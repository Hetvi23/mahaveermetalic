# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Add the MM Lot link to Inward / Cutting / Program / Production so a lot id can be
traced from receipt through to the finished voucher."""

import frappe


def execute():
	for dt in ("mm_lot", "mm_inward", "mm_cutting", "mm_program", "mm_production"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", dt, force=True)
		except Exception:
			frappe.log_error(title=f"reload {dt} failed")
