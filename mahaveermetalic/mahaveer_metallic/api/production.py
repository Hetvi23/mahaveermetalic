# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Production flow — the screen one step past Program.

  Left list   → programs "In Threads Processing" still to be wound, one row per program
  Arrow modal → that program's input weight + the produce form (operator, gross,
                bobbin rows, box) with auto Net = Gross − Bobbin − Box
  Submit      → create a (completed) MM Production, mark the program done, advance the
                Sales Order's production % (auto-locking it at ≥5%).

SRS 5.7: a >tolerance (default 4%) variance between produced Net and the Program's
input weight requires an Admin Override PIN (MM Settings).
"""

import json

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_tolerance_percent,
	verify_admin_pin,
)


@frappe.whitelist()
def threads_processing(branch=None, location=None):
	"""Left panel: programs being/already worked and not yet produced, one row per program."""
	filters = {
		"docstatus": 1,
		"status": ["in", ["Running", "Partially Done", "Completed"]],
		"production": ["is", "not set"],
	}
	if branch:
		filters["branch"] = branch
	if location:
		filters["location"] = location
	rows = frappe.get_all(
		"MM Program",
		filters=filters,
		fields=[
			"name",
			"program_date",
			"customer_order",
			"roll_no",
			"shade",
			"cut",
			"machine_no",
			"shift",
			"job_work_flag",
			"patti_qty",
			"net_weight",
		],
		order_by="modified desc",
		limit_page_length=500,
	)
	order_party = {}
	orders = {r.customer_order for r in rows if r.customer_order}
	if orders:
		for o in frappe.get_all(
			"MM Sales Order", filters={"name": ["in", list(orders)]}, fields=["name", "party"]
		):
			order_party[o.name] = o.party
	for r in rows:
		r["party"] = order_party.get(r.customer_order)
		r["input_weight"] = r.get("net_weight") or 0
	return rows


@frappe.whitelist()
def order_options_for_party(party=None, customer_order=None):
	"""Modal "Customer Order" dropdown — only the given party's orders."""
	if not party and customer_order:
		party = frappe.db.get_value("MM Sales Order", customer_order, "party")
	if not party:
		return []
	return frappe.get_all(
		"MM Sales Order",
		filters={"party": party, "docstatus": 1},
		fields=["name", "transaction_date", "delivery_date", "ordered_weight", "required_weight"],
		order_by="delivery_date asc, modified desc",
		limit_page_length=100,
	)


@frappe.whitelist()
def companies_for_item(color=None, show_all=0, pin=None):
	"""Party/company picker for the production voucher.

	By default only parties that have actually ORDERED this colour are offered (one row
	per company under each party — searchable by party, selectable by company). `show_all`
	lists every party/company even without an order, and is gated by the Admin Override
	PIN (a direct voucher with no order behind it)."""
	show_all = frappe.utils.cint(show_all)
	if show_all:
		from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import verify_admin_pin

		if not verify_admin_pin(pin):
			frappe.throw(_("A valid Admin Override PIN is required to show parties without an order."))
		rows = frappe.db.sql(
			"""
			select p.name as party, p.party_name, c.company_name
			from `tabMM Party Master` p
			left join `tabMM Party Company` c on c.parent = p.name
			order by p.party_name asc, c.idx asc
			""",
			as_dict=True,
		)
	else:
		if not color:
			return []
		rows = frappe.db.sql(
			"""
			select distinct p.name as party, p.party_name, c.company_name
			from `tabMM Sales Order` so
			join `tabMM Sales Order Item` soi on soi.parent = so.name
			join `tabMM Party Master` p on p.name = so.party
			left join `tabMM Party Company` c on c.parent = p.name
			where so.docstatus = 1 and soi.color_name = %(color)s
			order by p.party_name asc, c.idx asc
			""",
			{"color": color},
			as_dict=True,
		)
	# One entry per selectable company; parties with no company fall back to the party name.
	out = []
	for r in rows:
		out.append(
			{
				"party": r.party,
				"party_name": r.party_name or r.party,
				"company": r.company_name or r.party_name or r.party,
			}
		)
	return out


