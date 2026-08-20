# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inward posting helpers."""

import json

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_inward_over_tolerance,
)


# A little slack when comparing entered weight to the challan's expected weight, so
# floating-point noise / minor rounding on the scale doesn't trip the over-receipt guard.
# The PERCENTAGE allowance is configurable (MM Settings) because how much extra a shop
# will accept is a business call, not a constant: it is 20% here, where it used to be a
# hardcoded 2%.
_RECEIPT_TOLERANCE = 0.5  # kg absolute floor, for scale rounding


def _challan_expected_from_vm(challan_no: str) -> dict:
	"""Verify a challan against Veermetlon and return its expected totals.

	This IS the verification: `veermetlon.fetch_challan` throws if the challan isn't in
	Veermetlon, so a made-up challan number can never be received.
	"""
	from mahaveermetalic.mahaveer_metallic.api import veermetlon

	vm = veermetlon.fetch_challan(challan_no)
	items = vm.get("items") or []
	return {
		"expected_weight": round(sum(float(it.get("weight") or 0) for it in items), 3),
		"expected_box": round(sum(float(it.get("qty") or 0) for it in items), 3),
		"expected_rolls": len(items),
		"items": items,
		"matching_orders": vm.get("matching_orders") or [],
		"coating": vm.get("coating"),
		"sales_order": vm.get("sales_order"),
	}


# A challan belongs to the ROW it was entered on, so what has been received against it is
# a sum over inward ITEMS, not over inward headers: one inward can receive several
# challans and its header can only name one of them. An item that names no challan falls
# back to its parent's header challan — that is exactly what every inward posted before
# the challan moved onto the row looks like, so both read the same way here.
_CHALLAN_OF_ITEM = "coalesce(nullif(ii.challan_number, ''), i.challan_number)"


def _prior_receipt(challan_no: str, exclude: str = None):
	"""What is already received on this challan, and whether it is closed.

	Tracks both weight and box received, so box-only challans (no weight target) can
	still be closed/capped on their box quantity."""
	rows = frappe.db.sql(
		f"""
		select i.name, i.receipt_status, ifnull(i.is_gr, 0) as is_gr,
			coalesce(sum(ii.weight), 0) as weight, coalesce(sum(ii.qty_box), 0) as box
		from `tabMM Inward` i
		join `tabMM Inward Item` ii on ii.parent = i.name
		where i.docstatus = 1 and i.name != %(me)s and {_CHALLAN_OF_ITEM} = %(ch)s
		group by i.name, i.receipt_status, i.is_gr
		""",
		{"ch": challan_no, "me": exclude or ""},
		as_dict=True,
	)
	return {
		"rows": rows,
		# A goods return's rows are negative, so they net themselves off the received figure —
		# material handed back is not material received.
		"received_weight": round(sum(float(r.weight or 0) for r in rows), 3),
		"received_box": round(sum(float(r.box or 0) for r in rows), 3),
		# …but a return never CLOSES a challan. Only a receipt can do that.
		"closed": any(not r.is_gr and (r.receipt_status or "Complete") == "Complete" for r in rows),
	}


def challan_closed_by(challan_no: str, exclude: str = None):
	"""The submitted inward that closed this challan, if one did.

	A challan is closed once an inward that received it was posted Complete; a Partial one
	leaves it open for the rest. Shared with MM Inward.validate so the screen's check and
	the document's guard cannot disagree about what "closed" means.
	"""
	hit = frappe.db.sql(
		f"""
		select i.name
		from `tabMM Inward` i
		join `tabMM Inward Item` ii on ii.parent = i.name
		where i.docstatus = 1 and ifnull(i.receipt_status, 'Complete') = 'Complete'
			and ifnull(i.is_gr, 0) = 0
			and i.name != %(me)s and {_CHALLAN_OF_ITEM} = %(ch)s
		limit 1
		""",
		{"ch": challan_no, "me": exclude or ""},
	)
	return hit[0][0] if hit else None


def _acquire_challan_lock(challan_no: str):
	"""Serialize concurrent post_inward calls for the same challan with a MariaDB
	advisory lock, so two operators posting the same challan at once can't both pass the
	closed / over-receipt checks and double-post. Best-effort: reduces the TOCTOU window
	to the commit boundary."""
	got = frappe.db.sql("select get_lock(%s, 10)", (f"mm_inward_challan_{challan_no}",))
	if not (got and got[0][0]):
		frappe.throw(_("Another inward for challan {0} is being posted — please retry.").format(challan_no))


