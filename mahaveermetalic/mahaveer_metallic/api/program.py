# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Program (planning) flow — the screen one step past Cutting.

  Entry picker → one list of roll entries, each tagged with a STATE chip:
      "Cut"          a finished cutting (patty), ready to program
      "In Cutting"   a cutting still in progress (also selectable — programming it
                     is allowed while the physical cut is still running)
      "In Inventory" a raw inward roll not yet cut → selecting it auto-creates and
                     finishes its cutting, then programs it (the chain stays intact)
  Create        → an MM Program on a Machine + Shift (Day/Night). One patty = one
                  batch; the program holds `total_batches`, status starts "Running".
  Batch actions → complete_batches / revert_batches drive the lifecycle:
                  Running → Partially Done → Completed. Reverting takes the program
                  OFF the machine and returns the roll to wherever it came from
                  (cutting / inward), so it reappears in the entry picker; a
                  reverted program can never be completed again.
  Close         → close_program locks the program (audit-tracked via track_changes).

A finished cutting is an available patty once status='Completed' and its `program`
link is empty (the authoritative signal). Multiple machines, and multiple programs
per machine, are supported (each program is its own row).
"""

import json

import frappe
from frappe import _


def _party_map(orders):
	out = {}
	orders = [o for o in orders if o]
	if orders:
		for o in frappe.get_all("MM Sales Order", filters={"name": ["in", orders]}, fields=["name", "party"]):
			out[o.name] = o.party
	return out


@frappe.whitelist()
def available_rolls(branch=None, location=None, finished_only=0):
	"""Entry picker: one unified list of roll entries with a state chip.

	Returns rows shaped for the modal — `state` is one of Cut / In Cutting / In
	Inventory; `source_type` + (`cutting` | `inward_item`) say how to create the
	program from that row. `finished_only` restricts to finished cuttings (Cut) — the
	default Add-program list; the "search inventory" mode covers everything else.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_cutting.mm_cutting import ceil2

	rows = []
	finished_only = int(finished_only or 0)

	# --- Cut: finished cuttings (patties) not yet programmed ---
	cut_filters = {"docstatus": 1, "status": "Completed", "program": ["is", "not set"], "closed": 0}
	# --- In Cutting: cuttings still in progress (selectable — programming ahead of the cut is allowed) ---
	prog_filters = {"docstatus": 1, "status": ["!=", "Completed"], "program": ["is", "not set"], "closed": 0}
	states = (("Cut", cut_filters),) if finished_only else (("Cut", cut_filters), ("In Cutting", prog_filters))
	for state, filters in states:
		if branch:
			filters["branch"] = branch
		if location:
			filters["location"] = location
		for c in frappe.get_all(
			"MM Cutting",
			filters=filters,
			fields=["name", "posting_date", "customer_order", "roll_no", "shade", "cut",
				"job_work_flag", "total_patti_qty", "total_net_weight", "per_patty_weight", "lot"],
			order_by="modified desc",
			limit_page_length=500,
		):
			rows.append({
				"state": state,
				"source_type": "cutting",
				"cutting": c.name,
				"inward_item": None,
				"date": c.posting_date,
				"customer_order": c.customer_order,
				"roll_no": c.roll_no,
				"shade": c.shade,
				"cut": c.cut,
				"job_work": c.job_work_flag,
				"batches": int(round(c.total_patti_qty or 0)),
				"weight": c.total_net_weight or 0,
				# A cutting is consumed PER PATTY (one patty = one batch), so the per-patty
				# weight — not the cutting's total — is what a program actually takes.
				"per_patty": float(c.per_patty_weight or 0) or (
					ceil2(float(c.total_net_weight or 0) / float(c.total_patti_qty))
					if c.total_patti_qty else 0.0
				),
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
				"roll_no": ri.roll_no or ri.lot_number,
				"shade": ri.shade,
				"cut": None,
				"job_work": 0,
				"batches": int(round(ri.qty_box or 0)) or 1,
				"weight": ri.weight or 0,
				# An inventory row is a whole roll — it has no patty division yet.
				"per_patty": 0.0,
			})

	parties = _party_map([r["customer_order"] for r in rows])
	for r in rows:
		r["party"] = parties.get(r["customer_order"])
	return _merge_rows_by_lot(rows)


