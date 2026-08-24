# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""An order is finished when it has GONE OUT, not when it arrived.

Completion used to be stamped by INWARD: the moment the received weight matched the order,
`completed` was set and `completion_mode` became "Inward". Two things were wrong with that.

The order was not finished — the customer had had nothing. And four pickers key off
`completed`: stock commitment, Add Program, further inward, and the production order list.
So the order the floor had just taken delivery of promptly vanished from every screen that
could turn it into goods. Received, and unworkable.

`completed` now means one thing: FULFILLED. Which is Dispatch (the challans cover the
ordered weight, within the inward variance allowance) or Force (an admin said so).

Going-forward logic is not enough, because the wrong stamps are already on file:
  · every order stamped 'Inward' is invisible to the pickers until it is cleared;
  · every order stamped 'Dispatch' was closed by the FIRST challan against it whatever
    that challan carried, so a 1,200 kg order part-delivered 200 kg reads Complete.
Both are recounted here.

The same migration brings in MM Lot Remark (the reason a program stopped short, carried on
its lot) and the absolute-kg production tolerance, since both are new schema this release
depends on. force=True on every reload: a plain migrate can leave a changed doctype JSON
out of tabDocField, which is the failure mode reload_production_party_cut.py exists for.
"""

import frappe


def execute():
	for doctype in ("mm_lot_remark", "mm_settings", "mm_sales_order", "mm_sales_order_item"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", doctype, force=True)
		except Exception:
			frappe.log_error(title=f"reload {doctype} failed")

	if not frappe.db.has_column("MM Sales Order", "completion_mode"):
		return

	# 1. Release the inward stamps. Receiving material is not delivering it.
	frappe.db.sql(
		"""
		update `tabMM Sales Order`
		set completed = 0, completion_mode = '', completed_on = null
		where completion_mode = 'Inward'
		"""
	)

	# 2. Recount everything that was closed by a challan, plus everything still open, so a
	#    part-delivery stops reading as done and a genuinely covered order still does.
	#    Force is left alone — an admin's decision outranks the arithmetic, then and now.
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		mark_dispatched,
	)

	orders = frappe.get_all(
		"MM Sales Order",
		filters={"docstatus": 1, "completion_mode": ["!=", "Force"]},
		pluck="name",
	)
	for order in orders:
		try:
			mark_dispatched(order)
		except Exception:
			# One bad order must not stop the migration; it will be recounted by its next
			# challan either way.
			frappe.log_error(title=f"recount failed for order {order}")
	frappe.db.commit()
