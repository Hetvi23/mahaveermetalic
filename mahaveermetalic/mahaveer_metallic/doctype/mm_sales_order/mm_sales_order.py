# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document

def is_mm_admin() -> bool:
	roles = frappe.get_roles()
	return "MM Admin" in roles or "Administrator" in roles


class MMSalesOrder(Document):
	def validate(self):
		self._enforce_admin_only_flags()
		self._enforce_lock_rules()

	def _enforce_admin_only_flags(self):
		prev = self.get_doc_before_save()
		if not prev:
			return
		if int(self.admin_override_tolerance or 0) != int(prev.admin_override_tolerance or 0) and not is_mm_admin():
			frappe.throw(_("Only MM Admin can change the production tolerance override."))

	def _enforce_lock_rules(self):
		if self.is_new():
			return
		prev = self.get_doc_before_save()
		if not prev or not prev.order_locked:
			return
		if is_mm_admin():
			return
		if int(self.order_locked or 0) < int(prev.order_locked or 0):
			frappe.throw(_("Only MM Admin can unlock this order."))
		if self._document_changed_from(prev):
			frappe.throw(
				_("This order is locked (production ≥ 5%). Only MM Admin may change planning, lines, or other fields.")
			)

	def _document_changed_from(self, prev) -> bool:
		ignore = {"production_completed_percent", "order_locked", "modified", "modified_by"}
		for df in self.meta.fields:
			fn = df.fieldname
			if fn in ignore or df.fieldtype in ("Section Break", "Column Break", "Table", "HTML", "Button"):
				continue
			if self.get(fn) != prev.get(fn):
				return True
		if self.has_value_changed("items"):
			return True
		return False


def refresh_sales_order_lock(sales_order: str):
	"""Recompute production % from submitted cuttings and apply lock. Uses DB updates (no form round-trip)."""
	if not sales_order:
		return
	so = frappe.get_doc("MM Sales Order", sales_order)
	total = sum(float(r.qty_weight or 0) for r in so.items) or 1.0
	produced = float(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(produced_weight), 0)
			FROM `tabMM Cutting`
			WHERE sales_order = %s AND docstatus = 1
			""",
			sales_order,
		)[0][0]
		or 0
	)
	pct = min(100.0, (produced / total) * 100.0)
	locked = 1 if pct >= 5 else 0
	frappe.db.set_value(
		"MM Sales Order",
		sales_order,
		{
			"production_completed_percent": pct,
			"order_locked": locked,
		},
		update_modified=False,
	)
