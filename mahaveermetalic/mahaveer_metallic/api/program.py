# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Program (planning) flow — the screen one step past Cutting.

  Entry picker → one list of roll entries, each tagged with a STATE chip:
      "Cut"          a finished cutting (patty) with patti still available
      "In Inventory" a raw inward roll not yet cut → selecting it plans a "to cut"
                     program, finished from Cutting once the roll is bound
  Create        → an MM Program on a Machine + Shift (Day/Night). One patty = one
                  batch; the program holds `total_batches`, status starts "Running".
  Batch actions → complete_batches / revert_batches drive the lifecycle:
                  Running → Partially Done → Completed. Recording fewer batches than
                  planned takes the program OFF the machine and hands the batches it
                  did not run back to the picker; a reverted program can never be
                  completed again. Both of those leave material short of plan, so both
                  demand a typed reason, filed against the LOT (see api/lot_remark) —
                  the lot is what the operator meets again on the next screen.
  Close         → close_program locks the program (audit-tracked via track_changes).

PATTI ARE COUNTED, NOT CLAIMED. A cutting is available while it has patti left —
`total_patti_qty` minus `consumed_patti` — so one cut can feed several programs and a cut
that yielded more patti than the program that ordered it (6 cut against 4 batches) leaves
the rest available instead of losing them. `MM Program.patty_sources` records which
cutting each program's patti came from, so reverting gives back exactly its own.
Multiple machines, and multiple programs per machine, are supported.
"""

import json

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic.api import lot_remark


def _require_reason(reason, what="this"):
	"""Every path that leaves a lot short of plan has to say why, in words.

	The reason travels with the LOT, not the program, so the next person to meet this
	material — on the finished-patti list, in the picker, on the next inward — reads the
	same sentence. Three characters is the floor: "ok" is not a reason, and an operator
	who is forced to type something will type something true more often than not.
	"""
	reason = (reason or "").strip()
	if len(reason) < 3:
		frappe.throw(
			_("Please type why {0} — at least a few words. It is shown against this lot everywhere it appears.").format(what)
		)
	return reason


def _program_lots(doc):
	"""Every lot this program's material came off, as record() kwargs.

	The program's own field is authoritative when it is set. Otherwise the answer comes
	back through the patty it took — the only way a program planned off an uncut roll ever
	resolves a lot — and that CAN be more than one, because a program may draw patty from
	several cuttings of one colour. All of them are returned: a reason filed against only
	the first would leave the second lot unexplained on the very next screen it appears on.
	`program_lots` hands back a JOINED display id for the multi-lot case, so the ids are
	taken from its list and never from that string.

	May be empty — a program planned off an uncut roll has no lot until the roll is picked.
	"""
	if doc.get("lot"):
		return [{"lot": doc.get("lot")}]
	from mahaveermetalic.mahaveer_metallic.api.production import program_lots

	found = (program_lots([doc.name]) or {}).get(doc.name) or {}
	ids = found.get("lot_ids") or []
	if ids:
		return [{"lot_id": i} for i in ids]
	return [{"lot": found.get("lot")}] if found.get("lot") else []


def _file_reason(doc, reason, event_type):
	"""Record the reason against the program's lot(s) AND on the program's own history.

	Two places on purpose: the lot remark is what the floor sees on every later screen,
	the comment is what an admin sees when they open this one program and ask what
	happened to it. The program's `remark` field is the planning note and is left alone.
	"""
	filed = []
	for key in _program_lots(doc):
		name = lot_remark.record(
			reason=reason,
			event_type=event_type,
			program=doc.name,
			source_doctype="MM Program",
			source_name=doc.name,
			**key,
		)
		if name:
			filed.append(name)
	doc.add_comment("Comment", _("{0}: {1}").format(event_type, reason))
	return filed


def _party_map(orders):
	out = {}
	orders = [o for o in orders if o]
	if orders:
		for o in frappe.get_all("MM Sales Order", filters={"name": ["in", orders]}, fields=["name", "party"]):
			out[o.name] = o.party
	return out


# ── Patti accounting ─────────────────────────────────────────────────────────────────
# A cutting's patti are a countable stock, not a single claim: programs draw from it until
# it runs out. These four helpers are the only place that count changes, so availability,
# consumption and release can never drift apart.


def available_patti(cutting: dict) -> float:
	"""Patti of this cutting still available to program."""
	return round(float(cutting.get("total_patti_qty") or 0) - float(cutting.get("consumed_patti") or 0), 3)


def _cutting_for_patti(name: str) -> dict:
	row = frappe.db.get_value(
		"MM Cutting",
		name,
		["name", "docstatus", "status", "closed", "shade", "cut", "total_patti_qty", "consumed_patti",
		 "total_net_weight", "per_patty_weight", "program", "customer_order", "roll_no", "lot",
		 "branch", "location"],
		as_dict=True,
	)
	if not row:
		frappe.throw(_("Cutting {0} not found.").format(name))
	return row


def _take_patti(cutting_names, batches: int):
	"""Take `batches` patti across these cuttings, in the order given.

	Cuttings are offered to the picker merged by lot, so one card can stand for several
	cuttings of the same material — a program taking 6 batches off a card made of two
	3-patti cuts has to draw from both. Returns the per-cutting allocation; raises when
	there aren't enough patti to cover the ask, which is the guard that stops a program
	being planned against patti that don't exist.
	"""
	want = int(batches)
	taken, short_of = [], 0.0
	for name in cutting_names:
		if want <= 0:
			break
		row = _cutting_for_patti(name)
		free = available_patti(row)
		short_of += max(0.0, free)
		if free <= 0:
			continue
		use = min(float(want), free)
		taken.append({"cutting": name, "patti": round(float(use), 3), "shade": row.shade, "cut": row.cut, "row": row})
		want -= use
	if want > 0:
		frappe.throw(
			_("Only {0} patti are still available on this cut — {1} batches cannot be programmed. "
			  "Reduce the batches, or cut more.").format(round(short_of, 3), batches)
		)
	return taken


def _apply_patti(program: str, allocation) -> None:
	"""Record the take on the program and add it to each cutting's consumed count."""
	for a in allocation:
		frappe.get_doc(
			{
				"doctype": "MM Program Patty",
				"parent": program,
				"parenttype": "MM Program",
				"parentfield": "patty_sources",
				"cutting": a["cutting"],
				"patti": a["patti"],
				"shade": a.get("shade"),
				"cut": a.get("cut"),
			}
		).insert(ignore_permissions=True)
		row = _cutting_for_patti(a["cutting"])
		frappe.db.set_value(
			"MM Cutting",
			a["cutting"],
			"consumed_patti",
			round(float(row.consumed_patti or 0) + float(a["patti"]), 3),
			update_modified=False,
		)
		# The first program to draw from a cutting owns its `program` link — everything that
		# reads the old one-cutting-one-program signal (the cutting board, the processing
		# list) keeps working, while availability is now decided by the count.
		if not row.program:
			frappe.db.set_value("MM Cutting", a["cutting"], "program", program, update_modified=False)


def _hand_over_cutting_link(cutting: str, leaving: str) -> None:
	"""Pass a cutting's `program` link on when the program holding it lets go.

	The link is the old one-cutting-one-program signal, kept for the screens that still read
	it — but it names ONE program while several can now hold patti on the same cutting. When
	the named one releases, the link has to move to another program that still holds some,
	not simply stay: a submitted cutting pointing at a program BLOCKS that program's cancel,
	so a released program could not be cancelled while a second one held the rest of the cut.
	Nothing left holding it → cleared.
	"""
	heir = frappe.db.sql(
		"""
		select pp.parent
		from `tabMM Program Patty` pp
		join `tabMM Program` p on p.name = pp.parent
		where pp.cutting = %(cutting)s and pp.parent != %(leaving)s
			and pp.parenttype = 'MM Program' and p.docstatus < 2 and ifnull(pp.patti, 0) > 0
		order by pp.creation asc
		limit 1
		""",
		{"cutting": cutting, "leaving": leaving},
	)
	frappe.db.set_value(
		"MM Cutting", cutting, "program", heir[0][0] if heir else None, update_modified=False
	)


