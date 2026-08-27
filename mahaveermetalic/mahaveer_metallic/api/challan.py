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
			# The bobbins entered on the production voucher, carried onto the challan.
			# They were being written onto each LINE (bobbin / pcs / weight per box) but
			# never onto the challan's own bobbin table — which is the one the printed
			# challan's BOBBINS section reads. So the bobbins the operator picked in
			# production came out blank on the paper that goes to the customer, and the
			# whole point of that section is that a missing bobbin gets paid for.
			"bobbins": [
				{"bobbin": b.bobbin, "quality": b.quality, "qty": b.qty, "weight": b.weight}
				for b in (prod.get("bobbins") or [])
			],
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
def in_stock_rolls(item=None, challan_date=None, search=None, roll=None, lot=None, start=0, page_length=10):
	"""Rolls on hand, ROLL BY ROLL, for the left "IN STOCK ROLL" list of the job screen.

	This used to read MM Roll Inventory, which is keyed by (branch, location, lot, colour)
	— one row per inward LINE, with every roll on that line summed into it. So the picker
	offered "WATER 140N S+Z 304.5 kg" where the floor has eleven separate rolls, the Order
	column could never be filled (inventory does not know which order the material came in
	against), and sending three rolls to a worker meant typing a weight rather than picking
	the rolls.

	The rolls themselves are the MM Inward Item rows — the roll cart writes one per roll —
	so that is what is listed. Each row still carries its inventory row, because that is
	what the challan deducts from; the roll is what the operator recognises, the inventory
	row is what the books move.

	Paginated because a real site carries hundreds of rows (the legacy screen shows
	"1 to 10 of 304").
	"""
	conds = [
		"i.docstatus = 1",
		"ifnull(ii.weight, 0) > 0",
		# A goods return's rows are negative and are not stock to send anywhere.
		"ifnull(i.is_gr, 0) = 0",
		# Only what the lot still actually holds — a lot cut, dispatched or already sent to
		# a worker has no rolls left to offer, whatever the inward once said.
		"ifnull(ri.stock_weight, 0) > 0",
	]
	vals = {}
	if item:
		conds.append("ii.color_name = %(item)s")
		vals["item"] = item
	if challan_date:
		conds.append("i.posting_date = %(cd)s")
		vals["cd"] = challan_date
	if search:
		# Operators know a roll by its colour, its roll number, its lot or its challan.
		conds.append(
			"(ii.color_name like %(q)s or ii.roll_name like %(q)s"
			" or ii.lot_number like %(q)s or ii.challan_number like %(q)s)"
		)
		vals["q"] = f"%{search.strip()}%"
	# Roll and lot as filters of their OWN, on top of the catch-all box. A roll number and
	# a lot id are the two things the floor reads off the material in front of them, and
	# the shared box could not answer "roll 3 of lot 25" — it matched either term against
	# every column and returned both rolls of lot 25 and every roll numbered 3.
	if roll and str(roll).strip():
		conds.append("ii.roll_name like %(roll)s")
		vals["roll"] = f"%{str(roll).strip()}%"
	if lot and str(lot).strip():
		conds.append("ii.lot_number like %(lot)s")
		vals["lot"] = f"%{str(lot).strip()}%"
	where = " and ".join(conds)

	# The join that gives each roll its inventory row is the same key MM Inward uses to
	# find or create one (branch, location, lot_number, colour) — see MMInward._find_roll.
	src = """
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		left join `tabMM Roll Inventory` ri
			on ifnull(ri.lot_number, '') = ifnull(ii.lot_number, '')
			and ifnull(ri.color_name, '') = ifnull(ii.color_name, '')
			and ifnull(ri.location, '') = ifnull(i.location, '')
			and ifnull(ri.branch, '') = ifnull(i.branch, '')
	"""

	total = frappe.db.sql(f"select count(*) {src} where {where}", vals)[0][0]

	vals["start"] = frappe.utils.cint(start)
	vals["page_length"] = frappe.utils.cint(page_length) or 10
	rows = frappe.db.sql(
		f"""
		select ri.name as name, ii.name as inward_item,
			ii.roll_name as roll_no, ii.color_name, ii.lot_number, ii.cut,
			i.location, i.branch, ii.customer_order,
			ii.weight as stock_weight, ii.qty_box as stock_box,
			ri.stock_weight as lot_stock_weight,
			ii.challan_number, i.posting_date as challan_date
		{src}
		where {where}
		order by i.posting_date desc, i.creation desc, ii.idx asc
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
	rolls=None, bobbins=None, remark=None, location=None, branch=None, against_job_out=None):
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
	# The colours as INVENTORY holds them — plain text, always present. The row's own
	# `color_name` is a Link and `_valid_colour` blanks it for any shade not in MM Item
	# Master, so a rule written against that silently passes two unknown colours as "both
	# blank, therefore the same".
	raw_shades = set()
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
		if inv.color_name:
			raw_shades.add(inv.color_name)
		location = location or inv.location
		branch = branch or inv.branch

	# ONE COLOUR PER JOB OUT. The worker is sent one shade to work on and sends it back as
	# one shade; two on a single challan cannot be told apart on the way in, because a Job In
	# is reconciled against the Job Out's total weight and nothing carries which part of it
	# was which. Refused here as well as in the screen, so it holds however the call arrives.
	if challan_type == "Job Out" and len(raw_shades) > 1:
		frappe.throw(
			_("A Job Out challan carries ONE colour. These rolls are {0} — raise a separate "
			  "challan for each.").format(", ".join(sorted(raw_shades)))
		)

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
		# A Job In names the Job Out it answers, which is what makes "still with the
		# worker" a per-challan fact rather than a party-level guess.
		"against_job_out": against_job_out if challan_type == "Job In" else None,
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


def _rollup_bobbins(items):
	"""Sum the per-box bobbin lines into the challan's own bobbin table.

	A challan's BOBBINS section answers "how many of each bobbin left the building", which
	is a per-CHALLAN question — the per-box columns cannot answer it without the reader
	adding up a column by hand. Built from the rows so the two can never disagree.
	"""
	out = {}
	for it in items or []:
		name = it.get("bobbin")
		pcs = frappe.utils.flt(it.get("bobbin_pcs") or 0)
		if not name or pcs <= 0:
			continue
		e = out.setdefault(name, {"bobbin": name, "qty": 0.0, "weight": 0.0})
		e["qty"] += pcs
		e["weight"] += frappe.utils.flt(it.get("total_bobbin_weight") or 0)
	for e in out.values():
		e["qty"] = round(e["qty"], 3)
		e["weight"] = round(e["weight"], 3)
		e["quality"] = frappe.db.get_value("MM Bobbin Master", e["bobbin"], "quality")
	return list(out.values())


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
		# Money on the paper that goes out with the goods — nil when nothing is priced,
		# which the print uses to leave the rate columns off entirely rather than ruling
		# two empty ones down a delivery challan.
		"total_amount": doc.get("total_amount") or 0,
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
				"rate": it.get("rate") or 0,
				"amount": it.get("amount") or 0,
				"r_box": it.r_box,
				"r_bobbin": it.r_bobbin,
			}
			for it in doc.items
		],
		# The challan's own bobbin table when it has one; otherwise summed from the rows,
		# so every challan already on file prints its bobbins without a data migration.
		"bobbins": [
			{"bobbin": b.bobbin, "qty": b.qty, "quality": b.quality, "weight": b.weight}
			for b in (doc.get("bobbins") or [])
		] or _rollup_bobbins([it.as_dict() for it in doc.items]),
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
def order_rates(sales_order=None):
	"""What the order prices each colour at, per kg.

	The challan takes its rate from here on save (MMSalesChallan._apply_rates); this is the
	same figure read ahead of time so the picking screen can foot what is being dispatched
	before it is submitted, rather than the operator sending goods and finding out the
	value afterwards.
	"""
	if not sales_order:
		return []
	return [
		{
			"color_name": r.color_name,
			"cut": r.cut,
			"rate": float(r.sale_rate or 0),
		}
		for r in frappe.get_all(
			"MM Sales Order Item",
			filters={"parent": sales_order, "parenttype": "MM Sales Order"},
			fields=["color_name", "cut", "sale_rate"],
		)
		if float(r.sale_rate or 0) > 0
	]


@frappe.whitelist()
def orders_for_challan(party=None):
	"""Orders still available to dispatch against, for the challan's order picker.

	An order goes out on as MANY challans as it takes. This used to drop any order that
	already had one submitted against it — on the reading that a challan meant the order
	had been dispatched — so a 1,200 kg order shipped 300 kg at a time could never be
	picked for its second delivery. An order is offered until the challans standing
	against it COVER it, which is the same test the order's own status is read by.
	"""
	if not party:
		return []
	rows = frappe.db.sql(
		"""
		select so.name, so.transaction_date, so.ordered_weight, so.completion_mode,
			(select group_concat(distinct x.color_name order by x.color_name separator ', ')
			 from `tabMM Sales Order Item` x where x.parent = so.name) as colours
		from `tabMM Sales Order` so
		where so.party = %(party)s
			and so.docstatus = 1
			and ifnull(so.order_state, '') != 'Cancelled'
		-- FIFO: the order that came in first is filled first. This listed the NEWEST
		-- order at the top, so the newest was the one picked by default and the oldest
		-- sank down the list as more arrived — the queue ran backwards.
		--
		-- Tie-broken on `creation`, not `modified`: editing an old order must not shuffle
		-- it to a different place in the queue.
		order by so.transaction_date asc, so.creation asc
		limit 200
		""",
		{"party": party},
		as_dict=True,
	)
	if not rows:
		return []

	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		dispatched_weight_by_order,
		fulfilment_state,
	)
	from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
		get_inward_match_tolerance,
	)

	out_kg = dispatched_weight_by_order([r.name for r in rows])
	tol = get_inward_match_tolerance()
	open_rows = []
	for r in rows:
		sent = out_kg.get(r.name, 0.0)
		if fulfilment_state(r.ordered_weight, sent, r.completion_mode, tol) == "Complete":
			continue
		r["dispatched_weight"] = sent
		# What this order can still take on a challan — the picker shows it, so nobody
		# has to open the order to find out how much of it is left to send.
		r["pending_weight"] = round(max(0.0, float(r.ordered_weight or 0) - sent), 3)
		open_rows.append(r)
	return open_rows


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
	# Job Out / Job In / Job Challan send material to a WORKER, not to the customer, so
	# they never count against what the order has sent — the same exclusion every other
	# dispatch sum applies. Without it a job challan silently ate the order's headroom and
	# a genuine delivery was refused as an over-dispatch.
	dispatched = float(
		frappe.db.sql(
			"""select coalesce(sum(ci.weight), 0)
			from `tabMM Sales Challan Item` ci join `tabMM Sales Challan` c on c.name = ci.parent
			where c.docstatus = 1 and c.name != %(me)s
				and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
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
	# Correcting the weight is a completion-changing event now that the order's status is
	# read off what has gone out: 20 kg keyed as 200 closed the order, and putting it right
	# has to open it back up. Nothing else recounts on this path.
	if is_dispatch(doc.challan_type):
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
			mark_dispatched,
		)

		for o in filter(None, {doc.sales_order} | {it.sales_order for it in doc.items}):
			mark_dispatched(o)
	return {
		"challan": doc.name,
		"total_weight": doc.total_weight,
		"total_box": doc.total_box,
		"cover": _order_cover(order) if order else None,
	}


