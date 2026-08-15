# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import getdate

def is_mm_admin() -> bool:
	roles = frappe.get_roles()
	return "MM Admin" in roles or "Administrator" in roles


class MMSalesOrder(Document):
	def autoname(self):
		"""Plain running number shared across all branches: 1, 2, 3 …
		(The 'MMSO' prefix is only the series-counter key — it is stripped off
		so the visible id is just the digits.)"""
		raw = make_autoname("MMSO.#####")  # e.g. MMSO00001
		self.name = str(int(raw[len("MMSO"):]))  # → 1

	def validate(self):
		self._validate_lines()
		self._require_weight_or_box()
		self._compute_ordered_weight()
		self._prevent_duplicate_order()
		self._enforce_lock_rules()

	def on_submit(self):
		# Approving the order (submit) locks it AND submits its shortage purchase order(s).
		for po in self._linked_pos(docstatus=0):
			frappe.get_doc("MM Purchase Order", po).submit()

	def on_cancel(self):
		# Rejecting/cancelling the order cancels its purchase order(s) too.
		self.ignore_linked_doctypes = ("MM Purchase Order",)
		for po in self._linked_pos(docstatus=1):
			frappe.get_doc("MM Purchase Order", po).cancel()

	def on_trash(self):
		# Delete the linked purchase order(s) first — otherwise Frappe's link check blocks
		# deleting the order ("linked with MM Purchase Order").
		for po in self._linked_pos():
			frappe.delete_doc("MM Purchase Order", po, ignore_permissions=True, force=True)

	def _linked_pos(self, docstatus=None):
		filters = {"sales_order": self.name}
		if docstatus is not None:
			filters["docstatus"] = docstatus
		return frappe.get_all("MM Purchase Order", filters=filters, pluck="name")

	def _validate_lines(self):
		"""Field-level order rules (mirrored in the Order screen):
		- delivery date (header + per line) not before the order date
		- weight / box / sale rate / purchase rate never negative
		- size (cut) required and digits-only (no letters, e.g. 50/85)
		"""
		order_date = getdate(self.transaction_date) if self.transaction_date else None
		if order_date and self.delivery_date and getdate(self.delivery_date) < order_date:
			frappe.throw(_("Delivery date cannot be before the order date."))
		for it in self.items:
			if order_date and it.delivery_date and getdate(it.delivery_date) < order_date:
				frappe.throw(_("Row #{0}: delivery date cannot be before the order date.").format(it.idx))
			if (it.qty_weight or 0) < 0:
				frappe.throw(_("Row #{0}: weight cannot be negative.").format(it.idx))
			if (it.qty_box or 0) < 0:
				frappe.throw(_("Row #{0}: box quantity cannot be negative.").format(it.idx))
			if (it.sale_rate or 0) < 0:
				frappe.throw(_("Row #{0}: sale rate cannot be negative.").format(it.idx))
			if (it.purchase_rate or 0) < 0:
				frappe.throw(_("Row #{0}: purchase rate cannot be negative.").format(it.idx))
			# Size (cut) is optional; only validate the format when one is entered.
			cut = (it.cut or "").strip()
			if cut and re.search(r"[A-Za-z]", cut):
				frappe.throw(_("Row #{0}: size must not contain letters (digits only, e.g. 50/85).").format(it.idx))

	# NOTE: Purchase Orders are NO LONGER auto-generated on save. A PO is created only
	# on demand, for lines that are short on stock, via the "Create PO for shortfall"
	# action (api.stock.create_purchase_order_from_so). This is the requested behaviour:
	# no stock shortfall → no PO.

	def _require_weight_or_box(self):
		"""Each line must carry a Weight or a Box quantity (at least one, both allowed)."""
		for it in self.items:
			if (it.qty_weight or 0) <= 0 and (it.qty_box or 0) <= 0:
				frappe.throw(
					_("Row #{0}: enter a Weight or a Box quantity (at least one is required).").format(it.idx)
				)

	def _prevent_duplicate_order(self):
		"""No longer blocks: a customer may hold several open orders for the same colour.

		This used to throw and tell the operator to merge into the existing order, on the
		reading that a repeat colour was a mistake. It isn't — a customer genuinely reorders
		the same colour and cut while the first order is still open, and each order has its
		own delivery date, rate and challan, so folding them together loses information and
		bills wrongly. Kept as a no-op rather than deleted so the intent stays on record.
		"""
		return

	def _compute_ordered_weight(self):
		"""Order weight = sum of line weights. Required = ordered − already inwarded."""
		total = sum(float(i.qty_weight or 0) for i in self.items)
		self.ordered_weight = round(total, 3)
		self.required_weight = round(total - float(self.inwarded_weight or 0), 3)

	def _enforce_lock_rules(self):
		if self.is_new():
			return
		prev = self.get_doc_before_save()
		if not prev or not prev.order_locked:
			return
		if is_mm_admin():
			return
		if int(self.order_locked or 0) < int(prev.order_locked or 0):
			frappe.throw(_("Only MM Admin can unlock this order."))
		if self._document_changed_from(prev):
			frappe.throw(
				_("This order is locked (production ≥ 5%). Only MM Admin may change lines or other fields.")
			)

	def _document_changed_from(self, prev) -> bool:
		ignore = {
			"production_completed_percent",
			"order_locked",
			"ordered_weight",
			"inwarded_weight",
			"required_weight",
			"modified",
			"modified_by",
		}
		for df in self.meta.fields:
			fn = df.fieldname
			if fn in ignore or df.fieldtype in ("Section Break", "Column Break", "Table", "HTML", "Button"):
				continue
			if self.get(fn) != prev.get(fn):
				return True
		if self.has_value_changed("items"):
			return True
		return False


