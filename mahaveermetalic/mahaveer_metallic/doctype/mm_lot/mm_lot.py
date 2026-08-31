# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Lot master.

A lot is the material entered on ONE inward row: the rolls weighed together under one
challan/supplier/colour. Veermetlon challans are single-colour (lacquer, many rolls), so a
challan maps to a lot.

The displayed `lot_id` is numbered **per colour, per financial year** — LG MM BS runs
LT1/26-27, LT2/26-27, LT3/26-27 and K Anmol BSM runs its own LT1/26-27 alongside it. That
is how the shop counts: the third lot of a colour is that colour's third lot, and numbering
across every colour made it LT6 because five other colours arrived in between, which is not
a number anybody on the floor recognises.

The cost is that a lot id no longer identifies a lot on its own — two colours both read
LT1/26-27 — so it is always shown WITH its colour. Existing ids are never renumbered, so
lots allocated under the old global rule keep the numbers they were given.

Rows are lots: rolls added to ONE row (through the cart) share that row's lot, and a
separate row is a separate lot even in the same colour. Re-entering a challan on a LATER
inward reuses the lot it already has rather than allocating another.
"""

import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class MMLot(Document):
	pass


def financial_year(on=None) -> str:
	"""Indian financial year label for a date: Apr–Mar → '26-27'."""
	d = getdate(on) if on else getdate(frappe.utils.nowdate())
	start = d.year if d.month >= 4 else d.year - 1
	return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def _next_lot_no(fy: str, color: str) -> int:
	"""Next running number for this COLOUR in this financial year.

	The shop counts lots per colour: the third lot of LG MM BS is that colour's third lot,
	and calling it LT6 because five other colours were received in between is not a number
	anybody on the floor recognises.

	The consequence is deliberate and has to be lived with: two colours will both hold
	LT1/26-27, so a lot id no longer identifies a lot on its own — it identifies one only
	together with its colour. Every screen that shows a lot id shows the colour beside it
	for that reason.
	"""
	row = frappe.db.sql(
		"""select coalesce(max(lot_no), 0) from `tabMM Lot`
		where financial_year = %s and color = %s""",
		(fy, color),
	)
	return int((row[0][0] if row else 0) or 0) + 1


@frappe.whitelist()
def preview_lot(color=None, challan_number=None, posting_date=None):
	"""What lot this inward WOULD get — without creating anything.

	Lets the Inward screen show the lot id in its read-only field before posting: the
	challan's existing lot if it already has one, otherwise the next number.
	"""
	if not color:
		return {"lot_id": None, "reused": False}
	challan = (challan_number or "").strip()
	fy = financial_year(posting_date)
	if challan:
		existing = frappe.db.get_value(
			"MM Lot", {"challan_number": challan, "color": color}, ["name", "lot_id"], as_dict=True
		)
		if existing:
			return {"lot": existing.name, "lot_id": existing.lot_id, "reused": True}
	return {"lot": None, "lot_id": f"LT{_next_lot_no(fy, color)}/{fy}", "reused": False}


@frappe.whitelist()
def preview_lots(groups=None, posting_date=None):
	"""What lot EACH entry row would get — one pass over the whole grid, nothing created.

	A row is a lot, so previewing them one at a time is wrong: three new rows would all show
	the same "next" number while posting hands out three consecutive ones. Numbering the grid
	in a single pass is what makes the preview agree with what gets posted.

	`groups` is one entry per row — {"color", "challan_number"} — and the reply is a lot id
	per row, in the same order (None where the row has no colour yet). SEPARATE ROWS ALWAYS
	GET SEPARATE IDS, same colour or not; rolls share a lot only by sitting on one row (added
	through the cart). A row whose challan already carries a lot from an earlier inward shows
	that lot — but only once: a second row naming the same challan is still its own lot.
	"""
	groups = json.loads(groups) if isinstance(groups, str) else (groups or [])
	fy = financial_year(posting_date)
	# Per colour, both of them: the numbers run per colour now, so one colour's LT1 must
	# not stop another colour being given its own LT1 in the same pass.
	next_no = {}  # colour -> last number handed out in this pass
	taken = set()  # (colour, lot id) already shown, so no row repeats another of its colour
	out = []
	for g in groups:
		colour = (g or {}).get("color")
		if not colour:
			out.append(None)
			continue
		challan = ((g or {}).get("challan_number") or "").strip()
		lot_id = (
			frappe.db.get_value("MM Lot", {"challan_number": challan, "color": colour}, "lot_id")
			if challan
			else None
		)
		if not lot_id or (colour, lot_id) in taken:
			n = next_no.get(colour)
			n = (n + 1) if n else _next_lot_no(fy, colour)
			next_no[colour] = n
			lot_id = f"LT{n}/{fy}"
		taken.add((colour, lot_id))
		out.append(lot_id)
	return out


@frappe.whitelist()
def resolve_lot(color=None, challan_number=None, posting_date=None, exclude=None):
	"""Return the lot for this row — reusing the challan's existing lot when that challan is
	entered again, otherwise allocating the next number.

	`exclude` is the lots this document has already used. A second row naming the same
	challan must not land on the first row's lot: separate rows are separate lots, so a hit
	that is already taken is passed over and a fresh one allocated.

	Veermetlon fetch → pass `challan_number` (stored on the lot). Manual inward → omit it
	and a fresh lot is created."""
	if not color:
		frappe.throw(_("A colour is required to resolve a lot."))
	challan = (challan_number or "").strip()
	fy = financial_year(posting_date)
	exclude = set(exclude or ())

	if challan:
		existing = frappe.db.get_value(
			"MM Lot", {"challan_number": challan, "color": color}, ["name", "lot_id"], as_dict=True
		)
		if existing and existing.name not in exclude:
			return {"lot": existing.name, "lot_id": existing.lot_id, "reused": True}

	doc = frappe.get_doc(
		{
			"doctype": "MM Lot",
			"color": color,
			"challan_number": challan or None,
			"financial_year": fy,
			"lot_no": _next_lot_no(fy, color),
			"source": "Veermetlon" if challan else "Manual",
		}
	)
	doc.lot_id = f"LT{doc.lot_no}/{fy}"
	doc.insert(ignore_permissions=True)
	return {"lot": doc.name, "lot_id": doc.lot_id, "reused": False}
