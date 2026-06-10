# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Session helpers for the SPA — exposes per-user defaults.

`mahaveermetalic.api.session.get_branch_location` returns the branch + location
of the MM Employee Master linked to the logged-in user, so forms can pre-fill
them (editable) instead of asking the operator to pick every time.
"""

import frappe


@frappe.whitelist()
def get_branch_location():
	emp = frappe.db.get_value(
		"MM Employee Master",
		{"user": frappe.session.user},
		["branch", "location"],
		as_dict=True,
	)
	return {
		"branch": (emp and emp.branch) or None,
		"location": (emp and emp.location) or None,
	}
