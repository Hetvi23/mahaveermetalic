# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Give every lot remark its colour, so the eye stops appearing on the wrong material.

Lot numbers run per colour, per financial year (see MM Lot), so LT1/26-27 exists once for
every colour that has ever been received. The remark map was keyed on the bare lot id, so
one colour's reason was handed to every other colour holding the same number — the floor
saw an eye on patti nothing had ever been said about, and the reason it was really about
was buried among them.

The read side now keys on colour + id and takes the colour from MM Lot. This fills in the
remarks themselves for the few whose lot has since been released (cancelling an inward
deletes an unused lot), because those are the only ones the join cannot answer for.
"""

import frappe


def execute():
	if not frappe.db.has_column("MM Lot Remark", "color"):
		return
	# The lot is the authority: MM Lot.color is mandatory, a remark's own colour is not.
	frappe.db.sql(
		"""
		update `tabMM Lot Remark` r
		join `tabMM Lot` l on l.name = r.lot
		set r.color = l.color
		where ifnull(r.color, '') = '' and ifnull(l.color, '') != ''
		"""
	)
	# Remarks whose lot is gone, but whose id belongs to exactly one colour that is still
	# on record — unambiguous, so it can be filled in too. Anything left genuinely cannot
	# be attributed and stays colourless; the badge shows those on every colour of that id
	# rather than dropping them.
	frappe.db.sql(
		"""
		update `tabMM Lot Remark` r
		set r.color = (
			select max(l.color) from `tabMM Lot` l where l.lot_id = r.lot_id
		)
		where ifnull(r.color, '') = '' and ifnull(r.lot_id, '') != ''
			and (select count(distinct l.color) from `tabMM Lot` l where l.lot_id = r.lot_id) = 1
		"""
	)
