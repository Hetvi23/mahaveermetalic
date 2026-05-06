# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe.model.document import Document


class MMRollInventory(Document):
	def validate(self):
		self.stock_weight = float(self.stock_weight or 0)
		self.reserved_weight = float(self.reserved_weight or 0)
		self.issued_weight = float(self.issued_weight or 0)
		self.available_weight = self.stock_weight - self.reserved_weight - self.issued_weight
		if self.available_weight < 0:
			frappe.throw(frappe._("Available stock cannot be negative. Check reserve/issue values."))

		dup = frappe.db.get_value(
			"MM Roll Inventory",
			{
				"branch": self.branch or "",
				"location": self.location,
				"lot_number": self.lot_number or "",
				"color_name": self.color_name,
				"cut": self.cut or "",
			},
			"name",
		)
		if dup and dup != self.name:
			frappe.throw(
				frappe._("Roll inventory already exists for this Branch, Location, Lot, Color and Cut combination.")
			)
