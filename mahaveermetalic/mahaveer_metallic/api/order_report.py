# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Order register — one row per order, the shape the floor already reads.

Same columns as the order list (and the legacy register before it): number, date,
customer, items, the purchase/sale rate pair, weight against what has come in and what
is still required, purchase state and status. What a list cannot give is here instead:
a date range, party and status filters, totals, and something printable.

Built from four queries regardless of how many orders match — a per-order lookup would
turn a 600-row register into 2,400 round trips.
"""

import frappe


def _rate_range(vals):
	"""One rate, or the spread when an order's lines disagree — never an average, which
	would show a figure that appears nowhere on the order."""
	if not vals:
		return None
	lo, hi = min(vals), max(vals)
	return {"lo": round(lo, 2), "hi": round(hi, 2), "same": lo == hi}


def _status(o):
	"""Mirrors the order list exactly, so the register never disagrees with the screen
	it was opened from."""
	if int(o.get("docstatus") or 0) == 2:
		return "Rejected"
	if int(o.get("docstatus") or 0) == 0:
		return "Pending Approval"
	prod = round(float(o.get("production_completed_percent") or 0))
	if o.get("completed") and o.get("completion_mode") == "Inward" and prod < 100:
		return "Material In"
	if prod >= 100 or o.get("completed"):
		return "Completed"
	if float(o.get("inwarded_weight") or 0) > 0 or prod > 0:
		return "Partially Completed"
	return "Pending"


@frappe.whitelist()
def orders_report(from_date=None, to_date=None, party=None, status=None, limit=2000):
	"""Rows + totals for the order register."""
	conds = ["so.docstatus < 2"]
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

	orders = frappe.db.sql(
		f"""
		select so.name, so.transaction_date, so.delivery_date, so.party, so.company_name,
			so.ordered_weight, so.inwarded_weight, so.required_weight,
			so.production_completed_percent, so.completed, so.completion_mode, so.docstatus,
			pm.party_name
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
		return {"rows": [], "totals": {"orders": 0, "ordered": 0, "inwarded": 0, "required": 0}}

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

	# Purchase state, worst-of when an order carries several POs.
	po_fields = ["name", "sales_order", "supplier"]
	has_status = frappe.db.has_column("MM Purchase Order", "status")
	if has_status:
		po_fields.append("status")
	rank = {"Pending": 0, "Partially Received": 1, "Received": 2}
	pos = {}
	for po in frappe.get_all(
		"MM Purchase Order", filters={"sales_order": ["in", names], "docstatus": ["<", 2]}, fields=po_fields
	):
		st = (po.get("status") if has_status else None) or "Pending"
		cur = pos.get(po.sales_order)
		if cur is None or rank.get(st, 0) < rank.get(cur["status"], 0):
			pos[po.sales_order] = {"status": st, "supplier": po.supplier, "count": (cur or {}).get("count", 0) + 1}
		else:
			cur["count"] += 1

	rows, t_ord, t_inw, t_req = [], 0.0, 0.0, 0.0
	for o in orders:
		st = _status(o)
		if status and st != status:
			continue
		ln = lines.get(o.name, {"colours": [], "cuts": [], "p": [], "s": []})
		po = pos.get(o.name)
		ordered = float(o.ordered_weight or 0)
		inwarded = float(o.inwarded_weight or 0)
		required = float(o.required_weight or 0)
		t_ord += ordered
		t_inw += inwarded
		t_req += required
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
			"purchase_status": (po or {}).get("status"),
			"purchase_count": (po or {}).get("count", 0),
			"supplier": (po or {}).get("supplier"),
			"status": st,
		})

	return {
		"rows": rows,
		"totals": {
			"orders": len(rows),
			"ordered": round(t_ord, 3),
			"inwarded": round(t_inw, 3),
			"required": round(t_req, 3),
		},
	}
