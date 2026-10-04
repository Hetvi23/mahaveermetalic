# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The customer / supplier / admin app.

Creates the MM Customer role (after_install never reaches a running site), force-reloads
the doctypes that gained fields — `bench migrate` skips re-syncing an installed doctype
often enough on this app that every field patch here does it by hand — and seeds the
floor-pending age so the admin's "Order pending" list has a number before anyone opens
MM Settings.
"""

import frappe


def execute():
	if not frappe.db.exists("Role", "MM Customer"):
		doc = frappe.new_doc("Role")
		doc.update({"role_name": "MM Customer", "desk_access": 0})
		doc.insert(ignore_permissions=True)

	for name in (
		"mm_party_master", "mm_sales_order", "mm_purchase_order", "mm_settings",
		"mm_veermetlon_settings", "mm_follow_up", "mm_push_subscription", "mm_app_notification",
	):
		frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)

	if not frappe.db.get_single_value("MM Settings", "floor_pending_days"):
		frappe.db.set_single_value("MM Settings", "floor_pending_days", 5)

	# The push key pair, so the first phone to turn notifications on finds it ready.
	from mahaveermetalic.mahaveer_metallic.api.push import ensure_keys

	ensure_keys()