# ── Job In: what is still out with a worker ───────────────────────────────────────


@frappe.whitelist()
def job_out_options(party=None, search=None, limit=50):
	"""Job Outs for the "Against Job Out" picker on Bobbin / Box tracking.

	A plain Link on MM Sales Challan was wrong twice over. It offered EVERY sales challan —
	the field is named Against Job Out and the list was full of MM-SC-… dispatch challans
	that a bobbin movement can never be booked against — and it showed nothing but the
	document id, so choosing between six of them meant opening each one.

	One row per Job Out, carrying what the floor identifies a challan by: its challan
	number, the party, and the colours and cuts on it. Colour and cut live on the child
	table, which is why this cannot be a get_list and has to be its own endpoint.
	"""
	conds = ["c.docstatus = 1", "c.challan_type = 'Job Out'"]
	vals = {}
	if party:
		conds.append("c.party = %(party)s")
		vals["party"] = party
	if search and str(search).strip():
		# Searchable by every column shown, so what is read off the row can be typed back.
		conds.append(
			"(c.challan_no like %(q)s or c.name like %(q)s or pm.party_name like %(q)s"
			" or exists (select 1 from `tabMM Sales Challan Item` ci"
			"   where ci.parent = c.name and (ci.color_name like %(q)s or ci.cut like %(q)s)))"
		)
		vals["q"] = f"%{str(search).strip()}%"
	vals["limit"] = frappe.utils.cint(limit) or 50
	rows = frappe.db.sql(
		f"""
		select c.name, c.challan_no, c.transaction_date, c.party, c.total_weight,
			pm.party_name,
			(select group_concat(distinct ci.color_name order by ci.color_name separator ', ')
				from `tabMM Sales Challan Item` ci where ci.parent = c.name) as colours,
			(select group_concat(distinct ci.cut order by ci.cut separator ', ')
				from `tabMM Sales Challan Item` ci where ci.parent = c.name and ifnull(ci.cut, '') != '') as cuts
		from `tabMM Sales Challan` c
		left join `tabMM Party Master` pm on pm.name = c.party
		where {" and ".join(conds)}
		order by c.transaction_date desc, c.modified desc
		limit %(limit)s
		""",
		vals,
		as_dict=True,
	)
	return [
		{
			"name": r.name,
			"challan_no": r.challan_no or r.name,
			"date": str(r.transaction_date) if r.transaction_date else None,
			"party": r.party,
			"party_name": r.party_name or r.party,
			"colours": r.colours or "",
			"cuts": r.cuts or "",
			"total_weight": round(float(r.total_weight or 0), 3),
		}
		for r in rows
	]


