# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


class MMPurchaseOrder(Document):
	def autoname(self):
		"""The PO id mirrors its Sales Order id — one order, one purchase order, same
		number (SO 5 → PO 5). If a single Sales Order ever spawns more than one PO
		(a multi-line order), the extras are suffixed (5-2, 5-3 …) to stay unique.
		POs created without a Sales Order fall back to a plain running number."""
		if self.sales_order:
			base = str(self.sales_order)
			name, n = base, 2
			while frappe.db.exists("MM Purchase Order", name):
				name = f"{base}-{n}"
				n += 1
			self.name = name
		else:
			# No Sales Order to mirror — keep the MMPO- prefix (e.g. MMPO-00001) so the
			# name lives in its own namespace and can't collide with the plain-integer
			# names of SO-mirrored POs.
			self.name = make_autoname("MMPO-.#####")

	def validate(self):
		if self.sales_order:
			self.po_number = self.sales_order
