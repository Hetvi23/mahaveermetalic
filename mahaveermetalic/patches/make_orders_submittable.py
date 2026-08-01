# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Turn MM Sales Order and MM Purchase Order into submittable doctypes.

Force-reload so the docstatus machinery + submit permissions land, then mark every
PRE-EXISTING order/PO as submitted (docstatus 0 -> 1). Those records predate the
draft/submit lifecycle and must stay usable, since downstream work (inward / cutting /
production) is now gated to submitted orders. New orders created after this start as
drafts. Done with direct SQL — these docs are already valid and we only want to move
their state, not re-run submit side effects.
"""

import frappe


def execute():
	for dt in ("mm_sales_order", "mm_purchase_order"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", dt, force=True)
		except Exception:
			frappe.log_error(title=f"reload {dt} failed")

	frappe.db.sql("update `tabMM Sales Order` set docstatus = 1 where docstatus = 0")
	frappe.db.sql("update `tabMM Purchase Order` set docstatus = 1 where docstatus = 0")