@frappe.whitelist()
def in_progress_job_outs(challan_date=None, challan_no=None, company=None, item=None,
	party=None, start=0, page_length=10):
	"""Rolls still with a job worker — ROLL BY ROLL, one line each.

	Job In answers a Job Out, so this is the list it picks from — not in-stock rolls,
	which is what went out in the first place. A Job Out is "in progress" until the Job
	Ins booked against it account for its weight; anything still short is with the worker.

	It used to return one line per CHALLAN: the colours comma-joined into a "Roll" column
	that therefore showed a colour rather than a roll, and the challan's total weight
	against it. A Job Out carrying eleven rolls read as a single 1,290 kg line, which is
	the same complaint the Job Out picker had — the operator recognises a ROLL, and cannot
	tell which of them is coming back from a total. Each roll is its own line now, at its
	own weight, and picking any of them still receives against the whole Job Out because
	that is what a Job In reconciles against.

	Job Ins made before `against_job_out` existed name no Job Out, so they cannot be
	credited to one. They are left out of the per-challan figure rather than spread across
	challans arbitrarily — an old Job Out may therefore read as still open. The party-level
	`job_report` remains the answer for the overall balance.
	"""
	conds = ["c.docstatus = 1", "c.challan_type = 'Job Out'"]
	vals = {}
	if challan_date:
		conds.append("c.transaction_date = %(cd)s")
		vals["cd"] = challan_date
	if challan_no:
		conds.append("c.challan_no like %(cn)s")
		vals["cn"] = f"%{challan_no}%"
	if party:
		conds.append("c.party = %(party)s")
		vals["party"] = party
	if company:
		# The screen filters by COMPANY, which sits under a party — resolve it to its
		# party, because that is what the challan carries.
		owner = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)
		conds.append("c.party = %(cparty)s")
		vals["cparty"] = owner or "__none__"
	if item:
		conds.append(
			"exists (select 1 from `tabMM Sales Challan Item` ci"
			" where ci.parent = c.name and ci.color_name = %(item)s)"
		)
		vals["item"] = item
	where = " and ".join(conds)

	rows = frappe.db.sql(
		f"""
		select c.name, c.challan_no, c.transaction_date, c.party, c.total_weight, c.total_box,
			(select group_concat(distinct ci.color_name order by ci.color_name separator ', ')
				from `tabMM Sales Challan Item` ci where ci.parent = c.name) as rolls,
			coalesce((
				select sum(ji.weight) from `tabMM Sales Challan Item` ji
				join `tabMM Sales Challan` jc on jc.name = ji.parent
				where jc.docstatus = 1 and jc.challan_type = 'Job In' and jc.against_job_out = c.name
			), 0) as received_weight
		from `tabMM Sales Challan` c
		where {where}
		order by c.transaction_date desc, c.creation desc
		""",
		vals,
		as_dict=True,
	)
	# Outstanding is decided in Python, not SQL: the same expression would otherwise be
	# repeated in a HAVING and in the select, and drift the day one of them changed.
	open_rows = []
	for r in rows:
		out = round(float(r.total_weight or 0) - float(r.received_weight or 0), 3)
		if out <= 0.0005:
			continue
		r["outstanding_weight"] = out
		open_rows.append(r)

	# …then expand each open challan into the rolls that went out on it.
	by_challan = {r["name"]: r for r in open_rows}
	roll_rows = []
	if by_challan:
		items = frappe.get_all(
			"MM Sales Challan Item",
			filters={"parent": ["in", list(by_challan)], "parenttype": "MM Sales Challan"},
			fields=["name", "parent", "color_name", "cut", "weight", "qty_box", "roll_inventory"],
			order_by="parent asc, idx asc",
			limit_page_length=0,
		)
		# One lookup for every roll on the page rather than one per line. The COLOUR comes
		# from here too, not only the roll number: the challan line's `color_name` is a Link
		# and `_valid_colour` leaves it blank for any shade not in MM Item Master, so the
		# picker showed "—" for exactly the colours nobody had set up as an item.
		inv_names = {i.roll_inventory for i in items if i.roll_inventory}
		inv = {}
		if inv_names:
			inv = {
				x.name: x
				for x in frappe.get_all(
					"MM Roll Inventory", filters={"name": ["in", list(inv_names)]},
					fields=["name", "roll_no", "color_name"],
				)
			}
		for i in items:
			c = by_challan[i.parent]
			roll_rows.append({
				# The Job Out is still the identity for receiving — a Job In answers the
				# challan, not one roll of it — but the LINE is what the operator reads.
				"name": c["name"],
				"line": i.name,
				"challan_no": c["challan_no"],
				"transaction_date": c["transaction_date"],
				"party": c["party"],
				"total_weight": c["total_weight"],
				"total_box": c["total_box"],
				"received_weight": c["received_weight"],
				"outstanding_weight": c["outstanding_weight"],
				"color_name": i.color_name or (inv.get(i.roll_inventory) or {}).get("color_name"),
				"cut": i.cut,
				"roll_no": (inv.get(i.roll_inventory) or {}).get("roll_no"),
				# This roll's own weight, which is what "roll wise" means.
				"weight": round(frappe.utils.flt(i.weight), 3),
				"qty_box": frappe.utils.flt(i.qty_box),
			})

	total = len(roll_rows)
	start = int(start or 0)
	page_length = max(1, int(page_length or 10))
	page = roll_rows[start:start + page_length]

	parties = {r["party"] for r in page if r.get("party")}
	labels = {}
	if parties:
		for p in frappe.get_all(
			"MM Party Master", filters={"name": ["in", list(parties)]}, fields=["name", "party_name"]
		):
			labels[p.name] = p.party_name or p.name
		for pc in frappe.get_all(
			"MM Party Company",
			filters={"parent": ["in", list(parties)], "parenttype": "MM Party Master"},
			fields=["parent", "company_name"],
		):
			# The reference reads "PARTY (COMPANY)" — the worker and the firm they trade as.
			base = labels.get(pc.parent, pc.parent)
			if pc.company_name and pc.company_name != base:
				labels[pc.parent] = f"{base} ({pc.company_name})"
	for r in page:
		r["party_label"] = labels.get(r["party"], r["party"])
	return {"rows": page, "total": total}


