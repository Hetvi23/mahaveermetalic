# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Supplier-facing aggregates.

`get_supplier_pending` returns, per (supplier, color, cut), how much is still
pending = sum over that supplier's Purchase Orders of (ordered KG − received KG),
where received comes from submitted Inward lines matched on SO + color + cut.
Two separate POs for the same item+supplier are combined here (the user wants
400 pending + a new 300 order shown as 700 together).
"""

import frappe

# Roles that can see every supplier's data (and pass an explicit supplier filter).
PRIVILEGED_ROLES = {
	"Administrator",
	"System Manager",
	"MM Admin",
	"MM Operations",
	"MM Inventory Manager",
	"MM Sales Team",
}


def vendor_for_user(user: str | None = None):
	"""The MM Vendor Master linked to this login user, if any."""
	user = user or frappe.session.user
	return frappe.db.get_value("MM Vendor Master", {"user": user}, "name")


def _is_privileged(user: str) -> bool:
	return bool(PRIVILEGED_ROLES.intersection(frappe.get_roles(user)))


def _received_for(po) -> float:
	"""KG already received (inwarded) against this PO's order line."""
	if not po.sales_order:
		return 0.0
	res = frappe.db.sql(
		"""
		select coalesce(sum(ii.weight), 0)
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		where i.docstatus = 1
			and ii.customer_order = %(so)s
			and ii.color_name = %(color)s
			and (%(cut)s = '' or ifnull(ii.cut, '') = %(cut)s)
		""",
		{"so": po.sales_order, "color": po.color or "", "cut": po.cut or ""},
	)
	return float(res[0][0] or 0)


@frappe.whitelist()
def get_supplier_pending(supplier=None):
	user = frappe.session.user
	if _is_privileged(user):
		# Admin / ops: may view all, or a chosen supplier.
		frappe.has_permission("MM Purchase Order", throw=True)
	else:
		# A supplier login only ever sees its own vendor — the param is ignored.
		supplier = vendor_for_user(user)
		if not supplier:
			return []

	filters = {}
	if supplier:
		filters["supplier"] = supplier

	pos = frappe.get_all(
		"MM Purchase Order",
		filters=filters,
		fields=["name", "supplier", "sales_order", "color", "cut", "qty_kg"],
	)

	agg = {}
	for po in pos:
		ordered = float(po.qty_kg or 0)
		received = _received_for(po)
		pending = max(0.0, ordered - received)
		key = (po.supplier or "", po.color or "", po.cut or "")
		row = agg.setdefault(
			key,
			{
				"supplier": po.supplier,
				"color": po.color,
				"cut": po.cut or "",
				"ordered": 0.0,
				"received": 0.0,
				"pending": 0.0,
				"po_count": 0,
			},
		)
		row["ordered"] += ordered
		row["received"] += received
		row["pending"] += pending
		row["po_count"] += 1

	rows = [
		{
			**v,
			"ordered": round(v["ordered"], 3),
			"received": round(v["received"], 3),
			"pending": round(v["pending"], 3),
		}
		for v in agg.values()
	]
	rows.sort(key=lambda r: r["pending"], reverse=True)
	return rows


# ── Purchase Order row-level scoping for supplier logins ──────────────────────
# Wired in hooks.py (permission_query_conditions + has_permission). Privileged
# roles are unaffected; a supplier login only ever sees its own vendor's POs.


def po_permission_query(user: str | None = None) -> str:
	user = user or frappe.session.user
	if _is_privileged(user):
		return ""
	vendor = vendor_for_user(user)
	if not vendor:
		# A supplier with no vendor mapping sees nothing.
		return "1 = 0"
	return f"`tabMM Purchase Order`.`supplier` = {frappe.db.escape(vendor)}"


def po_has_permission(doc, user: str | None = None, permission_type=None) -> bool:
	user = user or frappe.session.user
	if _is_privileged(user):
		return True
	vendor = vendor_for_user(user)
	return bool(vendor) and doc.get("supplier") == vendor
