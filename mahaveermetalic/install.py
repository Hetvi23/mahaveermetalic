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
	# Signs the job-work hisab first, and enters the bill number once the admin has agreed
	# it. Kept apart from MM Admin because the two halves of that flow are two people.
	{"role_name": "MM Accounts", "desk_access": 1},
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
