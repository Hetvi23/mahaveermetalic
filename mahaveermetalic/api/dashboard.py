# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Home dashboard aggregates — job-tracking only (no billing in v1).

Exposed as `mahaveermetalic.api.dashboard.get_summary`. Returns light-weight
counts/weights for the action cards plus a short list of open orders so the
shop floor sees what to act on the moment the app opens.
"""

import frappe


def _count(query: str, values=None) -> int:
	row = frappe.db.sql(query, values or (), as_dict=False)
	return int(row[0][0] or 0) if row else 0


@frappe.whitelist()
def get_summary():
	frappe.has_permission("MM Sales Order", throw=True)

	today = frappe.utils.today()

	# Orders — "open" = production not yet complete (null treated as 0%).
	open_orders = _count(
		"select count(*) from `tabMM Sales Order` "
		"where ifnull(production_completed_percent, 0) < 100"
	)
	completed_orders = _count(
		"select count(*) from `tabMM Sales Order` "
		"where ifnull(production_completed_percent, 0) >= 100"
	)

	# Rolls available to cut (submitted/active stock rows with weight on hand).
	rolls_in_stock = _count(
		"select count(*) from `tabMM Roll Inventory` "
		"where ifnull(available_weight, ifnull(stock_weight, 0)) > 0"
	)
	rolls_weight = frappe.db.sql(
		"select sum(ifnull(available_weight, ifnull(stock_weight, 0))) "
		"from `tabMM Roll Inventory`"
	)
	rolls_weight = float(rolls_weight[0][0] or 0) if rolls_weight else 0.0

	# Cutting pipeline.
	cutting_active = _count(
		"select count(*) from `tabMM Cutting` "
		"where status = 'In Progress' and docstatus < 2"
	)
	cutting_pending = _count(
		"select count(*) from `tabMM Cutting` "
		"where status = 'Draft' and docstatus < 2"
	)

	# Inward posted today (submitted receipts).
	inward_today = _count(
		"select count(*) from `tabMM Inward` "
		"where posting_date = %s and docstatus = 1",
		(today,),
	)

	# Bobbin/box challans given out (not yet received back).
	bobbin_boxes_out = _count(
		"select count(*) from `tabMM Bobbin Box Tracking` "
		"where given_received = 'Given'"
	)

	# Deliveries — only open orders (production < 100%) with a delivery date set.
	open_clause = "ifnull(production_completed_percent, 0) < 100 and delivery_date is not null"
	delivery_overdue = _count(
		"select count(*) from `tabMM Sales Order` "
		f"where {open_clause} and delivery_date < %s",
		(today,),
	)
	delivery_today = _count(
		"select count(*) from `tabMM Sales Order` "
		f"where {open_clause} and delivery_date = %s",
		(today,),
	)

	# Low stock — rolls with a reorder level set and available below it.
	low_stock_count = _count(
		"select count(*) from `tabMM Roll Inventory` "
		"where ifnull(reorder_weight, 0) > 0 "
		"and ifnull(available_weight, ifnull(stock_weight, 0)) < reorder_weight"
	)

	# percent < 100 OR percent is null  → both count as "open".
	recent_open_orders = frappe.get_all(
		"MM Sales Order",
		or_filters=[
			["production_completed_percent", "<", 100],
			["production_completed_percent", "is", "not set"],
		],
		fields=[
			"name",
			"transaction_date",
			"delivery_date",
			"party",
			"production_completed_percent",
			"order_locked",
		],
		order_by="transaction_date desc, modified desc",
		limit_page_length=8,
	)

	# Soonest deadlines first: open orders due today or overdue.
	due_orders = frappe.get_all(
		"MM Sales Order",
		filters=[
			["production_completed_percent", "<", 100],
			["delivery_date", "is", "set"],
			["delivery_date", "<=", today],
		],
		fields=["name", "delivery_date", "party", "production_completed_percent"],
		order_by="delivery_date asc",
		limit_page_length=8,
	)

	low_stock_rolls = frappe.db.sql(
		"""
		select name, location, color_name, cut,
			ifnull(available_weight, ifnull(stock_weight, 0)) as available,
			reorder_weight
		from `tabMM Roll Inventory`
		where ifnull(reorder_weight, 0) > 0
			and ifnull(available_weight, ifnull(stock_weight, 0)) < reorder_weight
		order by (reorder_weight - ifnull(available_weight, ifnull(stock_weight, 0))) desc
		limit 8
		""",
		as_dict=True,
	)

	return {
		"orders": {"open": open_orders, "completed": completed_orders},
		"rolls": {"in_stock": rolls_in_stock, "weight": round(rolls_weight, 2)},
		"cutting": {"active": cutting_active, "pending": cutting_pending},
		"inward_today": inward_today,
		"bobbin_boxes_out": bobbin_boxes_out,
		"deliveries": {"today": delivery_today, "overdue": delivery_overdue},
		"low_stock": low_stock_count,
		"recent_open_orders": recent_open_orders,
		"due_orders": due_orders,
		"low_stock_rolls": low_stock_rolls,
	}
