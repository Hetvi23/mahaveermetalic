# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Lot master.

A lot groups the rolls received together for ONE colour. Veermetlon challans are
single-colour (lacquer, many rolls), so a challan maps to exactly one lot.

The displayed `lot_id` is numbered **per colour, per financial year** — LT1/26-27,
LT2/26-27 … and a different colour starts again at LT1/26-27. Two colours therefore
share the same visible id, so the document name is a hash (the internal id differs)
and `lot_id` is only the display value.

Re-entering an inward for a challan that already has a lot reuses that lot instead of
allocating a new number.
"""

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


def _next_lot_no(color: str, fy: str) -> int:
	"""Next running number for this colour + financial year (colour-wise numbering)."""
	row = frappe.db.sql(
		"""select coalesce(max(lot_no), 0) from `tabMM Lot`
		where color = %s and financial_year = %s""",
		(color, fy),
	)
	return int((row[0][0] if row else 0) or 0) + 1


@frappe.whitelist()
def resolve_lot(color=None, challan_number=None, posting_date=None):
	"""Return the lot for this colour — reusing the challan's existing lot when the same
	challan is entered again, otherwise allocating the next colour-wise number.

	Veermetlon fetch → pass `challan_number` (stored on the lot). Manual inward → omit it
	and a fresh lot is created."""
	if not color:
		frappe.throw(_("A colour is required to resolve a lot."))
	challan = (challan_number or "").strip()
	fy = financial_year(posting_date)

	if challan:
		existing = frappe.db.get_value(
			"MM Lot", {"challan_number": challan, "color": color}, ["name", "lot_id"], as_dict=True
		)
		if existing:
			return {"lot": existing.name, "lot_id": existing.lot_id, "reused": True}

	doc = frappe.get_doc(
		{
			"doctype": "MM Lot",
			"color": color,
			"challan_number": challan or None,
			"financial_year": fy,
			"lot_no": _next_lot_no(color, fy),
			"source": "Veermetlon" if challan else "Manual",
		}
	)
	doc.lot_id = f"LT{doc.lot_no}/{fy}"
	doc.insert(ignore_permissions=True)
	return {"lot": doc.name, "lot_id": doc.lot_id, "reused": False}
