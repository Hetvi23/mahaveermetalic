# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Sales Challan voucher.

Production is where boxes and bobbins are entered; the challan is the dispatch document
built from them. A production voucher that carries a Sales Order auto-raises its challan
on submit (as a draft, so it can be checked before it counts as dispatched). Without an
order the produced boxes simply stay available, and a challan can be built later here by
picking boxes (SELECT BOX) or rolls straight from inventory (SELECT ROLL).
"""

import json

import frappe
from frappe import _


def _valid_colour(name):
	"""Challan lines link the colour to MM Item Master, but a production's shade is free
	text — don't let an unknown colour block a dispatch, just leave the link empty."""
	return name if name and frappe.db.exists("MM Item Master", name) else None


def _box_row(b, production=None, order=None):
	"""Map a produced box onto a challan line."""
	return {
		"barcode": b.get("barcode"),
		"color_name": _valid_colour(b.get("item")),
		"cut": b.get("cut"),
		"gross_weight": b.get("gross_weight") or 0,
		"qty_box": 1,
		"bobbin": b.get("bobbin") or None,
		"bobbin_pcs": b.get("bobbin_pcs") or 0,
		"bobbin_pcs_weight": b.get("bobbin_pcs_weight") or 0,
		"total_bobbin_weight": b.get("total_bobbin_weight") or 0,
		"box_weight": b.get("box_weight") or 0,
		"net_weight": b.get("net_weight") or 0,
		"weight": b.get("net_weight") or 0,
		"production": production,
		"sales_order": order,
	}


def create_challan_from_production(production):
	"""Raise the dispatch challan for a production voucher (draft).

	Only when the production is tied to a Sales Order — otherwise the boxes stay in hand
	and a challan can be raised later from this screen.
	"""
	prod = frappe.get_doc("MM Production", production)
	if not prod.customer_order:
		return None  # no order → goes to stock, not dispatched
	if frappe.db.exists("MM Sales Challan", {"source_production": prod.name, "docstatus": ["<", 2]}):
		return None  # already raised

	rows = []
	for b in prod.boxes or []:
		rows.append(
			_box_row(
				{
					"barcode": None,
					"item": b.item or prod.shade,
					"cut": prod.cut,
					"gross_weight": b.gross_weight,
					"bobbin": b.bobbin,
					"bobbin_pcs": b.bobbin_pcs,
					"bobbin_pcs_weight": b.bobbin_pcs_weight,
					"total_bobbin_weight": b.total_bobbin_weight,
					"box_weight": b.box_weight,
					"net_weight": b.net_weight,
				},
				production=prod.name,
				order=prod.customer_order,
			)
		)
	if not rows:
		return None

	challan = frappe.get_doc(
		{
			"doctype": "MM Sales Challan",
			"transaction_date": prod.posting_date or frappe.utils.today(),
			"party": prod.party,
			"sales_order": prod.customer_order,
			"branch": prod.branch,
			"location": prod.location,
			"source_production": prod.name,
			"job_work_flag": prod.job_work_flag,
			"items": rows,
		}
	)
	challan.insert(ignore_permissions=True)
	return challan.name


@frappe.whitelist()
def available_boxes(party=None, sales_order=None, limit=200):
	"""SELECT BOX: produced boxes not yet on a challan."""
	conds = ["p.docstatus = 1"]
	vals = {}
	if sales_order:
		conds.append("p.customer_order = %(so)s")
		vals["so"] = sales_order
	elif party:
		conds.append("p.party = %(party)s")
		vals["party"] = party
	rows = frappe.db.sql(
		f"""
		select b.name as box, p.name as production, p.posting_date, p.shade as item, p.cut,
			p.customer_order, b.gross_weight, b.bobbin, b.bobbin_pcs, b.bobbin_pcs_weight,
			b.total_bobbin_weight, b.box_weight, b.net_weight
		from `tabMM Production Box` b
		join `tabMM Production` p on p.name = b.parent
		where {" and ".join(conds)}
		order by p.posting_date desc, b.idx asc
		limit {int(limit)}
		""",
		vals,
		as_dict=True,
	)
	# Drop boxes already dispatched (same production already on a submitted challan).
	used = set(
		frappe.db.sql_list(
			"""select distinct ci.production from `tabMM Sales Challan Item` ci
			join `tabMM Sales Challan` c on c.name = ci.parent
			where c.docstatus < 2 and ifnull(ci.production, '') != ''"""
		)
	)
	return [r for r in rows if r.production not in used]


@frappe.whitelist()
def create_challan(party=None, sales_order=None, challan_date=None, remark=None,
	job_work=0, boxes=None, rolls=None, challan_no=None, **kwargs):
	"""Build a challan by hand from picked produced boxes and/or inventory rolls."""
	box_list = json.loads(boxes) if isinstance(boxes, str) else (boxes or [])
	roll_list = json.loads(rolls) if isinstance(rolls, str) else (rolls or [])
	if not box_list and not roll_list:
		frappe.throw(_("Pick at least one box or roll for the challan."))
	if not party:
		frappe.throw(_("Choose the customer."))

	rows = []
	for name in box_list:
		b = frappe.db.get_value(
			"MM Production Box", name,
			["parent", "item", "gross_weight", "bobbin", "bobbin_pcs", "bobbin_pcs_weight",
			 "total_bobbin_weight", "box_weight", "net_weight"],
			as_dict=True,
		)
		if not b:
			continue
		cut = frappe.db.get_value("MM Production", b.parent, "cut")
		rows.append(_box_row(dict(b, cut=cut), production=b.parent, order=sales_order))
	for name in roll_list:
		r = frappe.db.get_value(
			"MM Roll Inventory", name, ["color_name", "roll_no", "stock_weight", "stock_box"], as_dict=True
		)
		if not r:
			continue
		rows.append(
			{
				"color_name": _valid_colour(r.color_name),
				"qty_box": r.stock_box or 1,
				"gross_weight": r.stock_weight or 0,
				"net_weight": r.stock_weight or 0,
				"weight": r.stock_weight or 0,
				"roll_inventory": name,
				"sales_order": sales_order,
			}
		)

	challan = frappe.get_doc(
		{
			"doctype": "MM Sales Challan",
			"transaction_date": challan_date or frappe.utils.today(),
			"party": party,
			"sales_order": sales_order or None,
			"challan_no": challan_no or None,
			"remarks": remark or None,
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"items": rows,
		}
	)
	challan.insert(ignore_permissions=True)
	return {"challan": challan.name, "lines": len(rows)}
