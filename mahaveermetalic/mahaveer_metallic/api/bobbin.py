# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Bobbin stock — a party-wise ledger fed from the papers that carry bobbins to a party.

  1. Bobbin / Box challan (MM Bobbin Box Tracking) — Received = we got bobbins back from the
     party (in), Given = we handed bobbins to them (out).
  2. Sales-side challans — Sales, Job Challan, Challan, Delivery Challan, Roll Challan —
     and every Job In: the bobbins inside each box go OUT to the challan's party.

Those, and nothing else (Hetvi, 2026-10-27: "data will only come from job in/sales or bobbin
in/out"). Production no longer posts: the bobbins it packs are counted when the boxes leave
on a challan, which is when they actually reach a party. Job Out is still left out — its
boxes carry bobbins the Job In that answers it counts.

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
			# WHICH Job Out these belong to. Without it the movement reaches the ledger
			# attached to nothing and the hisab — which counts bobbins per Job Out — cannot
			# see it, so bobbins sent this way looked like they were never sent.
			against_job_out=doc.get("against_job_out") or None,
			in_qty=qty if receiving else 0,
			out_qty=0 if receiving else qty,
			box_in=box if receiving else 0,
			box_out=0 if receiving else box,
		)


def post_production(doc):
	"""Production no longer posts bobbins — its boxes post when they leave on a challan.

	Still called on submit and cancel, and still clears: a production posted under the old
	rule drops its rows the next time it is touched, and the rebuild clears the rest.
	"""
	clear_voucher(doc.name)


