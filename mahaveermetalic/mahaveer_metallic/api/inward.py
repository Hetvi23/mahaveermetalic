# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inward posting helpers."""

import json

import frappe
from frappe import _


# A little slack when comparing entered weight to the challan's expected weight, so
# floating-point noise / minor rounding on the scale doesn't trip the over-receipt guard.
_RECEIPT_TOLERANCE = 0.5  # kg absolute
_RECEIPT_TOLERANCE_PCT = 0.02  # + 2% of expected


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


def _prior_inwards(challan_no: str, exclude: str = None):
	"""Submitted inwards already posted against this challan (for partial tracking).

	Tracks both weight and box received, so box-only challans (no weight target) can
	still be closed/capped on their box quantity."""
	rows = frappe.get_all(
		"MM Inward",
		filters={"challan_number": challan_no, "docstatus": 1},
		fields=["name", "receipt_status", "challan_received_weight"],
	)
	rows = [r for r in rows if r["name"] != (exclude or "")]
	received_w = received_b = 0.0
	for r in rows:
		agg = frappe.db.sql(
			"select coalesce(sum(weight),0), coalesce(sum(qty_box),0) from `tabMM Inward Item` where parent=%s",
			(r["name"],),
		)[0]
		item_w, item_b = float(agg[0] or 0), float(agg[1] or 0)
		# Prefer the stored per-inward received weight; fall back to the item sum for
		# older / hand-made inwards. Box always comes from the items (no stored field).
		received_w += float(r.get("challan_received_weight") or item_w)
		received_b += item_b
	closed = any((r.get("receipt_status") or "Complete") == "Complete" for r in rows)
	return {
		"rows": rows,
		"received_weight": round(received_w, 3),
		"received_box": round(received_b, 3),
		"closed": closed,
	}


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


@frappe.whitelist()
def verify_challan(challan_no):
	"""Verify a challan against Veermetlon and report expected vs already-received, so the
	Inward screen can show a verify panel and flag partial / over-receipt / closed."""
	challan_no = (challan_no or "").strip()
	if not challan_no:
		frappe.throw(_("Enter a challan number."))
	exp = _challan_expected_from_vm(challan_no)
	prior = _prior_inwards(challan_no)
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
	}


@frappe.whitelist()
def post_inward(payload):
	"""Create and submit an MM Inward in one transaction, applying the receipt rules.

	Doing the insert and submit server-side (on a single in-memory document) avoids the
	timestamp-mismatch race the two-call client flow hits. When the inward is
	Veermetlon-driven (`verify_against_vm`), the challan is re-verified against VM here
	(authoritative — the client's numbers are never trusted): over-receipt is blocked, a
	challan already fully received is blocked, and the receipt status (Complete / Partial)
	is derived from expected-vs-received. Manual inwards skip VM and are Complete unless
	the user marks them partial.
	"""
	data = json.loads(payload) if isinstance(payload, str) else payload
	data["doctype"] = "MM Inward"

	challan = (data.get("challan_number") or "").strip()
	verify = bool(data.pop("verify_against_vm", False))
	is_partial = bool(data.get("is_partial"))
	this_weight = round(sum(float(i.get("weight") or 0) for i in (data.get("items") or [])), 3)
	this_box = round(sum(float(i.get("qty_box") or 0) for i in (data.get("items") or [])), 3)
	data["challan_received_weight"] = this_weight

	# Downstream gating: an inward may only be posted against a SUBMITTED order.
	from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import assert_order_submitted

	orders_ref = {data.get("sales_order")} | {i.get("customer_order") for i in (data.get("items") or [])}
	for o in filter(None, orders_ref):
		assert_order_submitted(o)

	if not (challan and verify):
		# Manual / no VM verification: Complete unless flagged partial.
		data["receipt_status"] = "Partial" if is_partial else "Complete"
		doc = frappe.get_doc(data)
		doc.insert()
		doc.submit()
		return {"name": doc.name, "receipt_status": doc.receipt_status}

	# Veermetlon-verified path — serialize per challan so the check+insert is atomic.
	_acquire_challan_lock(challan)
	try:
		exp = _challan_expected_from_vm(challan)
		prior = _prior_inwards(challan)
		if prior["closed"]:
			frappe.throw(
				_("Challan {0} is already fully received. No further inward is allowed.").format(challan)
			)
		exp_w, exp_b = exp["expected_weight"], exp["expected_box"]
		cum_w = round(prior["received_weight"] + this_weight, 3)
		cum_b = round(prior["received_box"] + this_box, 3)

		# Over-receipt: cap on weight when the challan carries a weight target, else on box.
		if exp_w > 0:
			allowed = exp_w + max(_RECEIPT_TOLERANCE, exp_w * _RECEIPT_TOLERANCE_PCT)
			if cum_w > allowed:
				frappe.throw(
					_("Over-receipt blocked: challan {0} expects {1} kg, already received {2} kg, "
						"this inward adds {3} kg (total {4} kg).").format(
						challan, exp_w, prior["received_weight"], this_weight, cum_w)
				)
		elif exp_b > 0:
			allowed = exp_b + max(_RECEIPT_TOLERANCE, exp_b * _RECEIPT_TOLERANCE_PCT)
			if cum_b > allowed:
				frappe.throw(
					_("Over-receipt blocked: challan {0} expects {1} box, already received {2} box, "
						"this inward adds {3} box (total {4} box).").format(
						challan, exp_b, prior["received_box"], this_box, cum_b)
				)

		# Complete when the cumulative reaches expected (weight target if any, else box).
		# An empty challan (no weight and no box expected) closes immediately. Unless the
		# user explicitly flags it partial (more rolls still coming).
		if exp_w > 0:
			reaches = cum_w + _RECEIPT_TOLERANCE >= exp_w
		elif exp_b > 0:
			reaches = cum_b + _RECEIPT_TOLERANCE >= exp_b
		else:
			reaches = True
		data["receipt_status"] = "Partial" if (is_partial or not reaches) else "Complete"
		data["challan_expected_weight"] = exp_w
		data["challan_expected_box"] = exp_b
		data["challan_expected_rolls"] = exp["expected_rolls"]

		doc = frappe.get_doc(data)
		doc.insert()
		doc.submit()
		return {"name": doc.name, "receipt_status": doc.receipt_status}
	finally:
		_release_challan_lock(challan)


@frappe.whitelist()
def sales_order_options(search=None, limit=200):
	"""Open Sales Orders for the Inward SO picker.

	Returns one row per order enriched with customer name, colours, cuts and dates so
	the dropdown can be searched by any of them (order no / customer / colour / date).
	Only orders still open for inward are offered — docstatus < 2, production < 100%,
	and NOT fully inwarded. An order is fully inwarded once its required weight drops to
	≤ 0; box-only orders (no weight target, ordered_weight = 0) are always kept.
	"""
	limit = int(limit or 200)
	rows = frappe.db.sql(
		"""
		select so.name as sales_order, so.party, pm.party_name,
			so.delivery_date, so.transaction_date,
			so.ordered_weight, so.required_weight,
			soi.color_name, soi.cut
		from `tabMM Sales Order` so
		left join `tabMM Party Master` pm on pm.name = so.party
		left join `tabMM Sales Order Item` soi on soi.parent = so.name
		where so.docstatus < 2
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
		filters={"docstatus": 1},
		fields=[
			"name", "posting_date", "lot_number", "location", "branch",
			"sales_order", "party", "challan_number", "receipt_status",
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
