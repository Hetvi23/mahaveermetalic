# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

from frappe.model.document import Document
from frappe.model.naming import make_autoname


class MMPurchaseOrder(Document):
	def autoname(self):
		"""Plain running number: 1, 2, 3 … The linked Sales Order lives in its own
		field (and is shown as a column), so the PO id stays a simple sequential
		number instead of a confusing compound <so>-<n>."""
		raw = make_autoname("MMPO.#####")  # e.g. MMPO00001
		self.name = str(int(raw[len("MMPO"):]))  # → 1

	def validate(self):
		if self.sales_order:
			self.po_number = self.sales_order
