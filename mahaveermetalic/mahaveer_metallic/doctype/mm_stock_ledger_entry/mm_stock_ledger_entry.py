# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

from frappe.model.document import Document


class MMStockLedgerEntry(Document):
	"""Append-only record of one stock movement (inward IN / cutting OUT / …).

	Rows are created programmatically by `mahaveermetalic.mahaveer_metallic.stock_ledger`
	at the same points that mutate `MM Roll Inventory`; `balance_weight`/`balance_box`
	are copied from the inventory row *after* the movement so the ledger and the live
	balance always reconcile. Never edited by hand.
	"""

	pass
