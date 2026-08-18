# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Land the per-row inward schema, and backfill the rows already posted.

MM Inward Item gains `supplier`, `lot` and `lot_number` — a lot now belongs to the entry
row it was weighed on, not to the whole document. MM Inward's Company stops being
mandatory (the entry screen derives it from the row's order instead of asking).

`bench migrate` skips re-syncing an already-installed doctype whose JSON it thinks is
unchanged, so force the reload; then copy each existing inward's header lot down onto its
rows, so a register reading the row-level lot shows the same value it always did.
"""

import frappe


def execute():
	for name in ("mm_inward_item", "mm_inward"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")

	if not frappe.db.has_column("MM Inward Item", "lot_number"):
		return
	frappe.db.sql(
		"""
		update `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		set ii.lot_number = i.lot_number, ii.lot = i.lot
		where ifnull(ii.lot_number, '') = '' and ifnull(i.lot_number, '') != ''
		"""
	)
