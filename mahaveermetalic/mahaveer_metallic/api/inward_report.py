# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inward register — one row per ROLL received, newest entered first.

The posted-inwards list summarised a whole inward per line. That answers "what did we
post", not the question the floor actually asks: which rolls came in, on whose challan,
against which order, at what weight. This is that register — one row per
`MM Inward Item`, ordered by when it was keyed in (creation), not by challan date, so
what was just entered is always at the top.

A cancelled inward stays listed and is marked: its rolls were reversed out of stock, so
they are excluded from the totals, but hiding the rows would lose the audit trail. A GOODS
RETURN is listed too, as the negative rows it is — so the totals net down to what is
actually still in, while the receipt that brought it in stays on the record above it.

Two queries plus two small facet queries, whatever the row count — a per-row lookup
would turn a 2,000-roll register into thousands of round trips.
"""

import frappe


@frappe.whitelist()
def rolls_report(challan=None, from_date=None, to_date=None, company=None, item=None,
	party=None, lot=None, order=None, job_work=None, pending=None, limit=500):
	"""Roll-wise inward rows, newest first, with the filter facets and live totals."""
	limit = max(1, min(int(limit or 500), 5000))
	conds, vals = [], {"limit": limit}

	if challan and str(challan).strip():
		conds.append("coalesce(nullif(it.challan_number, ''), inw.challan_number) like %(challan)s")
		vals["challan"] = f"%{str(challan).strip()}%"
	if from_date:
		conds.append("inw.posting_date >= %(from_date)s")
		vals["from_date"] = from_date
	if to_date:
		conds.append("inw.posting_date <= %(to_date)s")
		vals["to_date"] = to_date
	if company:
		conds.append("inw.company_name = %(company)s")
		vals["company"] = company
	if item:
		conds.append("it.color_name = %(item)s")
		vals["item"] = item
	# The party is who it came FROM; the company is which of their businesses it belongs
	# to. A party with several companies is read both ways, so both have to be askable.
	if party:
		conds.append("inw.party = %(party)s")
		vals["party"] = party
	if lot and str(lot).strip():
		conds.append("coalesce(nullif(it.lot_number, ''), inw.lot_number) like %(lot)s")
		vals["lot"] = f"%{str(lot).strip()}%"
	if order:
		conds.append("coalesce(nullif(it.customer_order, ''), inw.sales_order) = %(order)s")
		vals["order"] = order
	if job_work not in (None, "", "all"):
		conds.append("ifnull(it.job_work, 0) = %(job_work)s")
		vals["job_work"] = 1 if frappe.utils.cint(job_work) else 0
	# PENDING = the challan is still open. A receipt posted Partial is one the shop expects
	# more against; a Complete one is finished. Cancelled receipts and goods-return rows are
	# excluded outright rather than filtered on status: neither is waiting for anything, and
	# leaving them in would pad the very list that exists to show what is outstanding.
	if frappe.utils.cint(pending):
		conds.append("ifnull(inw.receipt_status, 'Complete') = 'Partial'")
		conds.append("inw.docstatus = 1")
		conds.append("ifnull(inw.is_gr, 0) = 0")
	where = (" and " + " and ".join(conds)) if conds else ""

	rows = frappe.db.sql(
		f"""
		select
			it.name                                                        as row_id,
			inw.name                                                       as inward,
			inw.posting_date                                               as chalan_date,
			coalesce(nullif(it.challan_number, ''), inw.challan_number)    as challan_no,
			it.customer_order, it.color_name as item, it.roll_name, it.cut,
			it.qty_box, it.weight, it.job_work, it.supplier,
			-- Cutting is the cut-off for correcting or returning a roll, so the register
			-- carries it: the screen must not have to infer from the columns it happens to
			-- show which rows it may still offer actions on.
			it.cutting, it.cut_status,
			-- A return's rows are negative and net the receipt off; the receipt it returns
			-- stays listed, marked, so the register keeps the whole story.
			ifnull(inw.is_gr, 0)        as is_gr,
			ifnull(inw.gr_returned, 0)  as gr_returned,
			inw.gr_against, inw.gr_reason,
			-- Lot is per entry row now; fall back to the header for rolls keyed before that.
			coalesce(nullif(it.lot_number, ''), inw.lot_number)             as lot_number,
			inw.company_name, inw.party, inw.location,
			inw.receipt_status, inw.docstatus, it.creation
		from `tabMM Inward Item` it
		join `tabMM Inward` inw on inw.name = it.parent
		where 1 = 1 {where}
		order by it.creation desc, it.idx asc
		limit %(limit)s
		""",
		vals,
		as_dict=True,
	)

	# Whether each roll may still be corrected or returned, decided by the SAME function the
	# endpoints enforce it with — a screen that worked this out for itself would be a second
	# copy of the rule, and two copies drift.
	from mahaveermetalic.mahaveer_metallic.api.inward import row_block_reason

	for r in rows:
		r["block_reason"] = row_block_reason({**r, "color_name": r.get("item")})
		r["can_edit"] = not r["block_reason"]

	live = [r for r in rows if int(r.docstatus or 0) != 2]
	totals = {
		"rolls": len(live),
		"qty": round(sum(float(r.qty_box or 0) for r in live), 3),
		"weight": round(sum(float(r.weight or 0) for r in live), 3),
		"shown": len(rows),
	}

	items = [
		r[0]
		for r in frappe.db.sql(
			"select distinct color_name from `tabMM Inward Item` "
			"where ifnull(color_name, '') != '' order by color_name"
		)
	]
	companies = [
		r[0]
		for r in frappe.db.sql(
			"select distinct company_name from `tabMM Inward` "
			"where ifnull(company_name, '') != '' order by company_name"
		)
	]
	return {"rows": rows, "totals": totals, "items": items, "companies": companies}
