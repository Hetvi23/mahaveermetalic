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
import re

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
		# THE RETURN TICKS, WHICH THE TWO TABLES SPELL DIFFERENTLY. The production box
		# calls them box_return / bobbin_return; the challan line calls them r_box /
		# r_bobbin. Nothing mapped between the two, so the operator ticked "this box's
		# packaging comes back" on the voucher and the printed challan said "Return No. of
		# Box: 0 — No. of Bobbin: 0" every single time, on the one line that tells the
		# customer what they are holding on to and are liable for.
		"r_box": 1 if frappe.utils.cint(b.get("box_return")) else 0,
		"r_bobbin": 1 if frappe.utils.cint(b.get("bobbin_return")) else 0,
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
			# Stated, not inherited: this used to be left blank and take whichever series
			# happened to be first in the Select, which is a numbering scheme held together
			# by the order of a list.
			"challan_type": "Sales",
			"naming_series": SERIES["Sales"],
			"transaction_date": prod.posting_date or frappe.utils.today(),
			"party": prod.party,
			"sales_order": prod.customer_order,
			"branch": prod.branch,
			"location": prod.location,
			"source_production": prod.name,
			"job_work_flag": prod.job_work_flag,
			# Carried from the voucher: the challan is the dispatch, so whoever the
			# production named as taking it out is who this challan went with.
			"delivery_by": prod.get("delivery_by"),
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
	challan_type="Sales", delivery_by=None, challan_id=None, **kwargs):
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

	# A SALE IS AGAINST AN ORDER. Rolls were going out on Sales challans with no order on
	# them at all: nothing was billed against, the order's dispatch cover was never
	# touched, and the material simply left. The other types are deliberately free of this
	# — a plain Challan or Delivery Challan is how stock moves without a sale behind it,
	# and that is what they are for.
	if (challan_type or "Sales") == "Sales" and not sales_order:
		frappe.throw(
			_(
				"Pick the order this is being sent against. To move stock with no sale behind "
				"it, raise a Delivery Challan instead."
			)
		)

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
			"delivery_by": (delivery_by or "").strip() or None,
			"location": location,
			"branch": branch,
			"items": rows,
		}
	)
	challan.flags.manual_id = _challan_id(challan_id, challan_type, challan.transaction_date)
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
	"Sales": "MMUSC-.YYYY.-",
	"Job Out": "MMUJO-.YYYY.-",
	"Job In": "MMUJI-.YYYY.-",
	"Job Challan": "MMUJC-.YYYY.-",
	"Challan": "MMUCH-.YYYY.-",
	"Delivery Challan": "MMUDC-.YYYY.-",
	# A Roll Challan sends rolls to the customer against their order, so it is a DISPATCH:
	# it moves stock out and counts toward what the order has had. That falls out of
	# NON_DISPATCH_TYPES listing only the job types, which is why nothing is added there —
	# see the note on that list before changing it.
	"Roll Challan": "MMURC-.YYYY.-",
}
# Challans issued before the MMU numbering. Nothing writes these any more; they are kept
# on the doctype's Select so the documents already carrying them stay valid.
LEGACY_SERIES = (
	"MM-SC-.YYYY.-", "MM-JO-.YYYY.-", "MM-JI-.YYYY.-",
	"MM-JC-.YYYY.-", "MM-CH-.YYYY.-", "MM-DC-.YYYY.-",
)
_JOB_SERIES = SERIES  # kept for the job screens, which only ever index Job Out / Job In


def _series_shape(series):
	"""`MMPROD-.#####` → a pattern matching every name that series can ever produce."""
	parts, has_number = [], False
	for part in series.split("."):
		if part and set(part) == {"#"}:
			parts.append(r"\d+")
			has_number = True
		elif part in ("YYYY",):
			parts.append(r"\d{4}")
		elif part in ("YY", "MM", "DD"):
			parts.append(r"\d{2}")
		else:
			parts.append(re.escape(part))
	return re.compile("".join(parts) + ("" if has_number else r"\d+"), re.IGNORECASE)


def _manual_id(doctype, value, series):
	"""A voucher number typed by hand in place of the series — checked, or None.

	Blank means the series numbers it as before. Refused before anything is created: an ID
	another document already has, and one shaped like the series itself (`MMPROD-00099`),
	which the series would reach later and fail on.
	"""
	value = (value or "").strip()
	if not value:
		return None
	if _series_shape(series).fullmatch(value):
		frappe.throw(
			_("{0} looks like an automatic number. Type a different number, or leave it blank.")
			.format(value)
		)
	if frappe.db.exists(doctype, value):
		frappe.throw(_("{0} {1} already exists.").format(_(doctype), value))
	return value


def _series_key(series, fallback):
	"""The challan series picked on the voucher — a SERIES key — or the type's own."""
	key = (series or "").strip() or fallback
	if key not in SERIES:
		frappe.throw(_("Unknown challan series {0}.").format(key))
	return key


