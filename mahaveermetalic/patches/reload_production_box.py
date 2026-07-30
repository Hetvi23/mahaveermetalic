# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Ensure the multi-box production voucher schema lands on migrate.

Force-reloads the new MM Production Box child doctype and MM Production (which gained
the boxes table + batch_no / box_return / bobbin_return and a V.No naming series). A
fresh patch name is required because editing an earlier reload patch's body doesn't
make it re-run on sites that already recorded it.
"""

import frappe


def execute():
	for name in ("mm_production_box", "mm_production"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")
