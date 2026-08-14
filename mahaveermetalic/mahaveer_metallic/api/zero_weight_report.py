# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Cuttings saved with no weight.

A cutting used to save with 0 net weight (that is now blocked), but rows created before
the guard are still 0 — and a program built from one is refused with "Weight must be
greater than 0", which says nothing about where the problem actually is. This lists them
so they can be corrected at the source.
"""

import frappe


@frappe.whitelist()
def zero_weight_cuttings():
	"""Submitted, still-open cuttings carrying no weight — the ones that block a program."""
	return frappe.db.sql(
		"""
		select c.name, c.posting_date, c.shade, c.roll_no, c.cut, c.status,
			c.total_patti_qty, c.total_net_weight, c.per_patty_weight, c.program
		from `tabMM Cutting` c
		where c.docstatus = 1
			and ifnull(c.closed, 0) = 0
			and ifnull(c.total_net_weight, 0) <= 0
		order by c.posting_date desc
		limit 200
		""",
		as_dict=True,
	)
