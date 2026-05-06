# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe


@frappe.whitelist()
def get_roll_stock(color_name=None, cut=None, location=None, item_type=None):
	"""Aggregated roll inventory filtered by color, cut, location (and optional item type)."""
	filters = {}
	if color_name:
		filters["color_name"] = color_name
	if cut is not None and cut != "":
		filters["cut"] = cut
	if location:
		filters["location"] = location
	if item_type:
		filters["item_type"] = item_type
	return frappe.get_all(
		"MM Roll Inventory",
		filters=filters,
		fields=[
			"name",
			"roll_no",
			"lot_number",
			"location",
			"color_name",
			"cut",
			"item_type",
			"stock_weight",
			"stock_box",
		],
		order_by="modified desc",
		limit_page_length=500,
	)


@frappe.whitelist()
def get_stock_summary(color_name=None, cut=None, location=None):
	"""Total weight/box for filters (for SO line stock hint)."""
	rows = get_roll_stock(color_name=color_name, cut=cut, location=location)
	total_weight = sum(float(r.get("stock_weight") or 0) for r in rows)
	total_box = sum(float(r.get("stock_box") or 0) for r in rows)
	return {
		"lines": rows,
		"total_weight": total_weight,
		"total_box": total_box,
		"suggest_purchase_order": total_weight <= 0 and total_box <= 0,
	}
