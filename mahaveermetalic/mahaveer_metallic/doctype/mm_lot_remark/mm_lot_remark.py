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
		# ONE resolver, in api.lot_remark. This used to be a second copy of it, and it
		# carried the cross-colour fallback the API side was fixed to remove — so it ran on
		# every insert and quietly put the fix back: a remark written for one colour was
		# re-linked to another colour's lot that happened to share the id, and because the
		# read side keys on the LOT's colour, it surfaced on material nobody wrote it about.
		# A rule worth stating once is worth stating only once.
		from mahaveermetalic.mahaveer_metallic.api.lot_remark import _resolve_lot

		self.lot, self.lot_id, self.color = _resolve_lot(self.lot, self.lot_id, self.color)
