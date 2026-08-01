# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Replace the ERPNext-owned `Branch` doctype with an app-owned `MM Branch`.

The app never required ERPNext, yet 12 doctypes linked to ERPNext's `Branch` — so on a
site without ERPNext the Branch master 404s and branch links are dead. This introduces
`MM Branch` (like MM Location Master), force-reloads the doctypes now pointing at it, and
seeds MM Branch from every branch value already in use (plus any ERPNext Branch records)
so existing links keep resolving.
"""

import frappe

DOCTYPES = [
	"mm_branch", "mm_production", "mm_sales_challan", "mm_sales_order",
	"mm_roll_inventory", "mm_bobbin_box_tracking", "mm_employee_master",
	"mm_program", "mm_machine", "mm_inward", "mm_cutting",
	"mm_stock_ledger_entry", "mm_purchase_order",
]

USED = [
	"tabMM Sales Order", "tabMM Purchase Order", "tabMM Inward", "tabMM Cutting",
	"tabMM Program", "tabMM Production", "tabMM Roll Inventory", "tabMM Stock Ledger Entry",
	"tabMM Sales Challan", "tabMM Bobbin Box Tracking", "tabMM Employee Master", "tabMM Machine",
]


def execute():
	for dt in DOCTYPES:
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", dt, force=True)
		except Exception:
			frappe.log_error(title=f"reload {dt} failed")

	names = set()
	if frappe.db.exists("DocType", "Branch"):
		names |= set(frappe.get_all("Branch", pluck="name"))
	for tbl in USED:
		try:
			rows = frappe.db.sql(f"select distinct `branch` from `{tbl}` where ifnull(`branch`, '') != ''")
			names |= {r[0] for r in rows}
		except Exception:
			pass

	for nm in names:
		if nm and not frappe.db.exists("MM Branch", nm):
			try:
				frappe.get_doc({"doctype": "MM Branch", "branch_name": nm}).insert(ignore_permissions=True)
			except Exception:
				frappe.log_error(title=f"seed MM Branch {nm} failed")
