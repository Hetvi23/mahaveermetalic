# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document

from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import get_tolerance_percent


class MMProduction(Document):
	def validate(self):
		self._compute_weights()
		self._enforce_tolerance()

	def _compute_weights(self):
		"""SRS 5.7: Net = Gross − Bobbin − Box; Bobbin = sum of bobbin rows
		(auto qty × master tare when a row weight is left blank)."""
		bobbin_total = 0.0
		for row in self.bobbins or []:
			if row.bobbin:
				master = frappe.db.get_value(
					"MM Bobbin Master", row.bobbin, ["weight", "quality"], as_dict=True
				)
				if master:
					if not row.quality:
						row.quality = master.quality
					if not row.weight:
						row.weight = round(float(row.qty or 0) * float(master.weight or 0), 3)
			bobbin_total += float(row.weight or 0)

		self.bobbin_weight = round(bobbin_total, 3)
		self.net_weight = round(
			float(self.gross_weight or 0) - self.bobbin_weight - float(self.box_weight or 0), 3
		)
		base = float(self.input_weight or 0)
		self.variance_percent = round((self.net_weight - base) / base * 100, 2) if base else 0.0

	def _enforce_tolerance(self):
		"""Beyond ±tolerance (default 4%), the production cannot be saved/submitted unless
		an Admin PIN was verified (sets pin_override via the API)."""
		if not self.input_weight:
			return
		tol = get_tolerance_percent()
		if abs(self.variance_percent) > tol and not self.pin_override:
			frappe.throw(
				_(
					"Production variance is {0}% (tolerance ±{1}%). An Admin Override PIN is "
					"required to accept this."
				).format(self.variance_percent, tol)
			)

	def on_submit(self):
		self._sync_source_program(link=True)
		self._refresh_order_production()

	def on_cancel(self):
		self._sync_source_program(link=False)
		self._refresh_order_production()

	def _sync_source_program(self, link: bool):
		"""Mark the source program done (and link it) on submit; release it on cancel so
		it returns to 'In Threads Processing'."""
		if not self.source_program or not frappe.db.exists("MM Program", self.source_program):
			return
		if link:
			frappe.db.set_value(
				"MM Program",
				self.source_program,
				{"production": self.name, "status": "Completed"},
				update_modified=False,
			)
		else:
			frappe.db.set_value(
				"MM Program",
				self.source_program,
				{"production": None, "status": "In Progress"},
				update_modified=False,
			)

	def _refresh_order_production(self):
		if self.customer_order:
			from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
				recalculate_production_completed,
			)

			recalculate_production_completed(self.customer_order)