@frappe.whitelist()
def orders_for_production(party=None, color=None):
	"""Order picker on the production voucher: that party's APPROVED orders for this
	colour that still have something left, each with its running figures —
	ordered / inwarded / produced / dispatched / remaining."""
	if not party:
		return []
	conds = ["so.party = %(party)s", "so.docstatus = 1"]
	vals = {"party": party}
	if color:
		conds.append("soi.color_name = %(color)s")
		vals["color"] = color
	rows = frappe.db.sql(
		f"""
		select distinct so.name, so.transaction_date, so.delivery_date,
			so.ordered_weight, so.inwarded_weight,
			(select group_concat(distinct x.color_name order by x.color_name separator ', ')
				from `tabMM Sales Order Item` x where x.parent = so.name) as colours
		from `tabMM Sales Order` so
		join `tabMM Sales Order Item` soi on soi.parent = so.name
		where {" and ".join(conds)}
		order by so.transaction_date desc, so.modified desc
		limit 200
		""",
		vals,
		as_dict=True,
	)
	out = []
	for r in rows:
		produced = float(
			frappe.db.sql(
				"select coalesce(sum(net_weight), 0) from `tabMM Production` where customer_order=%s and docstatus=1",
				(r.name,),
			)[0][0]
			or 0
		)
		# Already dispatched = weight that physically left on submitted Sales Challans for
		# this order (the line's own order wins, else the challan header's).
		dispatched = float(
			frappe.db.sql(
				"""select coalesce(sum(ci.weight), 0)
				from `tabMM Sales Challan Item` ci join `tabMM Sales Challan` c on c.name = ci.parent
				where c.docstatus = 1 and coalesce(nullif(ci.sales_order, ''), c.sales_order) = %s""",
				(r.name,),
			)[0][0]
			or 0
		)
		ordered = float(r.ordered_weight or 0)
		remaining = round(ordered - produced, 3)
		# Only orders that still have something left to produce.
		if ordered > 0 and remaining <= 0:
			continue
		out.append(
			{
				"name": r.name,
				"colours": r.colours,
				"transaction_date": str(r.transaction_date) if r.transaction_date else None,
				"delivery_date": str(r.delivery_date) if r.delivery_date else None,
				"ordered_weight": round(ordered, 3),
				"inwarded_weight": round(float(r.inwarded_weight or 0), 3),
				"produced_weight": round(produced, 3),
				"dispatched_weight": round(dispatched, 3),
				"remaining_weight": remaining,
			}
		)
	return out


@frappe.whitelist()
def open_orders_for_item(color=None, party=None):
	"""Production voucher 'Select Order' list: the OPEN Sales Orders of a party that
	include this colour/item. Open = submitted-or-draft and not yet completed (production
	< 100% and not force/inward-closed)."""
	if not party:
		return []
	conditions = ["so.party = %(party)s", "so.docstatus = 1", "ifnull(so.production_completed_percent, 0) < 100"]
	values = {"party": party}
	if frappe.db.has_column("MM Sales Order", "completed"):
		conditions.append("ifnull(so.completed, 0) = 0")
	if color:
		conditions.append("soi.color_name = %(color)s")
		values["color"] = color
	return frappe.db.sql(
		f"""
		select distinct so.name, so.transaction_date, so.delivery_date,
			so.ordered_weight, so.required_weight,
			(select group_concat(distinct x.color_name order by x.color_name separator ', ')
				from `tabMM Sales Order Item` x where x.parent = so.name) as colours
		from `tabMM Sales Order` so
		join `tabMM Sales Order Item` soi on soi.parent = so.name
		where {" and ".join(conditions)}
		order by so.delivery_date asc, so.modified desc
		limit 100
		""",
		values,
		as_dict=True,
	)


def _coerce_bobbins(bobbins):
	if isinstance(bobbins, str):
		bobbins = json.loads(bobbins or "[]")
	return bobbins or []


def _coerce_boxes(boxes):
	if isinstance(boxes, str):
		boxes = json.loads(boxes or "[]")
	return boxes or []


def _box_net(b):
	"""Net of a single box row = gross − (pcs × per-pcs wt, or explicit total) − box tare."""
	tbw = float(b.get("total_bobbin_weight") or 0)
	if not tbw:
		tbw = round(float(b.get("bobbin_pcs") or 0) * float(b.get("bobbin_pcs_weight") or 0), 3)
	return round(float(b.get("gross_weight") or 0) - tbw - float(b.get("box_weight") or 0), 3)


@frappe.whitelist()
def preview_variance(input_weight, gross_weight, bobbin_weight=0, box_weight=0):
	"""Helper for the modal: compute Net + variance% live, and whether a PIN is needed."""
	base = float(input_weight or 0)
	net = round(float(gross_weight or 0) - float(bobbin_weight or 0) - float(box_weight or 0), 3)
	variance = round((net - base) / base * 100, 2) if base else 0.0
	tol = get_tolerance_percent()
	return {"net_weight": net, "variance_percent": variance, "tolerance": tol, "pin_required": abs(variance) > tol}


