# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _


@frappe.whitelist()
def get_roll_stock(color_name=None, cut=None, location=None, item_type=None, branch=None):
	"""Aggregated roll inventory filtered by color, location (and optional item type).

	`cut` is accepted and IGNORED: rolls are raw material and MM Roll Inventory has no cut
	column — cutting happens downstream. Filtering by it matched nothing, so any
	availability check that carried a size reported zero stock and every such order looked
	fully short. Callers still pass it, so the argument stays.
	"""
	filters = {}
	if color_name:
		filters["color_name"] = color_name
	if location:
		filters["location"] = location
	if branch:
		filters["branch"] = branch
	if item_type:
		filters["item_type"] = item_type
	rows = frappe.get_all(
		"MM Roll Inventory",
		filters=filters,
		fields=[
			"name",
			"roll_no",
			"lot_number",
			"location",
			"branch",
			"color_name",
			"item_type",
			"stock_weight",
			"stock_box",
			"reserved_weight",
			"issued_weight",
			"available_weight",
		],
		order_by="modified desc",
		limit_page_length=500,
	)
	for r in rows:
		stock = float(r.get("stock_weight") or 0)
		reserved = float(r.get("reserved_weight") or 0)
		issued = float(r.get("issued_weight") or 0)
		r["available_weight"] = stock - reserved - issued
	return rows


@frappe.whitelist()
def get_stock_summary(color_name=None, cut=None, location=None, item_type=None, branch=None):
	"""Total weight/box for filters (for SO line stock hint)."""
	rows = get_roll_stock(color_name=color_name, cut=cut, location=location, item_type=item_type, branch=branch)
	total_weight = sum(float(r.get("stock_weight") or 0) for r in rows)
	total_box = sum(float(r.get("stock_box") or 0) for r in rows)
	total_available_weight = sum(float(r.get("available_weight") or 0) for r in rows)
	return {
		"lines": rows,
		"total_weight": total_weight,
		"total_box": total_box,
		"total_available_weight": total_available_weight,
		"suggest_purchase_order": total_available_weight <= 0 and total_box <= 0,
	}


def _committed_weight(color_name, cut, exclude_order=None):
	"""Weight of this colour/cut already promised to other live orders.

	`reserved_weight` on MM Roll Inventory is never written by anything, so physical stock
	looked free even after it had been sold: order 53 took 100 kg and order 54 was still
	told 100 kg were available. An open order's claim is what it has yet to deliver
	(ordered − produced), so stock already turned into finished goods stops being a claim.
	"""
	# Matched on colour alone, to mirror the stock it draws from: inventory is not held per
	# cut, so two orders for the same colour in different sizes compete for the same rolls.
	conds = [
		"so.docstatus = 1",
		"ifnull(so.completed, 0) = 0",
		"ifnull(so.production_completed_percent, 0) < 100",
		"soi.color_name = %(color)s",
	]
	vals = {"color": color_name}
	if exclude_order:
		conds.append("so.name != %(ex)s")
		vals["ex"] = exclude_order
	row = frappe.db.sql(
		f"""
		select coalesce(sum(
			greatest(
				ifnull(soi.qty_weight, 0)
				- ifnull(soi.qty_weight, 0) * ifnull(so.production_completed_percent, 0) / 100,
				0
			)
		), 0)
		from `tabMM Sales Order Item` soi
		join `tabMM Sales Order` so on so.name = soi.parent
		where {" and ".join(conds)}
		""",
		vals,
	)
	return float((row[0][0] if row else 0) or 0)


def _line_available(color_name, cut, exclude_order=None):
	"""Roll weight genuinely free for a NEW order: physical stock minus what other live
	orders have already claimed. Never negative — an over-committed colour is simply 0
	free, and the shortage is what the new order needs in full."""
	rows = get_roll_stock(color_name=color_name, cut=cut)
	physical = sum(float(r.get("available_weight") or 0) for r in rows)
	return max(0.0, physical - _committed_weight(color_name, cut, exclude_order))