def _release_patti(program: str, count=None) -> float:
	"""Hand patti back — the ones this program did not run.

	`count` is how many to release (default: all of them). Released newest-take-first, so
	what goes back is the tail of what was taken. The cutting's `program` link is cleared
	once nothing of it is consumed any more, which is what puts it back in the picker under
	the old signal too.
	"""
	rows = frappe.get_all(
		"MM Program Patty",
		filters={"parent": program, "parenttype": "MM Program"},
		fields=["name", "cutting", "patti"],
		order_by="idx desc",
	)
	left = float("inf") if count in (None, "") else max(0.0, float(count))
	given_back = 0.0
	for r in rows:
		if left <= 0:
			break
		give = min(float(r.patti or 0), left)
		if give <= 0:
			continue
		row = _cutting_for_patti(r.cutting) if frappe.db.exists("MM Cutting", r.cutting) else None
		if row:
			consumed = round(max(0.0, float(row.consumed_patti or 0) - give), 3)
			frappe.db.set_value("MM Cutting", r.cutting, "consumed_patti", consumed, update_modified=False)
			if row.program == program:
				_hand_over_cutting_link(r.cutting, program)
		kept = round(float(r.patti or 0) - give, 3)
		if kept > 0:
			frappe.db.set_value("MM Program Patty", r.name, "patti", kept, update_modified=False)
		else:
			frappe.delete_doc("MM Program Patty", r.name, ignore_permissions=True, force=True)
		given_back += give
		left -= give
	return round(given_back, 3)