@frappe.whitelist()
def bobbin_report(party=None, from_date=None, to_date=None, bobbin=None, owner=None, company=None,
	bill_wise=1):
	"""Party-wise bobbin ledger: opening before from_date, then the period's movements
	with a running balance, plus totals.

	`company` selects the party that company is filed under, so the report can be pulled
	the same way orders and production are — by company, not only by party.

	`owner` narrows to whose bobbins these are: "MM", "Party", or blank/"Both". The owner
	lives on MM Bobbin Master, so it resolves to the set of bobbins first.

	`bill_wise` (default ON) gives ONE LINE PER VOUCHER instead of one per movement
	(Hetvi: "bobbin report bill wise"). A production that consumed twenty bobbins wrote
	twenty ledger rows, all reading "MMPROD-00001 · Production · −100", and the statement
	ran to 925 lines of the same voucher repeating — nobody can read a balance off that.
	Grouped, it is one line: MMPROD-00001, −2,000, 20 movements.

	Grouped by voucher AND bobbin, not by voucher alone: one voucher can move two kinds of
	bobbin, and adding those together would state a quantity of nothing in particular.
	Pass bill_wise=0 for the movement-by-movement ledger, which is still the truth behind
	each line.
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
		# Every row, or the running balance is struck on a part of them: the ledger is one
		# row per box line now, and an all-parties period passes 1,000 easily.
		limit_page_length=0,
	)

	# ONE LINE PER BILL, before the running balance is struck — the balance has to be the
	# balance after the whole voucher, not after an arbitrary row inside it.
	if frappe.utils.cint(bill_wise):
		grouped = {}
		for r in rows:
			key = (r.voucher_type, r.voucher_no, r.bobbin)
			g = grouped.get(key)
			if g is None:
				g = grouped[key] = frappe._dict({
					"posting_date": r.posting_date, "voucher_type": r.voucher_type,
					"voucher_no": r.voucher_no, "bobbin": r.bobbin, "note": r.note,
					"party": r.party, "in_qty": 0.0, "out_qty": 0.0,
					"box_in": 0.0, "box_out": 0.0, "movements": 0,
				})
			g.in_qty += float(r.in_qty or 0)
			g.out_qty += float(r.out_qty or 0)
			g.box_in += float(r.box_in or 0)
			g.box_out += float(r.box_out or 0)
			g.movements += 1
			# The voucher is dated once; keep the earliest row's date and drop the note,
			# which repeated the voucher number on every line anyway.
			if r.posting_date and (not g.posting_date or r.posting_date < g.posting_date):
				g.posting_date = r.posting_date
		rows = sorted(grouped.values(), key=lambda g: (g.posting_date or "", g.voucher_no or ""))

	refs = _references(rows)
	bal_qty, bal_box = opening_qty, opening_box
	out = []
	for r in rows:
		bal_qty += float(r.in_qty or 0) - float(r.out_qty or 0)
		bal_box += float(r.box_in or 0) - float(r.box_out or 0)
		out.append(
			{
				"date": str(r.posting_date) if r.posting_date else None,
				"voucher_type": r.voucher_type,
				# WHAT THE SHOP CALLED IT. A Bobbin In / Out entry is keyed as Given or
				# Received and that is the word on the page it was typed on; the register
				# said "Bobbin Challan" for both, so the two directions read identically
				# and only the sign told them apart.
				"label": (
					("Received" if float(r.in_qty or 0) >= float(r.out_qty or 0) else "Given")
					if r.voucher_type == "Bobbin Challan" else r.voucher_type
				),
				"voucher_no": r.voucher_no,
				"bobbin": r.bobbin,
				"note": r.note,
				# WHAT SOMEBODY WROTE, not what the system did (Hetvi: "remark addition in
				# bobbin report"): the Bobbin In / Out note, or the challan's own remark. A
				# production's old "Used in production MMPROD-…" only repeated its number.
				"remark": (r.note or None) if r.voucher_type != "Production" else None,
				# THE CHALLAN ID (Hetvi: "remove voucher no, reference should come based on
				# the challan id"): the one number the register shows per line.
				"reference": refs.get((r.voucher_type, r.voucher_no, r.bobbin)) or None,
				"in_qty": float(r.in_qty or 0),
				"out_qty": float(r.out_qty or 0),
				"qty": round(float(r.in_qty or 0) - float(r.out_qty or 0), 3),
				"box": round(float(r.box_in or 0) - float(r.box_out or 0), 3),
				"balance_qty": round(bal_qty, 3),
				"balance_box": round(bal_box, 3),
				# How many ledger rows this line stands for; 1 unless it is a grouped bill.
				"movements": int(r.get("movements") or 1),
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
		"bill_wise": bool(frappe.utils.cint(bill_wise)),
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


def _references(rows):
	"""(voucher_type, voucher_no, bobbin) -> the challan ID the bobbins moved on.

	A Sales Challan / Job In / Job Out row's voucher IS that challan. A Bobbin In / Out entry
	is keyed by a hash, so it shows the number off the party's paper (challan_number), else
	the Job Out it was made against. A Production row — only ledgers not yet rebuilt under
	the 2026-10-27 rule still hold them — shows the challan(s) its boxes went out on, and
	nothing while they sit in stock.
	"""
	tracking = {r.voucher_no for r in rows if r.voucher_type == "Bobbin Challan"}
	prods = {r.voucher_no for r in rows if r.voucher_type == "Production"}
	paper = {}
	if tracking:
		paper = {
			t.name: t.challan_number or t.against_job_out
			for t in frappe.get_all("MM Bobbin Box Tracking", filters={"name": ["in", list(tracking)]},
				fields=["name", "challan_number", "against_job_out"], limit_page_length=0)
		}
	went_on = {}
	if prods:
		for p, c in frappe.db.sql(
			"""select i.production, i.parent from `tabMM Sales Challan Item` i
			join `tabMM Sales Challan` c on c.name = i.parent
			where c.docstatus = 1 and i.parenttype = 'MM Sales Challan' and i.production in %(p)s
			order by c.transaction_date asc, c.creation asc""",
			{"p": list(prods)},
		):
			got = went_on.setdefault(p, [])
			if c not in got:
				got.append(c)

	out = {}
	for r in rows:
		key = (r.voucher_type, r.voucher_no, r.bobbin)
		if r.voucher_type == "Bobbin Challan":
			out[key] = paper.get(r.voucher_no)
		elif r.voucher_type == "Production":
			out[key] = ", ".join(went_on.get(r.voucher_no, []))
		else:
			out[key] = r.voucher_no
	return out


# The challans whose boxes take bobbins to a party: everything the Sales Challan Voucher
# issues, and every Job In. Job Out is not among them (see the module docstring).
BOBBIN_CHALLAN_TYPES = ("Sales", "Job Challan", "Challan", "Delivery Challan", "Roll Challan", "Job In")


def post_job_challan(doc):
	"""Post a challan's bobbins: each box line's bobbins go OUT to the challan's party.

	Cleared and written again from the document every time, so a re-post (mapping the
	challan to another order's party, an edit) never double-counts. A cancelled challan, or a
	type that does not carry bobbins to a party, is left with no rows.

	Two things are deliberately NOT set on these rows:
	  • against_job_out — Job Hisab reads ledger rows carrying it as LOOSE bobbins sent or
	    returned against a Job Out (Bobbin In / Out). A Job In's own bobbins are already in
	    the hisab off the challan; tagging them would count them twice. The report works the
	    Job Out out from the challan instead (_references).
	  • a Production row — the production that packed these boxes no longer posts.
	"""
	clear_voucher(doc.name)
	if doc.docstatus != 1 or (doc.challan_type or "Sales") not in BOBBIN_CHALLAN_TYPES:
		return
	vtype = "Job In" if doc.challan_type == "Job In" else "Sales Challan"
	for it in doc.items or []:
		pcs = float(it.bobbin_pcs or 0)
		if not it.bobbin or pcs <= 0:
			continue
		_post(
			posting_date=doc.transaction_date or frappe.utils.today(),
			voucher_type=vtype,
			voucher_no=doc.name,
			party=doc.party,
			bobbin=it.bobbin,
			# The challan's own remark, the operator's words — the report's Remark column.
			note=(doc.get("remarks") or "").strip() or None,
			job_work_flag=1 if frappe.utils.cint(doc.get("job_work_flag")) else 0,
			in_qty=0,
			out_qty=pcs,
			box_in=0,
			box_out=float(it.qty_box or 1),
		)
