# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMSalesChallan(Document):
	def validate(self):
		if not self.items:
			frappe.throw(_("Add at least one item to the sales challan."))
		for it in self.items:
			if (it.qty_box or 0) < 0 or (it.weight or 0) < 0:
				frappe.throw(_("Row #{0}: box and weight cannot be negative.").format(it.idx))
		self.total_box = round(sum(float(i.qty_box or 0) for i in self.items), 3)
		self.total_weight = round(sum(float(i.weight or 0) for i in self.items), 3)
