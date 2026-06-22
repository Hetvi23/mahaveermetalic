# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Cutting assignment flow (the "second" cutting screen).

Unlike the Roll-Inventory cutting (api is in the MM Cutting doctype controller via
`source_roll`), this flow is driven by **inward entries grouped by their order**:

  Left list   → in-stock inward entries grouped one-row-per-order
  Arrow modal → the individual inward entries that belong to that order
  Submit      → create an MM Cutting (records the order on the cutting only) and
                flag the selected inward entries as "In Cutting" so they leave the
                left list and surface on the right "In Cutting Processing" panel.

"In stock" = a submitted MM Inward's child row whose `cut_status` is still
"In Stock". Submitting an inward is what adds it to roll stock (SRS 5.4), so we
only ever consider docstatus=1 inwards here.
"""

import json

import frappe
from frappe import _


def _party_name(party):
	if not party:
		return None
	return frappe.db.get_value("MM Party Master", party, "name") or party


@frappe.whitelist()
def inward_stock_by_order(branch=None, location=None):
	"""Left panel: in-stock inward entries collapsed to one row per customer order.

	Returns, per order: the party, a roll summary, entry count (Qty), total weight
	and the latest challan date — enough to render the grouped list and open the
	drill-down modal.
	"""
	# A child row is "in stock" (available to cut) until it's linked to a cutting.
	# We key off the `cutting` link rather than `cut_status` so rows that predate the
	# cut_status field (NULL) are still treated as available.
	conditions = ["inw.docstatus = 1", "item.cutting is null", "item.customer_order is not null"]
	values = {}
	if branch:
		conditions.append("inw.branch = %(branch)s")
		values["branch"] = branch
	if location:
		conditions.append("inw.location = %(location)s")
		values["location"] = location

	rows = frappe.db.sql(
		f"""
		select
			item.customer_order        as customer_order,
			inw.party                  as party,
			item.roll_name             as roll_name,
			item.color_name            as color_name,
			item.challan_number        as challan_number,
			inw.posting_date           as inward_date,
			item.qty_box               as qty_box,
			item.weight                as weight
		from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where {" and ".join(conditions)}
		order by inw.posting_date desc, item.idx asc
		""",
		values,
		as_dict=True,
	)

	groups = {}
	for r in rows:
		order = r.customer_order
		g = groups.get(order)
		if not g:
			g = groups[order] = {
				"customer_order": order,
				"party": r.party,
				"party_name": _party_name(r.party),
				"rolls": [],
				"entry_count": 0,
				"total_qty_box": 0.0,
				"total_weight": 0.0,
				"latest_inward_date": r.inward_date,
			}
		if r.roll_name and r.roll_name not in g["rolls"]:
			g["rolls"].append(r.roll_name)
		g["entry_count"] += 1
		g["total_qty_box"] += float(r.qty_box or 0)
		g["total_weight"] += float(r.weight or 0)
		if r.inward_date and (not g["latest_inward_date"] or r.inward_date > g["latest_inward_date"]):
			g["latest_inward_date"] = r.inward_date

	out = list(groups.values())
	for g in out:
		g["total_weight"] = round(g["total_weight"], 3)
		g["total_qty_box"] = round(g["total_qty_box"], 3)
		g["roll_display"] = ", ".join(g["rolls"]) if g["rolls"] else None
	out.sort(key=lambda g: (g["latest_inward_date"] or ""), reverse=True)
	return out


@frappe.whitelist()
def inward_entries_for_order(customer_order):
	"""Modal: the individual in-stock inward entries that belong to one order."""
	if not customer_order:
		frappe.throw(_("Select an order."))
	return frappe.db.sql(
		"""
		select
			item.name           as inward_item,
			inw.name            as inward,
			inw.posting_date    as inward_date,
			item.challan_number as challan_number,
			item.customer_order as customer_order,
			item.roll_name      as roll_name,
			item.color_name     as color_name,
			item.cut            as cut,
			item.qty_box        as qty_box,
			item.weight         as weight,
			item.job_work       as job_work
		from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where inw.docstatus = 1
			and item.cutting is null
			and item.customer_order = %(order)s
		order by inw.posting_date asc, item.idx asc
		""",
		{"order": customer_order},
		as_dict=True,
	)


@frappe.whitelist()
def order_options_for_party(party, customer_order=None):
	"""Modal "Customer Order" dropdown — only the given party's orders.

	`party` can be passed directly, or derived from an order already on the group.
	"""
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


def _coerce_items(inward_items):
	if isinstance(inward_items, str):
		inward_items = json.loads(inward_items or "[]")
	return [i for i in (inward_items or []) if i]


@frappe.whitelist()
def create_cutting(
	inward_items,
	customer_order=None,
	cut=None,
	weight=None,
	no_of_patty=None,
	cutting_date=None,
	job_work=0,
	shade=None,
):
	"""Submit handler: assign the selected inward entries into a new MM Cutting.

	Records the order/cut on the cutting only (inward lines keep their own order);
	flags the selected inward entries "In Cutting" so they drop off the left list.
	"""
	names = _coerce_items(inward_items)
	if not names:
		frappe.throw(_("Select at least one inward entry to send to cutting."))

	# Pull the chosen rows, guarding that each is still in stock.
	entries = frappe.db.sql(
		"""
		select item.name, item.parent, item.cutting, item.customer_order,
			item.roll_name, item.color_name, item.cut, item.weight, inw.party
		from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where item.name in %(names)s
		""",
		{"names": tuple(names)},
		as_dict=True,
	)
	found = {e.name for e in entries}
	missing = [n for n in names if n not in found]
	if missing:
		frappe.throw(_("Inward entries no longer exist: {0}").format(", ".join(missing)))
	already = [e.name for e in entries if e.cutting]
	if already:
		frappe.throw(_("Some entries are already in cutting and can't be reassigned."))

	order = customer_order or entries[0].customer_order
	total_weight = float(weight) if weight not in (None, "") else sum(float(e.weight or 0) for e in entries)
	patti_qty = float(no_of_patty) if no_of_patty not in (None, "") else 1.0
	if patti_qty <= 0:
		frappe.throw(_("No of Patty must be greater than 0."))
	resolved_cut = cut or entries[0].cut
	resolved_shade = shade or entries[0].color_name
	roll_no = entries[0].roll_name or resolved_shade or "—"

	cutting = frappe.get_doc(
		{
			"doctype": "MM Cutting",
			"posting_date": cutting_date or frappe.utils.nowdate(),
			"customer_order": order,
			"roll_no": roll_no,
			"shade": resolved_shade,
			"cut": resolved_cut,
			"status": "In Progress",
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"roll_qty": len(names),
			"patti_entries": [
				{
					"shade": resolved_shade,
					"cut": resolved_cut,
					"patti_qty": patti_qty,
					"net_weight": round(total_weight, 3),
				}
			],
		}
	)
	cutting.insert(ignore_permissions=True)
	cutting.submit()

	# Flag the consumed inward entries (child rows of a submitted inward).
	for name in names:
		frappe.db.set_value(
			"MM Inward Item", name, {"cut_status": "In Cutting", "cutting": cutting.name}, update_modified=False
		)

	return {"cutting": cutting.name, "assigned": len(names)}


@frappe.whitelist()
def complete_cutting(cutting):
	"""Mark a cutting finished. A finished cutting becomes an available 'patty' on the
	Program screen's left list. Idempotent."""
	if not cutting:
		frappe.throw(_("Select a cutting."))
	doc = frappe.get_doc("MM Cutting", cutting)
	if doc.status != "Completed":
		doc.db_set("status", "Completed", update_modified=True)
	return {"cutting": doc.name, "status": doc.status}