@frappe.whitelist()
def available_rolls(branch=None, location=None, finished_only=0):
	"""Entry picker: one unified list of roll entries with a state chip.

	Returns rows shaped for the modal — `state` is Cut (a finished patty) or In Inventory
	(a roll not cut yet); `source_type` + (`cutting` | `roll_inventory`) say how to create
	the program from that row. `finished_only` restricts to patties — the default
	Add-program list; the "search inventory" mode covers everything else.

	A patty is listed only while some of it is left: `batches` is what is still AVAILABLE, and
	one whose patti are all programmed is left out entirely — the list answers "what can go on
	a machine", and a spent patty is not an answer to that. Cuttings still in progress are NOT
	offered either: a program runs on patti that exist.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_cutting.mm_cutting import ceil2

	rows = []
	finished_only = int(finished_only or 0)

	# --- Cut: finished cuttings (patties), with however many patti they have left ---
	cut_filters = {"docstatus": 1, "status": "Completed", "closed": 0}
	if branch:
		cut_filters["branch"] = branch
	if location:
		cut_filters["location"] = location
	for c in frappe.get_all(
		"MM Cutting",
		filters=cut_filters,
		fields=["name", "posting_date", "customer_order", "roll_no", "shade", "cut",
			"job_work_flag", "total_patti_qty", "consumed_patti", "total_net_weight",
			"per_patty_weight", "lot"],
		order_by="modified desc",
		limit_page_length=500,
	):
		free = available_patti(c)
		# Spent — every patty of it is already in a program. Not offered.
		if free <= 0:
			continue
		per_patty = float(c.per_patty_weight or 0) or (
			ceil2(float(c.total_net_weight or 0) / float(c.total_patti_qty)) if c.total_patti_qty else 0.0
		)
		rows.append({
			"state": "Cut",
			"source_type": "cutting",
			"cutting": c.name,
			"inward_item": None,
			"date": c.posting_date,
			"customer_order": c.customer_order,
			"roll_no": c.roll_no,
			"shade": c.shade,
			"cut": c.cut,
			"job_work": c.job_work_flag,
			# `batches` is what can still be programmed, which is what the picker offers.
			"batches": int(free) if float(free).is_integer() else free,
			"total_patti": int(round(c.total_patti_qty or 0)),
			"consumed_patti": round(float(c.consumed_patti or 0), 3),
			# The weight still on it, at the per-patty rate a program actually takes.
			"weight": round(per_patty * free, 3) if per_patty else (c.total_net_weight or 0),
			# A cutting is consumed PER PATTY (one patty = one batch), so the per-patty
			# weight — not the cutting's total — is what a program actually takes.
			"per_patty": per_patty,
			"lot": c.lot,
		})

	# --- In Inventory: rolls physically in stock (MM Roll Inventory) — the same balances the
	# Inventory screen shows, allocated to an order or not. Skipped for finished_only (that's the
	# finished-patty feeder, which is cuttings only). Picking one plans a "to cut" program; the
	# actual roll is bound (weight fetched) at finish. ---
	if not finished_only:
		inv_conditions = ["(ifnull(ri.stock_weight, 0) > 0 or ifnull(ri.stock_box, 0) > 0)"]
		values = {}
		if branch:
			inv_conditions.append("ri.branch = %(branch)s")
			values["branch"] = branch
		if location:
			inv_conditions.append("ri.location = %(location)s")
			values["location"] = location
		for ri in frappe.db.sql(
			f"""
			select ri.name as roll_inventory, ri.color_name as shade, ri.roll_no as roll_no,
				ri.lot_number as lot_number, ri.stock_weight as weight, ri.stock_box as qty_box,
				ri.location as location, ri.branch as branch
			from `tabMM Roll Inventory` ri
			where {" and ".join(inv_conditions)}
			order by ri.modified desc
			""",
			values,
			as_dict=True,
		):
			rows.append({
				"state": "In Inventory",
				"source_type": "inventory",
				"cutting": None,
				"inward_item": None,
				"roll_inventory": ri.roll_inventory,
				"date": None,
				"customer_order": None,
				"lot_number": ri.lot_number,
				"roll_no": ri.roll_no or ri.lot_number,
				"shade": ri.shade,
				"cut": None,
				"job_work": 0,
				"batches": int(round(ri.qty_box or 0)) or 1,
				"weight": ri.weight or 0,
				# An inventory row is a whole roll — it has no patty division yet.
				"per_patty": 0.0,
			})

	_attach_lot_keys(rows)
	parties = _party_map([r["customer_order"] for r in rows])
	for r in rows:
		r["party"] = parties.get(r["customer_order"])
	return _merge_rows_by_lot(rows)


def _attach_lot_keys(rows):
	"""Give EVERY picker row both halves of its lot identity, in two queries.

	The two halves of the list come from tables that each hold a different half of it: a
	cutting is stamped with the MM Lot doc, a roll-inventory row only ever carried the
	printed id. A row that had neither key showed no lot-remark eye at all — which is the
	one place the operator most needs it, since an inventory row is exactly the material
	someone handed back. So the half each row has is used to look up the other.
	"""
	names = {r["lot"] for r in rows if r.get("lot")}
	ids = {r["lot_number"] for r in rows if not r.get("lot") and r.get("lot_number")}
	by_name, by_id = {}, {}
	if names:
		for row in frappe.get_all("MM Lot", filters={"name": ["in", list(names)]}, fields=["name", "lot_id"]):
			by_name[row.name] = row.lot_id
	if ids:
		for row in frappe.get_all("MM Lot", filters={"lot_id": ["in", list(ids)]}, fields=["name", "lot_id"]):
			by_id[row.lot_id] = row.name
	for r in rows:
		lot = r.get("lot")
		lot_id = by_name.get(lot) if lot else r.get("lot_number")
		r["lot"] = lot or by_id.get(r.get("lot_number"))
		r["lot_id"] = lot_id


def _merge_rows_by_lot(rows):
	"""Fold picker entries of the same lot into one, summing batches and weight.

	The same lot spread over several cuttings listed as several near-identical rows, so
	the operator had to add the batches up by eye before planning a program. Only rows
	that carry a lot AND come from a cutting merge — an inventory roll is a distinct
	physical roll, and rows without a lot can't be proven to be the same material.

	`merged_from` carries every cutting behind the card, because a program taking more
	batches than the first of them holds has to draw across the rest.
	"""
	merged = {}
	out = []
	for r in rows:
		if not r.get("lot") or r.get("source_type") != "cutting":
			out.append(r)
			continue
		key = (r["lot"], r.get("shade") or r.get("roll_no"), r.get("cut"), r.get("state"))
		head = merged.get(key)
		if not head:
			r["merged_from"] = [r["cutting"]]
			r["merged_count"] = 1
			merged[key] = r
			out.append(r)
			continue
		head["batches"] = round(float(head.get("batches") or 0) + float(r.get("batches") or 0), 3)
		head["total_patti"] = int(head.get("total_patti") or 0) + int(r.get("total_patti") or 0)
		head["consumed_patti"] = round(float(head.get("consumed_patti") or 0) + float(r.get("consumed_patti") or 0), 3)
		head["weight"] = round(float(head.get("weight") or 0) + float(r.get("weight") or 0), 3)
		head["merged_from"].append(r["cutting"])
		head["merged_count"] += 1
	for r in out:
		if r.get("source_type") == "cutting" and float(r.get("batches") or 0).is_integer():
			r["batches"] = int(float(r["batches"] or 0))
	return out


DEFAULT_MACHINE_COUNT = 5


def _ensure_default_machines():
	"""Seed machines 1..5 the first time the screen is opened.

	Commit explicitly: this runs inside list_machines, which is a GET — Frappe would
	otherwise roll the inserts back, leaving the board showing machines that were
	never persisted, so creating a program on them fails the MM Machine link check
	("Could not find Machine No: 1")."""
	if not frappe.db.count("MM Machine"):
		for i in range(1, DEFAULT_MACHINE_COUNT + 1):
			frappe.get_doc({"doctype": "MM Machine", "machine_no": str(i)}).insert(ignore_permissions=True)
		frappe.db.commit()


@frappe.whitelist()
def list_machines(branch=None):
	"""Machines for the grid, each with its closed state and how many active programs
	are currently on it. Auto-seeds the first four."""
	_ensure_default_machines()
	filters = {}
	if branch:
		filters["branch"] = branch
	machines = frappe.get_all(
		"MM Machine", filters=filters, fields=["name", "machine_no", "machine_name", "cut", "closed"],
		order_by="cast(machine_no as unsigned) asc, machine_no asc",
	)
	for m in machines:
		m["active_programs"] = frappe.db.count(
			"MM Program", {"machine_no": m["name"], "docstatus": 1, "released": 0}
		)
	return machines


@frappe.whitelist()
def add_machine(branch=None):
	"""The "+" button — create the next serial-numbered machine."""
	nums = [
		int(m.machine_no)
		for m in frappe.get_all("MM Machine", fields=["machine_no"])
		if str(m.machine_no).isdigit()
	]
	nxt = (max(nums) + 1) if nums else 1
	doc = frappe.get_doc({"doctype": "MM Machine", "machine_no": str(nxt), "branch": branch}).insert(
		ignore_permissions=True
	)
	return {"machine": doc.name, "machine_no": doc.machine_no}


@frappe.whitelist()
def remove_machine(machine):
	"""Remove a machine from the board. Only allowed when no program (active or
	historical, non-cancelled) references it — otherwise the link check would break
	the audit trail; close the machine instead in that case."""
	if not frappe.db.exists("MM Machine", machine):
		frappe.throw(_("Machine {0} not found.").format(machine))
	if frappe.db.count("MM Program", {"machine_no": machine, "docstatus": ["<", 2]}):
		frappe.throw(_("Machine {0} has programs on record and cannot be removed. Close it instead.").format(
			frappe.db.get_value("MM Machine", machine, "machine_no") or machine
		))
	frappe.delete_doc("MM Machine", machine, ignore_permissions=True)
	return {"machine": machine, "removed": True}


@frappe.whitelist()
def set_machine_cut(machine, cut=None):
	"""Set the machine's default Cut — every program run on it inherits this cut.
	Set once, changed only when needed."""
	if not frappe.db.exists("MM Machine", machine):
		frappe.throw(_("Machine {0} not found.").format(machine))
	frappe.db.set_value("MM Machine", machine, "cut", (cut or "").strip() or None)
	return {"machine": machine, "cut": cut}


@frappe.whitelist()
def programs_on_machine(machine):
	"""The active (not freed) programs currently sitting on a machine, with their batch
	progress — so the Close dialog can ask, per program, how many batches to revert."""
	return frappe.get_all(
		"MM Program",
		filters={"machine_no": machine, "docstatus": 1, "released": 0},
		fields=["name", "roll_no", "shade", "cut", "shift", "status",
			"total_batches", "completed_batches"],
		order_by="shift asc, modified desc",
	)


@frappe.whitelist()
def close_machine(machine, reverts=None, reason=None):
	"""Mark a machine faulty / not-working. The Close dialog asks, for each program on
	the machine, how many batches to revert; `reverts` carries those answers as
	[{"program": name, "batches": n}, ...]. Reverting reduces a program's completed
	batches (they return to waiting). Programs are NOT cancelled and their status is
	never freed. No new program can be planned here until the machine is reopened.

	Giving batches back here is the same event as a picker revert as far as the lot is
	concerned, so it carries a reason too — one typed once for the whole machine, since a
	machine going down is one story, and filed against each affected program's lot. A row
	may carry its own `reason` when the dialog asked per program. Nothing is asked when
	nothing is being reverted: closing an idle machine takes material from no one."""
	if not frappe.db.exists("MM Machine", machine):
		frappe.throw(_("Machine {0} not found.").format(machine))
	reverts = json.loads(reverts) if isinstance(reverts, str) else (reverts or [])
	applied = []
	for r in reverts:
		prog, n = r.get("program"), r.get("batches")
		if not prog or not n:
			continue
		row = frappe.db.get_value("MM Program", prog, ["machine_no", "completed_batches"], as_dict=True)
		if not row or row.machine_no != machine:
			frappe.throw(_("Program {0} is not on machine {1}.").format(prog, machine))
		why = _require_reason(
			r.get("reason") or reason,
			_("{0} batch(es) are being given back from program {1}").format(int(n), prog),
		)
		_file_reason(frappe.get_doc("MM Program", prog), why, "Force Closed")
		# `n` = batches to give back → new completed count = done − n. The program
		# stays on the (closed) machine, unlike a picker revert.
		applied.append(_save_batches(prog, max(0, int(row.completed_batches or 0) - int(n)), is_running=False))
	frappe.db.set_value("MM Machine", machine, "closed", 1)
	return {"machine": machine, "closed": True, "reverted": applied}


@frappe.whitelist()
def reopen_machine(machine):
	"""Reopen a machine so programs can be planned on it again."""
	if not frappe.db.exists("MM Machine", machine):
		frappe.throw(_("Machine {0} not found.").format(machine))
	frappe.db.set_value("MM Machine", machine, "closed", 0)
	return {"machine": machine, "closed": False}


@frappe.whitelist()
def free_program(program):
	"""Free a COMPLETED program off its machine so the slot opens for a new program
	(it then flows on to production)."""
	doc = frappe.get_doc("MM Program", program)
	if doc.status != "Completed":
		frappe.throw(_("Only a completed program can be freed."))
	if not doc.released:
		doc.released = 1
		doc.save(ignore_permissions=True)
	return {"program": doc.name, "released": True}


def _match_key(value):
	"""Colours and cuts are typed by hand on both sides — once on an order line, again on
	an inward — so spacing and case must never decide whether two of them are the same
	thing. "LGDT BSM", "lgdt bsm" and "LGDTBSM" all key alike."""
	return "".join(str(value or "").split()).lower()


@frappe.whitelist()
def order_options(party=None, customer_order=None, cut=None, color=None):
	"""Orders for the modal's "Customer Order" dropdown, matched to what is being programmed.

	A ROLL is only a form of its colour — it carries no cut until someone cuts it — so an
	order that asks for that colour is an order that roll can serve, whatever cut it wants
	it in. Colour alone decides the match: `color` is passed, `cut` is not.

	A PATTY has already been cut, so it is a colour AT a cut, and only an order asking for
	that colour IN that cut can take it. Both are passed and `color_cut_match` — the two
	on the SAME line, not merely both somewhere on the order — is what marks it.

	Only the matches come back — an order that cannot take what is on the machine is not an
	option, so it is not offered. With no colour at all (nothing picked yet) the plain list
	of pending orders is returned.

	Each one carries how much it asks for in that colour (`matched_weight` / `matched_box`,
	and `matched_cut_weight` / `matched_cut_box` at this cut), the cuts it wants it in
	(`matched_cuts`) and every colour on it (`colours`).

	"Pending" is docstatus 1 and not completed: approved by the office, still open. A draft
	or rejected order is not something the floor can program against.
	"""
	if not party and customer_order:
		party = frappe.db.get_value("MM Sales Order", customer_order, "party")

	vals = {
		"party": party or "",
		"ckey": _match_key(color),
		"cutkey": _match_key(cut),
	}

	# Matched-first is decided in SQL, not after the fact: with the ordering done here the
	# 200-row cap can only ever drop orders that DON'T want this colour.
	orders = frappe.db.sql(
		"""
		select so.name, so.party, pm.party_name, so.transaction_date, so.delivery_date,
			so.ordered_weight, so.inwarded_weight, so.required_weight,
			exists (
				select 1 from `tabMM Sales Order Item` soi
				where soi.parent = so.name and %(ckey)s <> ''
					and lower(replace(ifnull(soi.color_name, ''), ' ', '')) = %(ckey)s
			) as color_match,
			exists (
				select 1 from `tabMM Sales Order Item` soi
				where soi.parent = so.name and %(ckey)s <> '' and %(cutkey)s <> ''
					and lower(replace(ifnull(soi.color_name, ''), ' ', '')) = %(ckey)s
					and lower(replace(ifnull(soi.cut, ''), ' ', '')) = %(cutkey)s
			) as color_cut_match
		from `tabMM Sales Order` so
		left join `tabMM Party Master` pm on pm.name = so.party
		where so.docstatus = 1
			and ifnull(so.completed, 0) = 0
		order by color_cut_match desc, color_match desc,
			case when so.party = %(party)s then 0 else 1 end,
			so.delivery_date asc, so.modified desc
		limit 200
		""",
		vals,
		as_dict=True,
	)
	if not orders:
		return []

	# Raw SQL, not get_all: a child table read runs its own permission check against the
	# parent, and this list is opened by the floor, not by a System Manager.
	lines = frappe.db.sql(
		"""
		select soi.parent, soi.color_name, soi.cut, soi.qty_weight, soi.qty_box
		from `tabMM Sales Order Item` soi
		where soi.parent in %(names)s and soi.parenttype = 'MM Sales Order'
		""",
		{"names": [o.name for o in orders]},
		as_dict=True,
	)
	by_order = {}
	for line in lines:
		by_order.setdefault(line.parent, []).append(line)

	# The flags handed to the UI are re-derived here from the lines rather than kept from
	# SQL: the match and the weight shown beside it must come from the same reading of the
	# colour, or an order can be listed as a match with "0 kg" under it.
	for o in orders:
		colours, matched_cuts = [], []
		matched_weight = matched_cut_weight = 0.0
		# An order line is quantified in kg OR in boxes. Reporting only kg would print a
		# real match as "0 kg of LGDT BSM", which reads as nothing to make.
		matched_box = matched_cut_box = 0.0
		matched = matched_at_cut = False
		for line in by_order.get(o.name, []):
			shade = (line.color_name or "").strip()
			if shade and shade not in colours:
				colours.append(shade)
			if not vals["ckey"] or _match_key(shade) != vals["ckey"]:
				continue
			matched = True
			matched_weight += float(line.qty_weight or 0)
			matched_box += float(line.qty_box or 0)
			line_cut = (line.cut or "").strip()
			if line_cut and line_cut not in matched_cuts:
				matched_cuts.append(line_cut)
			# Colour and cut on ONE line. An order wanting this colour in 50/85 and some
			# other colour in 50/1.5 does not want THIS patty.
			if vals["cutkey"] and _match_key(line_cut) == vals["cutkey"]:
				matched_at_cut = True
				matched_cut_weight += float(line.qty_weight or 0)
				matched_cut_box += float(line.qty_box or 0)
		o["colours"] = colours
		o["matched_cuts"] = matched_cuts
		o["matched_weight"] = round(matched_weight, 3)
		o["matched_cut_weight"] = round(matched_cut_weight, 3)
		o["matched_box"] = round(matched_box, 3)
		o["matched_cut_box"] = round(matched_cut_box, 3)
		o["color_match"] = int(matched)
		o["color_cut_match"] = int(matched_at_cut)

	# Only what can actually take this program. A patty is judged on colour AND cut, a roll
	# on colour alone; with nothing picked yet there is nothing to judge against, so the
	# plain pending list stands. Filtered on the flags derived above, not on SQL's own
	# reading of the colour, so what is offered and what is shown beside it always agree.
	if vals["ckey"]:
		wanted = "color_cut_match" if vals["cutkey"] else "color_match"
		orders = [o for o in orders if o[wanted]]
	return orders


def _ensure_cutting_from_inward(inward_item, customer_order=None, job_work=0, batches=1, cut=None):
	"""A roll picked directly from inventory must still flow through cutting — create the
	cutting entry from it and mark it OPEN (the physical cut is still pending), so the
	inward→cutting→program chain holds and the cutting shows as Open (not Completed).
	`batches` sets the patty count (1 batch programmed → 1 patty). Returns the cutting name."""
	from mahaveermetalic.mahaveer_metallic.api import cutting as capi

	row = frappe.db.get_value(
		"MM Inward Item", inward_item, ["customer_order", "cut", "weight", "cutting"], as_dict=True
	)
	if not row:
		frappe.throw(_("Inward entry {0} not found.").format(inward_item))
	if row.cutting:
		return row.cutting  # already has a cutting — reuse it as-is
	res = capi.create_cutting(
		inward_items=[inward_item],
		customer_order=customer_order or row.customer_order,
		cut=cut or row.cut,
		weight=row.weight,
		no_of_patty=int(batches) or 1,
		job_work=job_work,
	)
	# Open, not Completed — the cut hasn't physically happened yet.
	frappe.db.set_value("MM Cutting", res["cutting"], "status", "Open", update_modified=False)
	return res["cutting"]


@frappe.whitelist()
def create_program(
	source_cutting=None,
	source_inward_item=None,
	machine_no=None,
	customer_order=None,
	total_batches=None,
	weight=None,
	program_date=None,
	shift=None,
	job_work=0,
	source_cuttings=None,
):
	"""Send patti into a new program on a machine.

	Takes a finished patty (`source_cutting`, or `source_cuttings` for a card that stands
	for several cuttings of one lot) OR a raw inward roll (`source_inward_item` → cutting
	auto-created). The program draws its batches out of the patti still available: a cutting
	with more patti than this program needs keeps the rest for the next one.
	"""
	if not source_cutting and not source_inward_item and not source_cuttings:
		frappe.throw(_("Select a patty or an inventory roll to program."))
	if machine_no and frappe.db.get_value("MM Machine", machine_no, "closed"):
		frappe.throw(_("Machine {0} is closed. Reopen it before planning a program on it.").format(machine_no))

	# The machine's Cut (if set) is the authoritative cut for everything run on it.
	machine_cut = frappe.db.get_value("MM Machine", machine_no, "cut") if machine_no else None

	from_inventory = bool(source_inward_item and not source_cutting)
	if from_inventory:
		req_batches = int(total_batches) if total_batches not in (None, "") else 1
		source_cutting = _ensure_cutting_from_inward(
			source_inward_item, customer_order, job_work, batches=req_batches, cut=machine_cut
		)

	# Every cutting the picked card stands for, first one first. A lot-merged card carries
	# several; a single patty carries itself.
	if isinstance(source_cuttings, str):
		source_cuttings = json.loads(source_cuttings or "[]")
	candidates = [c for c in ([source_cutting] + list(source_cuttings or [])) if c]
	seen = set()
	candidates = [c for c in candidates if not (c in seen or seen.add(c))]
	source_cutting = source_cutting or candidates[0]

	cut = _cutting_for_patti(source_cutting)
	# A cutting must be submitted to be programmed; an inventory roll comes through as an
	# Open cutting we just created.
	if not from_inventory and cut.docstatus != 1:
		frappe.throw(_("Only a submitted cutting can be sent to program."))

	batches = int(total_batches) if total_batches not in (None, "") else int(round(available_patti(cut) or 0)) or 1
	if batches <= 0:
		frappe.throw(_("Total Batches must be greater than 0."))
	# Take the patti now — this is the guard that a program can only run on patti that exist,
	# and it is what leaves a bigger cut's remainder available to the next program.
	allocation = _take_patti(candidates, batches)
	# One patty = one batch: the program carries per-patty weight × batches, which is what
	# Production then consumes. Falls back to the cutting's own per-patty (or whole) weight.
	from mahaveermetalic.mahaveer_metallic.doctype.mm_cutting.mm_cutting import ceil2

	per_patty = float(cut.per_patty_weight or 0)
	if not per_patty and cut.total_patti_qty:
		per_patty = ceil2(float(cut.total_net_weight or 0) / float(cut.total_patti_qty))
	if weight not in (None, ""):
		final_weight = float(weight)
	elif per_patty:
		final_weight = round(per_patty * batches, 3)
	else:
		final_weight = float(cut.total_net_weight or 0)

	# Programming something with no weight means the job runs on a weight of nothing —
	# refused here rather than at the cutting, so a PLANNED cut (weight not known until
	# its roll is bound) can still exist while a real one can never be programmed empty.
	if final_weight <= 0:
		frappe.throw(
			_("{0} has no weight recorded on its cutting, so there is nothing to program. "
			  "Set the net weight on the cutting first.").format(cut.shade or cut.roll_no or cut.name)
		)
	final_cut = machine_cut or cut.cut  # machine cut wins, per spec

	program = frappe.get_doc(
		{
			"doctype": "MM Program",
			"program_date": program_date or frappe.utils.nowdate(),
			"customer_order": customer_order or cut.customer_order,
			"source_cutting": cut.name,
			"lot": cut.lot,
			"source_inward_item": source_inward_item if from_inventory else None,
			"roll_no": cut.roll_no,
			"shade": cut.shade,
			"cut": final_cut,
			"machine_no": machine_no,
			"shift": shift or None,
			"is_running": 1,
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"branch": cut.branch,
			"location": cut.location,
			"total_batches": batches,
			"completed_batches": 0,
			"patti_qty": batches,
			"net_weight": round(final_weight, 3),
			# The rate one batch runs at — what the completed weight is derived from.
			"per_patty_weight": round(per_patty, 3) or round(final_weight / batches, 3),
		}
	)
	program.insert(ignore_permissions=True)
	program.submit()
	# Book the patti against the program: each cutting's consumed count goes up, and the
	# rows say who took what so a revert can hand back exactly this program's share.
	_apply_patti(program.name, allocation)

	# Leftover weight is recorded, and a cutting is closed out ONLY once it has no patty
	# left to offer.
	#
	# Taking fewer batches than a cutting could yield never closes it: patti the program
	# didn't take are not waste, they are stock the picker is still offering, and a closed
	# cutting drops out of the picker. But once every patty is spoken for, what remains is
	# a sliver of weight no patty can be made from — and if that sliver is inside the
	# configured tolerance it is closed out rather than left to clutter the shelf forever.
	#
	# `maybe_auto_close_cutting` applies the tolerance AND the rule that matters more here:
	# if an uncut roll of the same colour and lot is still in the system, nothing is closed.
	# That leftover is kept open deliberately so the next cutting of that lot adds onto it
	# instead of stranding it.
	from mahaveermetalic.mahaveer_metallic.api.closeout import maybe_auto_close_cutting

	for a in allocation:
		row = _cutting_for_patti(a["cutting"])
		programmed = float(row.per_patty_weight or 0) * float(row.consumed_patti or 0)
		leftover = max(0.0, round(float(row.total_net_weight or 0) - programmed, 3))
		frappe.db.set_value("MM Cutting", a["cutting"], "leftover_weight", leftover, update_modified=False)
		free_patti = float(row.total_patti_qty or 0) - float(row.consumed_patti or 0)
		if free_patti <= 0:
			maybe_auto_close_cutting(a["cutting"], leftover)
	return {
		"program": program.name,
		"status": program.status,
		"total_batches": program.total_batches,
		"patti_taken": [{"cutting": a["cutting"], "patti": a["patti"]} for a in allocation],
	}


@frappe.whitelist()
def available_colours(branch=None, location=None):
	"""Colour-first picker for Add-program: finished patty AND inventory rolls.

	Both, on purpose. A patty can go on a machine as it is; a roll cannot, but picking one
	plans the cut and the program together ("to cut"), which is a real way to fill a shift
	that has not been cut for yet. The PATTY SHELF on the page behind this is the patty-only
	view — this picker is where everything programmable is offered.

	A patty with no patti left is not listed either way: it cannot go on a machine, so it is
	not an option. Each colour lists its underlying source rows, so the UI can show the colour
	up front and still create from the right source."""
	rows = available_rolls(branch=branch, location=location)
	groups = {}
	order = []
	for r in rows:
		key = (r.get("shade") or "").strip() or "—"
		g = groups.get(key)
		if not g:
			g = groups[key] = {"colour": key, "rows": [], "states": [], "total_weight": 0.0, "by_state": {}}
			order.append(key)
		g["rows"].append(r)
		if r.get("state") and r["state"] not in g["states"]:
			g["states"].append(r["state"])
		g["total_weight"] += float(r.get("weight") or 0)
		# Weight PER SOURCE as well as the total. The card used to show only the sum, which
		# belongs to no single source: a colour with an empty cutting and 210 kg in
		# inventory read "210 kg", and programming then drew from the empty cutting.
		if r.get("state"):
			e = g["by_state"].setdefault(r["state"], {"weight": 0.0, "per_patty": 0.0, "batches": 0})
			e["weight"] = round(e["weight"] + float(r.get("weight") or 0), 3)
			e["batches"] += int(r.get("batches") or 0)
			# Per-patty is a rate, not a total — carry the largest seen rather than summing.
			e["per_patty"] = max(e["per_patty"], round(float(r.get("per_patty") or 0), 3))
	out = [groups[k] for k in order]
	for g in out:
		g["total_weight"] = round(g["total_weight"], 3)
		g["count"] = len(g["rows"])
		# The weight actually available to a program: the best source that has any.
		rank = {"Cut": 0, "In Inventory": 1}
		usable = sorted(
			(r for r in g["rows"] if float(r.get("weight") or 0) > 0),
			key=lambda r: rank.get(r.get("state"), 9),
		)
		g["programmable_weight"] = round(float(usable[0].get("weight") or 0), 3) if usable else 0.0
		g["programmable_state"] = usable[0].get("state") if usable else None
	# Colours with a finished patty first (readiest to program), then the rest.
	out.sort(key=lambda g: (0 if "Cut" in g["states"] else 1, g["colour"]))
	return out


@frappe.whitelist()
def program_inventory_search(color=None, branch=None, location=None):
	"""'Search a roll from inventory' for the Add-program modal — inventory rolls of a
	colour that still have stock. If a colour has no stock, nothing comes back."""
	from mahaveermetalic.mahaveer_metallic.api import inventory as invapi

	return invapi.rolls_by_colour(color=color, branch=branch, location=location)


@frappe.whitelist()
def create_unfinished_program(
	machine_no=None,
	color=None,
	roll_inventory=None,
	total_batches=None,
	remark=None,
	customer_order=None,
	program_date=None,
	shift=None,
	job_work=0,
):
	"""Plan a program straight from an inventory colour, BEFORE the physical cut.

	Creates an UNFINISHED program (weight 0) plus a placeholder Open cutting — the
	"planned cut". The cutting shows red on the Cutting board and the program is
	highlighted as unfinished until the operator picks the real roll at finish (which
	fetches its weight, consumes stock and posts the OUT ledger entry). Fewest clicks:
	colour + batches + remark and it's on the machine.
	"""
	if not color and not roll_inventory:
		frappe.throw(_("Enter a colour (or pick an inventory roll) to plan."))
	if machine_no and frappe.db.get_value("MM Machine", machine_no, "closed"):
		frappe.throw(_("Machine {0} is closed. Reopen it before planning a program on it.").format(machine_no))

	machine_cut = frappe.db.get_value("MM Machine", machine_no, "cut") if machine_no else None

	branch = location = None
	if roll_inventory:
		ri = frappe.db.get_value(
			"MM Roll Inventory", roll_inventory, ["color_name", "branch", "location"], as_dict=True
		)
		if ri:
			color = color or ri.color_name
			branch, location = ri.branch, ri.location

	batches = int(total_batches) if total_batches not in (None, "") else 1
	if batches <= 0:
		frappe.throw(_("Total Batches must be greater than 0."))

	# Guard against junk colours: a plan must reference stock that actually exists — either
	# a specific inventory roll, or a colour that has some stock. Prevents phantom plans
	# like a stray "s" colour with no roll behind it.
	if not roll_inventory:
		has_stock = frappe.db.sql(
			"""select 1 from `tabMM Roll Inventory`
			where color_name = %s and (ifnull(stock_weight, 0) > 0 or ifnull(stock_box, 0) > 0) limit 1""",
			(color,),
		)
		if not has_stock:
			frappe.throw(
				_("No inventory stock for colour '{0}'. Search and pick a colour/roll that exists in stock.").format(color)
			)

	# Placeholder Open cutting — the planned cut. Zero weight until the roll is bound.
	cutting = frappe.get_doc(
		{
			"doctype": "MM Cutting",
			"posting_date": program_date or frappe.utils.nowdate(),
			"customer_order": customer_order,
			"roll_no": color or "—",
			"shade": color,
			"cut": machine_cut,
			"status": "Open",
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"roll_qty": 0,
			# Marks the zero weight below as legitimate — see MMCutting._compute_patti_weights.
			# finish_unfinished clears it once the real roll (and its weight) is bound.
			"planned": 1,
			"branch": branch,
			"location": location,
			"patti_entries": [{"shade": color, "cut": machine_cut, "patti_qty": batches, "net_weight": 0}],
		}
	)
	cutting.insert(ignore_permissions=True)
	cutting.submit()

	program = frappe.get_doc(
		{
			"doctype": "MM Program",
			"program_date": program_date or frappe.utils.nowdate(),
			"customer_order": customer_order,
			"source_cutting": cutting.name,
			"roll_no": color or "—",
			"shade": color,
			"cut": machine_cut,
			"machine_no": machine_no,
			"shift": shift or None,
			"is_running": 0,  # unfinished sits as Open/planned until the roll is bound
			"unfinished": 1,
			"roll_inventory": roll_inventory or None,
			"remark": remark,
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"branch": branch,
			"location": location,
			"total_batches": batches,
			"completed_batches": 0,
			"patti_qty": batches,
			"net_weight": 0,
		}
	)
	program.insert(ignore_permissions=True)
	program.submit()
	frappe.db.set_value("MM Cutting", cutting.name, "program", program.name, update_modified=False)
	return {"program": program.name, "cutting": cutting.name, "unfinished": True}


@frappe.whitelist()
def finish_unfinished(program, roll_inventory=None, rolls=None, no_of_patty=None, cut=None,
	cutting_date=None, customer_order=None, job_work=None):
	"""Finish an unfinished (planned) program by binding the ACTUAL roll(s) from inventory.

	Inward is roll-wise, so several rolls can be picked for one cut: their weights are
	summed, each is consumed from stock with its own OUT ledger entry, and the placeholder
	cutting is completed with the combined weight, the patty count and per-patty weight
	(total ÷ patty, rounded up) that Program/Production then run on.
	"""
	doc = frappe.get_doc("MM Program", program)
	if not doc.unfinished:
		frappe.throw(_("Program {0} is already finished.").format(program))

	picked = rolls
	if isinstance(picked, str):
		picked = json.loads(picked or "[]")
	picked = [r for r in (picked or []) if r]
	if not picked:
		single = roll_inventory or doc.roll_inventory
		picked = [single] if single else []
	if not picked:
		frappe.throw(_("Select at least one roll from inventory to finish this program."))
	for r in picked:
		if not frappe.db.exists("MM Roll Inventory", r):
			frappe.throw(_("Roll {0} not found in inventory.").format(r))

	from mahaveermetalic.mahaveer_metallic import stock_ledger

	weight = 0.0
	first_ri = None
	for name in picked:
		ri = frappe.get_doc("MM Roll Inventory", name)
		w = round(float(ri.stock_weight or 0), 3)
		b = round(float(ri.stock_box or 0), 3)
		if w <= 0:
			frappe.throw(_("Roll {0} has no stock weight to consume.").format(name))
		first_ri = first_ri or ri
		weight += w
		# Consume the whole roll (its weight is fetched into the program) + OUT ledger.
		ri.stock_weight = 0
		ri.stock_box = 0
		ri.save(ignore_permissions=True)
		stock_ledger.post_movement(
			voucher_type="Cutting",
			voucher_no=doc.source_cutting or doc.name,
			branch=ri.branch,
			location=ri.location,
			lot_number=ri.lot_number,
			color_name=ri.color_name,
			roll_no=ri.roll_no,
			item_type=ri.item_type,
			out_weight=w,
			out_box=b,
			balance_weight=ri.stock_weight,
			balance_box=ri.stock_box,
			customer_order=customer_order or doc.customer_order,
			remarks=_("Program finish — roll cut into program {0}").format(doc.name),
		)
	weight = round(weight, 3)
	ri = first_ri
	# A colour-planned program has no branch/location until real rolls are bound — take
	# them from the roll now, otherwise Production has nowhere to stock its output.
	if ri is not None:
		fills = {}
		if not doc.branch and ri.branch:
			fills["branch"] = ri.branch
		if not doc.location and ri.location:
			fills["location"] = ri.location
		if fills:
			frappe.db.set_value("MM Program", doc.name, fills, update_modified=False)
			doc.reload()
		if doc.source_cutting and fills:
			frappe.db.set_value("MM Cutting", doc.source_cutting, fills, update_modified=False)

	# Complete the placeholder cutting with the real weight + patty count, and store the
	# per-patty weight (rounded up) that Production consumes as one batch.
	from mahaveermetalic.mahaveer_metallic.doctype.mm_cutting.mm_cutting import ceil2

	patty = int(no_of_patty) if no_of_patty not in (None, "") else int(doc.total_batches or 1) or 1
	per_patty = ceil2(weight / patty) if patty > 0 else weight
	if doc.source_cutting and frappe.db.exists("MM Cutting", doc.source_cutting):
		updates = {
			"status": "Completed",
			"total_net_weight": weight,
			"total_patti_qty": patty,
			"per_patty_weight": per_patty,
			"roll_no": (ri.roll_no if ri else None) or doc.roll_no,
			# The roll is bound and the weight is real — it is an ordinary cutting now, so
			# the zero-weight carve-out no longer applies to it.
			"planned": 0,
		}
		if cut:
			updates["cut"] = cut
		if cutting_date:
			updates["posting_date"] = cutting_date
		if customer_order:
			updates["customer_order"] = customer_order
		if job_work is not None:
			updates["job_work_flag"] = 1 if frappe.utils.cint(job_work) else 0
		# Carry the lot from the roll being cut (roll inventory holds the LT display id).
		if ri is not None and ri.lot_number:
			lot_doc = frappe.db.get_value(
				"MM Lot", {"lot_id": ri.lot_number, "color": ri.color_name}, "name"
			) or frappe.db.get_value("MM Lot", {"lot_id": ri.lot_number}, "name")
			if lot_doc:
				updates["lot"] = lot_doc
		frappe.db.set_value("MM Cutting", doc.source_cutting, updates, update_modified=False)
		if updates.get("lot"):
			frappe.db.set_value("MM Program", doc.name, "lot", updates["lot"], update_modified=False)
		# Keep the patti child row in step so the cutting's own totals stay consistent.
		child = frappe.db.get_value("MM Cutting Patti", {"parent": doc.source_cutting}, "name")
		if child:
			frappe.db.set_value(
				"MM Cutting Patti", child,
				{"patti_qty": patty, "net_weight": weight, "weight_per_patti": per_patty},
				update_modified=False,
			)

	# Bind the roll, pull its weight onto the program, mark it finished/running. Written
	# with db.set_value because net_weight / roll_no aren't allow_on_submit — a plain
	# doc.save on the submitted program would raise UpdateAfterSubmitError. Status is
	# re-derived here (same rule as MMProgram.derive_status) since we bypass validate.
	#
	# THE PROGRAM KEEPS THE BATCHES IT WAS PLANNED FOR. Cut 6 patti against a 4-batch
	# program and the program still runs 4 — the other 2 patti are not swept into it; they
	# stay on the cutting as available patty for whatever is programmed next. A cut that
	# came up SHORT is the one case that moves the plan: there are only so many patti, so
	# the program can't run more batches than exist.
	planned = int(doc.total_batches or 0) or patty
	total = min(planned, patty)
	done = max(0, min(int(doc.completed_batches or 0), total))
	status = "Completed" if (total and done >= total) else ("Partially Done" if done > 0 else "Running")
	prog_weight = round(per_patty * total, 3)
	frappe.db.set_value(
		"MM Program",
		doc.name,
		{
			"roll_inventory": picked[0],
			"net_weight": prog_weight,
			"total_batches": total,
			"patti_qty": total,
			"roll_no": (ri.roll_no if ri else None) or doc.roll_no,
			"unfinished": 0,
			"is_running": 1,
			"status": status,
			"per_patty_weight": per_patty,
			# Written here too: this path bypasses validate, so derive_completed_weight
			# doesn't run for it.
			"completed_weight": round(per_patty * done, 3),
		},
		update_modified=True,
	)
	# Book only this program's batches against the cut. The rest of the patti stay
	# unconsumed, which is exactly what makes them available to program.
	if doc.source_cutting:
		frappe.db.sql(
			"delete from `tabMM Program Patty` where parent = %s and parenttype = 'MM Program'", (doc.name,)
		)
		frappe.db.set_value("MM Cutting", doc.source_cutting, "consumed_patti", 0, update_modified=False)
		_apply_patti(
			doc.name,
			[{"cutting": doc.source_cutting, "patti": total, "shade": doc.shade, "cut": cut or doc.cut}],
		)
	return {"program": doc.name, "net_weight": prog_weight, "per_patty_weight": per_patty,
		"total_batches": total, "patti_cut": patty, "spare_patti": max(0, patty - total),
		"unfinished": False, "status": status}


def _save_batches(program, completed, is_running):
	"""Update the batch counters and let the controller re-derive status. Uses
	doc.save so the change is captured in the audit trail (track_changes)."""
	doc = frappe.get_doc("MM Program", program)
	if doc.closed:
		frappe.throw(_("Program {0} is closed and cannot be changed.").format(program))
	doc.completed_batches = max(0, min(int(completed), int(doc.total_batches or 0)))
	doc.is_running = 1 if is_running else 0
	doc.save(ignore_permissions=True)
	return {"program": doc.name, "status": doc.status, "completed_batches": doc.completed_batches,
		"total_batches": doc.total_batches}


@frappe.whitelist()
def complete_batches(program, completed=None, count=None, partial_keeps_machine=0, reason=None):
	"""Record how many batches are completed (via the Complete dialog).

	All of them → the program frees off the machine to Production automatically, no manual
	Free step. FEWER than planned → the program is done short: it leaves the machine and the
	batches it never ran are handed straight back to the picker, so nobody has to remember
	to Revert the remainder. (`partial_keeps_machine` keeps a short program on the machine —
	for callers that record progress as it happens rather than closing the job out.)

	A SHORT CLOSE-OUT NEEDS A REASON. Six batches planned and two recorded means four
	patti go back on offer in a state nobody can explain by looking at them, so the
	operator says why and the sentence is filed against the lot. Recording progress that
	keeps the machine (`partial_keeps_machine`) is not a close-out and asks for nothing.

	`reason` defaults to None rather than being positional-required so an older client
	does not 500 on the call; the enforcement is `_require_reason` on the short path.

	A reverted program is off the machine — completing on it is blocked.
	(`count` kept for backward-compat: increments by that many.)
	"""
	doc = frappe.db.get_value(
		"MM Program", program, ["completed_batches", "total_batches", "reverted"], as_dict=True
	)
	reason = (reason or "").strip() or None
	if not doc:
		frappe.throw(_("Program {0} not found.").format(program))
	if doc.reverted:
		frappe.throw(_("Program {0} was reverted — its batches can no longer be completed.").format(program))
	total = int(doc.total_batches or 0)
	if completed not in (None, ""):
		comp = max(0, min(int(completed), total))
	else:
		comp = max(0, min((doc.completed_batches or 0) + int(count or 1), total))

	if total > 0 and comp < total and not frappe.utils.cint(partial_keeps_machine):
		# Short of plan: keep what ran, free the slot, and give the rest back.
		reason = _require_reason(reason, _("only {0} of {1} batches were completed").format(comp, total))
		res = revert_batches(program, completed=comp, reason=reason, event_type="Partial Completion")
		res["auto_reverted"] = True
		res["returned_batches"] = total - comp
		return res

	# Recording progress that goes BACKWARDS — 4 done corrected to 2 — is the one case on
	# this path worth a reason: two patty that were on Production are being taken off it,
	# and the next shift sees a number that fell with nothing to explain it. A reason typed
	# here used to be accepted and then dropped on the floor, because only the short
	# close-out branch above ever read the argument.
	banked = int(doc.completed_batches or 0)
	if comp < banked:
		reason = _require_reason(reason, _("the completed count is being lowered from {0} to {1}").format(banked, comp))

	res = _save_batches(program, comp, is_running=True)
	if reason:
		prog = frappe.get_doc("MM Program", program)
		_file_reason(prog, reason, "Partial Completion" if comp < total else "Other")
	if total > 0 and comp >= total:
		# All done → free off the machine to Production automatically.
		frappe.db.set_value("MM Program", program, "released", 1, update_modified=False)
		res["released"] = True
	return res


def release_program_patti(doc, batches=None):
	"""Give this program's unrun patti back to the picker.

	`batches` is how many to return (None = all of them). The patti go back onto the
	cuttings they came from, which is what puts them on offer again; the cutting's `program`
	link is cleared once none of it is consumed any more, for everything still reading that
	older signal.

	Reverting a program and then cancelling it must not hand the same patti back twice, so a
	full release stamps `patti_released` and any later one is a no-op.
	"""
	if doc.get("patti_released") and batches in (None, ""):
		return 0.0
	released = _release_patti(doc.name, batches)
	# Programs created before patti were counted have no source rows: their whole claim is
	# the cutting's consumed count, so subtract this program's own batches from it. Subtract
	# — never zero — because another program may hold patti on the same cutting.
	if not released and not doc.get("patti_released") and doc.source_cutting \
			and frappe.db.exists("MM Cutting", doc.source_cutting):
		row = _cutting_for_patti(doc.source_cutting)
		give = float(batches) if batches not in (None, "") else float(doc.total_batches or row.total_patti_qty or 0)
		consumed = round(max(0.0, float(row.consumed_patti or 0) - give), 3)
		frappe.db.set_value("MM Cutting", doc.source_cutting, "consumed_patti", consumed, update_modified=False)
		if consumed <= 0 and row.program == doc.name:
			frappe.db.set_value("MM Cutting", doc.source_cutting, "program", None, update_modified=False)
		released = give
	if batches in (None, ""):
		frappe.db.set_value("MM Program", doc.name, "patti_released", 1, update_modified=False)
	return released


def _unwind_inventory_cutting(doc):
	"""If the cutting was auto-created from an inventory pick and the physical cut
	never happened (still Open), cancel it so the inward entries return to In
	Inventory (MM Cutting.on_cancel restores them). Must run AFTER the program is
	cancelled, or the cutting→program link blocks the cancel."""
	if not doc.source_inward_item or not doc.source_cutting:
		return
	cut = frappe.db.get_value("MM Cutting", doc.source_cutting, ["docstatus", "status"], as_dict=True)
	if cut and cut.docstatus == 1 and cut.status == "Open":
		cutting = frappe.get_doc("MM Cutting", doc.source_cutting)
		cutting.flags.ignore_permissions = True
		cutting.cancel()


@frappe.whitelist()
def revert_batches(program, completed=None, reason=None, event_type=None):
	"""Revert the UNCOMPLETED batches. By default keeps whatever is already completed on
	record and returns the rest to the Add-Program picker; the program leaves the machine.
	  · nothing completed yet → the program is cancelled outright, ALL its patti go back;
	    an inventory pick's auto-created cutting is unwound so the roll returns to In
	    Inventory, otherwise the patty returns to the Cut list.
	  · some completed → the done batches stay on record (flagged `reverted` — no further
	    completes), the program leaves the machine, and only the patti of the batches it
	    never ran go back to the picker. The ones it did run are spent.
	(`completed` may be passed to override; when omitted the current completed count is used.)

	A REASON IS REQUIRED. Reverting puts material back on offer that an operator chose not
	to run, and the next person to pick it up has to be told why — so the sentence is filed
	against the lot BEFORE anything is cancelled: a cancelled program is no longer a place
	a remark can be hung off, and losing the reason would leave the picker showing patti
	with no explanation at all. `reason` is None-defaulted on the signature only so an old
	client fails with a readable message instead of a 500.

	(`event_type` only labels the remark. A short close-out arrives here through
	complete_batches and is a partial completion, not somebody abandoning the job — the
	operator reading the eye icon later cares which of those it was.)
	"""
	doc = frappe.get_doc("MM Program", program)
	if doc.closed:
		frappe.throw(_("Program {0} is closed and cannot be changed.").format(program))
	total = int(doc.total_batches or 0)
	if completed in (None, ""):
		comp = max(0, min(int(doc.completed_batches or 0), total))
	else:
		comp = max(0, min(int(completed), total))

	reason = _require_reason(reason, _("this program is being reverted"))
	# Before the cancel below, never after it.
	_file_reason(doc, reason, event_type or ("Cancelled" if comp == 0 else "Reverted"))

	if comp == 0:
		# Nothing produced — the program never happened. Hand every patty back and clear the
		# cutting's link first (a submitted cutting pointing here would block the cancel),
		# cancel the program, THEN unwind an inventory pick's auto-created cutting.
		returned = release_program_patti(doc)
		doc.flags.ignore_permissions = True
		doc.cancel()
		_unwind_inventory_cutting(doc)
		return {"program": doc.name, "status": "Cancelled", "reverted": True,
			"completed_batches": 0, "total_batches": total, "returned_patti": returned}

	# Partial: keep what was done, free the slot, lock further completes, and hand back only
	# the patti of the batches that never ran — what did run is spent material.
	doc.completed_batches = comp
	doc.is_running = 0
	doc.reverted = 1
	doc.released = 1
	doc.save(ignore_permissions=True)
	returned = release_program_patti(doc, batches=max(0, total - comp))
	return {"program": doc.name, "status": doc.status, "reverted": True,
		"completed_batches": doc.completed_batches, "total_batches": total,
		"returned_patti": returned}


@frappe.whitelist()
def close_program(program):
	"""Close (lock) a program. Audit-tracked via the doctype's change history."""
	doc = frappe.get_doc("MM Program", program)
	if not doc.closed:
		doc.closed = 1
		doc.save(ignore_permissions=True)
	return {"program": doc.name, "closed": bool(doc.closed)}


