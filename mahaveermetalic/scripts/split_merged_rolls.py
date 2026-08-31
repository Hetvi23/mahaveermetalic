# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Split stock rows that were merged across several rolls, one row per roll.

MM Roll Inventory used to be keyed on (branch, location, lot_number, color_name) — the ROLL
was not part of it. So the second roll of a lot was added into the first roll's row and the
third into the same one again: a lot received as five rolls of 242 kg became a single stock
row of 1,210 kg carrying the first roll's name. Every screen that picks stock reads these
rows, so Cutting and the Sales Voucher could only offer the whole lot.

MMInward._find_roll includes the roll now, so material received from here on gets a row per
roll. This is the other half: the rows already on the floor.

    DRY RUN (default — changes nothing, prints the plan):
        bench --site <site> execute mahaveermetalic.scripts.split_merged_rolls.run

    FOR REAL:
        bench --site <site> execute mahaveermetalic.scripts.split_merged_rolls.run \
            --kwargs "{'apply': True, 'confirm': 'SPLIT MERGED ROLLS'}"

WHAT IT WILL NOT TOUCH, and why:

  * A row whose weight does not equal the sum of its inward rows. That means something
    other than inward has moved it — a cutting consumed part of it, a challan sent some
    out — and there is no honest way to decide which roll the remainder belongs to. Those
    are listed and left alone for a person to look at.
  * A row carrying `issued_weight` or `reserved_weight`. Those figures are about the merged
    row as a whole and cannot be divided without knowing what they were issued against.
  * Anything at all when the stock does not reconcile. The script would rather leave a lot
    merged than invent a split.

The stock ledger is NOT rewritten. Its entries are the history of what happened, and what
happened is that the material arrived under one row; rewriting them would make the ledger
disagree with the vouchers that produced it. Balances stay correct because the split
preserves the total.
"""

import frappe

CONFIRM = "SPLIT MERGED ROLLS"


def _candidates():
	"""Merged rows: a stock row with MORE THAN ONE distinct inward roll behind it."""
	return frappe.db.sql(
		"""
		select ri.name, ri.branch, ri.location, ri.lot_number, ri.color_name, ri.roll_no,
			ri.stock_weight, ri.stock_box, ri.supplier, ri.item_type,
			ifnull(ri.issued_weight, 0) as issued_weight,
			ifnull(ri.reserved_weight, 0) as reserved_weight,
			count(distinct ii.roll_name) as rolls,
			round(sum(ii.weight), 3) as inward_weight,
			round(sum(ii.qty_box), 3) as inward_box
		from `tabMM Roll Inventory` ri
		join `tabMM Inward Item` ii
			on ifnull(ii.lot_number, '') = ifnull(ri.lot_number, '')
			and ifnull(ii.color_name, '') = ifnull(ri.color_name, '')
		join `tabMM Inward` i
			on i.name = ii.parent and i.docstatus = 1
			and ifnull(i.location, '') = ifnull(ri.location, '')
			and ifnull(i.branch, '') = ifnull(ri.branch, '')
		where ifnull(ii.roll_name, '') != ''
		group by ri.name
		having count(distinct ii.roll_name) > 1
		""",
		as_dict=True,
	)


def _rolls_behind(row):
	"""The individual rolls that were folded into one stock row."""
	return frappe.db.sql(
		"""
		select ii.roll_name, round(sum(ii.weight), 3) as weight,
			round(sum(ii.qty_box), 3) as box, max(ii.supplier) as supplier
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent and i.docstatus = 1
		where ifnull(ii.lot_number, '') = %(lot)s
			and ifnull(ii.color_name, '') = %(colour)s
			and ifnull(i.location, '') = %(loc)s
			and ifnull(i.branch, '') = %(branch)s
			and ifnull(ii.roll_name, '') != ''
		group by ii.roll_name
		order by ii.roll_name
		""",
		{
			"lot": row.lot_number or "", "colour": row.color_name or "",
			"loc": row.location or "", "branch": row.branch or "",
		},
		as_dict=True,
	)


def run(apply=False, confirm=None):
	apply = bool(apply) and str(apply).lower() not in ("0", "false")
	site = frappe.local.site

	print("")
	print("=" * 72)
	print("  SPLIT MERGED ROLL STOCK   site: {0}".format(site))
	print("  mode: {0}".format("APPLY" if apply else "DRY RUN — nothing is changed"))
	print("=" * 72)

	if apply and confirm != CONFIRM:
		frappe.throw("Re-run with confirm='{0}' to mean it. Site: {1}".format(CONFIRM, site))

	rows = _candidates()
	if not rows:
		print("\nNothing merged — every stock row already stands for one roll.")
		return

	split, skipped = 0, []
	for row in rows:
		rolls = _rolls_behind(row)
		total = round(sum(float(r.weight or 0) for r in rolls), 3)
		stock = round(float(row.stock_weight or 0), 3)

		# Only when the row still holds exactly what came in. Anything else means the
		# material has moved on and the split would be a guess.
		if abs(total - stock) > 0.001:
			skipped.append((row, "stock {0} != inwarded {1} — material has moved".format(stock, total)))
			continue
		if float(row.issued_weight or 0) or float(row.reserved_weight or 0):
			skipped.append((row, "carries issued/reserved weight"))
			continue

		print("\n  {0}  lot {1} · {2} · {3}".format(row.name, row.lot_number, row.color_name, row.location))
		print("     {0} kg over {1} rolls ->".format(stock, len(rolls)))
		for n, r in enumerate(rolls):
			keeps = " (this row keeps it)" if n == 0 else ""
			print("       {0:<14} {1:>10} kg{2}".format(r.roll_name, r.weight, keeps))

		if not apply:
			split += 1
			continue

		# The first roll stays on the existing row — every ledger entry, cutting and
		# challan already points at that name, and moving it would orphan them.
		first = rolls[0]
		frappe.db.set_value(
			"MM Roll Inventory", row.name,
			{"roll_no": first.roll_name, "stock_weight": first.weight, "stock_box": first.box},
			update_modified=False,
		)
		for r in rolls[1:]:
			doc = frappe.get_doc({
				"doctype": "MM Roll Inventory",
				"roll_no": r.roll_name,
				"lot_number": row.lot_number,
				"branch": row.branch,
				"location": row.location,
				"supplier": r.supplier or row.supplier,
				"color_name": row.color_name,
				"item_type": row.item_type,
				"stock_weight": r.weight,
				"stock_box": r.box,
			})
			doc.insert(ignore_permissions=True)
		split += 1

	if skipped:
		print("\nLEFT ALONE ({0}) — look at these by hand:".format(len(skipped)))
		for row, why in skipped:
			print("   {0}  lot {1} · {2}: {3}".format(row.name, row.lot_number, row.color_name, why))

	if apply:
		frappe.db.commit()
		print("\nSplit {0} merged row(s).".format(split))
	else:
		print("\n{0} row(s) would be split. Nothing was changed.".format(split))
		print("To do it for real:")
		print("   bench --site {0} backup".format(site))
		print(
			"   bench --site {0} execute mahaveermetalic.scripts.split_merged_rolls.run "
			"--kwargs \"{{'apply': True, 'confirm': '{1}'}}\"".format(site, CONFIRM)
		)
	print("")