def _challan_id(value, series_key, on=None):
	"""A typed challan number, filed as the shop's book writes it: MMUJI-123-26/27.

	The series code, the number, and the financial year of the challan date — so the same
	123 can run again in another series or another year, and the ID says which book and
	which year it came from. Blank returns None and the series numbers it as before.
	Typing the full ID (MMUJI-123-26/27) instead of the number is taken as that number.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_lot.mm_lot import financial_year

	value = (value or "").strip()
	if not value:
		return None
	code = SERIES[series_key].split("-")[0]
	fy = financial_year(frappe.utils.getdate(on or frappe.utils.today())).replace("-", "/")
	whole = re.fullmatch(rf"{code}-(.+)-\d{{2}}/\d{{2}}", value, re.IGNORECASE)
	if whole:
		value = whole.group(1).strip()
	name = f"{code}-{value}-{fy}"
	taken = frappe.db.get_value("MM Sales Challan", name, ["name", "challan_type"], as_dict=True)
	if taken:
		frappe.throw(_("Challan ID {0} is already used by a {1} challan.").format(taken.name, taken.challan_type))
	return name


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
		# …and not a roll a live program has booked. Planning books a roll without
		# consuming it, so it sits here looking free and could be sent out from under the
		# program that is waiting to cut it. The Program and Cutting pickers exclude these
		# too; this one is the last way in.
		"""ri.name not in (
			select p.roll_inventory from `tabMM Program` p
			where p.docstatus < 2 and ifnull(p.roll_inventory, '') != ''
				and ifnull(p.closed, 0) = 0 and ifnull(p.status, '') != 'Completed'
		)""",
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

	# The join that gives each roll its inventory row, on the same key MM Inward uses to
	# find or create one — see MMInward._find_roll, which now includes the ROLL.
	#
	# The roll matters here because `ri.name` is what a picked row is IDENTIFIED by
	# downstream: joined lot-wise, every roll of a lot resolved to the one lot row, so
	# selecting a single roll on the Sales Voucher put the whole lot on the challan.
	#
	# The NOT EXISTS arm is for stock received BEFORE the key included the roll: those
	# rows are merged under the first roll's name, so no per-roll row exists to match and
	# a plain equality join would drop them from the picker entirely. Where a row for this
	# roll does exist, that arm is false and the exact match wins — so a lot cannot match
	# twice and the join stays one-to-one.
	src = """
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		left join `tabMM Roll Inventory` ri
			on ifnull(ri.lot_number, '') = ifnull(ii.lot_number, '')
			and ifnull(ri.color_name, '') = ifnull(ii.color_name, '')
			and ifnull(ri.location, '') = ifnull(i.location, '')
			and ifnull(ri.branch, '') = ifnull(i.branch, '')
			and (
				ifnull(ri.roll_no, '') = ifnull(ii.roll_name, '')
				or not exists (
					select 1 from `tabMM Roll Inventory` r2
					where ifnull(r2.lot_number, '') = ifnull(ii.lot_number, '')
						and ifnull(r2.color_name, '') = ifnull(ii.color_name, '')
						and ifnull(r2.location, '') = ifnull(i.location, '')
						and ifnull(r2.branch, '') = ifnull(i.branch, '')
						and ifnull(r2.roll_no, '') = ifnull(ii.roll_name, '')
				)
			)
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
	rolls=None, bobbins=None, remark=None, location=None, branch=None, against_job_out=None,
	items=None, delivery_by=None, sales_order=None, challan_id=None, challan_series=None):
	"""Create a Job Out / Job In challan from the picked rolls and bobbins.

	Stock and the bobbin ledger both move on submit (see MMSalesChallan.on_submit), so
	the challan is submitted straight away — the job material has physically moved.

	`items` is the other shape this document comes in: ready-built challan lines, used by
	the Job In receipt, where what comes back is BOXES and not the rolls that went out.
	A Job In was being rebuilt from its Job Out's roll lines, so it carried the weight
	that was SENT and none of the box detail that was received — no barcode, no box tare,
	no bobbin count, and no return ticks. Given `items`, those lines are the challan.
	"""
	if challan_type not in ("Job Out", "Job In"):
		frappe.throw(_("Challan type must be Job Out or Job In."))
	if not party:
		frappe.throw(_("Choose the party."))
	roll_list = json.loads(rolls) if isinstance(rolls, str) else (rolls or [])
	bob_list = json.loads(bobbins) if isinstance(bobbins, str) else (bobbins or [])
	item_list = json.loads(items) if isinstance(items, str) else (items or [])
	if not roll_list and not bob_list and not item_list:
		frappe.throw(_("Add at least one roll or bobbin to the challan."))

	rows = list(item_list)
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
		# The book this challan is written in — its own type's unless the voucher picked another.
		"naming_series": SERIES[_series_key(challan_series, challan_type)],
		"challan_type": challan_type,
		"transaction_date": challan_date or frappe.utils.today(),
		"party": party,
		"challan_no": challan_no or None,
		"remarks": remark or None,
		"job_work_flag": 1,
		"delivery_by": (delivery_by or "").strip() or None,
		# WHOSE order this material belongs to. `party` above stays the WORKER — job_report
		# runs its balance per party across the Job Out / Job In pair, so repointing it at
		# the customer would leave the worker holding the material for ever. The order is
		# how the customer is reached instead, and a job challan is not a dispatch, so
		# naming one here cannot mark it delivered (see NON_DISPATCH_TYPES).
		"sales_order": (sales_order or "").strip() or None,
		"location": location,
		"branch": branch,
		# A Job In names the Job Out it answers, which is what makes "still with the
		# worker" a per-challan fact rather than a party-level guess.
		"against_job_out": against_job_out if challan_type == "Job In" else None,
		"items": rows,
		"bobbins": bobbin_rows,
	})
	challan.flags.manual_id = _challan_id(
		challan_id, _series_key(challan_series, challan_type), challan.transaction_date
	)
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