@frappe.whitelist()
def create_production(
	source_program,
	gross_weight=0,
	bobbins=None,
	boxes=None,
	box_qty=0,
	box_weight=0,
	operator=None,
	shift=None,
	customer_order=None,
	party=None,
	company_name=None,
	cut=None,
	posting_date=None,
	batch_no=None,
	box_return=0,
	bobbin_return=0,
	job_work=0,
	pin=None,
):
	"""Submit handler: wind a program's threads into a completed MM Production voucher.

	New model: `boxes` is a list of produced-box rows (gross, bobbin pcs × per-pcs wt,
	box tare); voucher Net = sum of box nets. Legacy callers may still pass a whole-doc
	`bobbins` table with gross_weight/box_weight. Either way it enforces the variance
	tolerance (Admin PIN beyond it), links/closes the program and advances the order %.
	"""
	if not source_program:
		frappe.throw(_("Select a program to produce."))
	prog = frappe.db.get_value(
		"MM Program",
		source_program,
		["name", "docstatus", "status", "production", "customer_order", "roll_no", "shade",
		 "cut", "machine_no", "net_weight", "branch", "location"],
		as_dict=True,
	)
	if not prog:
		frappe.throw(_("Program {0} not found.").format(source_program))
	if prog.docstatus != 1 or prog.status not in ("Running", "Partially Done", "Completed"):
		frappe.throw(_("Only a program that is In Threads Processing can be produced."))
	if prog.production:
		frappe.throw(_("This program is already produced ({0}).").format(prog.production))

	eff_order = customer_order or prog.customer_order
	if eff_order:
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import assert_order_submitted

		assert_order_submitted(eff_order)

	box_rows = _coerce_boxes(boxes)
	bobbin_rows = _coerce_bobbins(bobbins)
	input_weight = float(prog.net_weight or 0)

	# Compute the produced Net up front (matches the controller) so we can gate on variance
	# and set pin_override before the doc validates.
	if box_rows:
		if not any(float(b.get("gross_weight") or 0) > 0 for b in box_rows):
			frappe.throw(_("Add at least one box with a gross weight."))
		net = round(sum(_box_net(b) for b in box_rows), 3)
	else:
		bobbin_total = 0.0
		for b in bobbin_rows:
			w = float(b.get("weight") or 0)
			if not w and b.get("bobbin"):
				mwt = frappe.db.get_value("MM Bobbin Master", b["bobbin"], "weight") or 0
				w = round(float(b.get("qty") or 0) * float(mwt), 3)
			bobbin_total += w
		net = round(float(gross_weight or 0) - bobbin_total - float(box_weight or 0), 3)

	variance = round((net - input_weight) / input_weight * 100, 2) if input_weight else 0.0
	tol = get_tolerance_percent()
	pin_override = 0
	if input_weight and abs(variance) > tol:
		if not verify_admin_pin(pin):
			frappe.throw(
				_("Variance {0}% exceeds tolerance ±{1}%. A valid Admin Override PIN is required.").format(
					variance, tol
				)
			)
		pin_override = 1

	prod = frappe.get_doc(
		{
			"doctype": "MM Production",
			"posting_date": posting_date or frappe.utils.nowdate(),
			"customer_order": customer_order or prog.customer_order,
			"party": party or (frappe.db.get_value("MM Sales Order", customer_order, "party") if customer_order else None),
			"company_name": company_name or None,
			"source_program": prog.name,
			"roll_no": prog.roll_no,
			"shade": prog.shade,
			"cut": cut if cut not in (None, "") else prog.cut,
			"machine_no": prog.machine_no,
			"operator": operator,
			"shift": shift or None,
			"batch_no": batch_no or None,
			"box_return": 1 if frappe.utils.cint(box_return) else 0,
			"bobbin_return": 1 if frappe.utils.cint(bobbin_return) else 0,
			"status": "Completed",
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"branch": prog.branch,
			"location": prog.location,
			"input_weight": input_weight,
			"gross_weight": float(gross_weight or 0),
			"box_qty": float(box_qty or 0),
			"box_weight": float(box_weight or 0),
			"pin_override": pin_override,
			"boxes": [
				{
					"item": b.get("item") or prog.shade,
					"gross_weight": float(b.get("gross_weight") or 0),
					"qty": float(b.get("qty") or 0),
					"bobbin": b.get("bobbin") or None,
					"bobbin_pcs": float(b.get("bobbin_pcs") or 0),
					"bobbin_pcs_weight": float(b.get("bobbin_pcs_weight") or 0),
					"total_bobbin_weight": float(b.get("total_bobbin_weight") or 0),
					"box_weight": float(b.get("box_weight") or 0),
				}
				for b in box_rows
			],
			"bobbins": [
				{"bobbin": b.get("bobbin"), "qty": float(b.get("qty") or 0), "weight": float(b.get("weight") or 0)}
				for b in bobbin_rows
			],
		}
	)
	prod.insert(ignore_permissions=True)
	prod.submit()

	return {
		"production": prod.name,
		"net_weight": prod.net_weight,
		"variance_percent": prod.variance_percent,
		"pin_override": bool(prod.pin_override),
	}


@frappe.whitelist()
def production_done(branch=None):
	"""Right panel: completed productions (finished goods)."""
	filters = {"docstatus": 1, "status": "Completed"}
	if branch:
		filters["branch"] = branch
	return frappe.get_all(
		"MM Production",
		filters=filters,
		fields=[
			"name",
			"posting_date",
			"customer_order",
			"roll_no",
			"machine_no",
			"operator",
			"gross_weight",
			"bobbin_weight",
			"box_weight",
			"net_weight",
			"variance_percent",
			"pin_override",
		],
		order_by="modified desc",
		limit_page_length=200,
	)