def recalculate_order_fulfilment(order: str):
	"""Recompute Inwards (Kg) / Required (Kg) on a Sales Order by summing all
	submitted inward lines that reference it. Summing from the DB keeps the
	figures correct across submit, cancel and amend. Written with set_value so
	the SO's own lock/validate rules are not re-triggered."""
	if not order:
		return
	inwarded = frappe.db.sql(
		"""
		select coalesce(sum(ii.weight), 0)
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		where ii.customer_order = %s and i.docstatus = 1
		""",
		(order,),
	)[0][0] or 0
	ordered = frappe.db.get_value("MM Sales Order", order, "ordered_weight") or 0
	frappe.db.set_value(
		"MM Sales Order",
		order,
		{
			"inwarded_weight": round(float(inwarded), 3),
			"required_weight": round(float(ordered) - float(inwarded), 3),
		},
		update_modified=False,
	)
	_apply_inward_completion(order, float(inwarded), float(ordered))


def _apply_inward_completion(order, inwarded, ordered):
	"""Auto-complete an order once its inwarded weight reaches within the configured
	tolerance of the ordered weight. Never touches an order completed by Force (that
	stays closed); an auto (Inward) completion is released if a cancelled inward drops
	the weight back below the threshold."""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
		get_inward_match_tolerance,
	)

	mode = frappe.db.get_value("MM Sales Order", order, "completion_mode")
	if mode in ("Force", "Dispatch"):
		return  # closed by hand, or the goods have physically gone — both stick

	tol = get_inward_match_tolerance()
	# "Matched" = received has reached within tol% below the ordered weight (or more).
	matched = ordered > 0 and inwarded >= ordered * (1 - tol / 100.0)
	if matched:
		frappe.db.set_value(
			"MM Sales Order", order,
			{"completed": 1, "completion_mode": "Inward", "completed_on": frappe.utils.now()},
			update_modified=False,
		)
	elif mode == "Inward":
		# Was auto-completed, but a cancelled/amended inward pulled it back below tolerance.
		# If the goods have already gone out on a challan the order is done regardless of
		# what the inward paperwork now says — reopening it there put a dispatched order
		# back to Pending. Promote it to Dispatch instead, which sticks.
		if _has_dispatch(order):
			frappe.db.set_value(
				"MM Sales Order", order, {"completed": 1, "completion_mode": "Dispatch"},
				update_modified=False,
			)
			return
		frappe.db.set_value(
			"MM Sales Order", order,
			{"completed": 0, "completion_mode": "", "completed_on": None},
			update_modified=False,
		)


