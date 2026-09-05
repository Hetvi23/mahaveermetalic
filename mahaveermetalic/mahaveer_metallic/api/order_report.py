# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Order register — one row per order, the shape the floor already reads.

Same columns as the order list (and the legacy register before it): number, date,
customer, items, the purchase/sale rate pair, weight against what has come in and what
is still required, purchase state and the order's status.

The register is APPROVED orders only. One awaiting approval has not started, and a
rejected or cancelled one is not an order any more — listing them under a Complete /
Incomplete heading would say they are still owed. Which they are not.

That status has exactly two values, and both are read off what has GONE OUT: Complete
once challans covering the ordered weight have been raised (off production or straight),
Incomplete while any of it is still to go — 800 kg dispatched against a 1,200 kg order is
Incomplete. What a list cannot give is here instead: a date range, party and status
filters, totals, and something printable.

Built from four queries regardless of how many orders match — a per-order lookup would
turn a 600-row register into 2,400 round trips.
"""

import frappe

from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
	dispatched_by_order,
	fulfilment_state,
	purchase_state,
)
from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_inward_match_tolerance,
)


def _rate_range(vals):
	"""One rate, or the spread when an order's lines disagree — never an average, which
	would show a figure that appears nowhere on the order."""
	if not vals:
		return None
	lo, hi = min(vals), max(vals)
	return {"lo": round(lo, 2), "hi": round(hi, 2), "same": lo == hi}


@frappe.whitelist()
def orders_report(from_date=None, to_date=None, party=None, status=None, company=None,
	item=None, order=None, purchase_status=None, limit=2000):
	"""Rows + totals for the order register.

	`status` is the ORDER's status (Complete / Incomplete — has it all gone out) and
	`purchase_status` is the PURCHASE side (Pending / Partial / Completed — has the material
	been bought and has it arrived). Two different questions about the same order, so they
	filter independently: "what have I still to deliver" and "what have I still to buy" are
	asked by different people on different days.

	Both are derived per row rather than stored, so neither can be pushed into the SQL —
	they are applied as the rows are built, and the totals therefore count what SURVIVES
	the filter rather than what the query returned.
	"""
	# Approved orders only. docstatus 1 IS approval here, so this one condition drops
	# drafts (both pending and rejected) and anything cancelled after approval — a cancel
	# on an approved order cancels the document, taking it to docstatus 2. A cancelled
	# PENDING order never reached docstatus 1, so it is out too.
	conds = ["so.docstatus = 1"]
	vals = {}
	if from_date:
		conds.append("so.transaction_date >= %(fd)s")
		vals["fd"] = from_date
	if to_date:
		conds.append("so.transaction_date <= %(td)s")
		vals["td"] = to_date
	if party:
		conds.append("so.party = %(party)s")
		vals["party"] = party
	# A party can hold several companies and the register is read one company at a time —
	# it is the company, not the party, that is billed.
	if company:
		conds.append("so.company_name = %(company)s")
		vals["company"] = company
	if order:
		conds.append("so.name = %(order)s")
		vals["order"] = order
	# Colour lives on the lines, so filtering by it is an EXISTS rather than a join — a
	# join would multiply an order by its lines and count it once per colour.
	if item:
		conds.append(
			"exists (select 1 from `tabMM Sales Order Item` x"
			" where x.parent = so.name and x.color_name = %(item)s)"
		)
		vals["item"] = item

	orders = frappe.db.sql(
		f"""
		select so.name, so.transaction_date, so.delivery_date, so.party, so.company_name,
			so.ordered_weight, so.ordered_box, so.inwarded_weight, so.required_weight,
			so.production_completed_percent, so.completed, so.completion_mode, so.docstatus,
			so.order_state, pm.party_name
		from `tabMM Sales Order` so
		left join `tabMM Party Master` pm on pm.name = so.party
		where {" and ".join(conds)}
		order by cast(so.name as unsigned) desc, so.name desc
		limit {int(limit)}
		""",
		vals,
		as_dict=True,
	)
	if not orders:
		return {"rows": [], "totals": {
			"orders": 0, "ordered": 0, "inwarded": 0, "required": 0, "dispatched": 0, "pending": 0,
		}}

	names = [o.name for o in orders]

	# Lines: colours and the two rates.
	lines = {}
	for r in frappe.get_all(
		"MM Sales Order Item",
		filters={"parent": ["in", names], "parenttype": "MM Sales Order"},
		fields=["parent", "color_name", "cut", "purchase_rate", "sale_rate"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	):
		e = lines.setdefault(r.parent, {"colours": [], "cuts": [], "p": [], "s": []})
		if r.color_name and r.color_name not in e["colours"]:
			e["colours"].append(r.color_name)
		if r.cut and r.cut not in e["cuts"]:
			e["cuts"].append(r.cut)
		if float(r.purchase_rate or 0) > 0:
			e["p"].append(float(r.purchase_rate))
		if float(r.sale_rate or 0) > 0:
			e["s"].append(float(r.sale_rate))

	# Purchase orders raised against these orders — carried for the supplier and the
	# count; the STATE itself is judged on the order's own requirement (see below).
	pos = {}
	for po in frappe.get_all(
		"MM Purchase Order",
		filters={"sales_order": ["in", names], "docstatus": ["<", 2]},
		fields=["name", "sales_order", "supplier"],
	):
		if not po.sales_order:
			continue
		cur = pos.setdefault(po.sales_order, {"supplier": po.supplier, "count": 0})
		cur["count"] += 1

	# Both states want the inward tolerance and it is a query of its own — read it once for
	# the whole register rather than twice per row.
	tol = get_inward_match_tolerance()
	# One query for the whole page: what has physically left against each order.
	out_by = dispatched_by_order(names)

	rows, t_ord, t_inw, t_req, t_out, t_pend = [], 0.0, 0.0, 0.0, 0.0, 0.0
	for o in orders:
		# The order's ONE status: has all of it gone out, or not yet.
		went = out_by.get(o.name) or {"weight": 0.0, "box": 0.0}
		dispatched = went["weight"]
		# A box order is judged on boxes — see fulfilment_state.
		st = fulfilment_state(o.ordered_weight, dispatched, o.completion_mode, tol,
			ordered_box=o.get("ordered_box"), dispatched_box=went["box"])
		if status and st != status:
			continue
		ln = lines.get(o.name, {"colours": [], "cuts": [], "p": [], "s": []})
		po = pos.get(o.name)
		ordered = float(o.ordered_weight or 0)
		inwarded = float(o.inwarded_weight or 0)
		required = float(o.required_weight or 0)
		ps = purchase_state(ordered, inwarded, bool(po), tol)
		if purchase_status and ps != purchase_status:
			continue
		t_ord += ordered
		t_inw += inwarded
		t_req += required
		t_out += dispatched
		# Summed, never re-derived as ordered − dispatched: an order that over-dispatches
		# would otherwise net off another order's shortfall and the footer would disagree
		# with the column above it.
		t_pend += max(0.0, ordered - dispatched)
		rows.append({
			"order": o.name,
			"date": str(o.transaction_date) if o.transaction_date else None,
			"delivery_date": str(o.delivery_date) if o.delivery_date else None,
			"party": o.party_name or o.party,
			"company": o.company_name,
			"items": ", ".join(ln["colours"]) or None,
			"cuts": ", ".join(ln["cuts"]) or None,
			"purchase_rate": _rate_range(ln["p"]),
			"sale_rate": _rate_range(ln["s"]),
			"ordered_weight": round(ordered, 3),
			"inwarded_weight": round(inwarded, 3),
			"required_weight": round(required, 3),
			# What the status is read off — a status nobody can check is a status nobody
			# trusts, so the figure behind it travels with it.
			"dispatched_weight": round(dispatched, 3),
			"pending_weight": round(max(0.0, float(ordered) - dispatched), 3),
			"purchase_status": ps,
			"purchase_count": (po or {}).get("count", 0),
			"supplier": (po or {}).get("supplier"),
			"has_po": bool(po),
			"status": st,
		})

	return {
		"rows": rows,
		"totals": {
			"orders": len(rows),
			"ordered": round(t_ord, 3),
			"inwarded": round(t_inw, 3),
			"required": round(t_req, 3),
			"dispatched": round(t_out, 3),
			"pending": round(t_pend, 3),
		},
	}


@frappe.whitelist()
def order_summary(order):
	"""Everything that has happened against ONE order, as three dated logs.

	An order is not one inward and one delivery. Material arrives over several inwards,
	is wound over several productions, and goes out over several challans — and the
	register can only show the totals, so the question "where did 577.9 of 600 kg come
	from" had no answer anywhere in the app. This is that answer: the rows behind each
	total, in date order, with the arithmetic that decides Complete / Incomplete spelled
	out rather than asserted.

	A goods return sits in the inwards log with its negative weight, which is exactly how
	it nets off the total — hiding it would leave the total unexplainable by its own rows.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		approval_state,
		dispatched_by_order,
	)

	if not order or not frappe.db.exists("MM Sales Order", order):
		frappe.throw(frappe._("Order {0} not found.").format(order))

	so = frappe.db.get_value(
		"MM Sales Order",
		order,
		["name", "transaction_date", "delivery_date", "party", "company_name", "ordered_weight", "ordered_box",
		 "inwarded_weight", "required_weight", "docstatus", "order_state", "completion_mode",
		 "production_completed_percent"],
		as_dict=True,
	)
	so.party_name = frappe.db.get_value("MM Party Master", so.party, "party_name") or so.party

	items = frappe.get_all(
		"MM Sales Order Item",
		filters={"parent": order, "parenttype": "MM Sales Order"},
		fields=["color_name", "cut", "qty_weight", "qty_box", "sale_rate", "purchase_rate",
			"delivery_date"],
		order_by="idx asc",
		limit_page_length=0,
	)

	# ── Inwards: every receipt row against this order, its own document's date ──
	inwards = frappe.db.sql(
		"""
		select i.name as doc, i.posting_date as date, i.challan_number, i.is_gr,
			ii.lot_number, ii.color_name, ii.roll_name,
			ifnull(ii.to_inventory, 0) as to_inventory,
			coalesce(ii.weight, 0) as weight, coalesce(ii.qty_box, 0) as qty_box
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		where ii.customer_order = %(o)s and i.docstatus = 1
		order by i.posting_date asc, i.creation asc, ii.idx asc
		""",
		{"o": order},
		as_dict=True,
	)

	productions = frappe.get_all(
		"MM Production",
		filters={"customer_order": order, "docstatus": 1},
		fields=["name", "posting_date as date", "machine_no", "batch_no", "shade", "cut",
			"box_qty", "net_weight", "variance_percent"],
		order_by="posting_date asc, creation asc",
		limit_page_length=0,
	)

	# ── Sales: the dispatch challans, job challans excluded (they fulfil nothing) ──
	sales = frappe.db.sql(
		"""
		select c.name as doc, c.challan_no, c.transaction_date as date, c.challan_type,
			c.party, pm.party_name,
			ci.color_name, ci.cut,
			coalesce(sum(ci.weight), 0) as weight, coalesce(sum(ci.qty_box), 0) as qty_box
		from `tabMM Sales Challan Item` ci
		join `tabMM Sales Challan` c on c.name = ci.parent
		left join `tabMM Party Master` pm on pm.name = c.party
		where c.docstatus = 1
			and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
			and coalesce(nullif(ci.sales_order, ''), c.sales_order) = %(o)s
		group by c.name, c.challan_no, c.transaction_date, c.challan_type, c.party, pm.party_name,
			ci.color_name, ci.cut
		order by c.transaction_date asc, c.creation asc
		""",
		{"o": order},
		as_dict=True,
	)

	ordered = float(so.ordered_weight or 0)
	# Stock-only rows arrived under this order's PURCHASE order but fulfil nothing on the
	# sales order, so the receipt total here means the same thing the order's own Inwards
	# (Kg) does. They are still listed, and totalled separately, so the surplus is visible
	# rather than missing.
	in_total = round(sum(float(r.weight or 0) for r in inwards if not r.to_inventory), 3)
	stock_only_total = round(sum(float(r.weight or 0) for r in inwards if r.to_inventory), 3)
	prod_total = round(sum(float(r.net_weight or 0) for r in productions), 3)
	out_by = dispatched_by_order([order]).get(order) or {"weight": 0.0, "box": 0.0}
	out_total = out_by["weight"]
	out_box = out_by["box"]
	tol = get_inward_match_tolerance()

	return {
		"order": so.name,
		"date": str(so.transaction_date) if so.transaction_date else None,
		"delivery_date": str(so.delivery_date) if so.delivery_date else None,
		"party": so.party,
		"party_name": so.party_name,
		"company": so.company_name,
		"approval": approval_state(so.docstatus, so.order_state),
		"status": fulfilment_state(ordered, out_total, so.completion_mode, tol,
			ordered_box=so.get("ordered_box"), dispatched_box=out_box),
		# The unit this order is READ in. A box order's summary foots in boxes, because
		# that is what was sold; its kilos are a consequence and are still carried.
		"unit": "box" if float(so.get("ordered_box") or 0) > 0 else "weight",
		"ordered_box": float(so.get("ordered_box") or 0),
		"dispatched_box": out_box,
		"completion_mode": so.completion_mode or None,
		"items": [
			{**it, "delivery_date": str(it.delivery_date) if it.delivery_date else None}
			for it in items
		],
		"inwards": [
			{
				**r,
				"date": str(r.date) if r.date else None,
				"is_gr": bool(r.is_gr),
				"to_inventory": bool(r.to_inventory),
			}
			for r in inwards
		],
		"productions": [
			{**r, "date": str(r.date) if r.date else None} for r in productions
		],
		"sales": [{**r, "date": str(r.date) if r.date else None} for r in sales],
		"totals": {
			"ordered": round(ordered, 3),
			"inwarded": in_total,
			# Surplus received against the purchase order, over and above what was sold.
			"stock_only": stock_only_total,
			"produced": prod_total,
			"dispatched": out_total,
			# What the customer is still owed — the figure the status is decided on.
			"remaining": round(max(0.0, ordered - out_total), 3),
			# What has arrived but not yet left. Different question, and the one the floor
			# asks when deciding whether it can raise another challan today.
			# Physically here and not yet gone — surplus included, because it is in hand
			# whether or not it belongs to the order's fulfilment.
			"in_hand": round(in_total + stock_only_total - out_total, 3),
			"tolerance_percent": tol,
			# The BOX side of the same arithmetic. An order placed in boxes is judged on
			# these (see fulfilment_state), so the summary has to be able to show the
			# figures its verdict was actually reached on rather than the kilos beside them.
			"ordered_box": round(float(so.get("ordered_box") or 0), 3),
			"dispatched_box": out_box,
			"remaining_box": round(max(0.0, float(so.get("ordered_box") or 0) - out_box), 3),
			# A count has no variance allowance — see fulfilment_state.
			"complete_at_box": round(float(so.get("ordered_box") or 0), 3),
			# Below this, the order counts as delivered in full.
			"complete_at": round(ordered * (1 - tol / 100.0), 3),
		},
	}
