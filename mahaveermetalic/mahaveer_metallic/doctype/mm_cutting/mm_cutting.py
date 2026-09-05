# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import math

import frappe
from frappe import _
from frappe.model.document import Document


def ceil2(value) -> float:
	"""Round UP to 2 decimals — 42.7285 → 42.73, 43.7211 → 43.73.

	Per-patty weight is always rounded up so the weight planned into production is never
	understated (one patty = one batch, and production consumes per-patty × batches)."""
	return math.ceil(round(float(value or 0) * 100, 6)) / 100


class MMCutting(Document):
	def validate(self):
		self._compute_patti_weights()

	def _compute_patti_weights(self):
		"""SRS 5.5: weight per patti = net weight of one patti (net ÷ qty), rounded UP."""
		if not self.patti_entries:
			frappe.throw(_("Add at least one patti entry."))

		total_qty = 0.0
		total_net = 0.0
		for row in self.patti_entries:
			qty = float(row.patti_qty or 0)
			net = float(row.net_weight or 0)
			if qty <= 0:
				frappe.throw(_("Row #{0}: Patti Qty must be greater than 0.").format(row.idx))
			# A PATTY IS A THING, NOT A MEASUREMENT. One patty is one batch on a machine —
			# you cannot run half of one — so 2.5 patty is a slip of the keyboard, and it
			# propagated: per-patty weight became roll ÷ 2.5, the program planned 2.5
			# batches against it, and the half batch could never be completed.
			if qty != int(qty):
				frappe.throw(
					_("Row #{0}: patty is counted, not weighed — enter a whole number, not {1}.").format(
						row.idx, qty
					)
				)
			qty = int(qty)
			row.patti_qty = qty
			# A zero (or negative) weight was accepted and became per_patty_weight = 0,
			# which the program then planned batches against — so the whole job ran on a
			# weight of nothing. Catch it at the cutting, where it can still be corrected.
			#
			# A PLANNED cut is the one legitimate exception: it is the placeholder a "to
			# cut" program creates before any roll is picked, so its weight is genuinely
			# unknown until the operator binds the real roll (finish_unfinished fills the
			# weight in and clears the flag). Without this carve-out the guard rejected
			# every roll-wise program at save with "Net Weight must be greater than 0",
			# which is the whole feature. Programming a weightless cutting is still
			# refused — in create_program, where that decision actually belongs.
			# .get(), not .planned — the field is only there after a migrate, and an
			# AttributeError here would break every cutting save on a half-deployed site.
			if net <= 0 and not self.get("planned"):
				frappe.throw(
					_("Row #{0}: Net Weight must be greater than 0 — a cutting with no weight "
					  "cannot be programmed.").format(row.idx)
				)
			row.weight_per_patti = ceil2(net / qty)
			total_qty += qty
			total_net += net

		self.total_patti_qty = round(total_qty, 3)
		self.total_net_weight = round(total_net, 3)
		# Roll weight ÷ patty count, rounded up — the per-batch weight Program/Production use.
		self.per_patty_weight = ceil2(total_net / total_qty) if total_qty > 0 else 0.0

	def on_submit(self):
		self._consume_source_roll(sign=-1)

	def on_cancel(self):
		self._consume_source_roll(sign=1)
		self._release_inward_entries()

	def _release_inward_entries(self):
		"""Return any inward entries assigned via the cutting-assignment flow back to
		stock so they reappear on the left 'In Stock' list."""
		assigned = frappe.get_all("MM Inward Item", filters={"cutting": self.name}, pluck="name")
		for name in assigned:
			frappe.db.set_value(
				"MM Inward Item",
				name,
				{"cut_status": "In Stock", "cutting": None},
				update_modified=False,
			)

	def _consume_source_roll(self, sign: int):
		"""Reduce (on submit) / restore (on cancel) source roll stock by total net weight.
		MM Roll Inventory.validate blocks stock going below reserved+issued, so over-cutting
		is rejected automatically. Each move is mirrored to the stock ledger as an OUT
		(submit) / reversing IN (cancel)."""
		if not self.source_roll:
			return
		delta = round(float(self.total_net_weight or 0) * sign, 3)
		if not delta:
			return
		from mahaveermetalic.mahaveer_metallic import stock_ledger

		roll = frappe.get_doc("MM Roll Inventory", self.source_roll)
		roll.stock_weight = round((roll.stock_weight or 0) + delta, 3)
		roll.save(ignore_permissions=True)

		mag_w = round(float(self.total_net_weight or 0), 3)
		stock_ledger.post_movement(
			voucher_type="Cutting",
			voucher_no=self.name,
			branch=roll.branch,
			location=roll.location,
			lot_number=roll.lot_number,
			color_name=roll.color_name,
			roll_no=roll.roll_no,
			item_type=roll.item_type,
			# submit (sign<0) = material leaves stock → OUT; cancel (sign>0) = restore → IN
			out_weight=mag_w if sign < 0 else 0,
			in_weight=mag_w if sign > 0 else 0,
			balance_weight=roll.stock_weight,
			balance_box=roll.stock_box,
			customer_order=self.get("customer_order"),
			remarks="Cutting cancelled" if sign > 0 else None,
		)