@frappe.whitelist()
def availability_for_lines(lines, exclude_order=None):
	"""Available roll weight per (colour, cut) — lets the order builder compute the
	shortage (order weight − available) live, before the order is saved.

	`exclude_order` is the order being edited: its own claim must not count against it,
	or re-saving an order would show its own weight as a shortage.
	"""
	import json as _json

	if isinstance(lines, str):
		lines = _json.loads(lines or "[]")
	out = []
	for ln in lines or []:
		color = ln.get("color") or ln.get("color_name")
		cut = ln.get("cut")
		out.append({
			"color": color,
			"cut": cut,
			"available": round(_line_available(color, cut, exclude_order), 3),
		})
	return out


@frappe.whitelist()
def create_po_for_order(sales_order, qty_kg=0, rate=0, supplier=None, clamp_to_shortage=1):
	"""Create / update / remove the ONE draft shortage Purchase Order for a Sales Order
	(this app is one-SO-per-item, so one line → one PO). qty_kg ≤ 0 removes any existing
	draft PO. The PO stays a draft until the order is approved, then it submits with it.

	`clamp_to_shortage` (default on) recomputes the real shortage server-side and caps the
	requested qty to it — so a client working from stale/never-fetched availability can't
	raise a PO for stock that is actually covered."""
	so = frappe.get_doc("MM Sales Order", sales_order)
	qty = round(float(qty_kg or 0), 3)
	it = so.items[0] if so.items else None

	if qty > 0 and frappe.utils.cint(clamp_to_shortage) and it:
		short = round(max(0.0, float(it.qty_weight or 0) - _line_available(it.color_name, it.cut, so.name)), 3)
		qty = min(qty, short)
	existing = frappe.db.get_value("MM Purchase Order", {"sales_order": so.name, "docstatus": 0}, "name")

	if qty <= 0:
		if existing:
			frappe.delete_doc("MM Purchase Order", existing, ignore_permissions=True)
		return {"po": None, "qty": 0}

	if existing:
		po = frappe.get_doc("MM Purchase Order", existing)
		po.qty_kg = qty
		po.rate = float(rate or 0)
		po.supplier = supplier or None
		if it:
			po.color, po.cut, po.so_item = it.color_name, it.cut, it.name
		po.save(ignore_permissions=True)
		return {"po": po.name, "qty": qty}

	po = frappe.get_doc(
		{
			"doctype": "MM Purchase Order",
			"transaction_date": frappe.utils.today(),
			"branch": so.branch,
			"location": so.location,
			"sales_order": so.name,
			"so_item": it.name if it else None,
			"supplier": supplier or None,
			"color": it.color_name if it else None,
			"cut": it.cut if it else None,
			"qty_kg": qty,
			"rate": float(rate or 0),
			"delivery_date": (it.delivery_date if it else None) or so.get("delivery_date"),
		}
	)
	po.insert(ignore_permissions=True)
	return {"po": po.name, "qty": qty}