def _challan_lot_keys(doc) -> set:
	"""(colour, printed lot id) for every row on a challan, however the row was raised.

	The two creation paths reach a lot by different links and neither sets the other's: a
	challan raised from a production carries `production` (MM Production.lot, a Link to MM
	Lot), and one picked off stock carries `roll_inventory` (lot_number, the printed id).
	Both are resolved to the PRINTED id — LT12/26-27 — so the two paths can be compared
	against each other and against history.
	"""
	prods = {it.get("production") for it in doc.items if it.get("production")}
	invs = {it.get("roll_inventory") for it in doc.items if it.get("roll_inventory")}
	by_prod, by_inv = {}, {}
	if prods:
		by_prod = {
			r[0]: r[1]
			for r in frappe.db.sql(
				"""select p.name, l.lot_id from `tabMM Production` p
				left join `tabMM Lot` l on l.name = p.lot where p.name in %s""",
				(tuple(prods),),
			)
		}
	if invs:
		by_inv = {
			r[0]: r[1]
			for r in frappe.db.sql(
				"select name, lot_number from `tabMM Roll Inventory` where name in %s",
				(tuple(invs),),
			)
		}
	keys = set()
	for it in doc.items:
		lot = by_inv.get(it.get("roll_inventory")) or by_prod.get(it.get("production"))
		if lot:
			keys.add(((it.color_name or "").strip(), str(lot).strip()))
	return keys


