# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Make box-ordered lines self-consistent, and give every order its box total.

A line ordered in boxes now carries the weight of ONE box, and the line weight is worked
out from it (MMSalesOrder._derive_box_weights). Lines keyed before that have a box qty and
a weight somebody worked out on paper, and no per-box figure at all — so the per-box weight
is derived back out of them here. Nothing about what the customer ordered changes: the
weight already on the line is kept and the missing number is filled in behind it.

`ordered_box` is the box counterpart of `ordered_weight`, and an order placed in boxes is
judged Complete on it, so every existing order needs it summed rather than sitting at zero
and quietly reading as a weight order.
"""

import frappe


def execute():
	for name in ("mm_sales_order_item", "mm_sales_order", "mm_settings"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")

	if frappe.db.has_column("MM Sales Order Item", "weight_per_box"):
		# Only where a box qty AND a weight are both present — that is the only case the
		# per-box figure can be recovered from. A box line with no weight has nothing to
		# derive from and is asked for the figure the next time it is saved.
		frappe.db.sql(
			"""
			update `tabMM Sales Order Item`
			set weight_per_box = round(qty_weight / qty_box, 3)
			where ifnull(weight_per_box, 0) = 0
				and ifnull(qty_box, 0) > 0 and ifnull(qty_weight, 0) > 0
			"""
		)

	if frappe.db.has_column("MM Sales Order", "ordered_box"):
		frappe.db.sql(
			"""
			update `tabMM Sales Order` so
			set so.ordered_box = (
				select coalesce(sum(i.qty_box), 0) from `tabMM Sales Order Item` i
				where i.parent = so.name and i.parenttype = 'MM Sales Order'
			)
			"""
		)
