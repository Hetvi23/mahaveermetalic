# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Create the MM Accounts role on sites installed before the job hisab existed.

after_install only fires on a fresh install, so the role in install.py never reaches a
site that is already running — and the hisab's first two steps are gated on it.
"""

import frappe


def execute():
	if frappe.db.exists("Role", "MM Accounts"):
		return
	doc = frappe.new_doc("Role")
	doc.update({"role_name": "MM Accounts", "desk_access": 1})
	doc.insert(ignore_permissions=True)
