# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Give orders a state, and stop rejection destroying them.

MM Sales Order gains `order_state` (Pending / Approved / Rejected / Cancelled) plus who
changed it, when and why. Rejecting used to DELETE the order and hand its number back for the
next one to reuse; now a rejected order keeps its number and stays an editable draft the admin
can approve, and cancelling is the permanent end of the road. Either way the number stays
reserved, so no two orders can ever share an id.

Existing orders are stamped from their docstatus — submitted ones are Approved, cancelled ones
Cancelled, drafts Pending — so the state agrees with the records already on file.
"""

import frappe


def execute():
	try:
		frappe.reload_doc("mahaveer_metallic", "doctype", "mm_sales_order", force=True)
	except Exception:
		frappe.log_error(title="reload mm_sales_order failed")

	if not frappe.db.has_column("MM Sales Order", "order_state"):
		return
	# Drafts are Pending, submitted are Approved, cancelled are Cancelled. Nothing on file can
	# be told apart as "rejected" — rejection deleted the order until now, so there are none.
	frappe.db.sql(
		"""
		update `tabMM Sales Order`
		set order_state = case docstatus when 1 then 'Approved' when 2 then 'Cancelled' else 'Pending' end
		where ifnull(order_state, '') = ''
		"""
	)
