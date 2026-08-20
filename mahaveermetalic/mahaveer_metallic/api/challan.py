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
		select b.name as box, b.barcode, p.name as production, p.posting_date, p.shade as item, p.cut,
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
	# Drop boxes already on a challan — BY BOX, not by production. Excluding the whole
	# production hid every remaining box the moment one of its boxes shipped, and since a
	# production with an order raises its own challan immediately, the list came back empty
	# every time ("Select box not working").
	used_barcodes = set(
		frappe.db.sql_list(
			"""select distinct ci.barcode from `tabMM Sales Challan Item` ci
			join `tabMM Sales Challan` c on c.name = ci.parent
			where c.docstatus < 2 and ifnull(ci.barcode, '') != ''"""
		)
	)
	# Boxes that predate barcoding can only be matched by their production.
	used_productions = set(
		frappe.db.sql_list(
			"""select distinct ci.production from `tabMM Sales Challan Item` ci
			join `tabMM Sales Challan` c on c.name = ci.parent
			where c.docstatus < 2 and ifnull(ci.production, '') != ''
				and ifnull(ci.barcode, '') = ''"""
		)
	)
	out = []
	for r in rows:
		if r.get("barcode") and r["barcode"] in used_barcodes:
			continue
		if not r.get("barcode") and r.production in used_productions:
			continue
		out.append(r)
	return out


@frappe.whitelist()
def create_challan(party=None, sales_order=None, challan_date=None, remark=None,
	job_work=0, boxes=None, rolls=None, challan_no=None, location=None, branch=None,
	challan_type="Sales", **kwargs):
	"""Build a challan by hand from picked produced boxes and/or inventory rolls.

	`challan_type` is the paper being issued — Sales, Job Challan, Challan or Delivery
	Challan — and it decides the numbering series. Only a dispatch type closes the order
	it references (see MMSalesChallan.NON_DISPATCH_TYPES).
	"""
	challan_type = (challan_type or "Sales").strip() or "Sales"
	if challan_type not in SERIES:
		frappe.throw(
			_("Unknown challan type {0}. Choose one of: {1}.").format(
				challan_type, ", ".join(SERIES)
			)
		)
	box_list = json.loads(boxes) if isinstance(boxes, str) else (boxes or [])
	roll_list = json.loads(rolls) if isinstance(rolls, str) else (rolls or [])
	if not box_list and not roll_list:
		frappe.throw(_("Pick at least one box or roll for the challan."))
	if not party:
		frappe.throw(_("Choose the customer."))

	# The order fixes what may go on the challan: dispatching a colour the customer never
	# ordered is a picking mistake, and it silently mis-bills them.
	order_colours = set()
	if sales_order:
		order_colours = {
			c for c in frappe.get_all(
				"MM Sales Order Item", filters={"parent": sales_order, "parenttype": "MM Sales Order"},
				pluck="color_name",
			) if c
		}

	def _check_colour(colour, what):
		if order_colours and colour and colour not in order_colours:
			frappe.throw(
				_("{0} is {1}, but order {2} is for {3}. Pick the ordered colour, or clear the order.").format(
					what, colour, sales_order, ", ".join(sorted(order_colours))
				)
			)

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
		prod = frappe.db.get_value("MM Production", b.parent, ["cut", "location", "branch"], as_dict=True) or {}
		cut = prod.get("cut")
		location = location or prod.get("location")
		branch = branch or prod.get("branch")
		_check_colour(b.item, _("Box {0}").format(b.barcode or name))
		rows.append(_box_row(dict(b, cut=cut), production=b.parent, order=sales_order))
	for name in roll_list:
		r = frappe.db.get_value(
			"MM Roll Inventory", name,
			["color_name", "roll_no", "stock_weight", "stock_box", "location", "branch"], as_dict=True
		)
		if not r:
			continue
		_check_colour(r.color_name, _("Roll {0}").format(r.roll_no or name))
		location = location or r.location
		branch = branch or r.branch
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
			"challan_type": challan_type,
			"naming_series": SERIES[challan_type],
			"transaction_date": challan_date or frappe.utils.today(),
			"party": party,
			"sales_order": sales_order or None,
			"challan_no": challan_no or None,
			"remarks": remark or None,
			"job_work_flag": 1 if frappe.utils.cint(job_work) else 0,
			"location": location,
			"branch": branch,
			"items": rows,
		}
	)
	challan.insert(ignore_permissions=True)
	# Submit it. A hand-built challan used to be left as a DRAFT, so nothing ran: stock
	# never moved, the order was never marked dispatched (it sat on "Material In" even
	# after the goods had gone), and the screen offered no way to complete it. The
	# production and job-work paths have always submitted; this one was the odd one out.
	challan.submit()
	return {
		"challan": challan.name,
		"lines": len(rows),
		"docstatus": challan.docstatus,
		"total_weight": challan.total_weight,
	}


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

