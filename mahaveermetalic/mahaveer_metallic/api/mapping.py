# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Roll → Inward mapping, and the receipt status that follows from it.

WHY THIS EXISTS: an inward is inserted and submitted in one transaction, so its
Partial/Complete status was decided once, at the moment it was posted, and then frozen.
A challan that arrives over two days left the first receipt reading "Partial" for ever,
even after the rest of it turned up — nothing could ever go back and say "that one is
settled now" (Hetvi: "the inward status also keeps changing based on that sync").

WHAT A MAPPING IS: a roll already standing in MM Roll Inventory, credited to the receipt
it belongs to. Nothing here creates or moves stock — the roll was received by an inward
in the ordinary way and is in stock already; this only says which receipt it answers for.

THE WEIGHT IS A SNAPSHOT. `stock_weight` falls as a roll is cut and issued, so counting a
receipt from the live figure would drag a Complete inward back to Partial weeks later,
with nothing having changed about what was delivered. `mapped_weight` records what the
roll was worth when it was mapped, and only re-mapping changes it.

WHEN IT LOCKS: a challan closes when an inward that received it is Complete
(inward.challan_closed_by). Mapping is free until then and refused afterwards — which is
the same rule the receipt screen already enforces, so the two cannot disagree.
"""

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic.api.inward import (
	_RECEIPT_TOLERANCE,
	challan_closed_by,
)
from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_inward_over_tolerance,
)


def _challan_of(inward) -> str:
	"""The challan a receipt was filed under — its own, or the one its rows carry.

	Challans are entered per ROW on the grid, and the header field is only filled on some
	paths, so a receipt whose header is blank still has a challan and must not be treated
	as having none.
	"""
	head = (frappe.db.get_value("MM Inward", inward, "challan_number") or "").strip()
	if head:
		return head
	row = frappe.db.sql(
		"""select ifnull(challan_number, '') from `tabMM Inward Item`
		where parent = %s and ifnull(challan_number, '') != '' limit 1""",
		(inward,),
	)
	return (row[0][0] if row else "") or ""


def mapped_weight_of(inward) -> float:
	"""What the rolls mapped to this receipt are credited with, in total."""
	return round(
		float(
			frappe.db.sql(
				"select coalesce(sum(mapped_weight), 0) from `tabMM Roll Inventory` where mapped_inward = %s",
				(inward,),
			)[0][0]
			or 0
		),
		3,
	)


def expected_weight_of(inward) -> float:
	"""What this receipt was told to expect.

	`challan_expected_weight` is only filled on the Veermetlon-verified path. With nothing
	to measure against, the receipt's own rows ARE the expectation — a receipt that was
	never given a target cannot be judged short.
	"""
	exp = float(frappe.db.get_value("MM Inward", inward, "challan_expected_weight") or 0)
	if exp > 0:
		return round(exp, 3)
	own = frappe.db.sql(
		"select coalesce(sum(weight), 0) from `tabMM Inward Item` where parent = %s", (inward,)
	)[0][0]
	return round(float(own or 0), 3)


def status_for(inward) -> str:
	"""Complete once the mapped weight reaches what was expected, Partial until then.

	The same shape of test the receipt screen uses when it verifies a challan against
	Veermetlon: reached, within an absolute floor for scale rounding. Nothing mapped at
	all is NOT a judgement — a receipt nobody has touched keeps the status it was posted
	with, or the page would mark every historic inward Partial the day it opened.
	"""
	if not frappe.db.exists("MM Roll Inventory", {"mapped_inward": inward}):
		return frappe.db.get_value("MM Inward", inward, "receipt_status") or "Complete"
	expected = expected_weight_of(inward)
	if expected <= 0:
		return "Complete"
	return "Complete" if mapped_weight_of(inward) + _RECEIPT_TOLERANCE >= expected else "Partial"


def _sync_status(inward) -> str:
	"""Write the status the mapping implies. Submitted document, one field, no amend.

	`receipt_status` is allow_on_submit for exactly this. The weights and rows of the
	receipt itself are NOT touched — what was delivered that day does not change; only
	the question "is this receipt settled" gets a later answer.
	"""
	status = status_for(inward)
	if (frappe.db.get_value("MM Inward", inward, "receipt_status") or "") != status:
		frappe.db.set_value("MM Inward", inward, "receipt_status", status)
		# is_partial is the operator's own tick and is what validate() reads on any later
		# save, so leaving it behind would put the status back the moment anyone touched
		# the document.
		frappe.db.set_value("MM Inward", inward, "is_partial", 1 if status == "Partial" else 0)
	return status


def _assert_open(inward):
	"""Refuse to re-map a receipt whose challan is already closed."""
	if frappe.db.get_value("MM Inward", inward, "docstatus") != 1:
		frappe.throw(_("{0} is not a submitted receipt.").format(inward))
	challan = _challan_of(inward)
	if not challan:
		return
	supplier = frappe.db.sql(
		"""select ifnull(supplier, '') from `tabMM Inward Item`
		where parent = %s and ifnull(supplier, '') != '' limit 1""",
		(inward,),
	)
	closer = challan_closed_by(
		challan, exclude=inward, supplier=(supplier[0][0] if supplier else "") or None
	)
	if closer:
		frappe.throw(
			_(
				"Challan {0} is already fully received — {1} closed it. Rolls cannot be "
				"re-mapped against a closed challan."
			).format(challan, closer),
			title=_("Challan closed"),
		)


@frappe.whitelist()
def inwards(search=None, only_open=1, limit=100):
	"""The receipts on the mapping board, newest first, with their progress."""
	conds = ["i.docstatus = 1", "ifnull(i.is_gr, 0) = 0"]
	vals = {"limit": int(limit or 100)}
	if int(only_open or 0):
		conds.append("ifnull(i.receipt_status, 'Complete') = 'Partial'")
	if (search or "").strip():
		conds.append(
			"(i.name like %(q)s or ifnull(i.challan_number,'') like %(q)s"
			" or ifnull(i.party,'') like %(q)s or ifnull(i.lot_number,'') like %(q)s)"
		)
		vals["q"] = f"%{search.strip()}%"
	rows = frappe.db.sql(
		f"""
		select i.name, i.posting_date, i.party, i.company_name, i.challan_number,
			i.lot_number, i.receipt_status, i.challan_expected_weight, i.sales_order
		from `tabMM Inward` i
		where {' and '.join(conds)}
		order by i.posting_date desc, i.creation desc
		limit %(limit)s
		""",
		vals,
		as_dict=True,
	)
	for r in rows:
		r["challan_number"] = r.get("challan_number") or _challan_of(r["name"])
		# THE ORDER THIS RECEIPT IS AGAINST, and who it is for. The board showed only the
		# challan, which reads as an order id to anyone who does not already know the
		# difference (Hetvi: "MM587... is the order id?"). Orders here are bare numbers —
		# 1, 45, 46 — so nothing about the challan's own format says which is which.
		# Taken off the LINES, because that is where a receipt records its order, and one
		# receipt can answer several.
		orders = [
			o[0] for o in frappe.db.sql(
				"""select distinct customer_order from `tabMM Inward Item`
				where parent = %s and ifnull(customer_order, '') != '' order by customer_order""",
				(r["name"],),
			)
		]
		if not orders and r.get("sales_order"):
			orders = [r["sales_order"]]
		r["orders"] = orders
		if not r.get("party") and orders:
			r["party"] = frappe.db.get_value("MM Sales Order", orders[0], "party")
			r["company_name"] = r.get("company_name") or frappe.db.get_value(
				"MM Sales Order", orders[0], "company_name"
			)
		r["expected_weight"] = expected_weight_of(r["name"])
		r["mapped_weight"] = mapped_weight_of(r["name"])
		r["still_due"] = round(max(0.0, r["expected_weight"] - r["mapped_weight"]), 3)
		r["mapped_rolls"] = frappe.db.count("MM Roll Inventory", {"mapped_inward": r["name"]})
		r["would_be"] = status_for(r["name"])
		r["locked"] = bool(_locked(r["name"]))
	return rows


def _locked(inward):
	try:
		_assert_open(inward)
	except frappe.ValidationError:
		frappe.local.message_log = []
		return True
	return False


@frappe.whitelist()
def rolls(search=None, inward=None, unmapped_only=0, limit=200):
	"""Rolls in stock, with where each one is currently credited.

	Only rolls still HOLDING something are offered: a row emptied by cutting is a
	historical record, not material anybody is deciding about today.
	"""
	conds = ["ifnull(r.stock_weight, 0) > 0"]
	vals = {"limit": int(limit or 200)}
	if (inward or "").strip():
		conds = ["r.mapped_inward = %(inward)s"]
		vals["inward"] = inward.strip()
	elif int(unmapped_only or 0):
		conds.append("ifnull(r.mapped_inward, '') = ''")
	if (search or "").strip():
		conds.append(
			"(ifnull(r.roll_no,'') like %(q)s or ifnull(r.lot_number,'') like %(q)s"
			" or ifnull(r.color_name,'') like %(q)s or ifnull(r.supplier,'') like %(q)s)"
		)
		vals["q"] = f"%{search.strip()}%"
	return frappe.db.sql(
		f"""
		select r.name, r.roll_no, r.lot_number, r.color_name, r.supplier, r.location,
			r.stock_weight, r.mapped_inward, r.mapped_weight
		from `tabMM Roll Inventory` r
		where {' and '.join(conds)}
		order by r.lot_number, r.roll_no
		limit %(limit)s
		""",
		vals,
		as_dict=True,
	)


@frappe.whitelist()
def assign(inward, rolls):
	"""Credit rolls to a receipt. Whole rolls, and one receipt each.

	A roll already credited elsewhere MOVES, and both receipts are re-judged — that is
	what makes a mis-mapping correctable rather than something to be lived with.
	"""
	rolls = frappe.parse_json(rolls) if isinstance(rolls, str) else (rolls or [])
	if not rolls:
		frappe.throw(_("Pick at least one roll."))
	_assert_open(inward)
	touched = {inward}
	for name in rolls:
		row = frappe.db.get_value(
			"MM Roll Inventory", name, ["stock_weight", "mapped_inward"], as_dict=True
		)
		if not row:
			frappe.throw(_("Roll {0} no longer exists.").format(name))
		if row.mapped_inward and row.mapped_inward != inward:
			# Taking it off a closed receipt would re-open a settled challan behind the
			# shop's back, so the one it is leaving has to be open too.
			_assert_open(row.mapped_inward)
			touched.add(row.mapped_inward)
		frappe.db.set_value(
			"MM Roll Inventory", name,
			{"mapped_inward": inward, "mapped_weight": round(float(row.stock_weight or 0), 3)},
		)
	return {"mapped": len(rolls), "status": {i: _sync_status(i) for i in touched}}


@frappe.whitelist()
def unassign(rolls):
	"""Take rolls back off whatever receipt they were credited to."""
	rolls = frappe.parse_json(rolls) if isinstance(rolls, str) else (rolls or [])
	if not rolls:
		frappe.throw(_("Pick at least one roll."))
	touched = set()
	for name in rolls:
		current = frappe.db.get_value("MM Roll Inventory", name, "mapped_inward")
		if not current:
			continue
		_assert_open(current)
		touched.add(current)
		frappe.db.set_value("MM Roll Inventory", name, {"mapped_inward": None, "mapped_weight": 0})
	return {"unmapped": len(rolls), "status": {i: _sync_status(i) for i in touched}}
