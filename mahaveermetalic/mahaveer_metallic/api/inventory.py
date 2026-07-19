# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inventory + stock-ledger read APIs.

`MM Roll Inventory` holds the live balance per (branch, location, lot, colour);
`MM Stock Ledger Entry` holds the append-only movement history. Both are written in
lock-step by `stock_ledger.post_movement`, so a balance row and its ledger always agree.
These endpoints back the Inventory and Stock Ledger screens (and the Program screen's
"search a roll from inventory" picker).
"""

import frappe


def _available(row):
	return round(
		float(row.get("stock_weight") or 0)
		- float(row.get("reserved_weight") or 0)
		- float(row.get("issued_weight") or 0),
		3,
	)


@frappe.whitelist()
def balances(branch=None, location=None, color=None, lot=None, search=None,
	low_stock_only=0, in_stock_only=0, limit=500):
	"""Live roll-inventory balances with computed available weight + low-stock flag.

	`search` matches colour / lot / roll / location (case-insensitive). `in_stock_only`
	keeps rows with available > 0; `low_stock_only` keeps rows at/below their reorder level.
	"""
	filters = {}
	if branch:
		filters["branch"] = branch
	if location:
		filters["location"] = location
	if color:
		filters["color_name"] = color
	if lot:
		filters["lot_number"] = lot

	# Fetch ALL rows matching the SQL filters (limit_page_length=0), then apply the
	# Python-side filters (in_stock/low_stock/search), and only THEN cap to the display
	# limit — otherwise a SQL limit would silently drop rows the Python filters wanted.
	rows = frappe.get_all(
		"MM Roll Inventory",
		filters=filters,
		fields=[
			"name", "roll_no", "lot_number", "location", "branch", "color_name",
			"item_type", "stock_weight", "stock_box", "reserved_weight",
			"issued_weight", "reorder_weight",
		],
		order_by="color_name asc, lot_number asc",
		limit_page_length=0,
	)

	s = (search or "").strip().lower()
	out = []
	for r in rows:
		r["available_weight"] = _available(r)
		reorder = float(r.get("reorder_weight") or 0)
		r["low_stock"] = bool(reorder > 0 and r["available_weight"] <= reorder)
		if int(in_stock_only or 0) and r["available_weight"] <= 0:
			continue
		if int(low_stock_only or 0) and not r["low_stock"]:
			continue
		if s:
			hay = " ".join(
				str(r.get(f) or "") for f in ("color_name", "lot_number", "roll_no", "location")
			).lower()
			if s not in hay:
				continue
		out.append(r)
	lim = int(limit or 0)
	return out[:lim] if lim > 0 else out


@frappe.whitelist()
def rolls_by_colour(color=None, branch=None, location=None, search=None, limit=200):
	"""Inventory rolls of a given colour that still have stock — the Program screen's
	'search a roll from inventory' picker. Returns available rolls newest-colour-first."""
	rows = balances(
		branch=branch, location=location, color=color, search=search,
		in_stock_only=1, limit=limit,
	)
	return rows


@frappe.whitelist()
def ledger(color=None, lot=None, location=None, branch=None, voucher_type=None,
	from_date=None, to_date=None, search=None, limit=300):
	"""Stock ledger movements (every IN / OUT), newest first, with the running balance."""
	filters = {}
	if color:
		filters["color_name"] = color
	if lot:
		filters["lot_number"] = lot
	if location:
		filters["location"] = location
	if branch:
		filters["branch"] = branch
	if voucher_type:
		filters["voucher_type"] = voucher_type
	if from_date and to_date:
		filters["posting_date"] = ["between", [from_date, to_date]]
	elif from_date:
		filters["posting_date"] = [">=", from_date]
	elif to_date:
		filters["posting_date"] = ["<=", to_date]

	# Push search into SQL (OR across the searchable columns) so the limit is applied
	# AFTER the search — otherwise a term matching only older rows would return nothing
	# because the newest `limit` rows were fetched first.
	or_filters = None
	s = (search or "").strip()
	if s:
		like = f"%{s}%"
		or_filters = [
			[f, "like", like]
			for f in ("color_name", "lot_number", "roll_no", "location", "voucher_no", "voucher_type", "customer_order")
		]

	rows = frappe.get_all(
		"MM Stock Ledger Entry",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name", "posting_date", "posting_datetime", "voucher_type", "voucher_no",
			"branch", "location", "lot_number", "color_name", "roll_no",
			"in_weight", "out_weight", "in_box", "out_box",
			"balance_weight", "balance_box", "customer_order", "challan_number", "remarks",
		],
		order_by="posting_datetime desc, creation desc",
		limit_page_length=int(limit),
	)
	return rows


@frappe.whitelist()
def summary(branch=None, location=None):
	"""Top-line numbers for the Inventory screen header."""
	# limit=0 → all rows, so totals never undercount on large inventories.
	rows = balances(branch=branch, location=location, limit=0)
	return {
		"skus": len(rows),
		"total_weight": round(sum(float(r.get("stock_weight") or 0) for r in rows), 3),
		"available_weight": round(sum(float(r.get("available_weight") or 0) for r in rows), 3),
		"total_box": round(sum(float(r.get("stock_box") or 0) for r in rows), 3),
		"low_stock_count": sum(1 for r in rows if r.get("low_stock")),
	}
