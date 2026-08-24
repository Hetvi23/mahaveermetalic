# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Why a lot stopped short.

A remark is written whenever an operator does something to a program that leaves the
material in a state the next person has to know about — a partial completion, a revert, a
cancel. It is attached to the LOT rather than to the program, because the lot is what
travels: the same material shows up again on the finished-patti list, in the program
picker, in the Add-program pop-up and on the next inward for that lot, and the reason has
to read the same in all four places.

MM Program's own `remark` field is the PLANNING note written when the program was created.
It is a different thing and is never read or written from here.

Both keys are stored on every row. `lot` is the MM Lot doc name, which is what MM Inward,
MM Cutting, MM Program and MM Production carry; `lot_id` is the human id (LT12/26-27),
which is the ONLY key MM Roll Inventory and MM Stock Ledger Entry have. Filling in
whichever one the caller did not have is what lets one row be found from either side.
"""

import frappe
from frappe.model.document import Document


class MMLotRemark(Document):
	def validate(self):
		self._sync_keys()

	def _sync_keys(self):
		"""Derive the missing half of the lot identity, and the colour with it.

		Callers write a remark from wherever they happen to be standing, so one side or
		the other is routinely all they hold. Resolving here — rather than at each write
		point — is what guarantees a row is findable by either key.
		"""
		if self.lot and not self.lot_id:
			self.lot_id = frappe.db.get_value("MM Lot", self.lot, "lot_id")
		elif self.lot_id and not self.lot:
			# Colour first: lot ids were only made unique per colour later, so two legacy
			# lots can both read "LT1/26-27" and a bare lookup would attach this reason to
			# whichever the database returned — quite possibly the other colour's.
			self.lot = (
				(frappe.db.get_value("MM Lot", {"lot_id": self.lot_id, "color": self.color}, "name")
				 if self.color else None)
				or frappe.db.get_value("MM Lot", {"lot_id": self.lot_id}, "name")
			)
		if self.lot and not self.color:
			self.color = frappe.db.get_value("MM Lot", self.lot, "color")