def _has_dispatch(order) -> bool:
	"""True once anything has physically left against this order on a submitted challan."""
	return bool(
		frappe.db.sql(
			"""
			select 1 from `tabMM Sales Challan` c
			left join `tabMM Sales Challan Item` ci on ci.parent = c.name
			where c.docstatus = 1
				and ifnull(c.challan_type, 'Sales') = 'Sales'
				and (c.sales_order = %(o)s or ci.sales_order = %(o)s)
			limit 1
			""",
			{"o": order},
		)
	)


def mark_dispatched(order):
	"""A submitted sales challan closes its order, and that closure sticks."""
	if not order:
		return
	frappe.db.set_value(
		"MM Sales Order", order,
		{"completed": 1, "completion_mode": "Dispatch", "completed_on": frappe.utils.now()},
		update_modified=False,
	)


@frappe.whitelist()
def force_complete_order(order, pin):
	"""Close an order regardless of inward weight, gated by the Admin Override PIN."""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import require_admin_pin

	if not order or not frappe.db.exists("MM Sales Order", order):
		frappe.throw(_("Order {0} not found.").format(order))
	require_admin_pin(pin, action=_("close this order early"))
	frappe.db.set_value(
		"MM Sales Order", order,
		{"completed": 1, "completion_mode": "Force", "completed_on": frappe.utils.now()},
		update_modified=False,
	)
	return {"order": order, "completed": True, "mode": "Force"}


@frappe.whitelist()
def approve_order(sales_order):
	"""Admin approval: submit the order (docstatus 1 = Approved), which locks it and its
	shortage purchase order(s). Only after approval can the order be used in inward /
	cutting / production. Restricted to MM Admin (submit permission)."""
	if not is_mm_admin() and "MM Admin" not in frappe.get_roles():
		frappe.throw(_("Only an admin can approve orders."))
	doc = frappe.get_doc("MM Sales Order", sales_order)
	if doc.docstatus == 0:
		doc.submit()
	return {"order": doc.name, "docstatus": doc.docstatus, "approval_status": "Approved"}


@frappe.whitelist()
def reject_order(sales_order):
	"""Admin rejection of a PENDING order.

	Frappe forbids a direct 0 -> 2 (draft -> cancelled) docstatus transition, so a pending
	order is rejected by deleting it (with its draft shortage PO first, otherwise the link
	check blocks the delete). An already-approved order is cancelled normally."""
	if not is_mm_admin() and "MM Admin" not in frappe.get_roles():
		frappe.throw(_("Only an admin can reject orders."))
	doc = frappe.get_doc("MM Sales Order", sales_order)
	if doc.docstatus == 1:
		doc.cancel()
		return {"order": doc.name, "docstatus": doc.docstatus, "approval_status": "Rejected"}
	if doc.docstatus == 0:
		for po in frappe.get_all("MM Purchase Order", filters={"sales_order": doc.name, "docstatus": 0}, pluck="name"):
			frappe.delete_doc("MM Purchase Order", po, ignore_permissions=True, force=True)
		rejected_name = doc.name
		frappe.delete_doc("MM Sales Order", doc.name, ignore_permissions=True)
		_release_order_number(rejected_name)
		return {"order": sales_order, "docstatus": None, "approval_status": "Rejected", "deleted": True}
	return {"order": doc.name, "docstatus": doc.docstatus, "approval_status": "Rejected"}


def _release_order_number(name):
	"""Give a rejected order's number back so the next order reuses it.

	Rejecting a pending order deletes it, but the naming counter had already moved on —
	so rejecting 50 left the next order as 51 and a gap in the books. Only rolls back when
	the deleted order was the LAST number issued; rejecting an older one leaves the counter
	alone, since numbers above it are already in use.
	"""
	try:
		n = int(str(name))
	except (TypeError, ValueError):
		return  # not a plain running number — nothing to reclaim
	current = frappe.db.sql("select current from `tabSeries` where name = %s for update", ("MMSO",))
	if current and int(current[0][0] or 0) == n:
		frappe.db.sql("update `tabSeries` set current = %s where name = %s", (n - 1, "MMSO"))

