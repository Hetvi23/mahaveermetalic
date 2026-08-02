# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Bobbin ledger + per-box barcode + bobbin ownership."""

import frappe


def execute():
	for dt in ("mm_bobbin_ledger_entry", "mm_bobbin_master", "mm_bobbin_box_tracking",
		"mm_production_box", "mm_production", "mm_sales_challan_item", "mm_sales_challan"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", dt, force=True)
		except Exception:
			frappe.log_error(title=f"reload {dt} failed")