def _merge_rows_by_lot(rows):
	"""Fold picker entries of the same lot into one, summing batches and weight.

	The same lot spread over several cuttings listed as several near-identical rows, so
	the operator had to add the batches up by eye before planning a program. Only rows
	that carry a lot AND come from a cutting merge — an inventory roll is a distinct
	physical roll, and rows without a lot can't be proven to be the same material.
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
		head["batches"] = int(head.get("batches") or 0) + int(r.get("batches") or 0)
		head["weight"] = round(float(head.get("weight") or 0) + float(r.get("weight") or 0), 3)
		head["merged_from"].append(r["cutting"])
		head["merged_count"] += 1
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
def close_machine(machine, reverts=None):
	"""Mark a machine faulty / not-working. The Close dialog asks, for each program on
	the machine, how many batches to revert; `reverts` carries those answers as
	[{"program": name, "batches": n}, ...]. Reverting reduces a program's completed
	batches (they return to waiting). Programs are NOT cancelled and their status is
	never freed. No new program can be planned here until the machine is reopened."""
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


@frappe.whitelist()
def order_options_for_party(party=None, customer_order=None):
	"""Modal "Customer Order" dropdown — only the given party's orders."""
	if not party and customer_order:
		party = frappe.db.get_value("MM Sales Order", customer_order, "party")
	if not party:
		return []
	return frappe.get_all(
		"MM Sales Order",
		filters={"party": party, "docstatus": 1},
		fields=["name", "transaction_date", "delivery_date", "ordered_weight", "required_weight"],
		order_by="delivery_date asc, modified desc",
		limit_page_length=100,
	)


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
):
	"""Send a roll into a new program on a machine. Accepts a finished cutting
	(source_cutting) OR a raw inward roll (source_inward_item → cutting auto-created)."""
	if not source_cutting and not source_inward_item:
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

	cut = frappe.db.get_value(
		"MM Cutting",
		source_cutting,
		["name", "docstatus", "status", "program", "customer_order", "roll_no", "shade",
		 "cut", "total_patti_qty", "total_net_weight", "per_patty_weight", "lot", "branch", "location"],
		as_dict=True,
	)
	if not cut:
		frappe.throw(_("Cutting {0} not found.").format(source_cutting))
	# Any submitted cutting can be programmed — finished (Cut) or still in progress
	# (In Cutting); an inventory roll comes through as an Open cutting we just created.
	if not from_inventory and cut.docstatus != 1:
		frappe.throw(_("Only a submitted cutting can be sent to program."))
	if cut.program:
		frappe.throw(_("This patty is already in a program ({0}).").format(cut.program))

	batches = int(total_batches) if total_batches not in (None, "") else int(round(cut.total_patti_qty or 0)) or 1
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
		}
	)
	program.insert(ignore_permissions=True)
	program.submit()
	frappe.db.set_value("MM Cutting", cut.name, "program", program.name, update_modified=False)

	# The program may take fewer batches than this cutting could yield — the unused weight
	# is a leftover. Close it out when it's within tolerance and no more of this colour+lot
	# is on the way (otherwise it stays open so the next cutting adds onto it).
	leftover = round(float(cut.total_net_weight or 0) - final_weight, 3)
	if leftover > 0:
		from mahaveermetalic.mahaveer_metallic.api.closeout import maybe_auto_close_cutting

		frappe.db.set_value("MM Cutting", cut.name, "leftover_weight", leftover, update_modified=False)
		maybe_auto_close_cutting(cut.name, leftover)
	return {"program": program.name, "status": program.status, "total_batches": program.total_batches}