@frappe.whitelist()
def job_out_rolls(challan):
	"""The rolls on one Job Out, ready to be brought back in."""
	doc = frappe.get_doc("MM Sales Challan", challan)
	if doc.challan_type != "Job Out":
		frappe.throw(_("{0} is not a Job Out.").format(challan))
	return {
		"challan": doc.name,
		"challan_no": doc.challan_no or doc.name,
		"transaction_date": str(doc.transaction_date or ""),
		"party": doc.party,
		"rows": [
			{
				"roll_inventory": it.roll_inventory,
				"color_name": it.color_name,
				"cut": it.cut,
				"qty_box": it.qty_box,
				"weight": it.weight,
			}
			for it in doc.items
		],
	}


# ── Job In as a PRODUCTION voucher ────────────────────────────────────────────────
# Material sent to a worker does not come back as rolls — it comes back WOUND, in boxes,
# with barcodes and bobbins, exactly like something produced in-house. So Job In is the
# production voucher, run for a job worker.
#
# One thing is inverted, and it is the whole reason this cannot just reuse create_production:
# in-house, the box is weighed on the way OUT and the net is what is left after the packing
# is deducted — Net = Gross − Bobbin − Box. Coming back from a worker the NET is the figure
# that matters and is measured, and the box tare is what falls out of it:
#     Box = Gross − Bobbin − Net
# Same four numbers, solved for the other unknown.