def new_lots_for_party(doc) -> list:
	"""Lots on this challan that this PARTY has never been sent before.

	The printed terms tell the weaver to use material lot to lot, so the one thing that has
	to shout off the top of the page is that the lot has CHANGED. Scoped to the PARTY, not
	to the order: two customers drawing from the same lot are each told when their own
	supply moves on, and a party who has already woven with a lot is not warned about it
	again just because a new order started.

	Compared per COLOUR, because a lot is one colour of material — a party taking silver
	from one lot and gold from another has not had a lot change, they have two products.

	Only DISPATCH paper counts, on both sides. Job Out, Job In and Job Challan are material
	moving to and from a job worker, not goods sold — asking `== "Job In"` here was the
	fifth place in this codebase to spell that rule by hand, which is what
	NON_DISPATCH_TYPES exists to stop. It also let job paper poison the history: a roll of
	LT2 sent to a party on a Job Out made the first genuine SALE of LT2 to them read as a
	lot they already had, and the mark this feature exists for never printed.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_challan.mm_sales_challan import (
		NON_DISPATCH_TYPES,
		is_dispatch,
	)

	if not is_dispatch(doc.get("challan_type")) or not doc.get("party"):
		return []
	keys = _challan_lot_keys(doc)
	if not keys:
		return []
	had = set()
	for r in frappe.db.sql(
		"""select distinct ci.color_name as colour,
			coalesce(nullif(ri.lot_number, ''), l.lot_id) as lot
		from `tabMM Sales Challan Item` ci
		join `tabMM Sales Challan` c on c.name = ci.parent
		left join `tabMM Roll Inventory` ri on ri.name = ci.roll_inventory
		left join `tabMM Production` p on p.name = ci.production
		left join `tabMM Lot` l on l.name = p.lot
		where c.party = %(party)s and c.docstatus = 1
			and c.challan_type not in %(skip)s
			and c.name != %(name)s and c.creation < %(creation)s""",
		{
			"party": doc.party, "name": doc.name, "creation": doc.creation,
			"skip": NON_DISPATCH_TYPES,
		},
		as_dict=True,
	):
		if r.lot:
			had.add(((r.colour or "").strip(), str(r.lot).strip()))
	return sorted({lot for colour, lot in keys if (colour, lot) not in had})


def _customer_block(doc):
	"""The customer behind a challan's order — name, address, phone.

	Only worth adding when it says something the paper does not already: on a Sales challan
	the party IS the customer and repeating them would print the same name twice.
	"""
	order = doc.sales_order or next((it.sales_order for it in doc.items if it.sales_order), None)
	if not order:
		return {}
	customer = frappe.db.get_value("MM Sales Order", order, "party")
	if not customer or customer == doc.party:
		return {}
	row = frappe.db.get_value(
		"MM Party Master", customer, ["party_name", "address", "mobile_number"], as_dict=True
	) or {}
	return {
		"customer": customer,
		"customer_name": row.get("party_name") or customer,
		"customer_address": row.get("address"),
		"customer_mobile": row.get("mobile_number"),
	}


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
	# Whether the material on this paper is a lot the customer has not had before — the
	# warning the printed terms already imply ("use material lot to lot") but never raised.
	new_lots = new_lots_for_party(doc)
	return {
		"name": doc.name,
		"challan_type": doc.challan_type or "Sales",
		"new_lot": 1 if new_lots else 0,
		"new_lots": new_lots,
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
		# On a job challan `party` is the WORKER, so the customer would otherwise appear
		# nowhere on the paper. Read off the order the challan names; absent on anything
		# with no order behind it, which the print renders by leaving the row out.
		**_customer_block(doc),
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
def production_box_labels(production):
	"""The box labels a production minted — read off its OWN boxes.

	`challan_for_production` answers from the dispatch challan a production raises, and a
	JOB IN production raises none on purpose: material coming back from a worker must not
	dispatch itself the moment it arrives. So a received box had a real barcode stamped on
	it (MMProduction._assign_box_barcodes) and no way on earth to print it — the labels
	source every screen used simply returned nothing.

	Shaped like `challan_for_print` so the sticker builder takes it unchanged; the cut and
	the colour come off the production where the box row does not carry its own.
	"""
	if not production or not frappe.db.exists("MM Production", production):
		return None
	prod = frappe.db.get_value(
		"MM Production", production,
		["posting_date", "shade", "cut", "batch_no", "operator"], as_dict=True,
	)
	rows = frappe.get_all(
		"MM Production Box",
		filters={"parent": production},
		fields=["barcode", "item", "gross_weight", "box_weight", "total_bobbin_weight",
			"net_weight", "bobbin_pcs"],
		order_by="idx",
	)
	return {
		"transaction_date": str(prod.posting_date) if prod.posting_date else None,
		"batch_no": prod.batch_no,
		"operator": prod.operator,
		"items": [
			{
				"barcode": r.barcode,
				"color_name": r.item or prod.shade,
				"cut": prod.cut,
				"gross_weight": r.gross_weight,
				"box_weight": r.box_weight,
				"total_bobbin_weight": r.total_bobbin_weight,
				"net_weight": r.net_weight,
				"bobbin_pcs": r.bobbin_pcs,
			}
			for r in rows
		],
	}


@frappe.whitelist()
def job_report(party=None, from_date=None, to_date=None, company=None):
	"""Job work report: what went out, what came back, and what is still with the worker.

	Balance is per party — Job Out minus Job In — so an outstanding balance is material
	the job worker still holds. Bobbins are tracked the same way alongside the weight.

	The worker is read off the JOB OUT. A Job In received against an order is filed under
	that order's customer, so its own party is not the worker — counted by it, the receipt
	would never come off the worker's balance.
	"""
	if company and not party:
		party = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)

	worker = "coalesce(jo.party, c.party)"
	conds = ["c.docstatus = 1", "c.challan_type in ('Job Out', 'Job In')"]
	vals = {}
	if party:
		conds.append(f"{worker} = %(party)s")
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
		select c.name, c.challan_type, c.transaction_date, {worker} as party, c.challan_no,
			c.total_box, c.total_weight,
			(select coalesce(sum(b.qty), 0) from `tabMM Production Bobbin` b
			 where b.parent = c.name and b.parenttype = 'MM Sales Challan') as bobbin_qty
		from `tabMM Sales Challan` c
		left join `tabMM Sales Challan` jo
			on c.challan_type = 'Job In' and jo.name = c.against_job_out
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
	# NO PARTY IS NOT AN ERROR, IT IS A STARTING POINT. The floor identifies a dispatch by
	# its ORDER — that is the number on the paperwork in the operator's hand — and this
	# used to return nothing without a customer, so the screen greyed the Order box out and
	# told them to go and find the customer first. Picking the order names the customer,
	# not the other way round; the party is a filter when they have one, not a gate.
	rows = frappe.db.sql(
		"""
		select so.name, so.party, so.transaction_date, so.ordered_weight, so.ordered_box, so.completion_mode,
			pm.party_name,
			(select group_concat(distinct x.color_name order by x.color_name separator ', ')
			 from `tabMM Sales Order Item` x where x.parent = so.name) as colours
		from `tabMM Sales Order` so
		left join `tabMM Party Master` pm on pm.name = so.party
		where (%(party)s is null or %(party)s = '' or so.party = %(party)s)
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
		{"party": party or None},
		as_dict=True,
	)
	if not rows:
		return []

	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		dispatched_by_order,
		fulfilment_state,
	)
	from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
		get_inward_match_tolerance,
	)

	out_by = dispatched_by_order([r.name for r in rows])
	tol = get_inward_match_tolerance()
	open_rows = []
	for r in rows:
		went = out_by.get(r.name) or {"weight": 0.0, "box": 0.0}
		sent = went["weight"]
		# Judged in whichever unit the order was placed in — a box order that is one box
		# short is still open, however close its kilos happen to land.
		if fulfilment_state(r.ordered_weight, sent, r.completion_mode, tol,
			ordered_box=r.get("ordered_box"), dispatched_box=went["box"]) == "Complete":
			continue
		r["dispatched_weight"] = sent
		r["dispatched_box"] = went["box"]
		# What this order can still take on a challan — the picker shows it, so nobody
		# has to open the order to find out how much of it is left to send.
		r["pending_weight"] = round(max(0.0, float(r.ordered_weight or 0) - sent), 3)
		r["pending_box"] = round(max(0.0, float(r.get("ordered_box") or 0) - went["box"]), 3)
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


