# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inward posting helpers."""

import json

import frappe
from frappe import _


@frappe.whitelist()
def post_inward(payload):
	"""Create and submit an MM Inward in one transaction.

	Doing the insert and submit server-side (on a single in-memory document) avoids
	the timestamp-mismatch race the two-call client flow hits — where the doc is
	inserted in one request and submitted in a second, and its `modified` shifts in
	between ("Document has been modified after you have opened it").
	"""
	data = json.loads(payload) if isinstance(payload, str) else payload
	data["doctype"] = "MM Inward"
	doc = frappe.get_doc(data)
	doc.insert()
	doc.submit()
	return {"name": doc.name}


@frappe.whitelist()
def recent_inwards(limit=15):
	"""Recently posted inwards, summarised, for the 'match to order' picker."""
	rows = frappe.get_all(
		"MM Inward",
		filters={"docstatus": 1},
		fields=["name", "posting_date", "lot_number", "location", "sales_order"],
		order_by="creation desc",
		limit_page_length=int(limit),
	)
	for r in rows:
		items = frappe.get_all(
			"MM Inward Item", filters={"parent": r["name"]}, fields=["color_name", "weight", "customer_order"]
		)
		r["colours"] = ", ".join(sorted({i.color_name for i in items if i.color_name}))
		r["total_weight"] = round(sum(i.weight or 0 for i in items), 3)
		# Allocated when every line already points at an order.
		r["allocated"] = bool(items) and all(i.customer_order for i in items)
	return rows


@frappe.whitelist()
def allocate_inward_to_order(inward, sales_order):
	"""Match a posted inward to a Sales Order after the fact: point every line (and the
	header) at the order, then refresh fulfilment on the new order and any the inward
	was previously tied to."""
	if not frappe.db.exists("MM Inward", inward):
		frappe.throw(_("Inward {0} not found.").format(inward))
	if not frappe.db.exists("MM Sales Order", sales_order):
		frappe.throw(_("Sales Order {0} not found.").format(sales_order))

	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		recalculate_order_fulfilment,
	)

	affected = set()
	prev = frappe.db.get_value("MM Inward", inward, "sales_order")
	if prev:
		affected.add(prev)
	for it in frappe.get_all("MM Inward Item", filters={"parent": inward}, fields=["name", "customer_order"]):
		if it.customer_order:
			affected.add(it.customer_order)
		frappe.db.set_value("MM Inward Item", it.name, "customer_order", sales_order, update_modified=False)
	frappe.db.set_value("MM Inward", inward, "sales_order", sales_order, update_modified=False)
	affected.add(sales_order)
	for so in affected:
		recalculate_order_fulfilment(so)
	return {"inward": inward, "sales_order": sales_order, "refreshed": sorted(affected)}
