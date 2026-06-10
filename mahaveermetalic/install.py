# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe

# desk_access 0 for MM Supplier: suppliers use the SPA only, not the Frappe desk.
MM_ROLES = [
	{"role_name": "MM Admin", "desk_access": 1},
	{"role_name": "MM Operations", "desk_access": 1},
	{"role_name": "MM Production", "desk_access": 1},
	{"role_name": "MM Inventory Manager", "desk_access": 1},
	{"role_name": "MM Sales Team", "desk_access": 1},
	{"role_name": "MM Supplier", "desk_access": 0},
]


def create_roles():
	for row in MM_ROLES:
		if frappe.db.exists("Role", row["role_name"]):
			continue
		doc = frappe.new_doc("Role")
		doc.update(row)
		doc.insert(ignore_permissions=True)


def after_install():
	create_roles()
