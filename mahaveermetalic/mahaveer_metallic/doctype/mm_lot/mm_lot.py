# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Lot master.

A lot is the material entered on ONE inward row: the rolls weighed together under one
challan/supplier/colour. Veermetlon challans are single-colour (lacquer, many rolls), so a
challan maps to a lot.

The displayed `lot_id` is numbered **per financial year** — LT1/26-27, LT2/26-27, LT3/26-27
… across every colour, so an id identifies a lot on its own. It used to restart per colour,
which meant two colours both reading LT1/26-27 and an operator seeing the same id on two
different rows of one screen. Existing ids are never renumbered, so lots created under the
old rule can still collide with each other; everything allocated from now on is unique.

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


def _next_lot_no(fy: str) -> int:
	"""Next running number for this financial year — across every colour.

	Taking the max over the whole year (not over one colour) is what makes a lot id
	identify a lot: the number is larger than every number already handed out, so no two
	lots allocated from here can read the same.
	"""
	row = frappe.db.sql(
		"select coalesce(max(lot_no), 0) from `tabMM Lot` where financial_year = %s", (fy,)
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
	return {"lot": None, "lot_id": f"LT{_next_lot_no(fy)}/{fy}", "reused": False}


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
	next_no = None  # last number handed out in this pass
	taken = set()  # lot ids already shown, so no row repeats another's
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
		if not lot_id or lot_id in taken:
			next_no = (next_no + 1) if next_no else _next_lot_no(fy)
			lot_id = f"LT{next_no}/{fy}"
		taken.add(lot_id)
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
			"lot_no": _next_lot_no(fy),
			"source": "Veermetlon" if challan else "Manual",
		}
	)
	doc.lot_id = f"LT{doc.lot_no}/{fy}"
	doc.insert(ignore_permissions=True)
	return {"lot": doc.name, "lot_id": doc.lot_id, "reused": False}
