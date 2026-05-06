# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe.model.document import Document


class MMPurchaseOrder(Document):
	def validate(self):
		if self.sales_order:
			self.po_number = self.sales_order
