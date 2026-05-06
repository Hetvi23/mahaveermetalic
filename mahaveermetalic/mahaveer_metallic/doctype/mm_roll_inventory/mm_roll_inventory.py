# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe.model.document import Document


class MMRollInventory(Document):
	def validate(self):
		dup = frappe.db.get_value(
			"MM Roll Inventory",
			{
				"location": self.location,
				"lot_number": self.lot_number or "",
				"color_name": self.color_name,
				"cut": self.cut or "",
			},
			"name",
		)
		if dup and dup != self.name:
			frappe.throw(
				frappe._("Roll inventory already exists for this Location, Lot, Color and Cut combination.")
			)