def _job_in_box_rows(boxes, shade):
	"""Map the entered boxes onto MM Production Box rows, deriving the box tare.

	Every row is solved the same way, server-side, rather than trusting whatever the
	screen computed — the two must agree and only one of them can be authoritative.
	"""
	rows = []
	for b in boxes or []:
		gross = frappe.utils.flt(b.get("gross_weight") or 0)
		net = frappe.utils.flt(b.get("net_weight") or 0)
		bob = frappe.utils.flt(b.get("total_bobbin_weight") or 0)
		if not bob:
			bob = round(
				frappe.utils.flt(b.get("bobbin_pcs") or 0) * frappe.utils.flt(b.get("bobbin_pcs_weight") or 0), 3
			)
		box_wt = round(gross - bob - net, 3)
		if box_wt < 0:
			frappe.throw(
				_("A box's net ({0} kg) plus its bobbins ({1} kg) is more than its gross ({2} kg). "
				  "One of the three is keyed wrong.").format(net, bob, gross)
			)
		rows.append({
			"item": b.get("item") or shade,
			"gross_weight": gross,
			"qty": frappe.utils.flt(b.get("qty") or 0),
			"bobbin": b.get("bobbin") or None,
			"bobbin_pcs": frappe.utils.flt(b.get("bobbin_pcs") or 0),
			"bobbin_pcs_weight": frappe.utils.flt(b.get("bobbin_pcs_weight") or 0),
			"total_bobbin_weight": bob,
			"box_weight": box_wt,
			# The measured figure — it is the INPUT here, not the result, which is the whole
			# difference between receiving job work and producing in-house.
			"net_weight": net,
			"box_return": 1 if frappe.utils.cint(b.get("box_return")) else 0,
			"bobbin_return": 1 if frappe.utils.cint(b.get("bobbin_return")) else 0,
		})
	return rows


