# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Cutting assignment flow (the "second" cutting screen).

Unlike the Roll-Inventory cutting (api is in the MM Cutting doctype controller via
`source_roll`), this flow is driven by **inward entries grouped by their order**:

  Left list   → in-stock inward rolls, one row per roll
  Arrow modal → that roll's order's in-stock rolls, one of which is cut
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
def inward_stock_rolls(branch=None, location=None):
	"""Left panel: every in-stock inward roll, ONE ROW PER ROLL.

	Inward is roll-wise — a lot is many rolls weighed under one line — so collapsing the
	panel to one row per order (which is what it used to do) showed a lot's rolls as a
	single figure and made the operator open a modal to find out what was actually there.
	A cut is started against a roll, so the roll is the row.

	A roll with no number of its own is still a roll; it comes back with an empty
	`roll_name` and the screen renders it as a dash rather than dropping it.
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
			item.name                  as inward_item,
			inw.name                   as inward,
			item.customer_order        as customer_order,
			inw.party                  as party,
			item.roll_name             as roll_name,
			item.lot_number            as lot_number,
			item.color_name            as color_name,
			item.cut                   as cut,
			item.challan_number        as challan_number,
			inw.posting_date           as inward_date,
			item.qty_box               as qty_box,
			item.weight                as weight,
			item.job_work              as job_work,
			inw.branch                 as branch,
			inw.location               as location
		from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where {" and ".join(conditions)}
		order by inw.posting_date desc, inw.name desc, item.idx asc
		""",
		values,
		as_dict=True,
	)
	for r in rows:
		r["party_name"] = _party_name(r.party)
		r["weight"] = round(float(r.weight or 0), 3)
		r["qty_box"] = round(float(r.qty_box or 0), 3)
	return _drop_reserved(rows)


def _drop_reserved(rows):
	"""Take out rolls a live program has already booked.

	The Program screen's picker has excluded these for a while; this one did not, so a
	roll chosen for a program was still offered here and could be cut for something else.
	Stock is per roll now, so a booked roll is identified exactly — branch, location, lot,
	colour and the roll's own number — rather than by its lot, which would have taken every
	sibling roll of that lot out with it.
	"""
	from mahaveermetalic.mahaveer_metallic.api.inventory import reserved_roll_names

	reserved = reserved_roll_names()
	if not reserved or not rows:
		return rows
	booked = {
		(r.branch or "", r.location or "", r.lot_number or "", r.color_name or "", r.roll_no or "")
		for r in frappe.get_all(
			"MM Roll Inventory",
			filters={"name": ["in", list(reserved)]},
			fields=["branch", "location", "lot_number", "color_name", "roll_no"],
		)
	}
	return [
		r for r in rows
		if (r.get("branch") or "", r.get("location") or "", r.get("lot_number") or "",
			r.get("color_name") or "", r.get("roll_name") or "") not in booked
	]


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
	# Only APPROVED (submitted) orders — a pending order can't be worked downstream.
	return frappe.get_all(
		"MM Sales Order",
		filters={"party": party, "docstatus": 1},
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
			item.roll_name, item.color_name, item.cut, item.weight, inw.party, inw.lot as lot
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
	if order:
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import assert_order_submitted

		assert_order_submitted(order)
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
			"lot": entries[0].get("lot"),
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
def create_manual_cutting(
	customer_order=None, shade=None, cut=None, roll_no=None,
	patti_qty=None, weight=None, cutting_date=None, job_work=0,
):
	"""Add a cutting by hand (the Cutting screen's "New cutting" button) — not tied to a
	specific inward entry. Creates a submitted In-Progress cutting with one patty row."""
	shade = (shade or "").strip()
	if not shade:
		frappe.throw(_("Enter the colour / shade."))
	pq = float(patti_qty) if patti_qty not in (None, "") else 1.0
	if pq <= 0:
		frappe.throw(_("No of Patty must be greater than 0."))
	wt = float(weight) if weight not in (None, "") else 0.0
	if wt <= 0:
		frappe.throw(_("Enter the weight."))
	resolved_cut = (cut or "").strip() or None
	cutting = frappe.get_doc(
		{
			"doctype": "MM Cutting",
			"posting_date": cutting_date or frappe.utils.nowdate(),
			"customer_order": customer_order or None,
			"roll_no": roll_no or shade,
			"shade": shade,
			"cut": resolved_cut,
			"status": "In Progress",
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"roll_qty": 1,
			"patti_entries": [{"shade": shade, "cut": resolved_cut, "patti_qty": pq, "net_weight": wt}],
		}
	)
	cutting.insert(ignore_permissions=True)
	cutting.submit()
	return {"cutting": cutting.name}


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
	"""Cutting worklist board: in-process and open cuttings, grouped by Cut (cut =
	column, each cutting = a card). Cuttings already pulled into a program are excluded
	— EXCEPT the placeholder cut of an UNFINISHED program (planned straight from an
	inventory colour): that one shows here in RED as a cut still to be done, until the
	operator finishes it (picks the roll, weight is fetched). Each row carries an
	`unfinished` flag so the board can colour it."""
	conditions = [
		"c.docstatus = 1",
		"c.status in ('In Progress', 'Open')",
		"(c.program is null or p.unfinished = 1)",
		"ifnull(c.closed, 0) = 0",
	]
	values = {}
	if branch:
		conditions.append("c.branch = %(branch)s")
		values["branch"] = branch
	rows = frappe.db.sql(
		f"""
		select c.name, c.posting_date, c.customer_order, c.roll_no, c.shade, c.cut,
			c.status, c.roll_qty, c.total_patti_qty, c.total_net_weight, c.program,
			c.lot, l.lot_id,
			case when p.unfinished = 1 then 1 else 0 end as unfinished,
			p.name as program_name
		from `tabMM Cutting` c
		left join `tabMM Program` p on p.name = c.program
		left join `tabMM Lot` l on l.name = c.lot
		where {" and ".join(conditions)}
		order by c.cut asc, c.modified desc
		limit 500
		""",
		values,
		as_dict=True,
	)
	return _merge_by_lot(rows)


def _merge_by_lot(rows):
	"""Fold cuttings of the same lot (and same colour/cut) into one card, summing qty and
	weight.

	The same lot arrives across several inwards, which produced a separate card per
	inward — the operator saw one colour split over three rows and had to add up by eye.
	Rows without a lot can't be merged safely (nothing identifies them as the same
	material), so they pass through untouched.
	"""
	merged = {}
	out = []
	for r in rows:
		if not r.get("lot"):
			out.append(r)
			continue
		key = (r["lot"], r.get("shade") or r.get("roll_no"), r.get("cut"))
		head = merged.get(key)
		if not head:
			r["merged_from"] = [r["name"]]
			r["merged_count"] = 1
			merged[key] = r
			out.append(r)
			continue
		head["roll_qty"] = round(float(head.get("roll_qty") or 0) + float(r.get("roll_qty") or 0), 3)
		head["total_patti_qty"] = round(float(head.get("total_patti_qty") or 0) + float(r.get("total_patti_qty") or 0), 3)
		head["total_net_weight"] = round(float(head.get("total_net_weight") or 0) + float(r.get("total_net_weight") or 0), 3)
		head["merged_from"].append(r["name"])
		head["merged_count"] += 1
		# A merged card is only "finished" if every part of it is.
		if r.get("unfinished"):
			head["unfinished"] = 1
	return out


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