@frappe.whitelist()
def threads_processing(branch=None, machine_no=None, program_date=None):
	"""Program grid — programs still on a machine (not freed), ready to group by
	machine + shift. Completed-but-not-freed programs stay visible (colour changed)
	until you free them. Pass program_date to plan a specific date (tonight / next day)."""
	filters = {"docstatus": 1, "released": 0}
	if branch:
		filters["branch"] = branch
	if machine_no:
		filters["machine_no"] = machine_no
	if program_date:
		filters["program_date"] = program_date
	rows = frappe.get_all(
		"MM Program",
		filters=filters,
		fields=["name", "program_date", "customer_order", "roll_no", "shade", "machine_no", "shift", "cut",
			"status", "is_running", "closed", "released", "reverted", "unfinished", "remark", "lot",
			"roll_inventory", "total_batches", "completed_batches", "patti_qty", "net_weight",
			# What actually came off the machine, and the rate it runs at.
			"completed_weight", "per_patty_weight"],
		# Stable insertion order (creation asc), so an earlier program keeps its slot and a
		# newly added one goes AFTER it — not the "modified desc" that reshuffled them.
		order_by="machine_no asc, shift asc, creation asc",
		limit_page_length=500,
	)
	# A program planned off an uncut roll has no lot of its own — its lot is only knowable
	# through the patty it drew. Resolving it here is what lets the board show that lot's
	# remark; without it the tile that most needs the eye is the one that never gets one.
	from mahaveermetalic.mahaveer_metallic.api.production import program_lots

	lots = program_lots([r.name for r in rows])
	for r in rows:
		found = lots.get(r.name) or {}
		r["lot"] = r.get("lot") or found.get("lot")
		# `lot_id` off program_lots is a DISPLAY string — ", ".join(...) when a program drew
		# patty from several cuttings. It reads correctly and looks up nothing, so the list
		# travels beside it and every remark lookup keys off that.
		ids = found.get("lot_ids") or ([found["lot_id"]] if found.get("lot_id") else [])
		r["lot_ids"] = ids
		r["lot_id"] = ids[0] if len(ids) == 1 else (found.get("lot_id") or None)
	return rows
