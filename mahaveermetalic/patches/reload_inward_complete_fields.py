# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Land the inward-completion schema on migrate.

MM Settings gains inward_match_tolerance_percent; MM Sales Order gains completed /
completion_mode / completed_on. Force-reload so the columns are created even if a plain
migrate decides the JSON is unchanged.
"""

import frappe


def execute():
	for name in ("mm_settings", "mm_sales_order"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")