@frappe.whitelist()
def preview_job_in_box(gross_weight, net_weight, bobbin_pcs=0, bobbin_pcs_weight=0, total_bobbin_weight=0):
	"""The inverted box sum, for the screen — so it shows what the server will store."""
	gross = frappe.utils.flt(gross_weight or 0)
	net = frappe.utils.flt(net_weight or 0)
	bob = frappe.utils.flt(total_bobbin_weight or 0) or round(
		frappe.utils.flt(bobbin_pcs or 0) * frappe.utils.flt(bobbin_pcs_weight or 0), 3
	)
	return {
		"total_bobbin_weight": bob,
		"box_weight": round(gross - bob - net, 3),
		"valid": round(gross - bob - net, 3) >= 0,
	}


@frappe.whitelist()
def create_job_in_production(against_job_out, boxes=None, customer_order=None, party=None,
	posting_date=None, batch_no=None, cut=None, operator=None, shift=None, challan_no=None,
	box_return=0, bobbin_return=0):
	"""Receive a Job Out back as a PRODUCTION voucher, and close the Job Out with a Job In.

	Two records, because they answer two questions the shop asks separately: the production
	is what came back (boxes, barcodes, bobbins, finished-goods stock), and the Job In
	challan is the paperwork that reconciles it against what was sent. Raising only one of
	them would leave either the stock or the worker's balance wrong.

	The production carries `job_work_flag` so every screen that already separates job work
	from own production keeps doing so.
	"""
	if isinstance(boxes, str):
		boxes = json.loads(boxes or "[]")
	if not boxes:
		frappe.throw(_("Add at least one box."))

	jo = frappe.get_doc("MM Sales Challan", against_job_out)
	if jo.challan_type != "Job Out":
		frappe.throw(_("{0} is not a Job Out.").format(against_job_out))
	if jo.docstatus != 1:
		frappe.throw(_("Job Out {0} is not submitted.").format(against_job_out))

	# The shade the worker was given. The challan line carries it only when the colour is a
	# known MM Item Master (challan lines link it, and _valid_colour leaves it blank rather
	# than blocking a dispatch over an unknown shade) — so fall back to the ROLLS the
	# challan referenced, which always carry the colour as plain text. Without this the
	# finished-goods row the production creates has no colour and is refused.
	shade = next((it.color_name for it in jo.items if it.color_name), None)
	if not shade:
		for it in jo.items:
			if it.roll_inventory:
				shade = frappe.db.get_value("MM Roll Inventory", it.roll_inventory, "color_name")
				if shade:
					break
	if not shade:
		frappe.throw(
			_("Job Out {0} has no colour on it, so what came back cannot be filed against one.")
			.format(jo.name)
		)
	rows = _job_in_box_rows(boxes, shade)

	prod = frappe.get_doc({
		"doctype": "MM Production",
		"posting_date": posting_date or frappe.utils.today(),
		"customer_order": customer_order or jo.sales_order or None,
		"party": party or jo.party,
		"shade": shade,
		"cut": cut or next((it.cut for it in jo.items if it.cut), None),
		"branch": jo.branch,
		"location": jo.location,
		"operator": operator or None,
		"shift": shift or None,
		"batch_no": batch_no or None,
		"status": "Completed",
		# What makes this a job receipt rather than own production, everywhere downstream.
		"job_work_flag": 1,
		"box_return": 1 if frappe.utils.cint(box_return) else 0,
		"bobbin_return": 1 if frappe.utils.cint(bobbin_return) else 0,
		# What the worker was sent. The variance gate measures the return against it, which
		# is exactly the question a job receipt asks: did we get back what we sent?
		"input_weight": frappe.utils.flt(jo.total_weight or 0),
		"gross_weight": round(sum(r["gross_weight"] for r in rows), 3),
		"box_qty": len(rows),
		"box_weight": round(sum(r["box_weight"] for r in rows), 3),
		"boxes": rows,
	})
	# Material arriving must not dispatch itself: the production carries the order for
	# attribution, but the goods have just come IN.
	prod.flags.skip_dispatch_challan = True
	prod.insert(ignore_permissions=True)
	prod.submit()

	# …and the Job In that closes the Job Out, so the worker's balance moves with it.
	job_in = create_job_challan(
		challan_type="Job In",
		party=jo.party,
		challan_date=posting_date or frappe.utils.today(),
		challan_no=challan_no or None,
		rolls=json.dumps([
			{"roll_inventory": it.roll_inventory, "weight": it.weight, "cut": it.cut}
			for it in jo.items if it.roll_inventory
		]),
		against_job_out=jo.name,
	)
	return {
		"production": prod.name,
		"job_in": (job_in or {}).get("challan") if isinstance(job_in, dict) else job_in,
		"net_weight": prod.net_weight,
		"variance_percent": prod.variance_percent,
		"boxes": len(rows),
	}


