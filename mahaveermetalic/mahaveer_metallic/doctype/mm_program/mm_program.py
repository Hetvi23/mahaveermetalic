# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMProgram(Document):
	def validate(self):
		if (self.patti_qty or 0) <= 0:
			frappe.throw(_("No of Patty must be greater than 0."))
		# An unfinished program is planned from an inventory colour before the cut — its
		# weight is 0 until the operator picks the real roll at finish, so don't require it.
		if not self.unfinished and (self.net_weight or 0) <= 0:
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
		self.derive_completed_weight()

	def derive_completed_weight(self):
		"""The weight of the patty actually COMPLETED — what the screens show and what
		Production consumes.

		A program's `net_weight` is the plan: per-patty × the batches it set out to run. What
		came off the machine is per-patty × the batches that finished, and quoting the roll's
		weight for a job that ran three batches of four overstates it. Derived from the rate
		so it can never disagree with the batch counters.
		"""
		rate = float(self.per_patty_weight or 0)
		if not rate:
			total = int(self.total_batches or 0)
			rate = round(float(self.net_weight or 0) / total, 3) if total else 0.0
		self.completed_weight = round(rate * int(self.completed_batches or 0), 3)

	def on_cancel(self):
		self._release_source_cutting()
		self._cancel_placeholder_cutting()

	def _release_source_cutting(self):
		"""Cancelling a program hands its patti back, so they are available to program again.

		Patti are counted per cutting, so this returns exactly what this program took (and
		nothing another program holds on the same cutting). Reverting already gives back the
		unrun batches — `patti_released` is what stops a revert-then-cancel handing the same
		patti back twice.
		"""
		from mahaveermetalic.mahaveer_metallic.api.program import release_program_patti

		release_program_patti(self)

	def _cancel_placeholder_cutting(self):
		"""An unfinished program's source cutting is a 0-weight placeholder (the planned
		cut). Nothing was consumed from stock, so cancel it too so it doesn't linger on
		the Cutting board once the program is gone."""
		if not self.unfinished or not self.source_cutting:
			return
		if not frappe.db.exists("MM Cutting", self.source_cutting):
			return
		c = frappe.db.get_value("MM Cutting", self.source_cutting, "docstatus")
		if c == 1:
			doc = frappe.get_doc("MM Cutting", self.source_cutting)
			doc.flags.ignore_permissions = True
			doc.cancel()
