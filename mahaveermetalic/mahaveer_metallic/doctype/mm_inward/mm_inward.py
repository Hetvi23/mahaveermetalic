# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe.model.document import Document


class MMInward(Document):
	def on_submit(self):
		self._update_roll_inventory(1)

	def on_cancel(self):
		self._update_roll_inventory(-1)

	def _update_roll_inventory(self, direction: int):
		"""Increase or decrease roll stock on submit/cancel."""
		filters = {
			"location": self.location,
			"lot_number": self.lot_number,
			"color_name": self.color_name,
			"cut": self.cut or "",
		}
		name = frappe.db.get_value("MM Roll Inventory", filters, "name")
		dw = direction * float(self.weight_in or 0)
		db = direction * float(self.box_in or 0)
		if name:
			doc = frappe.get_doc("MM Roll Inventory", name)
			doc.stock_weight = float(doc.stock_weight or 0) + dw
			doc.stock_box = float(doc.stock_box or 0) + db
			doc.item_type = self.item_type
			doc.roll_no = doc.roll_no or self.lot_number
			doc.save(ignore_permissions=True)
		else:
			if direction < 0:
				return
			row = frappe.get_doc(
				{
					"doctype": "MM Roll Inventory",
					"location": self.location,
					"lot_number": self.lot_number,
					"color_name": self.color_name,
					"cut": self.cut or "",
					"item_type": self.item_type,
					"roll_no": self.lot_number,
					"stock_weight": dw,
					"stock_box": db,
				}
			)
			row.insert(ignore_permissions=True)
