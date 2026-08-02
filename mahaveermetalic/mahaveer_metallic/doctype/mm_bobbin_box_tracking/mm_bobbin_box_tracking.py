# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMBobbinBoxTracking(Document):
	def validate(self):
		self._require_bobbin_or_box()

	def on_update(self):
		# Receive = bobbins in, Give = bobbins out. Re-posted on every save so an edit
		# keeps the bobbin ledger in step.
		from mahaveermetalic.mahaveer_metallic.api.bobbin import post_bobbin_challan

		post_bobbin_challan(self)

	def on_trash(self):
		from mahaveermetalic.mahaveer_metallic.api.bobbin import clear_voucher

		clear_voucher(self.name)

	def _require_bobbin_or_box(self):
		"""SRS 5.3: each line must carry a bobbin OR a box quantity (at least one),
		and the challan must have at least one such line."""
		if not self.lines:
			frappe.throw(_("Add at least one bobbin / box line."))

		any_qty = False
		for row in self.lines:
			has_bobbin = (row.bobbin_qty or 0) > 0
			has_box = (row.box_qty or 0) > 0
			if not has_bobbin and not has_box:
				frappe.throw(
					_("Row #{0}: enter a Bobbin Qty or a Box Qty (at least one is required).").format(row.idx)
				)
			any_qty = any_qty or has_bobbin or has_box

		if not any_qty:
			frappe.throw(_("Enter a Bobbin Qty or Box Qty on at least one line."))
