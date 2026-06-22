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
		filters={"party": party, "docstatus": ["<", 2]},
		fields=["name", "transaction_date", "delivery_date", "ordered_weight", "required_weight"],
		order_by="delivery_date asc, modified desc",
		limit_page_length=100,
	)


def _coerce_bobbins(bobbins):
	if isinstance(bobbins, str):
		bobbins = json.loads(bobbins or "[]")
	return bobbins or []


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
	gross_weight,
	bobbins=None,
	box_qty=0,
	box_weight=0,
	operator=None,
	shift=None,
	customer_order=None,
	posting_date=None,
	job_work=0,
	pin=None,
):
	"""Submit handler: wind a program's threads into a completed MM Production.

	Computes Net = Gross − Bobbin − Box, enforces the variance tolerance (Admin PIN
	beyond it), links/closes the program and advances the order's production %.
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

	bobbin_rows = _coerce_bobbins(bobbins)
	input_weight = float(prog.net_weight or 0)

	# Decide tolerance / PIN up front so we can set pin_override before the doc validates.
	bobbin_total = sum(float(b.get("weight") or 0) for b in bobbin_rows)
	# (rows with blank weight are auto-filled in the controller; approximate here for the gate)
	for b in bobbin_rows:
		if not b.get("weight") and b.get("bobbin"):
			mwt = frappe.db.get_value("MM Bobbin Master", b["bobbin"], "weight") or 0
			bobbin_total += round(float(b.get("qty") or 0) * float(mwt), 3)
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
			"source_program": prog.name,
			"roll_no": prog.roll_no,
			"shade": prog.shade,
			"machine_no": prog.machine_no,
			"operator": operator,
			"shift": shift or None,
			"status": "Completed",
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"branch": prog.branch,
			"location": prog.location,
			"input_weight": input_weight,
			"gross_weight": float(gross_weight or 0),
			"box_qty": float(box_qty or 0),
			"box_weight": float(box_weight or 0),
			"pin_override": pin_override,
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
