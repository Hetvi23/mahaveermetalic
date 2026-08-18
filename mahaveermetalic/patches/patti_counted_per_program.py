# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Land the counted-patti model, and book what programs already hold.

Patti used to be claimed whole: a cutting carried a single `program` link and vanished from
the picker the moment anything programmed it — so a cut yielding more patti than the program
planned for lost the remainder. Now they are counted (MM Cutting.consumed_patti) and the
take is recorded per program (MM Program.patty_sources), which is what lets one cut feed
several programs and leaves a bigger cut's remainder available.

Existing programs are backfilled from that older signal: a cutting with a program link was
wholly consumed under the old rules, so its patti are booked to that program — up to what
the program actually planned, with anything beyond that left available, which is the new
behaviour applied to the data already on the floor.
"""

import frappe


def execute():
	for name in ("mm_program_patty", "mm_cutting", "mm_program"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")

	if not frappe.db.has_column("MM Cutting", "consumed_patti"):
		return

	live = frappe.db.sql(
		"""
		select p.name as program, p.total_batches, p.source_cutting, p.shade, p.cut,
			c.total_patti_qty, c.per_patty_weight, p.completed_batches, p.net_weight
		from `tabMM Program` p
		join `tabMM Cutting` c on c.name = p.source_cutting
		where p.docstatus = 1 and ifnull(p.source_cutting, '') != ''
		""",
		as_dict=True,
	)
	for row in live:
		if frappe.db.exists("MM Program Patty", {"parent": row.program, "cutting": row.source_cutting}):
			continue
		# What this program holds: its own batches, never more than the cut yielded.
		held = min(float(row.total_batches or 0) or float(row.total_patti_qty or 0), float(row.total_patti_qty or 0))
		if held <= 0:
			continue
		frappe.get_doc(
			{
				"doctype": "MM Program Patty",
				"parent": row.program,
				"parenttype": "MM Program",
				"parentfield": "patty_sources",
				"cutting": row.source_cutting,
				"patti": round(held, 3),
				"shade": row.shade,
				"cut": row.cut,
			}
		).insert(ignore_permissions=True)
		consumed = float(frappe.db.get_value("MM Cutting", row.source_cutting, "consumed_patti") or 0)
		frappe.db.set_value(
			"MM Cutting", row.source_cutting, "consumed_patti", round(consumed + held, 3), update_modified=False
		)

	# Completed weight is derived, so fill it in for everything already on record: the rate
	# comes from the cutting, and per-patty × completed batches is what those programs ran.
	frappe.db.sql(
		"""
		update `tabMM Program` p
		left join `tabMM Cutting` c on c.name = p.source_cutting
		set p.per_patty_weight = case
				when ifnull(p.per_patty_weight, 0) > 0 then p.per_patty_weight
				when ifnull(c.per_patty_weight, 0) > 0 then c.per_patty_weight
				when ifnull(p.total_batches, 0) > 0 then round(ifnull(p.net_weight, 0) / p.total_batches, 3)
				else 0 end
		"""
	)
	frappe.db.sql(
		"""
		update `tabMM Program`
		set completed_weight = round(ifnull(per_patty_weight, 0) * ifnull(completed_batches, 0), 3)
		"""
	)