@frappe.whitelist()
def cutting_board(branch=None):
	"""Cutting worklist board: ALL in-process and open cuttings, to be grouped by Cut
	(cut = column, each cutting = a card) on the screen."""
	filters = {"docstatus": 1, "status": ["in", ["In Progress", "Open"]]}
	if branch:
		filters["branch"] = branch
	return frappe.get_all(
		"MM Cutting",
		filters=filters,
		fields=[
			"name", "posting_date", "customer_order", "roll_no", "shade", "cut",
			"status", "roll_qty", "total_patti_qty", "total_net_weight", "program",
		],
		order_by="cut asc, modified desc",
		limit_page_length=500,
	)


@frappe.whitelist()
def set_cutting_status(cutting, status):
	"""Edit a cutting's status from the list (Draft / Open / In Progress / Completed)."""
	valid = ["Draft", "Open", "In Progress", "Completed"]
	if status not in valid:
		frappe.throw(_("Invalid status {0}.").format(status))
	doc = frappe.get_doc("MM Cutting", cutting)
	if doc.status != status:
		doc.db_set("status", status, update_modified=True)
	return {"cutting": doc.name, "status": status}


@frappe.whitelist()
def cutting_processing(branch=None):
	"""Right panel: cuttings currently in progress (created by this flow). Excludes
	cuttings already pulled into a program (those are tracked on the Program screen)."""
	filters = {
		"docstatus": 1,
		"status": ["in", ["In Progress", "Open"]],
		"roll_qty": [">", 0],
		"program": ["is", "not set"],
	}
	if branch:
		filters["branch"] = branch
	return frappe.get_all(
		"MM Cutting",
		filters=filters,
		fields=[
			"name",
			"posting_date",
			"customer_order",
			"roll_no",
			"cut",
			"roll_qty",
			"total_patti_qty",
			"total_net_weight",
			"status",
		],
		order_by="modified desc",
		limit_page_length=200,
	)
