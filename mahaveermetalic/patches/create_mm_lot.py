# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Install the MM Lot master (colour-wise lot ids, challan-linked)."""

import frappe


def execute():
	try:
		frappe.reload_doc("mahaveer_metallic", "doctype", "mm_lot", force=True)
	except Exception:
		frappe.log_error(title="reload mm_lot failed")