def _release_challan_lock(challan_no: str):
	try:
		frappe.db.sql("select release_lock(%s)", (f"mm_inward_challan_{challan_no}",))
	except Exception:
		pass


def _assign_lots(data):
	"""Resolve (and stamp) a lot PER ENTRY ROW.

	A lot is one row's worth of material: the operator keys the challan, supplier, order
	and colour once, then weighs any number of rolls under it — and every one of those
	rolls belongs to that one lot. The client tags each roll line with the row it was
	weighed on (`lot_group`), which is what makes the rolls of a row share a lot instead
	of taking one each.

	Separate rows are separate lots, same colour or not — the lots this document has already
	taken are passed to `resolve_lot` so a second row naming the same challan gets its own
	rather than joining the first.

	Rows arriving without that tag (desk entry, older API callers) fall back to grouping
	by colour + challan, which is the lot's own identity — so nothing that posted before
	changes shape.

	Sets `lot` (link) and `lot_number` (the LT display id) on every item, plus the first
	row's on the header, so the id flows into roll inventory, the stock ledger and
	everything downstream.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_lot.mm_lot import resolve_lot

	header_challan = (data.get("challan_number") or "").strip()
	resolved, first = {}, None
	for item in data.get("items") or []:
		colour = item.get("color_name")
		if not colour:
			continue
		challan = (item.get("challan_number") or "").strip() or header_challan
		group = item.pop("lot_group", None)
		key = f"g:{group}" if group not in (None, "") else f"c:{colour}|{challan}"
		res = resolved.get(key)
		if res is None:
			try:
				res = resolve_lot(
					color=colour,
					challan_number=challan or None,
					posting_date=data.get("posting_date"),
					exclude=[r["lot"] for r in resolved.values()],
				)
			except Exception as e:
				frappe.log_error(title="lot resolve failed")
				frappe.throw(_("Could not allocate a lot for colour {0}: {1}").format(colour, str(e)))
			resolved[key] = res
		item["lot"] = res["lot"]
		item["lot_number"] = res["lot_id"]
		first = first or res
	# The header keeps the FIRST row's lot: it is what the list view, the older reports and
	# the roll-stock fallback read, and a single-row inward is still simply "its lot".
	if first:
		data["lot"] = first["lot"]
		data["lot_number"] = first["lot_id"]


def _veermetlon_supplier():
	"""The MM Vendor Master row that IS Veermetlon.

	Material fetched off a VM challan came from VM, so making the operator also pick the
	supplier is asking them to retype what the fetch already knows. Matched loosely (case
	and spacing) so an existing "veer metlon" / "VeerMetlon" row is reused instead of
	duplicated, and created once if the site has neither.
	"""
	rows = frappe.db.sql(
		"""
		select name from `tabMM Vendor Master`
		where replace(lower(ifnull(vendor_name, name)), ' ', '') like %(pat)s
		order by creation asc
		limit 1
		""",
		{"pat": "%veermetlon%"},
	)
	if rows:
		return rows[0][0]
	try:
		doc = frappe.get_doc({"doctype": "MM Vendor Master", "vendor_name": "Veer Metlon"})
		# The master wants a mobile number and the challan fetch has no way to know one.
		# Inventing a number would be worse than leaving it blank: the row is real and
		# whoever maintains the vendor list fills the contact in.
		doc.flags.ignore_mandatory = True
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		# A supplier we couldn't resolve is a blank cell the operator fills in — never a
		# reason to fail the challan fetch itself.
		frappe.log_error(title="Veermetlon vendor could not be resolved")
		return None


@frappe.whitelist()
def supplier_options():
	"""Suppliers for the Inward grid's Supplier picker, each with the colours it has
	supplied before.

	The grid keys the colour first, so the picker can lift the suppliers that have
	supplied THAT colour to the top and keep every other one below it — filtered without
	hiding anything, because a colour arriving from a new supplier is ordinary.

	History is both sides: what was bought (purchase orders) and what was received
	(submitted inward rows). A supplier that has done neither still appears, with no
	colours against it.
	"""
	vendors = frappe.get_all(
		"MM Vendor Master",
		fields=["name", "vendor_name"],
		order_by="vendor_name asc, name asc",
		limit_page_length=0,
	)
	colours = {}

	def collect(rows):
		for r in rows:
			colours.setdefault(r.supplier, set()).add(r.colour)

	collect(
		frappe.db.sql(
			"""
			select distinct po.supplier as supplier, po.color as colour
			from `tabMM Purchase Order` po
			where po.docstatus < 2 and ifnull(po.supplier, '') != '' and ifnull(po.color, '') != ''
			""",
			as_dict=True,
		)
	)
	collect(
		frappe.db.sql(
			"""
			select distinct ii.supplier as supplier, ii.color_name as colour
			from `tabMM Inward Item` ii
			join `tabMM Inward` i on i.name = ii.parent
			where i.docstatus = 1 and ifnull(ii.supplier, '') != '' and ifnull(ii.color_name, '') != ''
			""",
			as_dict=True,
		)
	)
	return [
		{
			"vendor": v.name,
			"vendor_name": v.vendor_name or v.name,
			"colours": sorted(colours.get(v.name, ())),
		}
		for v in vendors
	]


@frappe.whitelist()
def verify_challan(challan_no):
	"""Verify a challan against Veermetlon and report expected vs already-received, so the
	Inward screen can show a verify panel and flag partial / over-receipt / closed."""
	challan_no = (challan_no or "").strip()
	if not challan_no:
		frappe.throw(_("Enter a challan number."))
	exp = _challan_expected_from_vm(challan_no)
	prior = _prior_receipt(challan_no)
	remaining = round(exp["expected_weight"] - prior["received_weight"], 3)
	return {
		"challan_no": challan_no,
		"expected_weight": exp["expected_weight"],
		"expected_box": exp["expected_box"],
		"expected_rolls": exp["expected_rolls"],
		"received_weight": prior["received_weight"],
		"remaining_weight": remaining,
		"closed": prior["closed"],
		"items": exp["items"],
		"matching_orders": exp["matching_orders"],
		"coating": exp["coating"],
		"sales_order": exp["sales_order"],
		# Fetched from VM means supplied by VM — the row's Supplier fills itself in.
		"supplier": _veermetlon_supplier(),
	}


def _row_challans(items, header_challan: str):
	"""Every distinct challan on the document, in a stable order."""
	return sorted({(i.get("challan_number") or "").strip() or header_challan for i in items} - {""})


def _weight_on_challan(items, challan: str, header_challan: str):
	"""Weight and box being received on ONE challan by this inward."""
	w = b = 0.0
	for i in items:
		if ((i.get("challan_number") or "").strip() or header_challan) == challan:
			w += float(i.get("weight") or 0)
			b += float(i.get("qty_box") or 0)
	return round(w, 3), round(b, 3)


@frappe.whitelist()
def post_inward(payload):
	"""Create and submit an MM Inward in one transaction, applying the receipt rules.

	Doing the insert and submit server-side (on a single in-memory document) avoids the
	timestamp-mismatch race the two-call client flow hits.

	Challans are entered per row, so verification is per challan too: `verified_challans`
	names the ones the operator actually fetched from Veermetlon, and each of those is
	re-fetched from VM here (authoritative — the client's numbers are never trusted). For
	every one of them, over-receipt is blocked against that challan's own rows, a challan
	already fully received is blocked, and Complete / Partial is derived from
	expected-vs-received. Rows typed by hand skip VM and are Complete unless the user marks
	the inward partial.
	"""
	data = json.loads(payload) if isinstance(payload, str) else payload
	data["doctype"] = "MM Inward"
	items = data.get("items") or []

	is_partial = bool(data.get("is_partial"))
	this_weight = round(sum(float(i.get("weight") or 0) for i in items), 3)
	data["challan_received_weight"] = this_weight

	# The header keeps the challan only when the whole inward is one challan — a document
	# spanning several of them would otherwise claim to be one of its rows. Everything that
	# matters is read off the rows either way.
	header_challan = (data.get("challan_number") or "").strip()
	row_challans = _row_challans(items, header_challan)
	if not header_challan and len(row_challans) == 1:
		header_challan = row_challans[0]
	data["challan_number"] = header_challan if len(row_challans) <= 1 else ""

	# Same treatment for the order: stamped on the header only when the whole inward is
	# for one order, so Company (and the older per-inward reports) still resolve.
	if not data.get("sales_order"):
		row_orders = {i.get("customer_order") for i in items if i.get("customer_order")}
		if len(row_orders) == 1:
			data["sales_order"] = row_orders.pop()

	# Which challans were fetched from VM and so get verified. `verify_against_vm` is the
	# older single-challan form of the same thing.
	verified = data.pop("verified_challans", None)
	legacy_verify = bool(data.pop("verify_against_vm", False))
	if verified is None:
		verified = [header_challan] if (legacy_verify and header_challan) else []
	elif isinstance(verified, str):
		verified = json.loads(verified)
	known = set(row_challans) | ({header_challan} if header_challan else set())
	verified = sorted({(c or "").strip() for c in verified} & known)

	# Downstream gating: an inward may only be posted against a SUBMITTED order.
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import assert_order_submitted

	orders_ref = {data.get("sales_order")} | {i.get("customer_order") for i in items}
	for o in filter(None, orders_ref):
		assert_order_submitted(o)

	# Lot: one per entry row (colour-wise LT id, reused when a challan already has one).
	# Drives lot_number downstream (roll inventory → cutting → program → production).
	_assign_lots(data)

	if not verified:
		# Manual / no VM verification: Complete unless flagged partial.
		data["receipt_status"] = "Partial" if is_partial else "Complete"
		doc = frappe.get_doc(data)
		doc.insert()
		doc.submit()
		return {"name": doc.name, "receipt_status": doc.receipt_status}

	# Veermetlon-verified path — serialize per challan so check+insert is atomic. Locks are
	# taken in a fixed (sorted) order so two operators posting the same pair of challans
	# can't deadlock on each other.
	for challan in verified:
		_acquire_challan_lock(challan)
	try:
		over_pct = get_inward_over_tolerance() / 100.0
		expected_w = expected_b = 0.0
		expected_rolls = 0
		reaches_all = True
		for challan in verified:
			exp = _challan_expected_from_vm(challan)
			prior = _prior_receipt(challan)
			if prior["closed"]:
				frappe.throw(
					_("Challan {0} is already fully received. No further inward is allowed.").format(challan)
				)
			exp_w, exp_b = exp["expected_weight"], exp["expected_box"]
			this_w, this_b = _weight_on_challan(items, challan, header_challan)
			cum_w = round(prior["received_weight"] + this_w, 3)
			cum_b = round(prior["received_box"] + this_b, 3)

			# Over-receipt: cap on weight when the challan carries a weight target, else on box.
			if exp_w > 0:
				allowed = exp_w + max(_RECEIPT_TOLERANCE, exp_w * over_pct)
				if cum_w > allowed:
					frappe.throw(
						_("Over-receipt blocked: challan {0} expects {1} kg, already received {2} kg, "
							"this inward adds {3} kg (total {4} kg).").format(
							challan, exp_w, prior["received_weight"], this_w, cum_w)
					)
			elif exp_b > 0:
				allowed = exp_b + max(_RECEIPT_TOLERANCE, exp_b * over_pct)
				if cum_b > allowed:
					frappe.throw(
						_("Over-receipt blocked: challan {0} expects {1} box, already received {2} box, "
							"this inward adds {3} box (total {4} box).").format(
							challan, exp_b, prior["received_box"], this_b, cum_b)
					)

			# Complete when the cumulative reaches expected (weight target if any, else box).
			# An empty challan (no weight and no box expected) closes immediately.
			if exp_w > 0:
				reaches = cum_w + _RECEIPT_TOLERANCE >= exp_w
			elif exp_b > 0:
				reaches = cum_b + _RECEIPT_TOLERANCE >= exp_b
			else:
				reaches = True
			reaches_all = reaches_all and reaches
			expected_w += exp_w
			expected_b += exp_b
			expected_rolls += exp["expected_rolls"]

		# One status for the document: Complete only when EVERY verified challan on it is
		# satisfied, so a short row keeps its challan open.
		data["receipt_status"] = "Partial" if (is_partial or not reaches_all) else "Complete"
		data["challan_expected_weight"] = round(expected_w, 3)
		data["challan_expected_box"] = round(expected_b, 3)
		data["challan_expected_rolls"] = expected_rolls

		doc = frappe.get_doc(data)
		doc.insert()
		doc.submit()
		return {"name": doc.name, "receipt_status": doc.receipt_status}
	finally:
		for challan in verified:
			_release_challan_lock(challan)


@frappe.whitelist()
def sales_order_options(search=None, limit=200):
	"""Open Sales Orders for the Inward SO picker.

	Returns one row per order enriched with customer name, colours, cuts and dates so
	the dropdown can be searched by any of them (order no / customer / colour / date).
	Only APPROVED orders still open for inward are offered — docstatus = 1 (admin-approved),
	production < 100%, and NOT fully inwarded. An order is fully inwarded once its required
	weight drops to ≤ 0; box-only orders (no weight target, ordered_weight = 0) are kept.
	"""
	limit = int(limit or 200)
	rows = frappe.db.sql(
		"""
		select so.name as sales_order, so.party, pm.party_name, so.company_name,
			so.delivery_date, so.transaction_date,
			so.ordered_weight, so.required_weight,
			soi.color_name, soi.cut
		from `tabMM Sales Order` so
		left join `tabMM Party Master` pm on pm.name = so.party
		left join `tabMM Sales Order Item` soi on soi.parent = so.name
		where so.docstatus = 1
			-- A completed order is not open for inward, however it was completed. Without
			-- this it kept appearing in the picker as though it were still open.
			and ifnull(so.completed, 0) = 0
			and ifnull(so.production_completed_percent, 0) < 100
			and not (ifnull(so.ordered_weight, 0) > 0 and ifnull(so.required_weight, 0) <= 0)
		order by so.transaction_date desc, so.modified desc
		""",
		as_dict=True,
	)
	by_so, order = {}, []
	for r in rows:
		o = by_so.get(r.sales_order)
		if not o:
			o = {
				"sales_order": r.sales_order,
				"party": r.party,
				"party_name": r.party_name or r.party,
				# Carried so picking an order fills the inward's Company by itself.
				"company_name": r.company_name,
				"delivery_date": str(r.delivery_date) if r.delivery_date else None,
				"transaction_date": str(r.transaction_date) if r.transaction_date else None,
				"ordered_weight": r.ordered_weight,
				"required_weight": r.required_weight,
				"colours": [],
				"cuts": [],
			}
			by_so[r.sales_order] = o
			order.append(r.sales_order)
		if r.color_name and r.color_name not in o["colours"]:
			o["colours"].append(r.color_name)
		if r.cut and r.cut not in o["cuts"]:
			o["cuts"].append(r.cut)
	out = [by_so[k] for k in order]
	if search:
		s = search.strip().lower()

		def hit(o):
			hay = " ".join(
				[o["sales_order"] or "", o["party_name"] or "", " ".join(o["colours"]),
				 " ".join(o["cuts"]), o["delivery_date"] or ""]
			).lower()
			return s in hay

		out = [o for o in out if hit(o)]
	return out[:limit]


@frappe.whitelist()
def sales_order_detail(sales_order):
	"""Header + line items of a Sales Order, to auto-form Inward rows in manual entry.

	The Material Received rows on the Inward screen are seeded from these items
	(colour, cut and qty/weight). Roll numbers aren't on the order, so those stay
	blank for the user to fill; quantities remain editable after seeding.
	"""
	if not sales_order or not frappe.db.exists("MM Sales Order", sales_order):
		frappe.throw(_("Sales Order {0} not found.").format(sales_order or ""))
	so = frappe.get_doc("MM Sales Order", sales_order)
	party_name = (
		frappe.db.get_value("MM Party Master", so.party, "party_name") or so.party
	) if so.party else None
	return {
		"sales_order": so.name,
		"party": so.party,
		"party_name": party_name,
		"branch": so.branch,
		"location": so.location,
		"delivery_date": str(so.delivery_date) if so.delivery_date else None,
		"transaction_date": str(so.transaction_date) if so.transaction_date else None,
		"items": [
			{
				"color": it.color_name,
				"cut": it.cut,
				"qty_box": it.qty_box or 0,
				"qty_weight": it.qty_weight or 0,
			}
			for it in (so.items or [])
		],
	}


@frappe.whitelist()
def recent_inwards(limit=30):
	"""Recently posted inwards, summarised — drives the Inward-screen list.

	Each row carries its challan/lot/location/order plus the party name and a rollup of
	the rolls received (colours, roll count, boxes and weight).
	"""
	rows = frappe.get_all(
		"MM Inward",
		# Posted AND cancelled — a cancelled inward stays visible (its stock was reversed).
		filters={"docstatus": ["in", [1, 2]]},
		fields=[
			"name", "posting_date", "lot_number", "location", "branch",
			"sales_order", "party", "challan_number", "receipt_status", "docstatus",
		],
		order_by="creation desc",
		limit_page_length=int(limit),
	)
	for r in rows:
		items = frappe.get_all(
			"MM Inward Item",
			filters={"parent": r["name"]},
			fields=["color_name", "weight", "qty_box", "customer_order"],
		)
		r["colours"] = ", ".join(sorted({i.color_name for i in items if i.color_name}))
		r["rolls"] = len(items)
		r["total_box"] = round(sum(i.qty_box or 0 for i in items), 3)
		r["total_weight"] = round(sum(i.weight or 0 for i in items), 3)
		r["party_name"] = (
			frappe.db.get_value("MM Party Master", r["party"], "party_name") or r["party"]
		) if r.get("party") else None
		# Allocated when every line already points at an order.
		r["allocated"] = bool(items) and all(i.customer_order for i in items)
	return rows


@frappe.whitelist()
def post_gr(inward, items=None, reason=None):
	"""Raise a GOODS RETURN against a posted inward.

	This is what the register offers instead of Cancel, and it is a different statement.
	Cancelling says the inward never happened and erases it; a GR says the rolls arrived and
	then went back. So the original STAYS SUBMITTED — marked returned — and the return is
	posted as its own inward whose rolls carry NEGATIVE weight. That negative entry is what
	takes the material out of stock, posts the OUT ledger movement, and nets the quantity off
	the register and off the order's inwarded weight: the inward stops showing that qty
	without the history losing the fact that it came in.

	`items` limits the return to particular MM Inward Item rows (a bad roll out of ten);
	omitted, the whole inward is returned.
	"""
	if not inward or not frappe.db.exists("MM Inward", inward):
		frappe.throw(_("Inward {0} not found.").format(inward or ""))
	src = frappe.get_doc("MM Inward", inward)
	if src.docstatus != 1:
		frappe.throw(_("Only a submitted inward can be returned."))
	if src.is_gr:
		frappe.throw(_("{0} is itself a goods return.").format(inward))

	wanted = json.loads(items) if isinstance(items, str) else items
	wanted = {w for w in (wanted or []) if w}
	rows = [r for r in src.items if not wanted or r.name in wanted]
	if not rows:
		frappe.throw(_("Nothing selected to return."))

	# What is left to return: an earlier partial GR may already have taken some of it back.
	returned = {}
	for prev in frappe.get_all(
		"MM Inward", filters={"gr_against": inward, "is_gr": 1, "docstatus": 1}, pluck="name"
	):
		for r in frappe.get_all(
			"MM Inward Item", filters={"parent": prev}, fields=["roll_name", "color_name", "lot_number", "weight", "qty_box"]
		):
			key = (r.roll_name or "", r.color_name or "", r.lot_number or "")
			acc = returned.setdefault(key, [0.0, 0.0])
			acc[0] += abs(float(r.weight or 0))
			acc[1] += abs(float(r.qty_box or 0))

	gr_items = []
	for r in rows:
		key = (r.roll_name or "", r.color_name or "", r.lot_number or "")
		done_w, done_b = returned.get(key, [0.0, 0.0])
		left_w = round(float(r.weight or 0) - done_w, 3)
		left_b = round(float(r.qty_box or 0) - done_b, 3)
		if left_w <= 0 and left_b <= 0:
			continue
		gr_items.append(
			{
				"idx": len(gr_items) + 1,
				"job_work": r.job_work,
				"supplier": r.supplier,
				"challan_number": r.challan_number,
				"customer_order": r.customer_order,
				# The return belongs to the SAME lot — it is that material going back, not
				# new material arriving, so no lot is allocated for it.
				"lot": r.lot,
				"lot_number": r.lot_number,
				"roll_name": r.roll_name,
				"color_name": r.color_name,
				"cut": r.cut,
				"qty_box": -left_b if left_b > 0 else 0,
				"weight": -left_w if left_w > 0 else 0,
			}
		)
	if not gr_items:
		frappe.throw(_("Everything on inward {0} has already been returned.").format(inward))

	gr = frappe.get_doc(
		{
			"doctype": "MM Inward",
			"is_gr": 1,
			"gr_against": inward,
			"gr_reason": (reason or "").strip() or None,
			"posting_date": frappe.utils.nowdate(),
			"branch": src.branch,
			"location": src.location,
			"company_name": src.company_name,
			"party": src.party,
			"sales_order": src.sales_order,
			"challan_number": src.challan_number,
			"item_type": src.item_type,
			"lot": src.lot,
			"lot_number": src.lot_number,
			"receipt_status": src.receipt_status,
			"items": gr_items,
		}
	)
	gr.insert()
	gr.submit()
	returned_weight = round(sum(abs(float(i["weight"] or 0)) for i in gr_items), 3)
	return {
		"gr": gr.name,
		"against": inward,
		"rolls": len(gr_items),
		"returned_weight": returned_weight,
	}


@frappe.whitelist()
def cancel_inward(inward):
	"""Cancel a posted inward. MM Inward.on_cancel reverses the roll inventory it added
	and posts the matching OUT stock-ledger entries, so stock and ledger stay in step."""
	if not inward or not frappe.db.exists("MM Inward", inward):
		frappe.throw(_("Inward {0} not found.").format(inward or ""))
	doc = frappe.get_doc("MM Inward", inward)
	if doc.docstatus == 2:
		frappe.throw(_("Inward {0} is already cancelled.").format(inward))
	if doc.docstatus == 0:
		frappe.throw(_("Inward {0} is a draft — nothing posted to reverse.").format(inward))
	doc.cancel()
	return {"inward": doc.name, "docstatus": doc.docstatus}


@frappe.whitelist()
def allocate_inward_to_order(inward, sales_order):
	"""Match a posted inward to a Sales Order after the fact: point every line (and the
	header) at the order, then refresh fulfilment on the new order and any the inward
	was previously tied to."""
	if not frappe.db.exists("MM Inward", inward):
		frappe.throw(_("Inward {0} not found.").format(inward))
	if not frappe.db.exists("MM Sales Order", sales_order):
		frappe.throw(_("Sales Order {0} not found.").format(sales_order))

	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		recalculate_order_fulfilment,
	)

	affected = set()
	prev = frappe.db.get_value("MM Inward", inward, "sales_order")
	if prev:
		affected.add(prev)
	for it in frappe.get_all("MM Inward Item", filters={"parent": inward}, fields=["name", "customer_order"]):
		if it.customer_order:
			affected.add(it.customer_order)
		frappe.db.set_value("MM Inward Item", it.name, "customer_order", sales_order, update_modified=False)
	frappe.db.set_value("MM Inward", inward, "sales_order", sales_order, update_modified=False)
	affected.add(sales_order)
	for so in affected:
		recalculate_order_fulfilment(so)
	return {"inward": inward, "sales_order": sales_order, "refreshed": sorted(affected)}


@frappe.whitelist()
def set_inward_status(inward, status, reason=None):
	"""Admin override of a posted inward's receipt status.

	The status is normally derived — Complete once the challan's weight is met, Partial
	while short. Reality does not always agree: a supplier confirms nothing more is
	coming on a short delivery, or a challan's expected weight was wrong to begin with.
	Rather than have the floor post a phantom inward to force the number, an admin can
	say so directly.

	Only the status moves. The stock already posted is untouched, because the material
	that arrived is not in question — only whether more is still expected.
	"""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
		is_mm_admin,
		recalculate_order_fulfilment,
	)

	if not is_mm_admin():
		frappe.throw(_("Only an admin can change an inward's status."))
	if status not in ("Complete", "Partial"):
		frappe.throw(_("Status must be Complete or Partial."))

	doc = frappe.get_doc("MM Inward", inward)
	if doc.docstatus != 1:
		frappe.throw(_("Only a submitted inward's status can be changed."))
	if doc.receipt_status == status:
		return {"inward": doc.name, "receipt_status": status, "changed": False}

	before = doc.receipt_status
	# db_set, not save: a submitted doc would re-run validation and the derivation would
	# simply overwrite the override we are making.
	doc.db_set("receipt_status", status, update_modified=False)
	doc.db_set("is_partial", 1 if status == "Partial" else 0, update_modified=False)

	doc.add_comment(
		"Comment",
		_("Receipt status changed {0} → {1} by {2}{3}").format(
			before or "—", status, frappe.session.user, f": {reason}" if reason else ""
		),
	)

	# A challan reopened or closed by hand changes what the order is still owed.
	for order in {i.customer_order for i in doc.items if i.customer_order} | {doc.sales_order}:
		if order:
			recalculate_order_fulfilment(order)

	return {"inward": doc.name, "receipt_status": status, "changed": True, "was": before}
