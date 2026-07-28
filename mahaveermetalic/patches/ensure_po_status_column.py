# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Guarantee MM Purchase Order.status exists.

Some sites ran the earlier `reload_stock_and_program_fields` patch BEFORE
`mm_purchase_order` was added to its reload list — and editing a patch's body doesn't
make it re-run. On those sites the `status` column was never created, so posting an
inward that recomputes a linked PO's status fails with (1054, "Unknown column 'status'").
This fresh patch force-reloads the doctype (creates the column) with a direct ALTER as a
final fallback.
"""

import frappe


def execute():
	try:
		frappe.reload_doc("mahaveer_metallic", "doctype", "mm_purchase_order", force=True)
	except Exception:
		frappe.log_error(title="ensure_po_status_column: reload failed")
	if not frappe.db.has_column("MM Purchase Order", "status"):
		frappe.db.sql(
			"alter table `tabMM Purchase Order` add column `status` varchar(140) default 'Open'"
		)