@frappe.whitelist()
def add_job_out_bobbins(challan, bobbins=None):
	"""Send MORE bobbins against a Job Out that has already gone out.

	Bobbins follow the material rather than the paperwork: the rolls leave, and then the
	worker needs another dozen bobbins on Thursday. Until now that meant raising a second
	Job Out for bobbins alone, which put a challan on the party's ledger carrying no
	material and made the roll reconciliation read as if a delivery had been missed.

	The bobbins are appended to the Job Out they belong to, and the ledger is re-posted —
	`post_job_challan` clears the voucher and writes it again from the document, so
	re-posting the whole set is correct rather than double-counting.
	"""
	rows = json.loads(bobbins) if isinstance(bobbins, str) else (bobbins or [])
	rows = [r for r in rows if r.get("bobbin") and frappe.utils.flt(r.get("qty") or 0) > 0]
	if not rows:
		frappe.throw(_("Pick a bobbin and a quantity."))

	doc = frappe.get_doc("MM Sales Challan", challan)
	if doc.challan_type != "Job Out":
		frappe.throw(_("Bobbins can only be added to a Job Out."))
	if doc.docstatus == 2:
		frappe.throw(_("Job Out {0} is cancelled.").format(challan))

	for r in rows:
		master = frappe.db.get_value("MM Bobbin Master", r["bobbin"], ["quality", "weight"], as_dict=True) or {}
		qty = frappe.utils.flt(r["qty"])
		doc.append("bobbins", {
			"bobbin": r["bobbin"],
			"qty": qty,
			"quality": master.get("quality"),
			"weight": round(qty * frappe.utils.flt(master.get("weight") or 0), 3),
		})

	# The document is submitted; these are an addition to it, not a re-approval of it.
	doc.flags.ignore_permissions = True
	doc.flags.ignore_validate_update_after_submit = True
	doc.save()

	from mahaveermetalic.mahaveer_metallic.api.bobbin import post_job_challan

	post_job_challan(doc)
	return {
		"challan": doc.name,
		"bobbins": [{"bobbin": b.bobbin, "qty": b.qty, "weight": b.weight} for b in doc.bobbins],
		"total_qty": round(sum(frappe.utils.flt(b.qty) for b in doc.bobbins), 3),
	}


