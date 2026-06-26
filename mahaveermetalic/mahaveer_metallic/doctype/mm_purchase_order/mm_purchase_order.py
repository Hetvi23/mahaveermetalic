# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

from frappe.model.document import Document
from frappe.model.naming import make_autoname


class MMPurchaseOrder(Document):
	def autoname(self):
		"""One PO per Sales Order line, numbered off the SO id: 3-1, 3-2, 3-3 …
		A standalone PO with no linked order falls back to its own plain number."""
		if self.sales_order:
			self.name = make_autoname(f"{self.sales_order}-.#")  # e.g. 3-1
		else:
			raw = make_autoname("MMPO.#####")  # e.g. MMPO00001
			self.name = str(int(raw[len("MMPO"):]))  # → 1

	def validate(self):
		if self.sales_order:
			self.po_number = self.sales_order