def _job_balances(rows):
	"""Job work read the way the worker's book reads it: sent, received back, still with them.

	Keyed by challan. A Job Out gets its whole story so far; a Job In gets the balance as it
	stood once THAT receipt was booked (receipts against the same Job Out, by date and then
	entry order), so a Job Out answered three times reads down the register like a ledger.
	Every receipt counts whatever the report is filtered to — a balance is not a period
	figure. A Job In from before `against_job_out` names no Job Out and gets nothing, the
	same rule the Job In picker applies.
	"""
	job_outs = {r.name for r in rows if r.challan_type == "Job Out"}
	job_outs |= {r.against_job_out for r in rows if r.challan_type == "Job In" and r.get("against_job_out")}
	if not job_outs:
		return {}
	sent = dict(frappe.get_all(
		"MM Sales Challan", filters={"name": ["in", list(job_outs)]}, fields=["name", "total_weight"], as_list=True,
	))
	receipts = frappe.get_all(
		"MM Sales Challan",
		filters={"challan_type": "Job In", "docstatus": 1, "against_job_out": ["in", list(job_outs)]},
		fields=["name", "against_job_out", "total_weight"],
		order_by="transaction_date asc, creation asc",
	)
	out, received = {}, {}
	for ji in receipts:
		received[ji.against_job_out] = round(received.get(ji.against_job_out, 0) + float(ji.total_weight or 0), 3)
		out[ji.name] = (ji.against_job_out, received[ji.against_job_out])

	def figures(job_out, got):
		s = round(float(sent.get(job_out) or 0), 3)
		return {"job_out": job_out, "sent": s, "received": got, "balance": round(s - got, 3)}

	result = {}
	for r in rows:
		if r.challan_type == "Job Out":
			result[r.name] = figures(r.name, received.get(r.name, 0))
		elif r.challan_type == "Job In" and r.name in out:
			result[r.name] = figures(*out[r.name])
	return result


