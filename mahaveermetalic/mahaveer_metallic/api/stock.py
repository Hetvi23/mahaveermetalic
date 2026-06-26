# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _


@frappe.whitelist()
def get_roll_stock(color_name=None, cut=None, location=None, item_type=None, branch=None):
	"""Aggregated roll inventory filtered by color, cut, location (and optional item type)."""
	filters = {}
	if color_name:
		filters["color_name"] = color_name
	if cut is not None and cut != "":
		filters["cut"] = cut
	if location:
		filters["location"] = location
	if branch:
		filters["branch"] = branch
	if item_type:
		filters["item_type"] = item_type
	rows = frappe.get_all(
		"MM Roll Inventory",
		filters=filters,
		fields=[
			"name",
			"roll_no",
			"lot_number",
			"location",
			"branch",
			"color_name",
			"cut",
			"item_type",
			"stock_weight",
			"stock_box",
			"reserved_weight",
			"issued_weight",
			"available_weight",
		],
		order_by="modified desc",
		limit_page_length=500,
	)
	for r in rows:
		stock = float(r.get("stock_weight") or 0)
		reserved = float(r.get("reserved_weight") or 0)
		issued = float(r.get("issued_weight") or 0)
		r["available_weight"] = stock - reserved - issued
	return rows


@frappe.whitelist()
def get_stock_summary(color_name=None, cut=None, location=None, item_type=None, branch=None):
	"""Total weight/box for filters (for SO line stock hint)."""
	rows = get_roll_stock(color_name=color_name, cut=cut, location=location, item_type=item_type, branch=branch)
	total_weight = sum(float(r.get("stock_weight") or 0) for r in rows)
	total_box = sum(float(r.get("stock_box") or 0) for r in rows)
	total_available_weight = sum(float(r.get("available_weight") or 0) for r in rows)
	return {
		"lines": rows,
		"total_weight": total_weight,
		"total_box": total_box,
		"total_available_weight": total_available_weight,
		"suggest_purchase_order": total_available_weight <= 0 and total_box <= 0,
	}


def _line_available(color_name, cut):
	"""Available roll weight for a colour/cut across all locations."""
	rows = get_roll_stock(color_name=color_name, cut=cut)
	return sum(float(r.get("available_weight") or 0) for r in rows)


@frappe.whitelist()
def get_so_stock_status(sales_order):
	"""SRS 5.1: per-line stock visibility for a Sales Order, flagging shortfalls
	that should trigger a Purchase Order."""
	so = frappe.get_doc("MM Sales Order", sales_order)
	lines = []
	any_short = False
	for it in so.items:
		required = float(it.qty_weight or 0)
		available = _line_available(it.color_name, it.cut)
		short = round(max(0.0, required - available), 3)
		if short > 0:
			any_short = True
		lines.append(
			{
				"color_name": it.color_name,
				"cut": it.cut,
				"required": round(required, 3),
				"available": round(available, 3),
				"short": short,
				"purchase_rate": float(it.purchase_rate or 0),
			}
		)
	return {"sales_order": so.name, "party": so.party, "lines": lines, "any_short": any_short}


@frappe.whitelist()
def create_purchase_order_from_so(sales_order):
	"""SRS 5.1: 'if no stock → trigger Purchase Order'. Ensures one draft MM
	Purchase Order per short line (qty = shortfall). Idempotent and deduped by
	the SO line (so_item): if a PO already exists for that line — e.g. one the
	Sales Order auto-raised because a supplier was named — its shortfall qty is
	updated instead of inserting a duplicate. Returns the affected PO names."""
	so = frappe.get_doc("MM Sales Order", sales_order)
	created, updated = [], []
	for it in so.items:
		required = float(it.qty_weight or 0)
		short = round(max(0.0, required - _line_available(it.color_name, it.cut)), 3)
		if short <= 0:
			continue
		existing = frappe.db.get_value("MM Purchase Order", {"so_item": it.name}, "name")
		if existing:
			po = frappe.get_doc("MM Purchase Order", existing)
			po.qty_kg = short
			po.save(ignore_permissions=True)
			updated.append(po.name)
			continue
		po = frappe.get_doc(
			{
				"doctype": "MM Purchase Order",
				"transaction_date": frappe.utils.today(),
				"branch": so.branch,
				"location": so.location,
				"sales_order": so.name,
				"so_item": it.name,
				"supplier": it.purchase_party or None,
				"color": it.color_name,
				"cut": it.cut,
				"qty_kg": short,
				"rate": it.purchase_rate or 0,
				"delivery_date": it.delivery_date or so.get("delivery_date"),
			}
		)
		po.insert(ignore_permissions=True)
		created.append(po.name)
	if not created and not updated:
		frappe.msgprint(_("All lines have enough stock — no Purchase Order needed."))
	return {"created": created, "updated": updated}
