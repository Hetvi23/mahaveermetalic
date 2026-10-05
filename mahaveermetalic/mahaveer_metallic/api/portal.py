# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The Mahaveer app's three faces: customer, supplier, admin.

One rule runs through every customer and supplier endpoint: the party (or vendor) is
taken from the LOGIN, never from an argument. A customer asking for "my orders" cannot
ask for anyone else's, because there is no parameter that names whose.

Order figures are not re-derived here. Approval, dispatch and completion come from
`mm_sales_order` (approval_state, dispatched_by_order, fulfilment_state) and receipt
against a purchase from `mm_purchase_order.received_against` — so the app and the office
screens can never disagree about the same order.
"""

import json
import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, now_datetime, nowdate

from mahaveermetalic.mahaveer_metallic.app_access import (
	admin_users,
	app_kind,
	is_admin,
	party_for_user,
	require_admin,
	require_customer,
	require_staff,
	require_supplier,
	vendor_for_user,
)
from mahaveermetalic.mahaveer_metallic.api.push import APP_BASE, notify
from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
	approval_state,
	dispatched_by_order,
	fulfilment_state,
)
from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_inward_match_tolerance,
)

#: Challans that send material to a worker — never a delivery to the customer.
JOB_TYPES = ("Job Out", "Job In", "Job Challan")

#: How many requests a customer may have waiting at once. A guard against a stuck button
#: (or a curious finger) filling the office's approval list, not a business limit.
MAX_OPEN_REQUESTS = 25

#: Staff who may flag an order urgent.
URGENT_ROLES = {"System Manager", "MM Admin", "MM Operations", "MM Sales Team"}


def _loads(value, default):
	if value is None or value == "":
		return default
	if isinstance(value, (list, dict)):
		return value
	try:
		return json.loads(value)
	except ValueError:
		frappe.throw(_("Bad request."))


def _norm(s):
	return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _kg(value) -> str:
	"""8,502.4 kg — how a person writes a weight, not how Python prints a float."""
	v = round(flt(value), 2)
	return f"{v:,.2f}".rstrip("0").rstrip(".") + " kg"


def _date_or_none(value):
	if not value:
		return None
	try:
		return getdate(value)
	except Exception:
		frappe.throw(_("{0} is not a date.").format(value))


def _party_names(parties):
	parties = [p for p in set(parties) if p]
	if not parties:
		return {}
	return {
		r.name: (r.party_name or r.name)
		for r in frappe.get_all(
			"MM Party Master", filters={"name": ["in", parties]}, fields=["name", "party_name"]
		)
	}


# =========================================================================== who am I

@frappe.whitelist()
def me():
	"""Which app to show, and the few facts its header needs."""
	user = frappe.session.user
	kind = app_kind(user)
	out = {
		"user": user,
		"kind": kind,
		"full_name": frappe.db.get_value("User", user, "full_name") or user,
	}
	if kind == "customer":
		party = party_for_user(user)
		out["party"] = party
		if party:
			p = frappe.db.get_value(
				"MM Party Master", party, ["party_name", "min_order_threshold_kg"], as_dict=True
			)
			out["party_name"] = p.party_name or party
			out["threshold"] = flt(p.min_order_threshold_kg)
	elif kind == "supplier":
		out["vendor"] = vendor_for_user(user)
	elif kind == "staff":
		roles = set(frappe.get_roles(user))
		out["is_admin"] = is_admin(user)
		out["is_accounts"] = bool(roles & {"MM Accounts", "MM Admin", "System Manager"})
		out["can_mark_urgent"] = bool(roles & URGENT_ROLES) or user == "Administrator"
	return out


# =========================================================================== orders, shared

def _order_rows(filters, limit=300, order_by="so.transaction_date desc, so.creation desc"):
	"""Orders with their lines folded in, plus the derived states."""
	conds, vals = [], {}
	for i, (sql, val) in enumerate(filters):
		key = f"v{i}"
		conds.append(sql.replace("%s", f"%({key})s"))
		vals[key] = val
	rows = frappe.db.sql(
		f"""
		select so.name, so.party, so.company_name, so.transaction_date, so.delivery_date,
			so.order_state, so.docstatus, so.ordered_weight, so.ordered_box, so.completion_mode,
			so.state_reason, so.placed_via, so.customer_remarks, so.is_urgent, so.creation
		from `tabMM Sales Order` so
		where {" and ".join(conds) if conds else "1=1"}
		order by {order_by}
		limit {int(limit)}
		""",
		vals,
		as_dict=True,
	)
	if not rows:
		return []
	names = [r.name for r in rows]
	lines = {}
	for it in frappe.get_all(
		"MM Sales Order Item",
		filters={"parent": ["in", names], "parenttype": "MM Sales Order"},
		fields=["parent", "color_name", "cut", "qty_weight", "qty_box", "delivery_date", "idx"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	):
		lines.setdefault(it.parent, []).append(it)
	out_by = dispatched_by_order(names)
	tol = get_inward_match_tolerance()
	for r in rows:
		ls = lines.get(r.name, [])
		r["lines"] = [
			{
				"color": l.color_name,
				"cut": l.cut,
				"weight": flt(l.qty_weight, 3),
				"box": flt(l.qty_box, 3),
				"delivery_date": l.delivery_date,
			}
			for l in ls
		]
		r["colours"] = ", ".join(dict.fromkeys(l.color_name for l in ls if l.color_name))
		if not r.delivery_date:
			dates = [l.delivery_date for l in ls if l.delivery_date]
			r["delivery_date"] = min(dates) if dates else None
		d = out_by.get(r.name) or {}
		r["dispatched_weight"] = flt(d.get("weight"), 3)
		r["dispatched_box"] = flt(d.get("box"), 3)
		r["approval"] = "New" if r.order_state == "New" else approval_state(r.docstatus, r.order_state)
		r["fulfilment"] = fulfilment_state(
			r.ordered_weight, r["dispatched_weight"], r.completion_mode, tol,
			ordered_box=r.ordered_box, dispatched_box=r["dispatched_box"],
		)
		r["pending_weight"] = (
			max(0.0, flt(r.ordered_weight) - r["dispatched_weight"])
			if r["fulfilment"] != "Complete" else 0.0
		)
		r["stage"] = _customer_stage(r)
	return rows


def _customer_stage(r):
	"""One word a customer understands, from the order's three separate states."""
	if r.approval == "Cancelled":
		return "Cancelled"
	if r.approval == "Rejected":
		return "Rejected"
	if r.approval == "New":
		return "Requested"
	if r.approval == "Pending":
		return "Accepted"
	if r.fulfilment == "Complete":
		return "Delivered"
	if r.dispatched_weight > 0 or r.dispatched_box > 0:
		return "Part delivered"
	return "Confirmed"