# The series each challan type is numbered in. The type IS the choice the operator makes
# on the voucher screen; the series follows from it, so the two can never disagree.
SERIES = {
	"Sales": "MM-SC-.YYYY.-",
	"Job Out": "MM-JO-.YYYY.-",
	"Job In": "MM-JI-.YYYY.-",
	"Job Challan": "MM-JC-.YYYY.-",
	"Challan": "MM-CH-.YYYY.-",
	"Delivery Challan": "MM-DC-.YYYY.-",
}
_JOB_SERIES = SERIES  # kept for the job screens, which only ever index Job Out / Job In


@frappe.whitelist()
def in_stock_rolls(item=None, challan_date=None, search=None, start=0, page_length=10):
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
	if search:
		# Operators know a roll by its colour or its roll number — match either.
		conds.append("(color_name like %(q)s or roll_no like %(q)s or lot_number like %(q)s)")
		vals["q"] = f"%{search.strip()}%"
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
	# Company address and terms are CONFIGURED, never hardcoded: printing an address the
	# shop never gave us would put a wrong one on every delivery. Blank simply omits it.
	settings = frappe.db.get_value(
		"MM Settings", "MM Settings", ["company_address", "challan_terms"], as_dict=True
	) or {}
	return {
		"name": doc.name,
		"challan_type": doc.challan_type or "Sales",
		"challan_no": doc.challan_no or doc.name,
		"company_address": settings.get("company_address") or None,
		"challan_terms": settings.get("challan_terms") or None,
		# The reference challan foots with what comes BACK, counted off the rows.
		"return_box": sum(1 for it in doc.items if frappe.utils.cint(it.get("r_box"))),
		"return_bobbin": sum(
			frappe.utils.flt(it.get("bobbin_pcs") or 0)
			for it in doc.items
			if frappe.utils.cint(it.get("r_bobbin"))
		),
		"total_bobbin": sum(frappe.utils.flt(it.get("bobbin_pcs") or 0) for it in doc.items),
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
				"r_box": it.r_box,
				"r_bobbin": it.r_bobbin,
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


@frappe.whitelist()
def order_colour_names(sales_order=None):
	"""Colours an order is for — the challan pickers filter to these so a roll or box of
	the wrong colour can't be chosen against it in the first place."""
	if not sales_order:
		return []
	return [
		c for c in frappe.get_all(
			"MM Sales Order Item",
			filters={"parent": sales_order, "parenttype": "MM Sales Order"},
			pluck="color_name",
		) if c
	]


@frappe.whitelist()
def orders_for_challan(party=None):
	"""Orders still available to dispatch against, for the challan's order picker.

	An order that already has a submitted Sales challan is dropped: it has been
	dispatched, so offering it again invites a second challan for the same goods.
	"""
	if not party:
		return []
	rows = frappe.db.sql(
		"""
		select so.name, so.transaction_date, so.ordered_weight,
			(select group_concat(distinct x.color_name order by x.color_name separator ', ')
			 from `tabMM Sales Order Item` x where x.parent = so.name) as colours
		from `tabMM Sales Order` so
		where so.party = %(party)s
			and so.docstatus = 1
			and not exists (
				select 1 from `tabMM Sales Challan` c
				left join `tabMM Sales Challan Item` ci on ci.parent = c.name
				where c.docstatus = 1
					and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
					and (c.sales_order = so.name or ci.sales_order = so.name)
			)
		order by so.transaction_date desc, so.modified desc
		limit 200
		""",
		{"party": party},
		as_dict=True,
	)
	return rows


# ── Sales Challan Voucher report ──────────────────────────────────────────────────
# The voucher screen ISSUES a challan; this reads back every one issued and lets a
# weighing mistake be corrected on it. Re-issuing is not an option — the number is
# already with the customer — so the correction happens in place, under the same rules.


def _order_cover(sales_order, exclude_challan=None):
	"""What an order has been inwarded, and what has already left against it.

	`exclude_challan` drops one challan from the dispatched figure, so a challan being
	edited is measured against everything EXCEPT itself — otherwise its own old weight
	counts against its new one and any increase looks like an over-dispatch.
	"""
	if not sales_order:
		return None
	so = frappe.db.get_value(
		"MM Sales Order", sales_order, ["name", "inwarded_weight", "ordered_weight"], as_dict=True
	)
	if not so:
		return None
	dispatched = float(
		frappe.db.sql(
			"""select coalesce(sum(ci.weight), 0)
			from `tabMM Sales Challan Item` ci join `tabMM Sales Challan` c on c.name = ci.parent
			where c.docstatus = 1 and c.name != %(me)s
				and coalesce(nullif(ci.sales_order, ''), c.sales_order) = %(so)s""",
			{"so": sales_order, "me": exclude_challan or ""},
		)[0][0]
		or 0
	)
	inwarded = float(so.inwarded_weight or 0)
	return {
		"sales_order": so.name,
		"ordered_weight": round(float(so.ordered_weight or 0), 3),
		"inwarded_weight": round(inwarded, 3),
		"dispatched_weight": round(dispatched, 3),
		"balance_weight": round(inwarded - dispatched, 3),
	}


@frappe.whitelist()
def challan_report(from_date=None, to_date=None, party=None, challan_type=None, sales_order=None, limit=300):
	"""Every challan issued, newest first, with its order's dispatch balance beside it."""
	conds = ["c.docstatus < 2"]
	vals = {}
	if from_date:
		conds.append("c.transaction_date >= %(fd)s")
		vals["fd"] = from_date
	if to_date:
		conds.append("c.transaction_date <= %(td)s")
		vals["td"] = to_date
	if party:
		conds.append("c.party = %(party)s")
		vals["party"] = party
	if challan_type:
		conds.append("c.challan_type = %(ct)s")
		vals["ct"] = challan_type
	if sales_order:
		conds.append("c.sales_order = %(so)s")
		vals["so"] = sales_order

	rows = frappe.db.sql(
		f"""
		select c.name, c.challan_type, c.challan_no, c.transaction_date, c.party,
			c.sales_order, c.total_box, c.total_weight, c.docstatus, c.job_work_flag,
			-- `lines` is reserved in MariaDB; naming it that failed the whole query.
			(select count(*) from `tabMM Sales Challan Item` ci where ci.parent = c.name) as line_count
		from `tabMM Sales Challan` c
		where {" and ".join(conds)}
		order by c.transaction_date desc, c.creation desc
		limit {int(limit or 300)}
		""",
		vals,
		as_dict=True,
	)
	names = {r.party for r in rows if r.party}
	party_names = {}
	if names:
		for p in frappe.get_all(
			"MM Party Master", filters={"name": ["in", list(names)]}, fields=["name", "party_name"]
		):
			party_names[p.name] = p.party_name or p.name
	# One cover lookup per ORDER, not per row — a party's twenty challans share one order.
	covers = {}
	for r in rows:
		r["party_name"] = party_names.get(r.party, r.party)
		if r.sales_order and r.sales_order not in covers:
			covers[r.sales_order] = _order_cover(r.sales_order)
		r["cover"] = covers.get(r.sales_order)
	return rows


@frappe.whitelist()
def challan_lines(challan):
	"""The editable rows of one challan, plus the order cover its weights must fit."""
	doc = frappe.get_doc("MM Sales Challan", challan)
	return {
		"challan": doc.name,
		"challan_no": doc.challan_no or doc.name,
		"challan_type": doc.challan_type,
		"transaction_date": str(doc.transaction_date or ""),
		"party": doc.party,
		"sales_order": doc.sales_order,
		"docstatus": doc.docstatus,
		"total_box": doc.total_box,
		"total_weight": doc.total_weight,
		# Measured WITHOUT this challan, so its own rows don't count against themselves.
		"cover": _order_cover(doc.sales_order, exclude_challan=doc.name),
		"items": [
			{
				"name": it.name,
				"idx": it.idx,
				"barcode": it.barcode,
				"color_name": it.color_name,
				"cut": it.cut,
				"qty_box": it.qty_box,
				"gross_weight": it.gross_weight,
				"bobbin": it.bobbin,
				"bobbin_pcs": it.bobbin_pcs,
				"bobbin_pcs_weight": it.bobbin_pcs_weight,
				"total_bobbin_weight": it.total_bobbin_weight,
				"box_weight": it.box_weight,
				"net_weight": it.net_weight,
				"weight": it.weight,
				"r_box": it.r_box,
				"r_bobbin": it.r_bobbin,
				"sales_order": it.sales_order,
			}
			for it in doc.items
		],
	}


@frappe.whitelist()
def update_challan_weights(challan, lines):
	"""Correct the weights on an already-issued challan.

	A weighing mistake is found after the paper has gone out, and re-issuing is not an
	option — the number is already with the customer. So only the WEIGHTS move: which
	boxes are on the challan, and which order it answers, are fixed here.

	The inward cover still has to hold. A challan can never send out more than the order
	took in, and that rule does not soften because the challan is being corrected rather
	than created — it is re-checked against everything dispatched on OTHER challans, so a
	correction is measured against the same ceiling a new challan would be.

	Totals are recomputed from the corrected rows and written through the document, so the
	order's dispatched figure — and the balance the report shows — move with them.
	"""
	rows = json.loads(lines) if isinstance(lines, str) else (lines or [])
	if not rows:
		frappe.throw(_("Nothing to update."))
	doc = frappe.get_doc("MM Sales Challan", challan)
	if doc.docstatus == 2:
		frappe.throw(_("Challan {0} is cancelled — its weights can no longer be corrected.").format(doc.name))

	by_name = {str(r.get("name")): r for r in rows if r.get("name")}
	unknown = [n for n in by_name if not any(it.name == n for it in doc.items)]
	if unknown:
		frappe.throw(_("These rows are not on challan {0}: {1}").format(doc.name, ", ".join(unknown)))

	new_total = 0.0
	for it in doc.items:
		r = by_name.get(it.name)
		if r is not None:
			net = frappe.utils.flt(r.get("net_weight", it.net_weight))
			if net < 0:
				frappe.throw(_("Row #{0}: weight cannot be negative.").format(it.idx))
			it.net_weight = net
			# `weight` is the dispatch figure every balance is summed from; net is what the
			# box actually holds. They are the same number here and must stay in step, or
			# the report and the order would disagree about what left.
			it.weight = net
			if r.get("gross_weight") is not None:
				it.gross_weight = frappe.utils.flt(r.get("gross_weight"))
			if r.get("box_weight") is not None:
				it.box_weight = frappe.utils.flt(r.get("box_weight"))
			if r.get("r_box") is not None:
				it.r_box = 1 if frappe.utils.cint(r.get("r_box")) else 0
			if r.get("r_bobbin") is not None:
				it.r_bobbin = 1 if frappe.utils.cint(r.get("r_bobbin")) else 0
		new_total += float(it.weight or 0)

	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_challan.mm_sales_challan import is_dispatch

	order = doc.sales_order or next((it.sales_order for it in doc.items if it.sales_order), None)
	# A job challan sends material to a worker, so it never eats the customer's cover.
	if order and is_dispatch(doc.challan_type):
		cover = _order_cover(order, exclude_challan=doc.name)
		if cover and cover["inwarded_weight"] > 0:
			available = round(cover["inwarded_weight"] - cover["dispatched_weight"], 3)
			if round(new_total, 3) > available:
				frappe.throw(
					_(
						"{0} kg is more than order {1} can still send out. It has taken in "
						"{2} kg, {3} kg has already gone on other challans, so {4} kg is left."
					).format(
						round(new_total, 3), order, cover["inwarded_weight"],
						cover["dispatched_weight"], available,
					)
				)

	doc.total_weight = round(new_total, 3)
	doc.total_box = round(sum(float(i.qty_box or 0) for i in doc.items), 3)
	# A submitted challan is not re-validated by save(); write the corrected rows through
	# directly so the correction lands whether it is a draft or already issued.
	for it in doc.items:
		frappe.db.set_value(
			"MM Sales Challan Item", it.name,
			{
				"net_weight": it.net_weight, "weight": it.weight,
				"gross_weight": it.gross_weight, "box_weight": it.box_weight,
				"r_box": it.r_box, "r_bobbin": it.r_bobbin,
			},
			update_modified=False,
		)
	frappe.db.set_value(
		"MM Sales Challan", doc.name,
		{"total_weight": doc.total_weight, "total_box": doc.total_box},
		update_modified=True,
	)
	return {
		"challan": doc.name,
		"total_weight": doc.total_weight,
		"total_box": doc.total_box,
		"cover": _order_cover(order) if order else None,
	}