@frappe.whitelist()
def available_colours(branch=None, location=None):
	"""Colour-first picker for Add-program: the colours available to program right now,
	aggregated across finished patties (Cut), in-progress cuttings (In Cutting) and
	inventory rolls (In Inventory). Each colour lists its underlying source rows (so the
	UI can show only the colour up front, then create from the right source)."""
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
		# The weight actually available to a program: the best source that has any, in the
		# same order the picker prefers them (patty → in cutting → inventory).
		rank = {"Cut": 0, "In Cutting": 1, "In Inventory": 2}
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
	# One patty = one batch: the actual cut decides how many batches run, and the program
	# carries per-patty × batches (what Production consumes).
	total = patty
	done = max(0, min(int(doc.completed_batches or 0), total))
	status = "Completed" if (total and done >= total) else ("Partially Done" if done > 0 else "Running")
	prog_weight = round(per_patty * patty, 3)
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
		},
		update_modified=True,
	)
	return {"program": doc.name, "net_weight": prog_weight, "per_patty_weight": per_patty,
		"total_batches": total, "unfinished": False, "status": status}


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
def complete_batches(program, completed=None, count=None):
	"""Record how many batches are completed (via the Complete dialog). Sets the count
	directly. When ALL batches are done the program auto-frees to Production — no manual
	Free step. A reverted program is off the machine — completing on it is blocked.
	(`count` kept for backward-compat: increments by that many.)"""
	doc = frappe.db.get_value(
		"MM Program", program, ["completed_batches", "total_batches", "reverted"], as_dict=True
	)
	if not doc:
		frappe.throw(_("Program {0} not found.").format(program))
	if doc.reverted:
		frappe.throw(_("Program {0} was reverted — its batches can no longer be completed.").format(program))
	total = int(doc.total_batches or 0)
	if completed not in (None, ""):
		comp = max(0, min(int(completed), total))
	else:
		comp = max(0, min((doc.completed_batches or 0) + int(count or 1), total))
	res = _save_batches(program, comp, is_running=True)
	if total > 0 and comp >= total:
		# All done → free off the machine to Production automatically.
		frappe.db.set_value("MM Program", program, "released", 1, update_modified=False)
		res["released"] = True
	return res


def _clear_cutting_link(doc):
	"""Clear the cutting's program link so the patty reappears in the entry picker
	(→ back to the Cut / In Cutting list)."""
	if doc.source_cutting and frappe.db.exists("MM Cutting", doc.source_cutting):
		frappe.db.set_value("MM Cutting", doc.source_cutting, "program", None, update_modified=False)


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
def revert_batches(program, completed=None):
	"""Revert the UNCOMPLETED batches. By default keeps whatever is already completed on
	record and returns the rest to the Add-Program picker; the program leaves the machine.
	  · nothing completed yet → the program is cancelled outright; an inventory pick's
	    auto-created cutting is unwound so the roll returns to In Inventory, otherwise the
	    patty returns to the Cut / In Cutting list.
	  · some completed → the done batches stay on record (flagged `reverted` — no further
	    completes), the program leaves the machine, and the remainder returns to the picker.
	(`completed` may be passed to override; when omitted the current completed count is used.)
	"""
	doc = frappe.get_doc("MM Program", program)
	if doc.closed:
		frappe.throw(_("Program {0} is closed and cannot be changed.").format(program))
	total = int(doc.total_batches or 0)
	if completed in (None, ""):
		comp = max(0, min(int(doc.completed_batches or 0), total))
	else:
		comp = max(0, min(int(completed), total))

	if comp == 0:
		# Nothing produced — the program never happened. Clear the cutting's link
		# first (a submitted cutting pointing here would block the cancel), cancel
		# the program, THEN unwind an inventory pick's auto-created cutting.
		_clear_cutting_link(doc)
		doc.flags.ignore_permissions = True
		doc.cancel()
		_unwind_inventory_cutting(doc)
		return {"program": doc.name, "status": "Cancelled", "reverted": True,
			"completed_batches": 0, "total_batches": total}

	# Partial: keep what was done, free the slot, lock further completes,
	# and hand the patty back to the picker for the rest.
	doc.completed_batches = comp
	doc.is_running = 0
	doc.reverted = 1
	doc.released = 1
	doc.save(ignore_permissions=True)
	_clear_cutting_link(doc)
	return {"program": doc.name, "status": doc.status, "reverted": True,
		"completed_batches": doc.completed_batches, "total_batches": total}


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
	return frappe.get_all(
		"MM Program",
		filters=filters,
		fields=["name", "program_date", "customer_order", "roll_no", "shade", "machine_no", "shift", "cut",
			"status", "is_running", "closed", "released", "reverted", "unfinished", "remark",
			"roll_inventory", "total_batches", "completed_batches", "patti_qty", "net_weight"],
		# Stable insertion order (creation asc), so an earlier program keeps its slot and a
		# newly added one goes AFTER it — not the "modified desc" that reshuffled them.
		order_by="machine_no asc, shift asc, creation asc",
		limit_page_length=500,
	)
