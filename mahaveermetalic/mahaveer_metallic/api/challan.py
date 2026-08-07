# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Sales Challan voucher.

Production is where boxes and bobbins are entered; the challan is the dispatch document
built from them. A production voucher that carries a Sales Order auto-raises its challan
on submit and submits it straight away (it counts as dispatched). Without an
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
					"barcode": b.barcode,
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
	challan.submit()   # dispatched straight away
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
			["parent", "item", "barcode", "gross_weight", "bobbin", "bobbin_pcs", "bobbin_pcs_weight",
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


@frappe.whitelist()
def scan_box(barcode):
	"""SCAN BOX: resolve a sticker barcode to its produced box."""
	code = (barcode or "").strip()
	if not code:
		frappe.throw(_("Scan or type a barcode."))
	b = frappe.db.get_value(
		"MM Production Box", {"barcode": code},
		["name as box", "parent as production", "item", "barcode", "gross_weight", "bobbin",
		 "bobbin_pcs", "bobbin_pcs_weight", "total_bobbin_weight", "box_weight", "net_weight"],
		as_dict=True,
	)
	if not b:
		frappe.throw(_("No box found for barcode {0}.").format(code))
	p = frappe.db.get_value("MM Production", b.production, ["cut", "customer_order", "docstatus"], as_dict=True)
	if p and p.docstatus != 1:
		frappe.throw(_("Box {0} belongs to a production that isn't submitted.").format(code))
	b["cut"] = p.cut if p else None
	b["customer_order"] = p.customer_order if p else None
	used = frappe.db.exists("MM Sales Challan Item", {"barcode": code})
	if used:
		frappe.throw(_("Box {0} is already on a challan.").format(code))
	return b


# ── Job work: Job Out / Job In ────────────────────────────────────────────────────
# Job In and Job Out are the SAME screen and the same record as a sales challan — only
# the type, the numbering series and the view differ. Job Out sends rolls (and bobbins)
# to a job worker; Job In is them coming back.

_JOB_SERIES = {"Sales": "MM-SC-.YYYY.-", "Job Out": "MM-JO-.YYYY.-", "Job In": "MM-JI-.YYYY.-"}


@frappe.whitelist()
def in_stock_rolls(item=None, challan_date=None, start=0, page_length=10):
	"""Rolls on hand, for the left "IN STOCK ROLL" list of the job screen.

	Paginated because a real site carries hundreds of rows (the legacy screen shows
	"1 to 10 of 304"). Returns the page plus the total so the pager can be drawn.

	Inventory is keyed by (branch, location, lot, colour) rather than by the inward that
	produced it, so there is no single challan date or order to show per row; the row's
	own creation date stands in for the date, and Order is left to the challan.
	"""
	conds = ["ifnull(stock_weight, 0) > 0"]
	vals = {}
	if item:
		conds.append("color_name = %(item)s")
		vals["item"] = item
	if challan_date:
		conds.append("date(creation) = %(cd)s")
		vals["cd"] = challan_date
	where = " and ".join(conds)

	total = frappe.db.sql(f"select count(*) from `tabMM Roll Inventory` where {where}", vals)[0][0]

	vals["start"] = frappe.utils.cint(start)
	vals["page_length"] = frappe.utils.cint(page_length) or 10
	rows = frappe.db.sql(
		f"""
		select name, roll_no, color_name, lot_number, location, branch,
			stock_weight, stock_box, date(creation) as challan_date
		from `tabMM Roll Inventory`
		where {where}
		order by modified desc
		limit %(page_length)s offset %(start)s
		""",
		vals,
		as_dict=True,
	)
	return {"rows": rows, "total": total}


@frappe.whitelist()
def next_job_challan_no(challan_type="Job Out"):
	"""The next manual challan number for this job type — the legacy screen pre-fills it
	and lets the operator overwrite it."""
	last = frappe.db.sql(
		"""
		select challan_no from `tabMM Sales Challan`
		where challan_type = %s and ifnull(challan_no, '') regexp '^[0-9]+$'
		order by cast(challan_no as unsigned) desc limit 1
		""",
		(challan_type,),
	)
	return str(int(last[0][0]) + 1) if last else "1"


@frappe.whitelist()
def create_job_challan(challan_type="Job Out", party=None, challan_date=None, challan_no=None,
	rolls=None, bobbins=None, remark=None, location=None, branch=None):
	"""Create a Job Out / Job In challan from the picked rolls and bobbins.

	Stock and the bobbin ledger both move on submit (see MMSalesChallan.on_submit), so
	the challan is submitted straight away — the job material has physically moved.
	"""
	if challan_type not in ("Job Out", "Job In"):
		frappe.throw(_("Challan type must be Job Out or Job In."))
	if not party:
		frappe.throw(_("Choose the party."))
	roll_list = json.loads(rolls) if isinstance(rolls, str) else (rolls or [])
	bob_list = json.loads(bobbins) if isinstance(bobbins, str) else (bobbins or [])
	if not roll_list and not bob_list:
		frappe.throw(_("Add at least one roll or bobbin to the challan."))

	rows = []
	for r in roll_list:
		name = r.get("roll_inventory") if isinstance(r, dict) else r
		inv = frappe.db.get_value(
			"MM Roll Inventory", name,
			["color_name", "roll_no", "stock_weight", "stock_box", "location", "branch"],
			as_dict=True,
		)
		if not inv:
			continue
		weight = float((r.get("weight") if isinstance(r, dict) else None) or inv.stock_weight or 0)
		rows.append({
			"color_name": _valid_colour(inv.color_name),
			"cut": (r.get("cut") if isinstance(r, dict) else None) or None,
			"qty_box": inv.stock_box or 1,
			"gross_weight": weight,
			"net_weight": weight,
			"weight": weight,
			"roll_inventory": name,
			"sales_order": (r.get("sales_order") if isinstance(r, dict) else None) or None,
		})
		location = location or inv.location
		branch = branch or inv.branch

	bobbin_rows = []
	for b in bob_list:
		qty = float(b.get("qty") or 0)
		if qty <= 0:
			continue
		master = frappe.db.get_value("MM Bobbin Master", b.get("bobbin"), ["quality", "weight"], as_dict=True)
		bobbin_rows.append({
			"bobbin": b.get("bobbin"),
			"qty": qty,
			"quality": (master or {}).get("quality"),
			"weight": round(qty * float((master or {}).get("weight") or 0), 3),
		})

	challan = frappe.get_doc({
		"doctype": "MM Sales Challan",
		"naming_series": _JOB_SERIES[challan_type],
		"challan_type": challan_type,
		"transaction_date": challan_date or frappe.utils.today(),
		"party": party,
		"challan_no": challan_no or None,
		"remarks": remark or None,
		"job_work_flag": 1,
		"location": location,
		"branch": branch,
		"items": rows,
		"bobbins": bobbin_rows,
	})
	challan.insert(ignore_permissions=True)
	challan.submit()
	return {
		"challan": challan.name,
		"rolls": len(rows),
		"bobbins": len(bobbin_rows),
		"total_weight": challan.total_weight,
	}


@frappe.whitelist()
def job_challans(challan_type="Job Out", limit=50):
	"""Recent job challans for the screen's list."""
	return frappe.get_all(
		"MM Sales Challan",
		filters={"challan_type": challan_type, "docstatus": ["<", 2]},
		fields=["name", "transaction_date", "party", "challan_no", "total_box", "total_weight", "docstatus"],
		order_by="creation desc",
		limit=frappe.utils.cint(limit),
	)


@frappe.whitelist()
def challan_for_print(challan):
	"""Everything one challan needs to print, in one call.

	Used by the A4 two-copies-per-sheet print (Original / Duplicate) and by the
	auto-print that fires when a production submits.
	"""
	doc = frappe.get_doc("MM Sales Challan", challan)
	party = frappe.db.get_value(
		"MM Party Master", doc.party, ["party_name", "address", "mobile_number"], as_dict=True
	) or {}
	return {
		"name": doc.name,
		"challan_type": doc.challan_type or "Sales",
		"challan_no": doc.challan_no or doc.name,
		"transaction_date": str(doc.transaction_date or ""),
		"party": doc.party,
		"party_name": party.get("party_name") or doc.party,
		"address": party.get("address"),
		"mobile_no": party.get("mobile_number"),
		"sales_order": doc.sales_order,
		"transport": doc.transport,
		"vehicle_no": doc.vehicle_no,
		"remarks": doc.remarks,
		"total_box": doc.total_box,
		"total_weight": doc.total_weight,
		"docstatus": doc.docstatus,
		"items": [
			{
				"idx": it.idx,
				"color_name": it.color_name,
				"cut": it.cut,
				"barcode": it.barcode,
				"qty_box": it.qty_box,
				"gross_weight": it.gross_weight,
				"bobbin": it.bobbin,
				"bobbin_pcs": it.bobbin_pcs,
				"total_bobbin_weight": it.total_bobbin_weight,
				"box_weight": it.box_weight,
				"net_weight": it.net_weight,
				"weight": it.weight,
			}
			for it in doc.items
		],
		"bobbins": [
			{"bobbin": b.bobbin, "qty": b.qty, "quality": b.quality, "weight": b.weight}
			for b in (doc.get("bobbins") or [])
		],
	}


@frappe.whitelist()
def challan_for_production(production):
	"""The challan raised by a production, if any — so the screen can print it straight
	after submitting without the operator hunting for it."""
	name = frappe.db.get_value("MM Sales Challan", {"source_production": production, "docstatus": ["<", 2]}, "name")
	return challan_for_print(name) if name else None


@frappe.whitelist()
def job_report(party=None, from_date=None, to_date=None, company=None):
	"""Job work report: what went out, what came back, and what is still with the worker.

	Balance is per party — Job Out minus Job In — so an outstanding balance is material
	the job worker still holds. Bobbins are tracked the same way alongside the weight.
	"""
	if company and not party:
		party = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)

	conds = ["c.docstatus = 1", "c.challan_type in ('Job Out', 'Job In')"]
	vals = {}
	if party:
		conds.append("c.party = %(party)s")
		vals["party"] = party
	if from_date:
		conds.append("c.transaction_date >= %(fd)s")
		vals["fd"] = from_date
	if to_date:
		conds.append("c.transaction_date <= %(td)s")
		vals["td"] = to_date
	where = " and ".join(conds)

	rows = frappe.db.sql(
		f"""
		select c.name, c.challan_type, c.transaction_date, c.party, c.challan_no,
			c.total_box, c.total_weight,
			(select coalesce(sum(b.qty), 0) from `tabMM Production Bobbin` b
			 where b.parent = c.name and b.parenttype = 'MM Sales Challan') as bobbin_qty
		from `tabMM Sales Challan` c
		where {where}
		order by c.transaction_date asc, c.creation asc
		""",
		vals,
		as_dict=True,
	)

	out = []
	bal_w = bal_b = 0.0
	for r in rows:
		sent = r.challan_type == "Job Out"
		w = float(r.total_weight or 0)
		b = float(r.bobbin_qty or 0)
		bal_w += w if sent else -w
		bal_b += b if sent else -b
		out.append({
			"challan": r.name,
			"type": r.challan_type,
			"date": str(r.transaction_date) if r.transaction_date else None,
			"party": r.party,
			"challan_no": r.challan_no,
			"box": float(r.total_box or 0),
			"out_weight": w if sent else 0.0,
			"in_weight": 0.0 if sent else w,
			"out_bobbin": b if sent else 0.0,
			"in_bobbin": 0.0 if sent else b,
			"balance_weight": round(bal_w, 3),
			"balance_bobbin": round(bal_b, 3),
		})

	return {
		"rows": out,
		"party": party,
		"total_out": round(sum(r["out_weight"] for r in out), 3),
		"total_in": round(sum(r["in_weight"] for r in out), 3),
		"pending_weight": round(bal_w, 3),
		"pending_bobbin": round(bal_b, 3),
	}
