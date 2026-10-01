# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The tail end of a lot, written off — or left alone because more of it is coming.

THE RULE (Hetvi, 2026-10-01). Finished goods already club by colour and lot: two
productions of one lot stand as one figure in MM Roll Inventory, because
MMProduction._add_to_inventory keys on (branch, location, lot, colour) and not on the roll.
So a lot is dispatched from one pile, and what is left after a dispatch is the tail of that
lot — 390 kg issued off 400 leaves 10.

A tail smaller than MM Settings' **Wastage Threshold (Kg)** is not worth carrying as stock:
nobody is going to sell 10 kg of one colour on its own, and it sits on every report for ever.
So it is written off to wastage.

EXCEPT when more of that same lot and colour is still to arrive. An inward that has not been
cut yet will become patty, be programmed, and come back as finished goods into the very same
pile — 380 kg landing on the 10 makes 390, which is a quantity again. Writing the 10 off
first would lose it, so while such an inward exists the tail waits.

"At that time" is meant literally: the test is made when the dispatch is submitted, because
that is the moment the floor is asking the question. A tail left standing because an inward
was pending is looked at again the next time that lot is dispatched.
"""

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic import stock_ledger
from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_wastage_threshold_kg,
)


def inward_still_coming(colour: str, lot_number: str) -> str | None:
	"""An inward of this colour+lot that has not been cut yet — the reason to wait.

	`cut_status` is the inward line's own word for it: "In Stock" is material still to be
	cut, "In Cutting" is material already on its way through. Either way it has not reached
	finished goods yet, so it is still coming.

	Scoped to SUBMITTED inwards. A draft is not a delivery, and a cancelled one never was.
	"""
	if not colour:
		return None
	rows = frappe.db.sql(
		"""
		select ii.parent
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		where i.docstatus = 1
		  and ifnull(i.is_gr, 0) = 0
		  and ii.color_name = %(colour)s
		  and ifnull(ii.lot_number, '') = ifnull(%(lot)s, '')
		  and ifnull(ii.cut_status, 'In Stock') in ('In Stock', 'In Cutting')
		limit 1
		""",
		{"colour": colour, "lot": lot_number or ""},
	)
	return rows[0][0] if rows else None


def consider(colour: str, lot_number: str, *, branch=None, location=None, voucher=None):
	"""Look at one colour+lot's tail and write it off if the rule says so.

	Returns a dict saying what was decided, so the caller can report it rather than having
	it happen silently — a write-off is stock leaving the books and the floor should be told.
	"""
	threshold = get_wastage_threshold_kg()
	if threshold <= 0:
		return {"action": "off", "reason": "wastage threshold is 0 — the rule is switched off"}

	rows = frappe.get_all(
		"MM Roll Inventory",
		filters={"color_name": colour},
		fields=["name", "branch", "location", "lot_number", "stock_weight", "stock_box", "roll_no"],
	)
	# Empty Link/Data fields store as NULL, so the key is compared in Python — the same
	# trap _add_to_inventory works around when it finds the row to add to.
	pile = [
		r for r in rows
		if (r.lot_number or "") == (lot_number or "")
		and (branch is None or (r.branch or "") == (branch or ""))
		and (location is None or (r.location or "") == (location or ""))
	]
	left = round(sum(float(r.stock_weight or 0) for r in pile), 3)
	if left <= 0:
		return {"action": "none", "reason": "nothing left of this lot", "left": left}
	if left >= threshold:
		return {"action": "none", "reason": f"{left} kg left is not a tail", "left": left,
			"threshold": threshold}

	waiting_on = inward_still_coming(colour, lot_number)
	if waiting_on:
		return {
			"action": "wait", "left": left, "threshold": threshold, "inward": waiting_on,
			"reason": f"{left} kg held: inward {waiting_on} of this lot is still to be cut",
		}

	written = 0.0
	for r in pile:
		w = round(float(r.stock_weight or 0), 3)
		if w <= 0:
			continue
		b = round(float(r.stock_box or 0), 3)
		row = frappe.get_doc("MM Roll Inventory", r.name)
		row.stock_weight = 0.0
		row.stock_box = 0.0
		row.save(ignore_permissions=True)
		stock_ledger.post_movement(
			voucher_type="Wastage",
			voucher_no=voucher or f"WASTAGE-{colour}-{lot_number or '-'}",
			branch=r.branch,
			location=r.location,
			lot_number=r.lot_number,
			color_name=colour,
			roll_no=r.roll_no,
			in_weight=0.0,
			in_box=0.0,
			out_weight=w,
			out_box=b,
			balance_weight=0.0,
			balance_box=0.0,
			remarks=(
				f"Tail of {colour} {lot_number or ''} written off: {w} kg is under the "
				f"{threshold} kg wastage threshold and no inward of this lot is still to be cut."
			),
		)
		written = round(written + w, 3)
	return {
		"action": "wastage", "written": written, "threshold": threshold,
		"reason": f"{written} kg written off: under {threshold} kg and no inward of this lot is coming",
	}