def _active_weight(rows):
	"""What a customer still has on order: undelivered kilos of live orders, and the whole
	of a request or draft (it has not been delivered against at all)."""
	total = 0.0
	for r in rows:
		if r.approval in ("Cancelled", "Rejected"):
			continue
		if r.approval in ("New", "Pending"):
			total += flt(r.ordered_weight)
		else:
			total += flt(r.pending_weight)
	return round(total, 3)


def _challan_rows(conds, vals, limit=200):
	rows = frappe.db.sql(
		f"""
		select c.name, c.challan_no, c.challan_type, c.transaction_date, c.party, c.company_name,
			c.sales_order, c.total_weight, c.total_box, c.vehicle_no, c.transport, c.creation
		from `tabMM Sales Challan` c
		where c.docstatus = 1
			and ifnull(c.challan_type, 'Sales') not in %(job)s
			and {" and ".join(conds)}
		order by c.transaction_date desc, c.creation desc
		limit {int(limit)}
		""",
		{**vals, "job": JOB_TYPES},
		as_dict=True,
	)
	if not rows:
		return []
	items = {}
	for it in frappe.get_all(
		"MM Sales Challan Item",
		filters={"parent": ["in", [r.name for r in rows]]},
		fields=["parent", "color_name", "qty_box", "weight", "sales_order", "idx"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	):
		items.setdefault(it.parent, []).append(it)
	names = _party_names(r.party for r in rows)
	for r in rows:
		its = items.get(r.name, [])
		by_colour = {}
		for it in its:
			k = it.color_name or "—"
			agg = by_colour.setdefault(k, {"color": k, "box": 0.0, "weight": 0.0})
			agg["box"] += flt(it.qty_box)
			agg["weight"] += flt(it.weight)
		r["lines"] = [
			{"color": v["color"], "box": round(v["box"], 3), "weight": round(v["weight"], 3)}
			for v in by_colour.values()
		]
		r["orders"] = ", ".join(dict.fromkeys(
			[o for o in [r.sales_order] + [it.sales_order for it in its] if o]
		))
		r["party_name"] = names.get(r.party, r.party)
		r["total_weight"] = flt(r.total_weight, 3) or round(sum(flt(it.weight) for it in its), 3)
		r["total_box"] = flt(r.total_box, 3) or round(sum(flt(it.qty_box) for it in its), 3)
	return rows


# =========================================================================== customer

@frappe.whitelist()
def customer_home():
	party = require_customer()
	threshold = flt(frappe.db.get_value("MM Party Master", party, "min_order_threshold_kg"))
	orders = _order_rows([("so.party = %s", party)], limit=500)
	live = [o for o in orders if o.approval not in ("Cancelled", "Rejected")]
	active = _active_weight(orders)
	today = getdate(nowdate())
	return {
		"kpis": {
			"open_orders": sum(1 for o in live if o.stage not in ("Delivered",)),
			"pending_weight": round(sum(flt(o.pending_weight) for o in live if o.approval == "Accepted"), 3),
			"requested": sum(1 for o in orders if o.approval == "New"),
			"delivered_today": 0,
		},
		"threshold": {
			"threshold": threshold,
			"active_weight": active,
			"below": bool(threshold > 0 and active < threshold),
		},
		"today": _customer_today(party, today),
		"recent": [_slim_order(o) for o in orders[:6]],
	}


def _customer_today(party, day):
	return _challan_rows(["c.party = %(party)s", "c.transaction_date = %(day)s"], {"party": party, "day": day})


def _slim_order(o):
	return {
		k: o.get(k)
		for k in (
			"name", "company_name", "transaction_date", "delivery_date", "stage", "approval", "fulfilment",
			"ordered_weight", "ordered_box", "dispatched_weight", "dispatched_box", "pending_weight",
			"colours", "lines", "state_reason", "placed_via", "customer_remarks",
		)
	}


@frappe.whitelist()
def customer_orders(stage=None, from_date=None, to_date=None, search=None, colour=None):
	"""The customer's orders. `stage` = open / delivered / requested / closed / all."""
	party = require_customer()
	filters = [("so.party = %s", party)]
	f, t = _date_or_none(from_date), _date_or_none(to_date)
	if f:
		filters.append(("so.transaction_date >= %s", f))
	if t:
		filters.append(("so.transaction_date <= %s", t))
	if search:
		filters.append(("so.name like %s", f"%{search.strip()}%"))
	rows = _order_rows(filters, limit=500)
	if colour:
		key = _norm(colour)
		rows = [r for r in rows if any(key in _norm(l["color"]) for l in r["lines"])]
	stage = (stage or "all").lower()
	if stage == "open":
		rows = [r for r in rows if r.stage in ("Requested", "Accepted", "Confirmed", "Part delivered")]
	elif stage == "delivered":
		rows = [r for r in rows if r.stage == "Delivered"]
	elif stage == "requested":
		rows = [r for r in rows if r.stage in ("Requested", "Accepted")]
	elif stage == "closed":
		rows = [r for r in rows if r.stage in ("Rejected", "Cancelled")]
	return [_slim_order(r) for r in rows]


@frappe.whitelist()
def customer_order(order):
	party = require_customer()
	rows = _order_rows([("so.party = %s", party), ("so.name = %s", order)], limit=1)
	if not rows:
		frappe.throw(_("Order {0} not found.").format(order), frappe.DoesNotExistError)
	out = _slim_order(rows[0])
	out["challans"] = _challan_rows(
		["c.party = %(party)s",
		 "(c.sales_order = %(o)s or exists (select 1 from `tabMM Sales Challan Item` x "
		 "where x.parent = c.name and x.sales_order = %(o)s))"],
		{"party": party, "o": order},
	)
	return out


@frappe.whitelist()
def customer_deliveries(day=None, from_date=None, to_date=None):
	"""Challans sent to this customer — today by default, or a date range."""
	party = require_customer()
	if from_date or to_date:
		f = _date_or_none(from_date) or getdate("2000-01-01")
		t = _date_or_none(to_date) or getdate(nowdate())
		return _challan_rows(
			["c.party = %(party)s", "c.transaction_date between %(f)s and %(t)s"],
			{"party": party, "f": f, "t": t},
		)
	return _customer_today(party, _date_or_none(day) or getdate(nowdate()))


@frappe.whitelist()
def customer_bobbins(from_date=None, to_date=None):
	"""Bobbin statement (bill-wise) and the balance per bobbin, for this customer only."""
	from mahaveermetalic.mahaveer_metallic.api.bobbin import bobbin_balances, bobbin_report

	party = require_customer()
	f = _date_or_none(from_date) or getdate(add_days(nowdate(), -90))
	t = _date_or_none(to_date) or getdate(nowdate())
	statement = bobbin_report(party=party, from_date=str(f), to_date=str(t), bill_wise=1)
	balances = [
		{"bobbin": b.bobbin, "qty": flt(b.qty, 3), "box": flt(b.box, 3)}
		for b in bobbin_balances(party=party)
		if flt(b.qty) or flt(b.box)
	]
	return {"from_date": str(f), "to_date": str(t), "statement": statement, "balances": balances}


@frappe.whitelist()
def customer_order_form():
	"""What the New Order form needs: colours (this customer's usual ones first) and the
	firms the customer trades as."""
	party = require_customer()
	usual = [
		r[0] for r in frappe.db.sql(
			"""select i.color_name from `tabMM Sales Order Item` i
			join `tabMM Sales Order` so on so.name = i.parent
			where so.party = %s and so.docstatus < 2 and ifnull(i.color_name, '') != ''
			group by i.color_name order by max(so.transaction_date) desc limit 30""",
			(party,),
		)
	]
	colours = frappe.get_all("MM Item Master", pluck="name", order_by="name asc", limit_page_length=0)
	known = set(colours)
	usual = [c for c in usual if c in known]
	companies = frappe.get_all(
		"MM Party Company",
		filters={"parent": party, "parenttype": "MM Party Master"},
		pluck="company_name",
		order_by="idx asc",
	)
	return {"usual": usual, "colours": colours, "companies": [c for c in companies if c]}


@frappe.whitelist(methods=["POST"])
def place_order(items, delivery_date=None, remarks=None, company_name=None):
	"""A customer's order request. Lands in the office's order list as NEW.

	One order per line, the same as the office's own Order screen does it: every order
	downstream (purchase, inward, challan, completion) is one colour, and a request that
	bundled three would have to be split by hand before any of it could move.

	Weight is what the customer must give. Boxes are optional and, given with a weight,
	set the per-box figure; boxes alone would leave the order with no weight, and every
	ceiling downstream is measured in kilos.
	"""
	party = require_customer()
	rows = _loads(items, [])
	if not isinstance(rows, list) or not rows:
		frappe.throw(_("Add at least one colour to the order."))
	if len(rows) > 20:
		frappe.throw(_("Please place at most 20 colours in one go."))
	waiting = frappe.db.count("MM Sales Order", {"party": party, "order_state": "New", "docstatus": 0})
	if waiting + len(rows) > MAX_OPEN_REQUESTS:
		frappe.throw(
			_("You already have {0} requests waiting for Mahaveer to accept. Please wait for those first.").format(waiting)
		)
	today = getdate(nowdate())
	header_date = _date_or_none(delivery_date)
	if header_date and header_date < today:
		frappe.throw(_("Delivery date cannot be in the past."))
	companies = frappe.get_all(
		"MM Party Company", filters={"parent": party, "parenttype": "MM Party Master"}, pluck="company_name"
	)
	company = (company_name or "").strip() or None
	if company and company not in companies:
		frappe.throw(_("{0} is not one of your firms.").format(company))
	if not company and len(companies) == 1:
		company = companies[0]

	clean = []
	for i, r in enumerate(rows, start=1):
		colour = (r.get("color_name") or r.get("color") or "").strip()
		if not colour or not frappe.db.exists("MM Item Master", colour):
			frappe.throw(_("Line {0}: pick a colour from the list.").format(i))
		weight = flt(r.get("qty_weight") or r.get("weight"))
		box = flt(r.get("qty_box") or r.get("box"))
		if weight <= 0:
			frappe.throw(_("Line {0} ({1}): enter the weight in kg.").format(i, colour))
		if box < 0:
			frappe.throw(_("Line {0} ({1}): boxes cannot be negative.").format(i, colour))
		cut = (r.get("cut") or "").strip()
		if cut and re.search(r"[A-Za-z]", cut):
			frappe.throw(_("Line {0} ({1}): size must be digits only, e.g. 50/85.").format(i, colour))
		line_date = _date_or_none(r.get("delivery_date")) or header_date
		if line_date and line_date < today:
			frappe.throw(_("Line {0} ({1}): delivery date cannot be in the past.").format(i, colour))
		clean.append({
			"color_name": colour, "qty_weight": weight, "qty_box": box or 0, "cut": cut or None,
			"delivery_date": line_date, "sale_rate": 0,
			"weight_per_box": round(weight / box, 3) if box > 0 else 0,
		})

	created = []
	for line in clean:
		so = frappe.get_doc({
			"doctype": "MM Sales Order",
			"transaction_date": today,
			"delivery_date": line["delivery_date"],
			"party": party,
			"company_name": company,
			"order_state": "New",
			"placed_via": "Customer App",
			"customer_remarks": (remarks or "").strip()[:1000] or None,
			"items": [line],
		})
		so.insert(ignore_permissions=True)
		created.append(so.name)

	party_name = frappe.db.get_value("MM Party Master", party, "party_name") or party
	summary = ", ".join(f"{l['color_name']} {_kg(l['qty_weight'])}" for l in clean)
	notify(
		admin_users(),
		_("New order request — {0}").format(party_name),
		summary,
		url=f"{APP_BASE}/admin?tab=approvals",
		category="approval",
		reference=("MM Sales Order", created[0]),
	)
	return {"orders": created}


@frappe.whitelist(methods=["POST"])
def withdraw_request(order):
	"""A customer may take back a request nobody has accepted yet."""
	party = require_customer()
	row = frappe.db.get_value("MM Sales Order", order, ["party", "order_state", "docstatus"], as_dict=True)
	if not row or row.party != party:
		frappe.throw(_("Order {0} not found.").format(order), frappe.DoesNotExistError)
	if row.order_state != "New" or row.docstatus != 0:
		frappe.throw(_("Mahaveer has already taken this order up — please call them to change it."))
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import _set_state

	doc = frappe.get_doc("MM Sales Order", order)
	return _set_state(doc, "Cancelled", _("Withdrawn by the customer"))


# =========================================================================== supplier

def _purchase_rows(vendor=None, only_pending=None, search=None):
	"""Submitted purchase orders with what has arrived against them.

	Received against a PO that serves a sales order is `received_against` — the same rule
	the PO's own status is kept by. A PO placed straight into stock (a Veer Metlon order with
	no customer behind it) has no order line to match, so it is filled from that supplier's
	stock inwards of the colour, received on or after the PO date, oldest PO first.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_purchase_order.mm_purchase_order import (
		received_against,
	)

	filters = {"docstatus": 1}
	if vendor:
		filters["supplier"] = vendor
	pos = frappe.get_all(
		"MM Purchase Order",
		filters=filters,
		fields=[
			"name", "supplier", "sales_order", "po_number", "so_item", "color", "cut", "qty_kg", "qty_box",
			"delivery_date", "transaction_date", "status", "is_urgent", "urgent_on", "vm_sales_order",
			"creation",
		],
		order_by="transaction_date asc, creation asc",
		limit_page_length=0,
	)
	if not pos:
		return []
	tol = get_inward_match_tolerance()

	# Order-side facts in one go: urgent flag, delivery dates, and whether it is still live.
	orders = list({p.sales_order for p in pos if p.sales_order})
	so_info = {}
	if orders:
		for r in frappe.get_all(
			"MM Sales Order",
			filters={"name": ["in", orders]},
			fields=["name", "is_urgent", "delivery_date", "order_state", "docstatus"],
		):
			so_info[r.name] = r
		for it in frappe.get_all(
			"MM Sales Order Item",
			filters={"parent": ["in", orders]},
			fields=["name", "delivery_date"],
			limit_page_length=0,
		):
			so_info.setdefault("__line__", {})[it.name] = it.delivery_date

	# Stock POs (no sales order): pool per (supplier, colour), filled FIFO.
	stock_pool = {}
	stock_pos = [p for p in pos if not p.sales_order]
	if stock_pos:
		suppliers = list({p.supplier for p in stock_pos if p.supplier})
		if suppliers:
			for r in frappe.db.sql(
				"""
				select ii.supplier, ii.color_name, i.posting_date, ii.weight
				from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
				where i.docstatus = 1 and ifnull(ii.customer_order, '') = '' and ii.supplier in %(s)s
				""",
				{"s": tuple(suppliers)},
				as_dict=True,
			):
				stock_pool.setdefault((r.supplier, _norm(r.color_name)), []).append(r)

	out = []
	consumed = {}
	for p in pos:
		qty = flt(p.qty_kg)
		if p.sales_order:
			received = flt(received_against(p))
		else:
			key = (p.supplier, _norm(p.color))
			pool = [
				r for r in stock_pool.get(key, [])
				if not p.transaction_date or getdate(r.posting_date) >= getdate(p.transaction_date)
			]
			available = sum(flt(r.weight) for r in pool) - consumed.get(key, 0.0)
			received = max(0.0, min(qty, available)) if qty > 0 else max(0.0, available)
			consumed[key] = consumed.get(key, 0.0) + received
		so = so_info.get(p.sales_order) if p.sales_order else None
		if so and (so.order_state == "Cancelled" or so.docstatus == 2):
			continue
		pending = max(0.0, round(qty - received, 3))
		done = (p.status == "Received") or (qty > 0 and received >= qty * (1 - tol / 100.0))
		delivery = p.delivery_date
		if not delivery and p.so_item:
			delivery = (so_info.get("__line__") or {}).get(p.so_item)
		if not delivery and so:
			delivery = so.delivery_date
		out.append({
			"name": p.name,
			"order_no": p.po_number or p.sales_order or p.vm_sales_order or p.name,
			"sales_order": p.sales_order,
			"vm_sales_order": p.vm_sales_order,
			"supplier": p.supplier,
			"color": p.color,
			"cut": p.cut,
			"qty_kg": round(qty, 3),
			"qty_box": flt(p.qty_box, 3),
			"received": round(received, 3),
			"pending": 0.0 if done else pending,
			"done": bool(done),
			"order_date": p.transaction_date,
			"delivery_date": delivery,
			"overdue": bool(not done and delivery and getdate(delivery) < getdate(nowdate())),
			"urgent": bool(p.is_urgent or (so and so.is_urgent)),
			"urgent_on": p.urgent_on,
		})

	if only_pending is not None:
		out = [r for r in out if (not r["done"]) == bool(only_pending)]
	if search:
		s = _norm(search)
		out = [r for r in out if s in _norm(r["order_no"]) or s in _norm(r["color"]) or s in _norm(r["name"])]
	out.sort(key=lambda r: (
		not r["urgent"] if not r["done"] else True,
		r["done"],
		str(r["delivery_date"] or "9999-12-31"),
		str(r["order_date"] or ""),
	))
	return out


@frappe.whitelist()
def supplier_orders(status="pending", search=None):
	"""This supplier's purchase orders. status = pending / done / all."""
	vendor = require_supplier()
	status = (status or "pending").lower()
	only = True if status == "pending" else False if status == "done" else None
	everything = _purchase_rows(vendor)
	rows = _purchase_rows(vendor, only, search) if (only is not None or search) else everything
	# A supplier is told what is owed — never who the end customer is or what we sell at.
	for r in rows:
		r.pop("sales_order", None)
	pending = [r for r in everything if not r["done"]]
	return {
		"rows": rows,
		"summary": {
			"pending": len(pending),
			"pending_kg": round(sum(r["pending"] for r in pending), 3),
			"urgent": sum(1 for r in pending if r["urgent"]),
			"overdue": sum(1 for r in pending if r["overdue"]),
		},
		"vendor": vendor,
	}


# =========================================================================== admin

@frappe.whitelist()
def admin_home():
	require_staff()
	days = _floor_days()
	approvals = admin_approvals()
	today = getdate(nowdate())
	dispatched = _challan_rows(["c.transaction_date = %(d)s"], {"d": today}, limit=500)
	purchase = [r for r in _purchase_rows() if not r["done"]]
	floor = floor_pending()
	fups = follow_ups()
	return {
		"counts": {
			"approvals": len(approvals["orders"]) + len(approvals["hisabs"]),
			"requests": sum(1 for o in approvals["orders"] if o["approval"] == "New"),
			"deliveries_today": len(dispatched),
			"dispatched_kg": round(sum(flt(c["total_weight"]) for c in dispatched), 3),
			"purchase_pending": len(purchase),
			"purchase_urgent": sum(1 for r in purchase if r["urgent"]),
			"purchase_overdue": sum(1 for r in purchase if r["overdue"]),
			"floor_pending": len(floor["rows"]),
			"follow_ups": len(fups["auto"]) + sum(1 for m in fups["manual"] if m["due"]),
		},
		"floor_days": days,
	}


@frappe.whitelist()
def admin_approvals():
	"""Orders waiting on the admin (customer requests, drafts, rejected) and job hisabs
	waiting on a signature."""
	require_staff()
	orders = _order_rows(
		[("so.docstatus = %s", 0)],
		limit=300,
		order_by="field(so.order_state, 'New', 'Pending', 'Rejected'), so.transaction_date asc, so.creation asc",
	)
	orders = [o for o in orders if o.approval in ("New", "Pending", "Rejected")]
	names = _party_names(o.party for o in orders)
	order_rows = []
	for o in orders:
		row = _slim_order(o)
		row["party"] = o.party
		row["party_name"] = names.get(o.party, o.party)
		row["urgent"] = bool(o.is_urgent)
		order_rows.append(row)

	hisabs = frappe.get_all(
		"MM Job Hisab",
		filters={"status": ["!=", "Completed"]},
		fields=[
			"name", "job_out", "party", "posting_date", "status", "out_weight", "in_weight",
			"wastage_weight", "wastage_percent", "wastage_over_limit", "total_amount", "bill_no",
		],
		order_by="posting_date asc, creation asc",
		limit_page_length=200,
	)
	hnames = _party_names(h.party for h in hisabs)
	step = {
		"Draft": ("Accountant approval", "accountant_approve", "accounts"),
		"Accountant Approved": ("Admin approval", "admin_approve", "admin"),
		"Admin Approved": ("Bill number", "enter_bill", "accounts"),
		"Billed": ("Final approval (cheque)", "final_approve", "admin"),
	}
	for h in hisabs:
		label, action, who = step.get(h.status, ("—", None, None))
		h["party_name"] = hnames.get(h.party, h.party)
		h["next_step"] = label
		h["action"] = action
		h["who"] = who
	return {"orders": order_rows, "hisabs": hisabs}


@frappe.whitelist(methods=["POST"])
def accept_request(order):
	"""A customer's NEW request becomes a draft in the order list (Pending), where the
	office completes it — supplier, rate — and approves it as usual."""
	require_admin()
	doc = frappe.get_doc("MM Sales Order", order)
	if doc.order_state != "New" or doc.docstatus != 0:
		frappe.throw(_("Order {0} is not a new request.").format(order))
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import _set_state

	return _set_state(doc, "Pending", _("Customer request accepted"))


@frappe.whitelist()
def deliveries(day=None):
	"""Challans out on a day, and approved orders due by then that are not delivered."""
	require_staff()
	d = _date_or_none(day) or getdate(nowdate())
	dispatched = _challan_rows(["c.transaction_date = %(d)s"], {"d": d}, limit=500)
	due = [
		o for o in _order_rows(
			[("so.docstatus = %s", 1)], limit=1000, order_by="so.transaction_date asc, so.creation asc"
		)
		if o.fulfilment != "Complete" and o.delivery_date and getdate(o.delivery_date) <= d
	]
	names = _party_names(o.party for o in due)
	due_rows = []
	for o in due:
		row = _slim_order(o)
		row["party_name"] = names.get(o.party, o.party)
		row["overdue_days"] = (d - getdate(o.delivery_date)).days
		row["urgent"] = bool(o.is_urgent)
		due_rows.append(row)
	due_rows.sort(key=lambda r: (-r["overdue_days"], r["name"]))
	return {
		"day": str(d),
		"dispatched": dispatched,
		"dispatched_kg": round(sum(flt(c["total_weight"]) for c in dispatched), 3),
		"due": due_rows,
	}


@frappe.whitelist()
def purchase_pending(supplier=None, search=None):
	require_staff()
	rows = _purchase_rows(supplier or None, True, search)
	return {
		"rows": rows,
		"suppliers": sorted({r["supplier"] for r in rows if r["supplier"]}),
	}


def _floor_days():
	days = cint(frappe.db.get_single_value("MM Settings", "floor_pending_days"))
	return days if days > 0 else 5


@frappe.whitelist()
def floor_pending(days=None):
	"""Material that arrived for an order and has sat uncut — not taken into cutting or a
	program — for `days` or more (MM Settings, 5 by default).

	"Uncut" is the floor's own definition, `cutting.inward_stock_rolls`: inwarded against
	an order, no cutting yet, not booked by a live program. Reusing it means the admin's
	list and the cutting screen's In Stock panel can never name different rolls.
	"""
	require_staff()
	from mahaveermetalic.mahaveer_metallic.api.cutting import inward_stock_rolls

	days = cint(days) if cint(days) > 0 else _floor_days()
	cutoff = getdate(add_days(nowdate(), -days))
	today = getdate(nowdate())
	groups = {}
	for r in inward_stock_rolls():
		if not r.inward_date or getdate(r.inward_date) > cutoff:
			continue
		key = (r.customer_order, r.color_name, r.lot_number)
		g = groups.setdefault(key, {
			"order": r.customer_order, "color": r.color_name, "lot": r.lot_number,
			"party_name": r.party_name, "rolls": 0, "weight": 0.0,
			"oldest": getdate(r.inward_date), "challans": set(),
		})
		g["rolls"] += 1
		g["weight"] += flt(r.weight)
		g["oldest"] = min(g["oldest"], getdate(r.inward_date))
		if r.challan_number:
			g["challans"].add(r.challan_number)
	# An inward row carries the order but not always the inward's party; the order knows.
	missing = [g["order"] for g in groups.values() if not g["party_name"] and g["order"]]
	if missing:
		owners = dict(frappe.get_all(
			"MM Sales Order", filters={"name": ["in", missing]}, fields=["name", "party"], as_list=True
		))
		pn = _party_names(owners.values())
		for g in groups.values():
			if not g["party_name"]:
				g["party_name"] = pn.get(owners.get(g["order"]), "")
	rows = []
	for g in groups.values():
		g["weight"] = round(g["weight"], 3)
		g["days"] = (today - g["oldest"]).days
		g["challans"] = ", ".join(sorted(g["challans"]))
		rows.append(g)
	rows.sort(key=lambda g: (-g["days"], str(g["order"])))
	return {"days": days, "rows": rows}


@frappe.whitelist(methods=["POST"])
def set_urgent(doctype, name, urgent=1):
	"""Flag an order (and its purchase orders) or one purchase order urgent, and tell the
	supplier straight away. Clearing the flag tells nobody."""
	require_staff()
	if not (set(frappe.get_roles()) & URGENT_ROLES or frappe.session.user == "Administrator"):
		frappe.throw(_("You can't mark orders urgent."), frappe.PermissionError)
	if doctype not in ("MM Sales Order", "MM Purchase Order"):
		frappe.throw(_("Only orders and purchase orders can be marked urgent."))
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found.").format(doctype, name), frappe.DoesNotExistError)
	urgent = 1 if cint(urgent) else 0
	stamp = now_datetime() if urgent else None

	pos = []
	if doctype == "MM Sales Order":
		frappe.db.set_value(doctype, name, {"is_urgent": urgent, "urgent_on": stamp}, update_modified=False)
		pos = frappe.get_all(
			"MM Purchase Order", filters={"sales_order": name, "docstatus": ["<", 2]}, pluck="name"
		)
	else:
		pos = [name]
	for po in pos:
		frappe.db.set_value("MM Purchase Order", po, {"is_urgent": urgent, "urgent_on": stamp}, update_modified=False)

	told = []
	if urgent:
		for po in frappe.get_all(
			"MM Purchase Order",
			filters={"name": ["in", pos] if pos else ["in", [""]], "docstatus": 1},
			fields=["name", "supplier", "color", "qty_kg", "po_number", "sales_order", "delivery_date"],
		):
			user = frappe.db.get_value("MM Vendor Master", po.supplier, "user") if po.supplier else None
			if not user:
				continue
			when = f" · by {frappe.utils.formatdate(po.delivery_date)}" if po.delivery_date else ""
			notify(
				[user],
				_("URGENT — order {0}").format(po.po_number or po.sales_order or po.name),
				_("{0} · {1}{2}. Please send this first.").format(po.color or "", _kg(po.qty_kg), when),
				url=f"{APP_BASE}/s",
				category="urgent",
				reference=("MM Purchase Order", po.name),
			)
			told.append(po.supplier)
	frappe.get_doc(doctype, name).add_comment(
		"Comment", _("Marked urgent") if urgent else _("Urgent flag cleared")
	)
	return {
		"urgent": urgent,
		"purchase_orders": pos,
		"suppliers_told": sorted(set(told)),
		"note": None if (told or not urgent) else _(
			"Marked urgent. No supplier was notified — this order has no submitted purchase "
			"order, or its supplier has no app login."
		),
	}


# --------------------------------------------------------------------------- follow ups

@frappe.whitelist()
def follow_ups():
	"""Two lists: what the system says needs chasing, and the notes people wrote."""
	require_staff()
	today = getdate(nowdate())
	auto = []

	# Customers whose open orders have run below their minimum.
	for t in threshold_status():
		if t["below"]:
			auto.append({
				"kind": "threshold", "severity": "warn",
				"title": _("{0} is below their minimum order").format(t["party_name"]),
				"detail": _("{0} on order · minimum {1}").format(_kg(t["active_weight"]), _kg(t["threshold"])),
				"party": t["party"],
			})

	# Approved orders past their delivery date and not delivered.
	for o in deliveries(str(today))["due"]:
		if o["overdue_days"] > 0:
			auto.append({
				"kind": "late_delivery", "severity": "high" if o["overdue_days"] > 3 else "warn",
				"title": _("Order {0} is {1} day(s) late").format(o["name"], o["overdue_days"]),
				"detail": f"{o['party_name']} · {o['colours']} · {_kg(o['pending_weight'])} left",
				"order": o["name"],
			})

	# Suppliers late on a purchase, and urgent ones not yet in.
	for p in _purchase_rows(only_pending=True):
		if p["overdue"] or p["urgent"]:
			late = (today - getdate(p["delivery_date"])).days if p["delivery_date"] else 0
			auto.append({
				"kind": "late_purchase", "severity": "high" if p["urgent"] else "warn",
				"title": _("{0}: order {1} {2}").format(
					p["supplier"], p["order_no"],
					_("urgent") if p["urgent"] and not p["overdue"] else _("{0} day(s) late").format(late),
				),
				"detail": f"{p['color']} · {_kg(p['pending'])} pending",
				"supplier": p["supplier"],
			})

	# Customer requests nobody has answered for a day.
	for o in frappe.get_all(
		"MM Sales Order",
		filters={"order_state": "New", "docstatus": 0, "creation": ["<", add_days(now_datetime(), -1)]},
		fields=["name", "party", "creation"],
	):
		auto.append({
			"kind": "request", "severity": "warn",
			"title": _("Request {0} waiting since {1}").format(o.name, frappe.utils.format_datetime(o.creation, "dd-MM HH:mm")),
			"detail": _party_names([o.party]).get(o.party, o.party),
			"order": o.name,
		})

	order = {"high": 0, "warn": 1}
	auto.sort(key=lambda a: order.get(a["severity"], 2))

	manual = frappe.get_all(
		"MM Follow Up",
		filters={"status": "Open"},
		fields=["name", "follow_up_date", "party", "supplier", "sales_order", "note", "owner", "creation"],
		order_by="follow_up_date asc, creation asc",
		limit_page_length=300,
	)
	names = _party_names(m.party for m in manual)
	for m in manual:
		m["party_name"] = names.get(m.party, m.party) if m.party else None
		m["due"] = bool(m.follow_up_date and getdate(m.follow_up_date) <= today)
		m["overdue"] = bool(m.follow_up_date and getdate(m.follow_up_date) < today)
	done = frappe.get_all(
		"MM Follow Up",
		filters={"status": "Done"},
		fields=["name", "follow_up_date", "party", "supplier", "sales_order", "note", "outcome", "done_on", "done_by"],
		order_by="done_on desc",
		limit_page_length=15,
	)
	return {"auto": auto, "manual": manual, "done": done}


@frappe.whitelist(methods=["POST"])
def save_follow_up(note, follow_up_date, name=None, party=None, supplier=None, sales_order=None):
	require_staff()
	if not (note or "").strip():
		frappe.throw(_("Write what needs following up."))
	d = _date_or_none(follow_up_date)
	if not d:
		frappe.throw(_("Pick a follow-up date."))
	for dt, val in (("MM Party Master", party), ("MM Vendor Master", supplier), ("MM Sales Order", sales_order)):
		if val and not frappe.db.exists(dt, val):
			frappe.throw(_("{0} {1} not found.").format(dt, val))
	values = {
		"note": note.strip(), "follow_up_date": d, "party": party or None,
		"supplier": supplier or None, "sales_order": sales_order or None,
	}
	if name:
		doc = frappe.get_doc("MM Follow Up", name)
		if doc.status != "Open":
			frappe.throw(_("This follow-up is already done."))
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": "MM Follow Up", "status": "Open", **values})
		doc.insert(ignore_permissions=True)
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def close_follow_up(name, outcome=None, next_date=None):
	"""Mark done; with `next_date`, a fresh follow-up carries the same note forward."""
	require_staff()
	doc = frappe.get_doc("MM Follow Up", name)
	if doc.status == "Done":
		return {"name": name, "already": True}
	doc.status = "Done"
	doc.outcome = (outcome or "").strip() or None
	doc.done_on = now_datetime()
	doc.done_by = frappe.session.user
	doc.save(ignore_permissions=True)
	nxt = None
	if next_date:
		nxt = save_follow_up(
			note=doc.note, follow_up_date=next_date, party=doc.party,
			supplier=doc.supplier, sales_order=doc.sales_order,
		)["name"]
	return {"name": name, "next": nxt}


@frappe.whitelist()
def pick_options(kind, search=None):
	"""Small typeahead for the follow-up form."""
	require_staff()
	s = f"%{(search or '').strip()}%"
	if kind == "party":
		return frappe.get_all(
			"MM Party Master", or_filters={"name": ["like", s], "party_name": ["like", s]},
			fields=["name", "party_name as label"], limit_page_length=20, order_by="name asc",
		)
	if kind == "supplier":
		return frappe.get_all(
			"MM Vendor Master", filters={"name": ["like", s]},
			fields=["name", "vendor_name as label"], limit_page_length=20, order_by="name asc",
		)
	if kind == "order":
		return frappe.get_all(
			"MM Sales Order", filters={"name": ["like", s], "docstatus": ["<", 2]},
			fields=["name", "party as label"], limit_page_length=20, order_by="creation desc",
		)
	return []


# --------------------------------------------------------------------------- thresholds

def threshold_status(parties=None):
	"""Per customer with a minimum set: what they have on order against that minimum."""
	filters = {"min_order_threshold_kg": [">", 0]}
	if parties:
		filters["name"] = ["in", list(parties)]
	people = frappe.get_all(
		"MM Party Master",
		filters=filters,
		fields=["name", "party_name", "min_order_threshold_kg", "user", "threshold_alerted_on"],
		limit_page_length=0,
	)
	if not people:
		return []
	by_party = {}
	for o in _order_rows(
		[("so.party in %s", tuple(p.name for p in people)), ("so.docstatus < %s", 2)], limit=20000
	):
		by_party.setdefault(o.party, []).append(o)
	out = []
	for p in people:
		active = _active_weight(by_party.get(p.name, []))
		out.append({
			"party": p.name,
			"party_name": p.party_name or p.name,
			"threshold": flt(p.min_order_threshold_kg, 3),
			"active_weight": active,
			"below": active < flt(p.min_order_threshold_kg),
			"user": p.user,
			"alerted_on": p.threshold_alerted_on,
		})
	return out


def check_order_thresholds():
	"""Daily: remind each customer below their minimum, and the admins, once a day."""
	today = getdate(nowdate())
	admins = admin_users()
	below = []
	for t in threshold_status():
		if not t["below"] or (t["alerted_on"] and getdate(t["alerted_on"]) >= today):
			continue
		below.append(t)
		if t["user"]:
			notify(
				[t["user"]],
				_("Time to place your next order"),
				_("You have {0} on order with Mahaveer — below your usual {1}.").format(
					_kg(t["active_weight"]), _kg(t["threshold"])
				),
				url=f"{APP_BASE}/c/new",
				category="threshold",
				reference=("MM Party Master", t["party"]),
			)
		frappe.db.set_value("MM Party Master", t["party"], "threshold_alerted_on", today, update_modified=False)
	if below and admins:
		names = ", ".join(t["party_name"] for t in below[:5]) + (f" +{len(below) - 5}" if len(below) > 5 else "")
		notify(
			admins,
			_("{0} customer(s) below minimum order").format(len(below)),
			names,
			url=f"{APP_BASE}/admin?tab=followups",
			category="threshold",
		)


# --------------------------------------------------------------------------- Veer Metlon

def _vm_post(path, payload):
	import requests

	from mahaveermetalic.mahaveer_metallic.api.veermetlon import _settings

	s = _settings()
	base = s.base_url.rstrip("/")
	headers = {"Accept": "application/json", "Content-Type": "application/json"}
	# Read the stored secret itself: the Password field on a Single can read back empty
	# even when a secret is saved, and gating on it meant the token was never sent.
	secret = s.get_password("api_secret", raise_exception=False)
	if s.api_key and secret:
		headers["Authorization"] = f"token {s.api_key}:{secret}"
	try:
		resp = requests.post(f"{base}{path}", headers=headers, data=json.dumps(payload, default=str), timeout=30)
	except requests.RequestException as e:
		frappe.throw(_("Could not reach Veer Metlon: {0}").format(str(e)))
	if resp.status_code >= 400:
		msg = resp.text[:400]
		try:
			body = resp.json()
			server = body.get("_server_messages")
			if server:
				msg = " ".join(
					frappe.utils.strip_html(json.loads(m).get("message", "")) for m in json.loads(server)
				)
			elif body.get("exception"):
				msg = body["exception"].split(":", 1)[-1].strip()
		except Exception:
			pass
		frappe.throw(_("Veer Metlon refused the order: {0}").format(msg))
	return resp.json()


def _vm_vendor():
	vendor = frappe.db.get_single_value("MM Veermetlon Settings", "vm_vendor")
	if vendor:
		return vendor
	for name in frappe.get_all("MM Vendor Master", pluck="name"):
		if _norm(name).startswith("veer") or "veermetlon" in _norm(name):
			return name
	return None


@frappe.whitelist()
def vm_order_form():
	"""Colours (lacquers) and customers as Veer Metlon has them, plus our settings."""
	require_admin()
	from mahaveermetalic.mahaveer_metallic.api.veermetlon import _vm_get

	s = frappe.get_single("MM Veermetlon Settings")
	out = {
		"configured": bool(s.enabled and s.base_url),
		"vm_customer": s.get("vm_customer"),
		"vm_vendor": _vm_vendor(),
		"lacquers": [],
		"customers": [],
		"error": None,
	}
	if not out["configured"]:
		out["error"] = _("Veer Metlon is not connected — set it up in MM Veermetlon Settings.")
		return out
	try:
		lac = _vm_get("/api/resource/Lacquer", {"fields": json.dumps(["name"]), "limit_page_length": 0})
		out["lacquers"] = sorted(r["name"] for r in (lac.get("data") or []))
		cus = _vm_get("/api/resource/Customer", {"fields": json.dumps(["name"]), "limit_page_length": 0})
		out["customers"] = sorted(r["name"] for r in (cus.get("data") or []))
		if not out["vm_customer"]:
			guess = [c for c in out["customers"] if "mahav" in _norm(c)]
			out["vm_customer"] = guess[0] if len(guess) == 1 else None
	except Exception as e:
		frappe.clear_messages()
		out["error"] = str(e)
	return out


@frappe.whitelist(methods=["POST"])
def place_vm_order(items, vm_customer=None, payment_terms=None, delivery_date=None, sales_order=None):
	"""Book an order with Veer Metlon, and record it here as purchase orders.

	The local purchase orders are written FIRST under a savepoint, then the order goes to
	Veer Metlon, and only if Veer Metlon accepts it does anything stay. So a refusal over
	there leaves nothing here, and a refusal here never reaches Veer Metlon.
	"""
	require_admin()
	lines = _loads(items, [])
	if not isinstance(lines, list) or not lines:
		frappe.throw(_("Add at least one colour."))
	customer = (vm_customer or frappe.db.get_single_value("MM Veermetlon Settings", "vm_customer") or "").strip()
	if not customer:
		frappe.throw(_("Pick which Veer Metlon customer this order is booked under."))
	vendor = _vm_vendor()
	if not vendor:
		frappe.throw(_("Set 'Veer Metlon as Supplier' in MM Veermetlon Settings first."))
	if sales_order:
		so = frappe.db.get_value("MM Sales Order", sales_order, ["docstatus", "order_state"], as_dict=True)
		if not so or so.docstatus == 2 or so.order_state == "Cancelled":
			frappe.throw(_("Order {0} is not a live order.").format(sales_order))
	d = _date_or_none(delivery_date)
	today = getdate(nowdate())
	if d and d < today:
		frappe.throw(_("Delivery date cannot be in the past."))

	clean = []
	for i, l in enumerate(lines, start=1):
		colour = (l.get("colour") or l.get("color") or "").strip()
		qty, rate = flt(l.get("quantity") or l.get("qty")), flt(l.get("rate"))
		if not colour:
			frappe.throw(_("Line {0}: pick a colour.").format(i))
		if qty <= 0:
			frappe.throw(_("Line {0} ({1}): enter the quantity in kg.").format(i, colour))
		if rate <= 0:
			frappe.throw(_("Line {0} ({1}): Veer Metlon needs a rate.").format(i, colour))
		clean.append({"colour": colour, "qty": qty, "rate": rate})

	# Our colour name for each lacquer, where one matches — the PO is read on our screens.
	ours = {_norm(c): c for c in frappe.get_all("MM Item Master", pluck="name")}

	frappe.db.savepoint("vm_order")
	pos = []
	try:
		for l in clean:
			base = re.sub(r"\s*\(\d{2}-\d{2}-\d{4}\)\s*$", "", l["colour"])
			po = frappe.get_doc({
				"doctype": "MM Purchase Order",
				"transaction_date": today,
				"supplier": vendor,
				"sales_order": sales_order or None,
				"color": ours.get(_norm(base), base),
				"qty_kg": l["qty"],
				"rate": l["rate"],
				"delivery_date": d,
			})
			po.insert(ignore_permissions=True)
			po.submit()
			pos.append(po)
		vm = _vm_post("/api/resource/VM Sales Order", {
			"order_date": str(today),
			"company_name": customer,
			"payment_terms": cint(payment_terms) or None,
			"items": [{"colour_name": l["colour"], "quantity": l["qty"], "sales_rate": l["rate"]} for l in clean],
		})
	except Exception:
		frappe.db.rollback(save_point="vm_order")
		raise
	vm_name = (vm.get("data") or {}).get("name")
	for po in pos:
		po.db_set("vm_sales_order", vm_name, update_modified=False)
		if not po.sales_order:
			po.db_set("po_number", vm_name, update_modified=False)
	if not frappe.db.get_single_value("MM Veermetlon Settings", "vm_customer"):
		frappe.db.set_single_value("MM Veermetlon Settings", "vm_customer", customer)
	return {"vm_order": vm_name, "purchase_orders": [p.name for p in pos]}
