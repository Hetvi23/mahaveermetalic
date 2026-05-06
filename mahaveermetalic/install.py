# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe


def after_install():
	roles = [
		{"role_name": "MM Admin", "desk_access": 1},
		{"role_name": "MM Operations", "desk_access": 1},
		{"role_name": "MM Production", "desk_access": 1},
		{"role_name": "MM Inventory Manager", "desk_access": 1},
		{"role_name": "MM Sales Team", "desk_access": 1},
	]
	for row in roles:
		if frappe.db.exists("Role", row["role_name"]):
			continue
		doc = frappe.new_doc("Role")
		doc.update(row)
		doc.insert(ignore_permissions=True)
