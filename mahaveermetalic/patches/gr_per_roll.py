# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Give a goods-return row a link back to the ROLL it returns.

A GR used to be matched to what it had already given back by (roll name, colour, lot).
That worked while a GR returned a whole receipt, and breaks the moment one roll of a
receipt is returned on its own: a lot arrives as ten rolls, they are weighed under one
colour and one lot and most carry no roll number of their own, so all ten share that key.
Returning the first roll then read as having returned every one of them, and the second
was refused with "everything has already been returned".

`gr_against_row` names the source row instead, which is unique. Existing GR rows are
backfilled where the old key still identifies exactly one unreturned source row; where it
is genuinely ambiguous they are left alone and the old tuple match still covers them.
"""

import frappe


def execute():
	try:
		frappe.reload_doc("mahaveer_metallic", "doctype", "mm_inward_item", force=True)
	except Exception:
		frappe.log_error(title="reload mm_inward_item failed")

	if not frappe.db.has_column("MM Inward Item", "gr_against_row"):
		return

	# One source row per (parent receipt, roll, colour, lot) is the unambiguous case.
	frappe.db.sql(
		"""
		update `tabMM Inward Item` gi
		join `tabMM Inward` g on g.name = gi.parent and ifnull(g.is_gr, 0) = 1
		join `tabMM Inward Item` si on si.parent = g.gr_against
			and ifnull(si.roll_name, '') = ifnull(gi.roll_name, '')
			and ifnull(si.color_name, '') = ifnull(gi.color_name, '')
			and ifnull(si.lot_number, '') = ifnull(gi.lot_number, '')
		set gi.gr_against_row = si.name
		where ifnull(gi.gr_against_row, '') = ''
			and (
				select count(*) from `tabMM Inward Item` x
				where x.parent = g.gr_against
					and ifnull(x.roll_name, '') = ifnull(gi.roll_name, '')
					and ifnull(x.color_name, '') = ifnull(gi.color_name, '')
					and ifnull(x.lot_number, '') = ifnull(gi.lot_number, '')
			) = 1
		"""
	)
