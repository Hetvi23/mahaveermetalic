# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document

from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
	is_mm_admin,
	refresh_sales_order_lock,
)


class MMCutting(Document):
	def validate(self):
		self._validate_wastage_tolerance()

	def on_submit(self):
		if self.sales_order:
			refresh_sales_order_lock(self.sales_order)

	def on_cancel(self):
		if self.sales_order:
			refresh_sales_order_lock(self.sales_order)

	def _validate_wastage_tolerance(self):
		w = float(self.wastage_percent or 0)
		if w <= 4:
			return
		if is_mm_admin():
			return
		if self.sales_order and frappe.db.get_value(
			"MM Sales Order", self.sales_order, "admin_override_tolerance"
		):
			return
		frappe.throw(
			_(
				"Wastage above 4% requires MM Admin or an approved tolerance override on the linked Sales Order."
			)
		)