@frappe.whitelist()
def challan_report(from_date=None, to_date=None, party=None, challan_type=None, sales_order=None, limit=300):
	"""Every challan issued, newest first, with its order's dispatch balance beside it —
	or, on a Job Out / Job In, the job's own balance (see _job_balances).

	Unfiltered, it is the SALES CHALLAN register: Sales and Job Challan only, the two books
	that go to the customer. Job Out / Job In, roll and delivery challans are their own
	paperwork and show only when their type is picked.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_challan.mm_sales_challan import is_dispatch

	conds = ["c.docstatus < 2"]
	vals = {}
	if not challan_type:
		# ifnull, like every other challan_type test in the app: a challan saved before the
		# field existed carries NULL and IS a sales challan — matched plainly it would drop
		# out of its own register.
		conds.append("ifnull(c.challan_type, 'Sales') in ('Sales', 'Job Challan')")
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
			c.sales_order, c.total_box, c.total_weight, c.docstatus, c.job_work_flag, c.against_job_out,
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
	# The COLOUR on each challan. One grouped query for the whole page, never one per row —
	# the register runs to hundreds of challans. A challan carrying several colours names
	# them all: it is what the floor reads to tell two dispatches to the same party apart,
	# and collapsing it to the first would make them look identical.
	colours = {}
	if rows:
		for ci in frappe.db.sql(
			"""
			select ci.parent, ci.color_name
			from `tabMM Sales Challan Item` ci
			where ci.parent in %(n)s and ifnull(ci.color_name, '') != ''
			order by ci.parent, ci.idx
			""",
			{"n": tuple(r.name for r in rows)},
			as_dict=True,
		):
			bucket = colours.setdefault(ci.parent, [])
			if ci.color_name not in bucket:
				bucket.append(ci.color_name)

	names = {r.party for r in rows if r.party}
	party_names = {}
	if names:
		for p in frappe.get_all(
			"MM Party Master", filters={"name": ["in", list(names)]}, fields=["name", "party_name"]
		):
			party_names[p.name] = p.party_name or p.name
	jobs = _job_balances(rows)
	# One cover lookup per ORDER, not per row — a party's twenty challans share one order.
	covers = {}
	for r in rows:
		r["party_name"] = party_names.get(r.party, r.party)
		r["colours"] = colours.get(r.name) or []
		r["job"] = jobs.get(r.name)
		# The order's dispatch arithmetic belongs to DISPATCHES. A job challan named the
		# order only to reach the customer, and showing its cover there read as the job's
		# balance — a Job Out of 1,239.6 kg answered by 98.62 kg showed 1,239.6 still due.
		if not is_dispatch(r.challan_type):
			r["cover"] = None
			continue
		if r.sales_order and r.sales_order not in covers:
			covers[r.sales_order] = _order_cover(r.sales_order)
		r["cover"] = covers.get(r.sales_order)
	return rows


@frappe.whitelist()
def challan_lines(challan):
	"""The editable rows of one challan, plus the order cover its weights must fit."""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_challan.mm_sales_challan import is_dispatch

	doc = frappe.get_doc("MM Sales Challan", challan)
	# What the box's own sticker said when it was packed — batch, operator and date live on
	# the PRODUCTION, not the challan line — so a label reprinted from here matches the one
	# already on the box. One read for every production the challan draws on.
	made = {
		p.name: p for p in frappe.get_all(
			"MM Production",
			filters={"name": ["in", list({it.production for it in doc.items if it.get("production")}) or [""]]},
			fields=["name", "batch_no", "operator", "posting_date"],
		)
	}
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
		# Dispatches only — a job challan never draws on the order (see challan_report).
		"cover": _order_cover(doc.sales_order, exclude_challan=doc.name) if is_dispatch(doc.challan_type) else None,
		"job": _job_balances([frappe._dict(name=doc.name, challan_type=doc.challan_type,
			against_job_out=doc.get("against_job_out"))]).get(doc.name),
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
				"batch_no": (made.get(it.get("production")) or {}).get("batch_no"),
				"operator": (made.get(it.get("production")) or {}).get("operator"),
				"posting_date": str((made.get(it.get("production")) or {}).get("posting_date") or "") or None,
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


def _job_in_box_rows(boxes, shade, box_return=0, bobbin_return=0):
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
		# RECEIVING SOLVES FOR THE TOTAL. The box is weighed NET on the floor and its
		# packaging is known — bobbins by count, the empty box by its tare — so the gross is
		# what falls out. The screen used to send a gross and have the box tare derived from
		# it, which asked for a number nobody weighs; that shape is still accepted so an
		# older client keeps working, and is the branch below.
		box_wt = frappe.utils.flt(b.get("box_weight") or 0)
		if b.get("box_weight") is not None:
			gross = round(net + bob + box_wt, 3)
		else:
			box_wt = round(gross - bob - net, 3)
			if box_wt < 0:
				frappe.throw(
					_("A box's net ({0} kg) plus its bobbins ({1} kg) is more than its gross ({2} kg). "
					  "One of the three is keyed wrong.").format(net, bob, gross)
				)
		if box_wt < 0:
			frappe.throw(_("A box's own weight cannot be negative ({0} kg).").format(box_wt))
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
			# The header ticks are the DEFAULT each row carries, exactly as they are on a
			# production voucher — a row that says nothing inherits what the operator set
			# for the receipt rather than silently reading as "not returnable".
			"box_return": 1 if frappe.utils.cint(
				b.get("box_return", frappe.utils.cint(box_return))
			) else 0,
			"bobbin_return": 1 if frappe.utils.cint(
				b.get("bobbin_return", frappe.utils.cint(bobbin_return))
			) else 0,
		})
	return rows


@frappe.whitelist()
def preview_job_in_box(gross_weight=None, net_weight=None, bobbin_pcs=0, bobbin_pcs_weight=0,
		total_bobbin_weight=0, box_weight=None):
	"""The box sum, for the screen — so it shows what the server will store.

	Solved for whichever number is missing: given a box tare it returns the TOTAL (the
	receiving direction, where the box is weighed net), given a gross it returns the box
	tare (the older shape, kept so an out-of-date client still gets a sane answer).
	"""
	net = frappe.utils.flt(net_weight or 0)
	bob = frappe.utils.flt(total_bobbin_weight or 0) or round(
		frappe.utils.flt(bobbin_pcs or 0) * frappe.utils.flt(bobbin_pcs_weight or 0), 3
	)
	if box_weight is not None:
		box = frappe.utils.flt(box_weight or 0)
		return {"total_bobbin_weight": bob, "box_weight": box,
			"gross_weight": round(net + bob + box, 3), "valid": box >= 0}
	gross = frappe.utils.flt(gross_weight or 0)
	return {
		"total_bobbin_weight": bob,
		"box_weight": round(gross - bob - net, 3),
		"gross_weight": gross,
		"valid": round(gross - bob - net, 3) >= 0,
	}


@frappe.whitelist()
def create_job_in_production(against_job_out, boxes=None, customer_order=None, party=None,
	posting_date=None, batch_no=None, cut=None, operator=None, shift=None, challan_no=None,
	box_return=0, bobbin_return=0, delivery_by=None, voucher_no=None, challan_id=None,
	challan_series=None):
	"""Receive a Job Out back as a PRODUCTION voucher, and close the Job Out with a Job In.

	`voucher_no` and `challan_id` are the two IDs the operator may type by hand — the
	production's, as typed, and the Job In challan's, filed as series-number-year
	(MMUJI-123-26/27) under `challan_series` (a SERIES key, Job In unless picked). Blank
	leaves each to its series.

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
	# Both typed IDs are checked up front: the challan is raised after the production is
	# submitted, and a taken challan ID found only then would throw the whole receipt away.
	voucher_no = _manual_id("MM Production", voucher_no, frappe.get_meta("MM Production").autoname)
	challan_series = _series_key(challan_series, "Job In")
	_challan_id(challan_id, challan_series, posting_date)

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
	rows = _job_in_box_rows(boxes, shade, box_return=box_return, bobbin_return=bobbin_return)

	# WHOSE ACCOUNT the receipt lands in: the customer of the order it was received against.
	# The Job Out is addressed to the worker, and filing what came back under the worker put
	# the customer's finished goods on the worker's account. The worker's side still closes —
	# every job balance reads `against_job_out`, and job_report / the bobbin ledger follow the
	# Job Out's party. With no order (the shop's own material) it stays on the Job Out's party.
	order = customer_order or jo.sales_order or None
	receipt_party = (
		(frappe.db.get_value("MM Sales Order", order, "party") if order else None)
		or party or jo.party
	)

	prod = frappe.get_doc({
		"doctype": "MM Production",
		"posting_date": posting_date or frappe.utils.today(),
		"customer_order": order,
		"party": receipt_party,
		"shade": shade,
		"cut": cut or next((it.cut for it in jo.items if it.cut), None),
		"branch": jo.branch,
		"location": jo.location,
		"operator": operator or None,
		# On a receipt this is who BROUGHT it back — the same box on the same voucher,
		# read the other way round.
		"delivery_by": (delivery_by or "").strip() or None,
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
	prod.flags.manual_id = voucher_no
	prod.insert(ignore_permissions=True)
	prod.submit()

	# …and the Job In that closes the Job Out, so the worker's balance moves with it.
	#
	# BUILT FROM WHAT CAME BACK, not from what went out. This used to re-list the Job Out's
	# own roll lines, which made the Job In a photocopy of the Job Out: it carried the SENT
	# weight, so every hisab computed its wastage as out − in = 0 — the one figure the
	# settlement exists to argue about — and it carried none of the box detail the operator
	# had just keyed. No barcode to scan, no box tare, no bobbin count, and no return ticks,
	# so the printed challan's "Return No. of Box / No. of Bobbin" was 0 however the boxes
	# were marked.
	#
	# The production's own box rows are the answer to all of it: they are what the worker
	# handed over, they carry the barcodes MMProduction minted, and `_box_row` is the same
	# mapping a dispatch challan uses — including r_box / r_bobbin, which is what the print
	# counts the returnables off.
	prod.reload()
	job_in = create_job_challan(
		challan_type="Job In",
		party=receipt_party,
		challan_date=posting_date or frappe.utils.today(),
		# Filed under the number of the Job Out it answers unless another was typed: every
		# receipt against Job Out 125 is Job In 125.
		challan_no=challan_no or jo.challan_no or None,
		challan_id=challan_id,
		challan_series=challan_series,
		location=jo.location,
		branch=jo.branch,
		delivery_by=delivery_by,
		sales_order=prod.customer_order,
		items=[
			_box_row(
				dict(b.as_dict(), cut=prod.cut),
				production=prod.name,
				order=prod.customer_order,
			)
			for b in (prod.boxes or [])
		],
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
	# The production voucher each Job In was received on. The register names a receipt by
	# its Sale Challan ID and V.No — C.No is the Job Out's own number, shared by every
	# receipt against it, so it told the lines apart not at all.
	vouchers = {}
	if in_names:
		for it in frappe.get_all(
			"MM Sales Challan Item",
			filters={"parent": ["in", in_names], "parenttype": "MM Sales Challan", "production": ["is", "set"]},
			fields=["parent", "production"],
			order_by="parent asc, idx asc",
			limit_page_length=0,
		):
			v = vouchers.setdefault(it.parent, [])
			if it.production not in v:
				v.append(it.production)
	bob_in = {}
	if in_names:
		for b in frappe.get_all(
			"MM Production Bobbin",
			filters={"parent": ["in", in_names], "parenttype": "MM Sales Challan"},
			fields=["parent", "qty"],
			limit_page_length=0,
		):
			bob_in[b.parent] = bob_in.get(b.parent, 0.0) + frappe.utils.flt(b.qty)

	# Any hisab already formed against these Job Outs — the register shows its status and
	# its money beside the weights rather than making the screen ask row by row.
	hisabs = {}
	for h in frappe.get_all(
		"MM Job Hisab",
		filters={"job_out": ["in", names]},
		fields=["name", "job_out", "status", "rate_out", "rate_in", "out_amount",
			"in_amount", "markup_percent", "total_amount", "wastage_weight",
			"wastage_percent", "wastage_over_limit", "bill_no", "cheque"],
		limit_page_length=0,
	):
		hisabs[h.job_out] = h

	rows = []
	t_out = t_in = t_bo = t_bi = 0.0
	for o in outs:
		mine = ins.get(o.name, [])
		in_rows = [{
			"challan": c.name,
			"challan_no": c.challan_no or c.name,
			"voucher_no": ", ".join(vouchers.get(c.name, [])) or None,
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
			# Wastage is the weight that did not come back, as a share of what went. Stated
			# on every row whether or not a hisab exists yet: it is the material question,
			# and it is answerable long before anyone agrees a rate.
			"wastage_weight": round(out_w - in_w, 3),
			"wastage_percent": round(100.0 * (out_w - in_w) / out_w, 2) if out_w else 0.0,
			"hisab": hisabs.get(o.name),
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
			"wastage_weight": round(t_out - t_in, 3),
			"wastage_percent": round(100.0 * (t_out - t_in) / t_out, 2) if t_out else 0.0,
			"bobbin_out": round(t_bo, 3),
			"bobbin_in": round(t_bi, 3),
			"bobbin_difference": round(t_bo - t_bi, 3),
		},
	}


@frappe.whitelist()
def delivery_by_options(search=None, limit=20):
	"""The names already used for "Delivery by", most recent first.

	Free text with a memory rather than a master. Who takes the goods out is a driver, an
	angadia or whoever is going that way — a list the office would have to maintain, and
	would not. So the field accepts anything and offers back what has been typed before,
	which gets the spelling consistent without anybody being made to curate it.

	Read from BOTH documents that carry the field: a name first typed on a production
	should be offered on the next challan, and the other way round.
	"""
	search = (search or "").strip()
	limit = min(max(frappe.utils.cint(limit) or 20, 1), 50)
	like = f"%{search}%"
	rows = frappe.db.sql(
		"""
		select delivery_by, max(creation) as last_used from (
			select delivery_by, creation from `tabMM Production`
				where ifnull(delivery_by, '') != '' and (%(s)s = '' or delivery_by like %(l)s)
			union all
			select delivery_by, creation from `tabMM Sales Challan`
				where ifnull(delivery_by, '') != '' and (%(s)s = '' or delivery_by like %(l)s)
		) x
		group by delivery_by
		order by last_used desc
		limit %(n)s
		""",
		{"s": search, "l": like, "n": limit},
		as_dict=True,
	)
	return [r.delivery_by for r in rows]


@frappe.whitelist()
def job_out_orders(challan):
	"""The customer orders a Job Out was given against — for the Job In order picker.

	A Job Out is raised for a WORKER, and `party` on both it and the Job In that answers it
	is that worker: `job_report` runs a per-party running balance over the pair, so material
	only ever clears off the worker's books because both challans name them. The CUSTOMER is
	therefore not on the challan at all — it is on the order the rolls went out against, and
	that is what this resolves so the receipt can be attributed and the customer shown.

	Two sources, in order of how much they actually know:

	  1. The challan's own lines. `in_stock_rolls` carries each roll's `customer_order` and
	     the Job Out screen sends it, so a challan raised since that existed says outright
	     which order every roll belongs to.
	  2. Failing that, the rolls themselves. An older Job Out has no order on its lines, so
	     the answer is read back through the inward rows the roll came in on — matched on
	     the inventory row's lot and colour, which is the only key those two share.

	An empty list is a real answer: job work on the shop's own material belongs to no
	customer order, and the screen must be able to say so rather than invent one.
	"""
	# Read straight from the tables rather than through get_doc: a submitted document is
	# CACHED, so a challan whose lines were stamped with their order after somebody else
	# had opened it would come back here without them — and silently fall through to the
	# weaker roll lookup below.
	head = frappe.db.get_value(
		"MM Sales Challan", challan, ["challan_type", "sales_order"], as_dict=True
	)
	if not head:
		frappe.throw(_("Challan {0} not found.").format(challan))
	if head.challan_type != "Job Out":
		frappe.throw(_("{0} is not a Job Out.").format(challan))
	lines = frappe.get_all(
		"MM Sales Challan Item",
		filters={"parent": challan, "parenttype": "MM Sales Challan"},
		fields=["sales_order", "roll_inventory"],
		order_by="idx asc",
	)

	orders = [o for o in dict.fromkeys(
		[(it.sales_order or "").strip() for it in lines] + [(head.sales_order or "").strip()]
	) if o]

	if not orders:
		# Back through the rolls: the inward row that brought each one in knows the order.
		inv = [it.roll_inventory for it in lines if it.roll_inventory]
		if inv:
			orders = [
				r[0] for r in frappe.db.sql(
					"""
					select distinct ii.customer_order
					from `tabMM Roll Inventory` ri
					join `tabMM Inward` i on ifnull(i.location, '') = ifnull(ri.location, '')
						and ifnull(i.branch, '') = ifnull(ri.branch, '')
					join `tabMM Inward Item` ii on ii.parent = i.name
						and ifnull(ii.lot_number, '') = ifnull(ri.lot_number, '')
						and ifnull(ii.color_name, '') = ifnull(ri.color_name, '')
					where ri.name in %(inv)s and i.docstatus = 1
						and ifnull(ii.customer_order, '') != ''
					""",
					{"inv": tuple(inv)},
				)
			]

	if not orders:
		return []

	rows = frappe.get_all(
		"MM Sales Order",
		filters={"name": ["in", orders]},
		fields=["name", "party", "company_name", "transaction_date", "delivery_date",
			"ordered_weight", "docstatus"],
	)
	names = {p.name: (p.party_name or p.name) for p in frappe.get_all(
		"MM Party Master", filters={"name": ["in", [r.party for r in rows if r.party]] or [""]},
		fields=["name", "party_name"],
	)}
	return [
		{
			"order": r.name,
			# The CUSTOMER — who the order is for, not the worker the challan is addressed to.
			"customer": r.party,
			"customer_name": names.get(r.party, r.party),
			"company_name": r.company_name,
			"transaction_date": str(r.transaction_date or ""),
			"ordered_weight": r.ordered_weight,
		}
		for r in rows
	]
