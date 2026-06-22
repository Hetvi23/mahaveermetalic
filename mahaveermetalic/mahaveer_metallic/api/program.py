# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Program (planning) flow — the screen one step past Cutting.

  Entry picker → one list of roll entries, each tagged with a STATE chip:
      "Cut"          a finished cutting (patty), ready to program
      "In Cutting"   a cutting still in progress (shown, not selectable)
      "In Inventory" a raw inward roll not yet cut → selecting it auto-creates and
                     finishes its cutting, then programs it (the chain stays intact)
  Create        → an MM Program on a Machine + Shift (Day/Night). One patty = one
                  batch; the program holds `total_batches`, status starts "Running".
  Batch actions → complete_batches / revert_batches drive the lifecycle:
                  Running → Partially Done → Completed, and Revert (full → Open).
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
def available_rolls(branch=None, location=None):
	"""Entry picker: one unified list of roll entries with a state chip.

	Returns rows shaped for the modal — `state` is one of Cut / In Cutting / In
	Inventory; `source_type` + (`cutting` | `inward_item`) say how to create the
	program from that row.
	"""
	rows = []

	# --- Cut: finished cuttings (patties) not yet programmed ---
	cut_filters = {"docstatus": 1, "status": "Completed", "program": ["is", "not set"]}
	# --- In Cutting: cuttings still in progress (shown for visibility) ---
	prog_filters = {"docstatus": 1, "status": ["!=", "Completed"], "program": ["is", "not set"]}
	for state, filters in (("Cut", cut_filters), ("In Cutting", prog_filters)):
		if branch:
			filters["branch"] = branch
		if location:
			filters["location"] = location
		for c in frappe.get_all(
			"MM Cutting",
			filters=filters,
			fields=["name", "posting_date", "customer_order", "roll_no", "shade", "cut",
				"job_work_flag", "total_patti_qty", "total_net_weight"],
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
			})

	# --- In Inventory: submitted inward rolls not yet sent to cutting ---
	inv_conditions = ["inw.docstatus = 1", "item.cutting is null", "item.customer_order is not null"]
	values = {}
	if branch:
		inv_conditions.append("inw.branch = %(branch)s")
		values["branch"] = branch
	if location:
		inv_conditions.append("inw.location = %(location)s")
		values["location"] = location
	for it in frappe.db.sql(
		f"""
		select item.name as inward_item, inw.posting_date as date, item.customer_order as customer_order,
			item.roll_name as roll_no, item.color_name as shade, item.cut as cut,
			item.job_work as job_work, item.qty_box as qty_box, item.weight as weight
		from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where {" and ".join(inv_conditions)}
		order by inw.posting_date desc, item.idx asc
		""",
		values,
		as_dict=True,
	):
		rows.append({
			"state": "In Inventory",
			"source_type": "inward",
			"cutting": None,
			"inward_item": it.inward_item,
			"date": it.date,
			"customer_order": it.customer_order,
			"roll_no": it.roll_no,
			"shade": it.shade,
			"cut": it.cut,
			"job_work": it.job_work,
			"batches": int(round(it.qty_box or 0)) or 1,
			"weight": it.weight or 0,
		})

	parties = _party_map([r["customer_order"] for r in rows])
	for r in rows:
		r["party"] = parties.get(r["customer_order"])
	return rows


DEFAULT_MACHINE_COUNT = 4


def _ensure_default_machines():
	"""Seed machines 1..4 the first time the screen is opened."""
	if not frappe.db.count("MM Machine"):
		for i in range(1, DEFAULT_MACHINE_COUNT + 1):
			frappe.get_doc({"doctype": "MM Machine", "machine_no": str(i)}).insert(ignore_permissions=True)


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
		if frappe.db.get_value("MM Program", prog, "machine_no") != machine:
			frappe.throw(_("Program {0} is not on machine {1}.").format(prog, machine))
		applied.append(revert_batches(prog, n))
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
		filters={"party": party, "docstatus": ["<", 2]},
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
		 "cut", "total_patti_qty", "total_net_weight", "branch", "location"],
		as_dict=True,
	)
	if not cut:
		frappe.throw(_("Cutting {0} not found.").format(source_cutting))
	# Picking an existing patty must be a finished cutting; an inventory roll comes through
	# as an Open cutting we just created.
	if not from_inventory and (cut.docstatus != 1 or cut.status != "Completed"):
		frappe.throw(_("Only a finished (Completed) cutting can be sent to program."))
	if cut.program:
		frappe.throw(_("This patty is already in a program ({0}).").format(cut.program))

	batches = int(total_batches) if total_batches not in (None, "") else int(round(cut.total_patti_qty or 0)) or 1
	final_weight = float(weight) if weight not in (None, "") else float(cut.total_net_weight or 0)
	final_cut = machine_cut or cut.cut  # machine cut wins, per spec

	program = frappe.get_doc(
		{
			"doctype": "MM Program",
			"program_date": program_date or frappe.utils.nowdate(),
			"customer_order": customer_order or cut.customer_order,
			"source_cutting": cut.name,
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
	return {"program": program.name, "status": program.status, "total_batches": program.total_batches}


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
def complete_batches(program, count=1):
	"""Mark `count` more batches finished (caps at total). Drives Partially Done → Completed."""
	doc = frappe.db.get_value("MM Program", program, ["completed_batches"], as_dict=True)
	if not doc:
		frappe.throw(_("Program {0} not found.").format(program))
	return _save_batches(program, (doc.completed_batches or 0) + int(count), is_running=True)


@frappe.whitelist()
def revert_batches(program, completed=None):
	"""Revert: you report how many batches were actually completed; the remaining
	(total − completed) return to the Open/waiting state. completed=0 → fully Open,
	0<completed<total → Partially Done (rest open), completed=total → Completed."""
	row = frappe.db.get_value("MM Program", program, ["total_batches", "completed_batches"], as_dict=True)
	if not row:
		frappe.throw(_("Program {0} not found.").format(program))
	total = int(row.total_batches or 0)
	comp = 0 if completed in (None, "") else max(0, min(int(completed), total))
	# is_running False so completed==0 lands on Open (not Running)
	return _save_batches(program, comp, is_running=False)


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
		fields=["name", "program_date", "customer_order", "roll_no", "machine_no", "shift", "cut",
			"status", "is_running", "closed", "released", "total_batches", "completed_batches",
			"patti_qty", "net_weight"],
		order_by="machine_no asc, shift asc, modified desc",
		limit_page_length=500,
	)
