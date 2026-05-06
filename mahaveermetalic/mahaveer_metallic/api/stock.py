# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe


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