@frappe.whitelist()
def job_work_hisab(party=None, company=None, from_date=None, to_date=None, open_only=0, limit=200):
	"""The job-work account, one Job Out at a time — the shop's paper register, computed.

	The register works bill by bill: what went out on the left, every receipt against it on
	the right, and what is still owed underneath. This is the same, for job work: the rolls
	SENT (one line each, at the weight that roll went out at) against the rolls RECEIVED,
	and the bobbins sent against the bobbins that came back.

	Bobbins are the reason this cannot be read off the existing party-level job report. They
	go out with one challan and drift back over several, and the shop is owed the difference
	— so it is stated per Job Out, where somebody can act on it, not summed over a party
	where a missing dozen disappears into a year's trading.
	"""
	conds = ["c.docstatus = 1", "c.challan_type = 'Job Out'"]
	vals = {}
	if company and not party:
		party = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)
	if party:
		conds.append("c.party = %(party)s")
		vals["party"] = party
	if from_date:
		conds.append("c.transaction_date >= %(fd)s")
		vals["fd"] = from_date
	if to_date:
		conds.append("c.transaction_date <= %(td)s")
		vals["td"] = to_date

	outs = frappe.db.sql(
		f"""
		select c.name, c.challan_no, c.transaction_date, c.party, c.total_weight,
			pm.party_name
		from `tabMM Sales Challan` c
		left join `tabMM Party Master` pm on pm.name = c.party
		where {" and ".join(conds)}
		order by c.transaction_date desc, c.creation desc
		limit {int(limit)}
		""",
		vals,
		as_dict=True,
	)
	if not outs:
		return {"rows": [], "totals": {"out_weight": 0, "in_weight": 0, "balance_weight": 0,
			"bobbin_out": 0, "bobbin_in": 0, "bobbin_difference": 0}}

	names = [o.name for o in outs]

	# The rolls that went out — one line each, which is what "weight per roll" means.
	rolls = {}
	for r in frappe.get_all(
		"MM Sales Challan Item",
		filters={"parent": ["in", names], "parenttype": "MM Sales Challan"},
		fields=["parent", "color_name", "cut", "weight", "qty_box", "roll_inventory"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	):
		rolls.setdefault(r.parent, []).append({
			"color_name": r.color_name,
			"cut": r.cut,
			"weight": round(frappe.utils.flt(r.weight), 3),
			"qty_box": frappe.utils.flt(r.qty_box),
			# What the roll is called on the floor, which the challan line does not carry.
			"roll_no": frappe.db.get_value("MM Roll Inventory", r.roll_inventory, "roll_no")
			if r.roll_inventory else None,
		})

	# Bobbins sent, per Job Out.
	bob_out = {}
	for b in frappe.get_all(
		"MM Production Bobbin",
		filters={"parent": ["in", names], "parenttype": "MM Sales Challan"},
		fields=["parent", "bobbin", "qty", "weight"],
		limit_page_length=0,
	):
		e = bob_out.setdefault(b.parent, {"rows": [], "qty": 0.0})
		e["rows"].append({"bobbin": b.bobbin, "qty": frappe.utils.flt(b.qty), "weight": frappe.utils.flt(b.weight)})
		e["qty"] += frappe.utils.flt(b.qty)

	# The Job Ins answering each of them. `against_job_out` is what makes this per-challan
	# rather than a guess from dates and party.
	ins = {}
	for c in frappe.get_all(
		"MM Sales Challan",
		filters={"against_job_out": ["in", names], "challan_type": "Job In", "docstatus": 1},
		fields=["name", "challan_no", "transaction_date", "total_weight", "against_job_out"],
		order_by="transaction_date asc, creation asc",
		limit_page_length=0,
	):
		ins.setdefault(c.against_job_out, []).append(c)

	# Bobbins also move on their own, through Bobbin In / Out, against a named Job Out.
	# Counting only the challans' bobbin tables missed every one of those — the shop would
	# send a dozen more bobbins on Thursday and the hisab would still say what went out on
	# Monday. Given adds to what was sent, Received to what came back.
	loose_out, loose_in = {}, {}
	for e in frappe.get_all(
		"MM Bobbin Ledger Entry",
		filters={"against_job_out": ["in", names]},
		fields=["against_job_out", "in_qty", "out_qty"],
		limit_page_length=0,
	):
		jo = e.against_job_out
		loose_out[jo] = loose_out.get(jo, 0.0) + frappe.utils.flt(e.out_qty)
		loose_in[jo] = loose_in.get(jo, 0.0) + frappe.utils.flt(e.in_qty)

	in_names = [c.name for v in ins.values() for c in v]
	bob_in = {}
	if in_names:
		for b in frappe.get_all(
			"MM Production Bobbin",
			filters={"parent": ["in", in_names], "parenttype": "MM Sales Challan"},
			fields=["parent", "qty"],
			limit_page_length=0,
		):
			bob_in[b.parent] = bob_in.get(b.parent, 0.0) + frappe.utils.flt(b.qty)

	rows = []
	t_out = t_in = t_bo = t_bi = 0.0
	for o in outs:
		mine = ins.get(o.name, [])
		in_rows = [{
			"challan": c.name,
			"challan_no": c.challan_no or c.name,
			"date": str(c.transaction_date) if c.transaction_date else None,
			"weight": round(frappe.utils.flt(c.total_weight), 3),
			"bobbin": round(bob_in.get(c.name, 0.0), 3),
		} for c in mine]

		out_w = round(frappe.utils.flt(o.total_weight), 3)
		in_w = round(sum(r["weight"] for r in in_rows), 3)
		# Challan bobbins PLUS anything moved separately against this Job Out.
		b_out = round(bob_out.get(o.name, {}).get("qty", 0.0) + loose_out.get(o.name, 0.0), 3)
		b_in = round(sum(r["bobbin"] for r in in_rows) + loose_in.get(o.name, 0.0), 3)

		row = {
			"job_out": o.name,
			"bill_no": o.challan_no or o.name,
			"date": str(o.transaction_date) if o.transaction_date else None,
			"party": o.party,
			"party_name": o.party_name or o.party,
			"rolls": rolls.get(o.name, []),
			"bobbins_out": bob_out.get(o.name, {}).get("rows", []),
			# Split out so the register can say where a figure came from — the challan it
			# went on, or a bobbin movement raised against it afterwards.
			"bobbin_out_loose": round(loose_out.get(o.name, 0.0), 3),
			"bobbin_in_loose": round(loose_in.get(o.name, 0.0), 3),
			"job_ins": in_rows,
			"out_weight": out_w,
			"in_weight": in_w,
			# What the worker still holds, and what is still owed in bobbins. Negative
			# bobbins mean MORE came back than went — worth seeing, not worth hiding.
			"balance_weight": round(out_w - in_w, 3),
			"bobbin_out": b_out,
			"bobbin_in": b_in,
			"bobbin_difference": round(b_out - b_in, 3),
			"settled": abs(round(out_w - in_w, 3)) < 0.001 and abs(round(b_out - b_in, 3)) < 0.001,
		}
		if frappe.utils.cint(open_only) and row["settled"]:
			continue
		t_out += out_w
		t_in += in_w
		t_bo += b_out
		t_bi += b_in
		rows.append(row)

	return {
		"rows": rows,
		"totals": {
			"out_weight": round(t_out, 3),
			"in_weight": round(t_in, 3),
			"balance_weight": round(t_out - t_in, 3),
			"bobbin_out": round(t_bo, 3),
			"bobbin_in": round(t_bi, 3),
			"bobbin_difference": round(t_bo - t_bi, 3),
		},
	}
