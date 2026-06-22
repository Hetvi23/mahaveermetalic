# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMProgram(Document):
	def validate(self):
		if (self.patti_qty or 0) <= 0:
			frappe.throw(_("No of Patty must be greater than 0."))
		if (self.net_weight or 0) <= 0:
			frappe.throw(_("Weight must be greater than 0."))
		self.derive_status()

	def before_update_after_submit(self):
		# validate() does NOT run when saving an already-submitted doc, so re-derive the
		# status here whenever batch counters change post-submit.
		self.derive_status()

	def derive_status(self):
		"""Status is a pure function of the batch counters (one patty = one batch):
		all done → Completed, some done → Partially Done, none done → Running (on a
		machine) or Open (waiting / fully reverted)."""
		total = int(self.total_batches or 0)
		done = max(0, min(int(self.completed_batches or 0), total))
		self.completed_batches = done
		if total and done >= total:
			self.status = "Completed"
		elif done > 0:
			self.status = "Partially Done"
		elif self.is_running:
			self.status = "Running"
		else:
			self.status = "Open"

	def on_cancel(self):
		self._release_source_cutting()

	def _release_source_cutting(self):
		"""Cancelling a program returns its source cutting to the 'In Stock Patty'
		list (clears the program link on the cutting)."""
		if self.source_cutting and frappe.db.exists("MM Cutting", self.source_cutting):
			frappe.db.set_value("MM Cutting", self.source_cutting, "program", None, update_modified=False)
