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
		self._enforce_lock_rules()

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
				_("This order is locked (production ≥ 5%). Only MM Admin may change lines or other fields.")
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
