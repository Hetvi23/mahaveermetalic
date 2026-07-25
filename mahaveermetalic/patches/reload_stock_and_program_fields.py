# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Force-reload doctypes whose JSON gained fields this release.

`bench migrate` skips re-syncing an already-installed doctype when it decides the JSON
is unchanged (timestamp/hash), which leaves the new DB columns missing — the exact
gotcha that blanks a screen with 'Unknown column'. Reloading with force here guarantees
the new fields on MM Program (unfinished / roll_inventory / remark) and MM Inward
(receipt_status / is_partial / challan_expected_* / challan_received_weight) land, and
that the new MM Stock Ledger Entry doctype is present.
"""

import frappe


def execute():
	for name in (
		"mm_stock_ledger_entry", "mm_program", "mm_inward", "mm_purchase_order",
		"mm_cutting", "mm_production", "mm_roll_inventory", "mm_bobbin_box_tracking",
	):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")
