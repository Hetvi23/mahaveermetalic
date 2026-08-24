# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Bobbin stock — a party-wise ledger fed from two places.

  1. Bobbin / Box challan (MM Bobbin Box Tracking) — Receive = we got bobbins from the
     party (in), Give = we handed bobbins to them (out).
  2. Production — the bobbins entered on each box are consumed (out).

The report reads that ledger as Opening (everything before the from-date) + the period's
movements, ending in a running balance.
"""

import frappe
from frappe import _


def _post(**kw):
	frappe.get_doc(dict({"doctype": "MM Bobbin Ledger Entry"}, **kw)).insert(ignore_permissions=True)


def clear_voucher(voucher_no):
	"""Drop a voucher's ledger rows so it can be re-posted (edit / cancel)."""
	for n in frappe.get_all("MM Bobbin Ledger Entry", filters={"voucher_no": voucher_no}, pluck="name"):
		frappe.delete_doc("MM Bobbin Ledger Entry", n, ignore_permissions=True, force=True)


def post_bobbin_challan(doc):
	"""Receive → bobbins come in; Give → bobbins go out. Boxes ride along on the same row."""
	clear_voucher(doc.name)
	receiving = (doc.given_received or "").strip().lower() == "received"
	for row in doc.lines or []:
		qty = float(row.bobbin_qty or 0)
		box = float(row.box_qty or 0)
		if qty <= 0 and box <= 0:
			continue
		_post(
			posting_date=doc.chalan_date or frappe.utils.today(),
			voucher_type="Bobbin Challan",
			voucher_no=doc.name,
			party=doc.party,
			bobbin=row.bobbin_type,
			note=doc.note,
			# Carried so job-work bobbins can be told apart in the ledger and the report;
			# the movement is otherwise identical to an ordinary give/receive.
			job_work_flag=1 if frappe.utils.cint(doc.get("job_work_flag")) else 0,
			in_qty=qty if receiving else 0,
			out_qty=0 if receiving else qty,
			box_in=box if receiving else 0,
			box_out=0 if receiving else box,
		)


def post_production(doc):
	"""Bobbins entered on a production's boxes are consumed out of stock."""
	clear_voucher(doc.name)
	for b in doc.boxes or []:
		pcs = float(b.bobbin_pcs or 0)
		if not b.bobbin or pcs <= 0:
			continue
		_post(
			posting_date=doc.posting_date or frappe.utils.today(),
			voucher_type="Production",
			voucher_no=doc.name,
			party=doc.party,
			bobbin=b.bobbin,
			note=_("Used in production {0}").format(doc.name),
			in_qty=0,
			out_qty=pcs,
			box_in=0,
			box_out=1,
		)