@frappe.whitelist()
def sync_shortage_pos(sales_order, lines=None, clamp_to_shortage=1):
	"""Create / update / remove the draft shortage Purchase Orders for a Sales Order —
	ONE PER SHORT ITEM, so a multi-item order can carry more than one PO.

	`lines` is [{idx | so_item, qty_kg, rate, supplier}] — `idx` is the 1-based row number,
	which lets the caller identify rows it has just created without knowing their child
	names. Any draft PO for this order whose item is absent from the list (or listed with
	qty <= 0) is deleted, so unticking a line or covering its shortage cleans up after
	itself. Submitted POs are never touched.

	With `clamp_to_shortage` (the default) quantities are re-clamped to the real server-side
	shortage, so a client working from stale availability can't raise a PO for stock that is
	actually covered. Pass 0 when the operator is editing an existing PO by hand from the
	order view — there the typed weight is deliberate, and clamping it against stock that
	has arrived since would silently shrink or delete their purchase order.

	Unlike `create_po_for_order` this never *implicitly* raises anything: the caller passes
	exactly the lines the user chose in the purchase dialog, and nothing else is created.

	A line whose purchase order is already SUBMITTED is left alone and reported back in
	`locked`: it is a live commitment to a supplier, not a draft to be rewritten, and
	silently raising a second one for the same line is the one outcome nobody wants.
	"""
	import json as _json

	if isinstance(lines, str):
		lines = _json.loads(lines or "[]")
	so = frappe.get_doc("MM Sales Order", sales_order)
	by_name = {it.name: it for it in so.items}
	by_idx = {int(it.idx): it for it in so.items}

	wanted = {}
	for ln in lines or []:
		it = by_name.get(ln.get("so_item"))
		if not it and ln.get("idx") is not None:
			it = by_idx.get(int(ln["idx"]))
		if not it:
			continue
		qty = round(float(ln.get("qty_kg") or 0), 3)
		if qty <= 0:
			continue
		if frappe.utils.cint(clamp_to_shortage):
			short = round(max(0.0, float(it.qty_weight or 0) - _line_available(it.color_name, it.cut, so.name)), 3)
			qty = min(qty, short)
			if qty <= 0:
				continue
		wanted[it.name] = {"item": it, "qty": qty, "rate": float(ln.get("rate") or 0), "supplier": ln.get("supplier") or None}

	created, removed, locked = [], [], []
	existing = frappe.get_all(
		"MM Purchase Order", filters={"sales_order": so.name, "docstatus": 0}, fields=["name", "so_item"]
	)
	by_item = {e.so_item: e.name for e in existing}
	# Approving an order submits its purchase orders, and a submitted one is not a draft to
	# be rewritten. Now that an approved order stays editable, this function can be reached
	# with the line's PO already submitted — and looking only at drafts, it would have
	# raised a SECOND purchase order for the same line and left the order carrying two.
	submitted = {
		e.so_item: e.name
		for e in frappe.get_all(
			"MM Purchase Order",
			filters={"sales_order": so.name, "docstatus": 1},
			fields=["name", "so_item"],
		)
		if e.so_item
	}
	for so_item in list(wanted):
		if so_item in submitted:
			locked.append(submitted[so_item])
			wanted.pop(so_item)

	# Drop drafts for lines the user no longer wants a PO on. A line whose PO is already
	# submitted was removed from `wanted` above, so its draft — if any — is untouched here.
	for e in existing:
		if e.so_item not in wanted and e.so_item not in submitted:
			frappe.delete_doc("MM Purchase Order", e.name, ignore_permissions=True)
			removed.append(e.name)

	for so_item, w in wanted.items():
		it = w["item"]
		if so_item in by_item:
			po = frappe.get_doc("MM Purchase Order", by_item[so_item])
			po.qty_kg, po.rate, po.supplier = w["qty"], w["rate"], w["supplier"]
			po.color, po.cut, po.so_item = it.color_name, it.cut, it.name
			po.save(ignore_permissions=True)
		else:
			po = frappe.get_doc(
				{
					"doctype": "MM Purchase Order",
					"transaction_date": frappe.utils.today(),
					"branch": so.branch,
					"location": so.location,
					"sales_order": so.name,
					"so_item": it.name,
					"supplier": w["supplier"],
					"color": it.color_name,
					"cut": it.cut,
					"qty_kg": w["qty"],
					"rate": w["rate"],
					"delivery_date": it.delivery_date or so.get("delivery_date"),
				}
			)
			po.insert(ignore_permissions=True)
		created.append(po.name)

	return {"created": created, "removed": removed, "locked": locked}


@frappe.whitelist()
def get_so_stock_status(sales_order):
	"""SRS 5.1: per-line stock visibility for a Sales Order, flagging shortfalls
	that should trigger a Purchase Order."""
	so = frappe.get_doc("MM Sales Order", sales_order)
	lines = []
	any_short = False
	for it in so.items:
		required = float(it.qty_weight or 0)
		available = _line_available(it.color_name, it.cut, so.name)
		short = round(max(0.0, required - available), 3)
		if short > 0:
			any_short = True
		lines.append(
			{
				"color_name": it.color_name,
				"cut": it.cut,
				"required": round(required, 3),
				"available": round(available, 3),
				"short": short,
				"purchase_rate": float(it.purchase_rate or 0),
			}
		)
	# Purchase Orders already raised for this Sales Order — so the UI can show them
	# instead of offering to create yet another. `status` may not be synced pre-migrate.
	po_fields = ["name", "qty_kg", "supplier"]
	if frappe.db.has_column("MM Purchase Order", "status"):
		po_fields.append("status")
	pos = frappe.get_all(
		"MM Purchase Order", filters={"sales_order": so.name}, fields=po_fields, order_by="creation asc"
	)
	return {
		"sales_order": so.name,
		"party": so.party,
		"lines": lines,
		"any_short": any_short,
		"pos": pos,
		"any_po": bool(pos),
	}