def assert_order_submitted(order):
	"""Guard for downstream flows (inward / cutting / production): the referenced order
	must be APPROVED (submitted). A pending (draft) order isn't usable yet; a rejected
	(cancelled) order is closed."""
	if not order:
		return
	ds = frappe.db.get_value("MM Sales Order", order, "docstatus")
	if ds is None:
		return
	if ds == 0:
		frappe.throw(_("Order {0} is pending admin approval — it can't be used until approved.").format(order))
	if ds == 2:
		frappe.throw(_("Order {0} is rejected/cancelled.").format(order))


def recalculate_production_completed(order: str):
	"""Recompute production_completed_percent on a Sales Order from the net weight of
	all submitted MM Production rows that reference it (produced net ÷ ordered weight).
	Also auto-locks the order at ≥5% (SRS). Written with set_value so the SO's own
	lock/validate rules are not re-triggered."""
	if not order:
		return
	produced = frappe.db.sql(
		"""
		select coalesce(sum(net_weight), 0)
		from `tabMM Production`
		where customer_order = %s and docstatus = 1
		""",
		(order,),
	)[0][0] or 0
	ordered = frappe.db.get_value("MM Sales Order", order, "ordered_weight") or 0
	percent = round(float(produced) / float(ordered) * 100, 2) if ordered else 0.0
	frappe.db.set_value(
		"MM Sales Order",
		order,
		{
			"production_completed_percent": percent,
			"order_locked": 1 if percent >= 5 else 0,
		},
		update_modified=False,
	)


@frappe.whitelist()
def order_colours(orders=None):
	"""Colour (and size) per Sales Order, for the list view's Color column.

	The client cannot read `MM Sales Order Item` directly — Frappe refuses a child-table
	get_list over the REST API unless a parent is supplied — so the browser's query came
	back empty and the column rendered blank for every row. Serve the map from here.

	`orders` (optional) limits the lookup to the names currently on screen.
	"""
	import json as _json

	if isinstance(orders, str):
		orders = _json.loads(orders or "[]")
	filters = {"parenttype": "MM Sales Order"}
	if orders:
		filters["parent"] = ["in", orders]
	rows = frappe.get_all(
		"MM Sales Order Item",
		filters=filters,
		fields=["parent", "color_name", "cut"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	)
	out = {}
	for r in rows:
		if not r.color_name:
			continue
		bucket = out.setdefault(r.parent, [])
		if r.color_name not in bucket:
			bucket.append(r.color_name)
	return out


@frappe.whitelist()
def purchase_status_by_order(orders=None):
	"""Purchase-order status per Sales Order, for the order list's Purchase column.

	The sales side and the purchase side of the same order were only visible on separate
	screens, so telling whether an order's material had actually been bought meant opening
	the Purchase Orders tab and matching by hand. One call carries it for the whole list.

	An order can hold more than one PO (one per short line), so the rollup takes the WORST
	state — a single Pending line means the order is not covered, whatever the others say.
	"""
	import json as _json

	if isinstance(orders, str):
		orders = _json.loads(orders or "[]")

	filters = {"docstatus": ["<", 2]}
	if orders:
		filters["sales_order"] = ["in", orders]
	fields = ["name", "sales_order", "qty_kg", "supplier", "docstatus"]
	has_status = frappe.db.has_column("MM Purchase Order", "status")
	if has_status:
		fields.append("status")

	rank = {"Pending": 0, "Partially Received": 1, "Received": 2}
	out = {}
	for po in frappe.get_all("MM Purchase Order", filters=filters, fields=fields):
		if not po.sales_order:
			continue
		status = (po.get("status") if has_status else None) or "Pending"
		cur = out.get(po.sales_order)
		if cur is None or rank.get(status, 0) < rank.get(cur["status"], 0):
			out[po.sales_order] = {
				"status": status,
				"po": po.name,
				"qty_kg": po.qty_kg,
				"supplier": po.supplier,
				"count": (cur or {}).get("count", 0) + 1,
				"submitted": bool(po.docstatus == 1),
			}
		else:
			cur["count"] = cur.get("count", 0) + 1
	return out
