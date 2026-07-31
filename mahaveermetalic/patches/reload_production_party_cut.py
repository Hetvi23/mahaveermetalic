# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Land MM Production.party / MM Production.cut on migrate (force-reload so the columns
are created even if a plain migrate treats the JSON as unchanged)."""

import frappe


def execute():
	try:
		frappe.reload_doc("mahaveer_metallic", "doctype", "mm_production", force=True)
	except Exception:
		frappe.log_error(title="reload mm_production failed")