@frappe.whitelist()
def create_purchase_order_from_so(sales_order, full=0):
	"""Ensure one draft MM Purchase Order per Sales Order line. Idempotent and deduped
	by the SO line (so_item): if a PO already exists for that line, its qty is updated
	instead of inserting a duplicate. Returns the affected PO names.

	`full`: when truthy, the PO covers the line's FULL ordered weight regardless of
	current stock (the always-available "Create Purchase Order" action). When falsy,
	only the shortfall is ordered — lines already covered by stock are skipped."""
	full = frappe.utils.cint(full)
	so = frappe.get_doc("MM Sales Order", sales_order)
	# Material bought in fixed lots: the shortfall is what is NEEDED, the lot is what can
	# actually be bought, so the generated figure is raised to the next whole lot. Rounded
	# UP and never down — buying less than the shortfall leaves the order short, which is
	# the one outcome raising the PO was meant to prevent. A hand-typed quantity is refused
	# outright rather than adjusted (MMPurchaseOrder._enforce_qty_multiple); this is the
	# app proposing a number, not silently correcting the operator's.
	step = 0.0
	if so.get("enforce_purchase_multiple"):
		from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
			get_purchase_qty_multiple,
		)

		step = round(float(get_purchase_qty_multiple() or 0), 3)

	def to_lot(qty):
		"""The smallest whole number of lots that covers `qty`.

		The near-exact case takes the NEAREST lot count, not the floored one: 1799.9999 kg
		is 3 lots of 600 that a float lost a fraction of, and flooring it bought 2 — a
		whole lot short of the shortfall this exists to cover.
		"""
		if step <= 0 or qty <= 0:
			return qty
		ratio = qty / step
		nearest = round(ratio)
		lots = nearest if abs(ratio - nearest) < 1e-6 else int(ratio) + 1
		return round(max(lots, 1) * step, 3)

	created, updated, rounded = [], [], []
	for it in so.items:
		required = float(it.qty_weight or 0)
		if full:
			qty = round(required, 3)
		else:
			qty = round(max(0.0, required - _line_available(it.color_name, it.cut, so.name)), 3)
		if qty <= 0:
			continue
		lot_qty = to_lot(qty)
		if lot_qty != qty:
			rounded.append((it.color_name, qty, lot_qty))
			qty = lot_qty
		existing = frappe.db.get_value("MM Purchase Order", {"so_item": it.name}, "name")
		if existing:
			po = frappe.get_doc("MM Purchase Order", existing)
			po.qty_kg = qty
			po.save(ignore_permissions=True)
			updated.append(po.name)
			continue
		po = frappe.get_doc(
			{
				"doctype": "MM Purchase Order",
				"transaction_date": frappe.utils.today(),
				"branch": so.branch,
				"location": so.location,
				"sales_order": so.name,
				"so_item": it.name,
				"supplier": it.purchase_party or None,
				"color": it.color_name,
				"cut": it.cut,
				"qty_kg": qty,
				"rate": it.purchase_rate or 0,
				"delivery_date": it.delivery_date or so.get("delivery_date"),
			}
		)
		po.insert(ignore_permissions=True)
		created.append(po.name)
	if rounded:
		frappe.msgprint(
			_("Rounded up to whole {0} kg lots: {1}.").format(
				step,
				", ".join(f"{c or '—'} {a} → {b} kg" for c, a, b in rounded),
			),
			alert=True,
		)
	if not created and not updated:
		frappe.msgprint(
			_("No lines to purchase — every line is box-only or has zero weight.")
			if full
			else _("All lines have enough stock — no Purchase Order needed.")
		)
	return {"created": created, "updated": updated}
