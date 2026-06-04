# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMCutting(Document):
	def validate(self):
		self._compute_patti_weights()

	def _compute_patti_weights(self):
		"""SRS 5.5: weight per patti = net weight of one patti (net ÷ qty)."""
		if not self.patti_entries:
			frappe.throw(_("Add at least one patti entry."))

		total_qty = 0.0
		total_net = 0.0
		for row in self.patti_entries:
			qty = float(row.patti_qty or 0)
			net = float(row.net_weight or 0)
			if qty <= 0:
				frappe.throw(_("Row #{0}: Patti Qty must be greater than 0.").format(row.idx))
			row.weight_per_patti = round(net / qty, 4)
			total_qty += qty
			total_net += net

		self.total_patti_qty = round(total_qty, 3)
		self.total_net_weight = round(total_net, 3)

	def on_submit(self):
		self._consume_source_roll(sign=-1)

	def on_cancel(self):
		self._consume_source_roll(sign=1)

	def _consume_source_roll(self, sign: int):
		"""Reduce (on submit) / restore (on cancel) source roll stock by total net weight.
		MM Roll Inventory.validate blocks stock going below reserved+issued, so over-cutting
		is rejected automatically."""
		if not self.source_roll:
			return
		delta = round(float(self.total_net_weight or 0) * sign, 3)
		if not delta:
			return
		roll = frappe.get_doc("MM Roll Inventory", self.source_roll)
		roll.stock_weight = round((roll.stock_weight or 0) + delta, 3)
		roll.save(ignore_permissions=True)