@frappe.whitelist()
def bobbin_report(party=None, from_date=None, to_date=None, bobbin=None, owner=None, company=None):
	"""Party-wise bobbin ledger: opening before from_date, then the period's movements
	with a running balance, plus totals.

	`company` selects the party that company is filed under, so the report can be pulled
	the same way orders and production are — by company, not only by party.

	`owner` narrows to whose bobbins these are: "MM", "Party", or blank/"Both". The owner
	lives on MM Bobbin Master, so it resolves to the set of bobbins first.
	"""
	# A company is one of a party's MM Party Company rows — resolve it to its party.
	if company and not party:
		party = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)

	owner = (owner or "").strip()
	owned_bobbins = None
	if owner in ("MM", "Party"):
		owned_bobbins = frappe.get_all("MM Bobbin Master", filters={"owner_type": owner}, pluck="name")
		if not owned_bobbins:
			# No bobbin is owned that way, so nothing can match — say so rather than
			# silently dropping the filter and showing everything.
			return {"opening_qty": 0, "opening_box": 0, "rows": [], "closing_qty": 0, "closing_box": 0,
				"party": party, "owner": owner}

	filters = {}
	if party:
		filters["party"] = party
	if bobbin:
		filters["bobbin"] = bobbin
	if owned_bobbins is not None:
		filters["bobbin"] = ["in", owned_bobbins]

	def totals(where_extra, vals):
		conds = ["1=1"]
		v = dict(vals)
		if party:
			conds.append("party = %(party)s")
			v["party"] = party
		if bobbin:
			conds.append("bobbin = %(bobbin)s")
			v["bobbin"] = bobbin
		if owned_bobbins is not None:
			conds.append("bobbin in %(owned)s")
			v["owned"] = owned_bobbins
		conds.append(where_extra)
		row = frappe.db.sql(
			f"""select coalesce(sum(in_qty),0) - coalesce(sum(out_qty),0),
				coalesce(sum(box_in),0) - coalesce(sum(box_out),0)
			from `tabMM Bobbin Ledger Entry` where {" and ".join(conds)}""",
			v,
		)
		return (float(row[0][0] or 0), float(row[0][1] or 0)) if row else (0.0, 0.0)

	opening_qty, opening_box = (0.0, 0.0)
	if from_date:
		opening_qty, opening_box = totals("posting_date < %(fd)s", {"fd": from_date})

	period = dict(filters)
	if from_date and to_date:
		period["posting_date"] = ["between", [from_date, to_date]]
	elif from_date:
		period["posting_date"] = [">=", from_date]
	elif to_date:
		period["posting_date"] = ["<=", to_date]

	rows = frappe.get_all(
		"MM Bobbin Ledger Entry",
		filters=period,
		fields=["name", "posting_date", "voucher_type", "voucher_no", "bobbin", "note",
			"in_qty", "out_qty", "box_in", "box_out", "party"],
		order_by="posting_date asc, creation asc",
		limit_page_length=1000,
	)

	bal_qty, bal_box = opening_qty, opening_box
	out = []
	for r in rows:
		bal_qty += float(r.in_qty or 0) - float(r.out_qty or 0)
		bal_box += float(r.box_in or 0) - float(r.box_out or 0)
		out.append(
			{
				"date": str(r.posting_date) if r.posting_date else None,
				"voucher_type": r.voucher_type,
				"voucher_no": r.voucher_no,
				"bobbin": r.bobbin,
				"note": r.note,
				"in_qty": float(r.in_qty or 0),
				"out_qty": float(r.out_qty or 0),
				"qty": round(float(r.in_qty or 0) - float(r.out_qty or 0), 3),
				"box": round(float(r.box_in or 0) - float(r.box_out or 0), 3),
				"balance_qty": round(bal_qty, 3),
				"balance_box": round(bal_box, 3),
			}
		)

	return {
		"opening_qty": round(opening_qty, 3),
		"opening_box": round(opening_box, 3),
		"rows": out,
		"closing_qty": round(bal_qty, 3),
		"closing_box": round(bal_box, 3),
		"party": party,
		"owner": owner or "Both",
	}


@frappe.whitelist()
def bobbin_balances(party=None):
	"""Current bobbin balance per bobbin (optionally for one party)."""
	conds = ["1=1"]
	vals = {}
	if party:
		conds.append("l.party = %(party)s")
		vals["party"] = party
	return frappe.db.sql(
		f"""select l.bobbin, b.owner_type, b.party as owner_party,
			coalesce(sum(l.in_qty),0) - coalesce(sum(l.out_qty),0) as qty,
			coalesce(sum(l.box_in),0) - coalesce(sum(l.box_out),0) as box
		from `tabMM Bobbin Ledger Entry` l
		left join `tabMM Bobbin Master` b on b.name = l.bobbin
		where {" and ".join(conds)}
		group by l.bobbin, b.owner_type, b.party
		order by l.bobbin asc""",
		vals,
		as_dict=True,
	)


def post_job_challan(doc):
	"""Bobbins riding on a job challan.

	Job Out sends bobbins to the worker (out of MM's hands); Job In is them coming back.
	Same ledger as Bobbin In/Out and Production, so the report reconciles across all
	three sources.
	"""
	clear_voucher(doc.name)
	if (doc.challan_type or "") not in ("Job Out", "Job In"):
		return
	going_out = doc.challan_type == "Job Out"
	for row in doc.bobbins or []:
		qty = float(row.qty or 0)
		if qty <= 0:
			continue
		_post(
			posting_date=doc.transaction_date or frappe.utils.today(),
			voucher_type=doc.challan_type,
			voucher_no=doc.name,
			party=doc.party,
			bobbin=row.bobbin,
			note=doc.remarks,
			# A Job Out / Job In IS job work — the ledger records it without being asked.
			job_work_flag=1,
			in_qty=0 if going_out else qty,
			out_qty=qty if going_out else 0,
		)
