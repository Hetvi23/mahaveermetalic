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
		"""SRS 5.7: Net = Gross − Bobbin − Box, per box and rolled up to the voucher.

		New model — one row per produced box (gross, bobbin = pcs × per-pcs weight, box
		tare); the voucher totals are the sums of the box rows. Legacy single-entry docs
		(a whole-doc bobbins table + box_qty/box_weight) still compute the old way."""
		if self.boxes:
			g_total = bob_total = box_total = net_total = 0.0
			for b in self.boxes:
				tbw = float(b.total_bobbin_weight or 0)
				if not tbw:
					tbw = round(float(b.bobbin_pcs or 0) * float(b.bobbin_pcs_weight or 0), 3)
					b.total_bobbin_weight = tbw
				b.net_weight = round(float(b.gross_weight or 0) - tbw - float(b.box_weight or 0), 3)
				g_total += float(b.gross_weight or 0)
				bob_total += tbw
				box_total += float(b.box_weight or 0)
				net_total += b.net_weight
			self.gross_weight = round(g_total, 3)
			self.bobbin_weight = round(bob_total, 3)
			self.box_weight = round(box_total, 3)
			self.box_qty = len(self.boxes)
			self.net_weight = round(net_total, 3)
		else:
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
		self._raise_sales_challan()

	def _raise_sales_challan(self):
		"""Production is where boxes/bobbins are entered — the dispatch challan is raised
		from it. With a Sales Order the challan is created (as a draft, so it can be
		checked); without one the boxes simply stay in hand for a later challan."""
		if not self.customer_order:
			return
		from mahaveermetalic.mahaveer_metallic.api.challan import create_challan_from_production

		try:
			name = create_challan_from_production(self.name)
			if name:
				frappe.msgprint(_("Sales Challan {0} created from this production.").format(name), alert=True)
		except Exception:
			frappe.log_error(title=f"challan from production {self.name} failed")

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
