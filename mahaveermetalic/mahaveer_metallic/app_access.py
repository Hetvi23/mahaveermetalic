# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Who is logged in, as far as the Mahaveer app is concerned.

Three kinds of login share one PWA:

  · customer — a User linked from MM Party Master.user, holding MM Customer
  · supplier — a User linked from MM Vendor Master.user, holding MM Supplier
  · staff    — everyone else with an MM role (the office, the floor, the admin)

A customer or supplier is an OUTSIDER: they get their own screens and a short list of
endpoints, and nothing else. The rest of the app's whitelisted methods were written for
the office and mostly read with `frappe.get_all` (which skips permissions), so an
outsider calling, say, the order report with another party's name would simply be
answered. `guard_external_api` closes that door for every method at once instead of
relying on each one to remember.
"""

import frappe
from frappe import _

CUSTOMER_ROLE = "MM Customer"
SUPPLIER_ROLE = "MM Supplier"

#: Any of these makes a login staff, whatever else it holds.
STAFF_ROLES = {
	"Administrator",
	"System Manager",
	"MM Admin",
	"MM Operations",
	"MM Production",
	"MM Inventory Manager",
	"MM Sales Team",
	"MM Accounts",
}

ADMIN_ROLES = {"Administrator", "System Manager", "MM Admin"}

#: The only Mahaveer endpoints an outsider may call. Prefix match on the dotted path.
EXTERNAL_ALLOWED = (
	"mahaveermetalic.mahaveer_metallic.api.portal.",
	"mahaveermetalic.mahaveer_metallic.api.push.",
	"mahaveermetalic.api.supplier.get_supplier_pending",
	"mahaveermetalic.api.session.",
	"mahaveermetalic.www.mahaveermetalic.",
)


def app_kind(user=None) -> str:
	"""customer / supplier / staff / none."""
	user = user or frappe.session.user
	if not user or user == "Guest":
		return "none"
	roles = set(frappe.get_roles(user))
	if roles & STAFF_ROLES:
		return "staff"
	if CUSTOMER_ROLE in roles:
		return "customer"
	if SUPPLIER_ROLE in roles:
		return "supplier"
	return "none"


def is_admin(user=None) -> bool:
	return bool(ADMIN_ROLES & set(frappe.get_roles(user or frappe.session.user)))


def party_for_user(user=None):
	return frappe.db.get_value("MM Party Master", {"user": user or frappe.session.user}, "name")


def vendor_for_user(user=None):
	return frappe.db.get_value("MM Vendor Master", {"user": user or frappe.session.user}, "name")


def require_customer() -> str:
	"""The party behind this login, or refuse. Every customer endpoint starts here, and the
	party is ALWAYS taken from the login — never from an argument the browser sent."""
	if app_kind() != "customer":
		frappe.throw(_("This page is for customer logins."), frappe.PermissionError)
	party = party_for_user()
	if not party:
		frappe.throw(
			_("Your login is not linked to a customer yet. Please ask Mahaveer Metalic to link it."),
			frappe.PermissionError,
		)
	return party


def require_supplier() -> str:
	if app_kind() != "supplier":
		frappe.throw(_("This page is for supplier logins."), frappe.PermissionError)
	vendor = vendor_for_user()
	if not vendor:
		frappe.throw(
			_("Your login is not linked to a supplier yet. Please ask Mahaveer Metalic to link it."),
			frappe.PermissionError,
		)
	return vendor


def require_staff():
	if app_kind() != "staff":
		frappe.throw(_("Only Mahaveer staff can do this."), frappe.PermissionError)


def require_admin():
	if not is_admin():
		frappe.throw(_("Only an admin can do this."), frappe.PermissionError)


def users_with_roles(roles) -> list[str]:
	"""Enabled real users holding any of `roles` (Administrator is left out — it is a
	machine account here, not a phone in someone's pocket)."""
	rows = frappe.get_all(
		"Has Role",
		filters={"role": ["in", list(roles)], "parenttype": "User"},
		pluck="parent",
		distinct=True,
	)
	if not rows:
		return []
	return frappe.get_all(
		"User",
		filters=[
			["name", "in", rows],
			["name", "not in", ["Administrator", "Guest"]],
			["enabled", "=", 1],
		],
		pluck="name",
	)


def admin_users() -> list[str]:
	return users_with_roles({"MM Admin"})


def grant_role(user, role):
	"""Give `user` this role if it lacks it. Never takes anything away, and never touches
	Administrator. A missing role (site not migrated yet) is skipped rather than failing
	the master record's save over it."""
	if not user or user in ("Administrator", "Guest") or not frappe.db.exists("User", user):
		return
	if not frappe.db.exists("Role", role):
		return
	if role in frappe.get_roles(user):
		return
	u = frappe.get_doc("User", user)
	u.append("roles", {"role": role})
	u.save(ignore_permissions=True)


def guard_external_api():
	"""before_request: an outsider may only call the endpoints made for them.

	Only Mahaveer's own methods are screened — Frappe's generic endpoints (frappe.client,
	auth, logout) already obey doctype permissions, and an outsider holds none beyond
	what their role grants.
	"""
	try:
		path = frappe.request.path if frappe.request else ""
	except RuntimeError:
		return
	prefix = "/api/method/"
	if not path.startswith(prefix + "mahaveermetalic."):
		return
	method = path[len(prefix):]
	if method.startswith(EXTERNAL_ALLOWED):
		return
	if app_kind() in ("customer", "supplier"):
		frappe.throw(_("Not permitted."), frappe.PermissionError)
