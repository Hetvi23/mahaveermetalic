# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import getdate

from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	get_inward_match_tolerance,
)


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
		self._guard_state()
		self._validate_lines()
		self._derive_box_weights()
		self._require_weight_or_box()
		self._compute_ordered_weight()
		self._prevent_duplicate_order()
		self._enforce_lock_rules()

	def _guard_state(self):
		"""A new order starts Pending; a cancelled one is closed to further edits.

		Rejected is deliberately NOT blocked — being editable, under its own number, is what
		makes a rejection something the admin can fix and approve rather than a deletion.
		Saving a rejected order leaves it rejected until an admin approves it, so nobody can
		quietly slip a rejected order back into play by re-saving it.
		"""
		if self.is_new():
			if not self.order_state:
				self.order_state = "Pending"
			return
		prev = self.get_doc_before_save()
		if prev and prev.order_state == "Cancelled":
			frappe.throw(_("Order {0} is cancelled and can no longer be edited.").format(self.name))
		if prev and prev.order_state and self.order_state != prev.order_state:
			# The state moves through approve / reject / cancel, never by editing the field.
			self.order_state = prev.order_state

	def before_update_after_submit(self):
		"""Approval is no longer the end of editing — receipt is.

		Frappe runs NONE of `validate` on an update-after-submit: only this hook fires
		(document.py, run_before_save_methods). So every line rule and the weight totals
		have to be re-run here by hand, or an approved order could be edited into a state
		a draft would have been refused for, and `ordered_weight` would silently go stale
		while `required_weight` kept being measured against it.
		"""
		self._guard_post_approval_edit()
		self._guard_purchased_lines_kept()
		self._validate_lines()
		self._derive_box_weights()
		self._require_weight_or_box()
		self._compute_ordered_weight()

	def _guard_purchased_lines_kept(self):
		"""A line with a live purchase order behind it cannot be deleted.

		MM Purchase Order.so_item is a Data field, not a Link, so Frappe's link-integrity
		check does not see it — removing the line would leave a submitted purchase order
		pointing at a row that no longer exists. Nothing would raise; the PO would simply
		drop out of the order's purchase table, still committed to a supplier, with nobody
		told. Cancel the purchase order first, deliberately.
		"""
		prev = self.get_doc_before_save()
		if not prev:
			return
		kept = {row.name for row in self.items if row.name}
		gone = [row for row in prev.items if row.name and row.name not in kept]
		if not gone:
			return
		for row in gone:
			po = frappe.get_all(
				"MM Purchase Order",
				filters={"sales_order": self.name, "so_item": row.name, "docstatus": ["<", 2]},
				fields=["name", "docstatus"],
				limit=1,
			)
			if po:
				frappe.throw(
					_("Row {0} ({1}) has purchase order {2} against it, so it can't be removed. "
					  "Cancel that purchase order first.").format(row.idx, row.color_name or "—", po[0].name)
				)

	def _guard_post_approval_edit(self):
		"""What may still be changed once an order is approved.

		Approval used to be a point of no return. It is not: the customer moves a delivery
		date or a rate while the order is still only paperwork, and the alternative was
		cancelling a live order and re-keying it under a new number. RECEIPT is the real
		point of no return — once material has arrived against the order, its lines have
		stock filed under them and changing them would leave the two disagreeing.

		Cancelled stays closed for good, and the approval state itself is never editable:
		it moves through approve / reject / cancel, never by writing the field.
		"""
		if self.order_state == "Cancelled" or self.docstatus == 2:
			frappe.throw(_("Order {0} is cancelled and can no longer be edited.").format(self.name))
		if order_has_inward(self.name):
			frappe.throw(
				_("Order {0} already has inward received against it, so it can't be changed. "
				  "Raise a goods return (GR) for that inward first.").format(self.name)
			)
		prev = self.get_doc_before_save()
		if prev and prev.order_state and self.order_state != prev.order_state:
			self.order_state = prev.order_state

	def on_update_after_submit(self):
		"""Submit any purchase order raised AFTER the sales order was approved.

		`on_submit` runs once and never again, so a PO added during a post-approval edit
		would have sat as a draft forever — invisible to receiving, and quietly dropped by
		the order's own cancel path, which only reverses SUBMITTED purchase orders.
		"""
		for po in self._linked_pos(docstatus=0):
			frappe.get_doc("MM Purchase Order", po).submit()

	def on_submit(self):
		# Approving the order (submit) locks it AND submits its shortage purchase order(s).
		for po in self._linked_pos(docstatus=0):
			frappe.get_doc("MM Purchase Order", po).submit()
		# Submitting IS approval, however it was reached (the API, or the desk) — so the state
		# follows the docstatus rather than depending on which door was used.
		self.db_set("order_state", "Approved", update_modified=False)

	def on_cancel(self):
		# Cancelling the order cancels its purchase order(s) too.
		self.ignore_linked_doctypes = ("MM Purchase Order",)
		for po in self._linked_pos(docstatus=1):
			frappe.get_doc("MM Purchase Order", po).cancel()
		# Cancelled is final. `cancel_order` records who and why; this keeps the state honest
		# even when someone cancels straight from the desk.
		self.db_set("order_state", "Cancelled", update_modified=False)

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
			if (it.get("weight_per_box") or 0) < 0:
				frappe.throw(_("Row #{0}: weight per box cannot be negative.").format(it.idx))
			# Size (cut) is optional; only validate the format when one is entered.
			cut = (it.cut or "").strip()
			if cut and re.search(r"[A-Za-z]", cut):
				frappe.throw(_("Row #{0}: size must not contain letters (digits only, e.g. 50/85).").format(it.idx))

	# NOTE: Purchase Orders are NO LONGER auto-generated on save. A PO is created only
	# on demand, for lines that are short on stock, via the "Create PO for shortfall"
	# action (api.stock.create_purchase_order_from_so). This is the requested behaviour:
	# no stock shortfall → no PO.

	def _derive_box_weights(self):
		"""A line ordered in BOXES gets its weight from the box, not from a second keystroke.

		"25 boxes" used to be entered alongside a weight somebody had worked out on paper,
		so the two could disagree the moment either was edited — and every ceiling
		downstream is measured against the weight. The per-box weight is asked for instead
		and the line weight follows from it; the weight field is read-only on the form for
		the same reason. One number, not two that have to be kept in step by hand.

		A line with no box qty is left entirely alone: plenty of material is still ordered
		by weight, and inventing a box count for it would be worse than leaving it be.

		Lines keyed BEFORE this existed carry a box qty and a typed weight and no per-box
		figure. They keep their weight and have the per-box figure derived from it, so the
		line becomes self-consistent without restating what the customer ordered. Only a box
		line with no weight at all has to be told, because nothing else can supply it.
		"""
		for it in self.items:
			box = float(it.qty_box or 0)
			if box <= 0:
				continue
			per = float(it.get("weight_per_box") or 0)
			if per > 0:
				it.qty_weight = round(box * per, 3)
			elif float(it.qty_weight or 0) > 0:
				it.weight_per_box = round(float(it.qty_weight) / box, 3)
			else:
				frappe.throw(
					_("Row #{0}: enter the weight per box — the line's weight is worked out "
					  "from it.").format(it.idx)
				)

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
		"""Order weight = sum of line weights. Required = ordered − already inwarded.

		The box count is summed the same way, because an order placed in boxes is judged
		Complete on boxes (see `fulfilment_state`) and that figure has to be stored rather
		than re-derived by every screen that asks.
		"""
		total = sum(float(i.qty_weight or 0) for i in self.items)
		self.ordered_weight = round(total, 3)
		self.required_weight = round(total - float(self.inwarded_weight or 0), 3)
		self.ordered_box = round(sum(float(i.qty_box or 0) for i in self.items), 3)

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
	# Stock-only rows are surplus bought over and above what was sold: they come into
	# stock and count against the PURCHASE order, but they never fulfil the sales order,
	# so Inwards (Kg) / Required (Kg) must not see them.
	inwarded = frappe.db.sql(
		"""
		select coalesce(sum(ii.weight), 0)
		from `tabMM Inward Item` ii
		join `tabMM Inward` i on i.name = ii.parent
		where ii.customer_order = %s and i.docstatus = 1
			and ifnull(ii.to_inventory, 0) = 0
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
	_clear_legacy_inward_completion(order)


def _clear_legacy_inward_completion(order):
	"""Receiving material no longer closes an order. This unpicks the old stamp.

	Inward used to set completed=1 / completion_mode="Inward" the moment the received
	weight matched the order, and FOUR pickers key off `completed`: stock commitment,
	Add Program, further inward, and the production order list. So the order the floor
	had just taken delivery of promptly vanished from every screen that could turn it
	into goods — received, and unworkable.

	`completed` now means one thing only: the order is FULFILLED. Which is Dispatch (the
	challans cover it) or Force (an admin said so). Material arriving is not either, so
	an order still carrying the old Inward stamp is released here as its inwards move.
	A patch clears the ones that will never be touched again.
	"""
	if frappe.db.get_value("MM Sales Order", order, "completion_mode") != "Inward":
		return
	frappe.db.set_value(
		"MM Sales Order", order,
		{"completed": 0, "completion_mode": "", "completed_on": None},
		update_modified=False,
	)


def mark_dispatched(order):
	"""Re-decide an order's completion from the challans standing against it.

	A submitted challan used to close the order outright, whatever it carried — so a
	200 kg part-delivery marked a 1,200 kg order done. The order is closed only once the
	dispatched weight REACHES the ordered weight (within the variance limit), and a
	cancelled challan reopens it, because the same recount runs both ways.

	Force stays: an admin closing an order by hand outranks the arithmetic.
	"""
	if not order:
		return
	row = frappe.db.get_value(
		"MM Sales Order", order, ["ordered_weight", "ordered_box", "completion_mode"], as_dict=True
	)
	if not row or row.completion_mode == "Force":
		return
	sent = dispatched_by_order([order]).get(order) or {"weight": 0.0, "box": 0.0}
	state = fulfilment_state(
		row.ordered_weight, sent["weight"], tol=get_inward_match_tolerance(),
		ordered_box=row.get("ordered_box"), dispatched_box=sent["box"],
	)
	if state == "Complete":
		frappe.db.set_value(
			"MM Sales Order", order,
			{"completed": 1, "completion_mode": "Dispatch", "completed_on": frappe.utils.now()},
			update_modified=False,
		)
	elif row.completion_mode == "Dispatch":
		# It was closed by dispatch and no longer is — a challan was cancelled or amended.
		frappe.db.set_value(
			"MM Sales Order", order,
			{"completed": 0, "completion_mode": "", "completed_on": None},
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
	cutting / production. Restricted to MM Admin (submit permission).

	A REJECTED order comes through here too — that is the whole point of rejecting rather
	than deleting: the admin fixes what was wrong and approves the same order, under the same
	number. A CANCELLED one never does; cancelling is final.
	"""
	if not is_mm_admin():
		frappe.throw(_("Only an admin can approve orders."))
	doc = frappe.get_doc("MM Sales Order", sales_order)
	if doc.order_state == "Cancelled" or doc.docstatus == 2:
		frappe.throw(_("Order {0} is cancelled and can't be approved.").format(doc.name))
	if doc.docstatus == 0:
		doc.submit()
		doc.reload()
	return _set_state(doc, "Approved", submitted=True)


def _set_state(doc, state, reason=None, submitted=False):
	"""Stamp the order's state, who changed it and why, and leave a comment behind.

	Written with db_set because this runs on submitted documents too, and because the state
	is an annotation on the order rather than a reason to re-run its validation.
	"""
	values = {
		"order_state": state,
		"state_reason": (reason or "").strip() or None,
		"state_changed_on": frappe.utils.now(),
		"state_changed_by": frappe.session.user,
	}
	for field, value in values.items():
		doc.db_set(field, value, update_modified=False)
	doc.add_comment("Comment", _("Order {0} by {1}{2}").format(
		state.lower(), frappe.session.user, f": {reason}" if reason else ""
	))
	return {
		"order": doc.name,
		"docstatus": doc.docstatus,
		"order_state": state,
		"approval_status": state,
		"submitted": submitted,
	}


def order_has_inward(order) -> bool:
	"""Has anything been received against this order? Editing and cancelling stop there."""
	return bool(
		frappe.db.sql(
			"""select 1 from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
			where ii.customer_order = %s and i.docstatus = 1 limit 1""",
			(order,),
		)
	)


@frappe.whitelist()
def reject_order(sales_order, reason=None):
	"""Admin rejection — SENT BACK, not destroyed.

	A rejected order keeps its number and stays a draft, so the admin can edit it and approve
	it afterwards. It used to be DELETED and its number handed back to the counter for the
	next order to reuse; that is gone. A number that was issued stays issued: reusing it made
	two different orders share an id in the books, and there was nothing left to re-approve.

	An APPROVED order cannot be rejected — approval has already sent it down the line. Kill
	it with `cancel_order` instead, which says so permanently.
	"""
	if not is_mm_admin():
		frappe.throw(_("Only an admin can reject orders."))
	doc = frappe.get_doc("MM Sales Order", sales_order)
	if doc.docstatus == 1:
		frappe.throw(
			_("Order {0} is already approved, so it can't be sent back. Cancel it instead — "
			  "that closes it for good.").format(doc.name)
		)
	if doc.docstatus == 2 or doc.order_state == "Cancelled":
		frappe.throw(_("Order {0} is cancelled.").format(doc.name))
	return _set_state(doc, "Rejected", reason)


@frappe.whitelist()
def cancel_order(sales_order, reason=None):
	"""Cancel an order — closed for good.

	Permanent by design, and the counterpart to a rejection: rejected means "fix it and bring
	it back", cancelled means "this order is over". The number STAYS RESERVED either way, so
	nothing else can ever be filed under it.

	An approved order is cancelled properly (docstatus 2, its purchase orders with it). A
	pending or rejected one has nothing submitted to reverse, so it stays a draft, marked
	Cancelled and locked out of editing and approval. An order that has already received
	material is refused: return the inward (GR) first, or the stock and the order disagree.
	"""
	if not is_mm_admin():
		frappe.throw(_("Only an admin can cancel orders."))
	doc = frappe.get_doc("MM Sales Order", sales_order)
	if doc.order_state == "Cancelled" or doc.docstatus == 2:
		return {"order": doc.name, "docstatus": doc.docstatus, "order_state": "Cancelled",
			"approval_status": "Cancelled", "already": True}
	if order_has_inward(doc.name):
		frappe.throw(
			_("Order {0} has inward received against it, so it can't be cancelled. Raise a "
			  "goods return (GR) for that inward first.").format(doc.name)
		)
	if doc.docstatus == 1:
		doc.cancel()
		doc.reload()
		return _set_state(doc, "Cancelled", reason)
	# A draft: nothing was submitted, so there is nothing to reverse — drop the shortage PO
	# that was raised with it and close the order where it stands.
	for po in frappe.get_all("MM Purchase Order", filters={"sales_order": doc.name, "docstatus": 0}, pluck="name"):
		frappe.delete_doc("MM Purchase Order", po, ignore_permissions=True, force=True)
	return _set_state(doc, "Cancelled", reason)


def assert_order_editable(order):
	"""An order may be changed until material arrives against it.

	Approval is NOT the cut-off any more. An approved order is agreed, not delivered, and
	the customer still moves a date or a rate on it; refusing meant cancelling a live order
	and re-keying it under a new number. RECEIPT is the cut-off: once an inward stands
	against the order there is stock filed under its lines, and editing them would leave
	the two disagreeing. A CANCELLED order is closed for good — rejected is the state that
	comes back.
	"""
	if not order or not frappe.db.exists("MM Sales Order", order):
		return
	row = frappe.db.get_value("MM Sales Order", order, ["docstatus", "order_state"], as_dict=True)
	if row.order_state == "Cancelled" or row.docstatus == 2:
		frappe.throw(_("Order {0} is cancelled and can no longer be edited.").format(order))
	if order_has_inward(order):
		frappe.throw(
			_("Order {0} already has inward received against it, so its lines can't be "
			  "changed. Return that inward (GR) first.").format(order)
		)


def assert_order_submitted(order):
	"""Guard for downstream flows (inward / cutting / production): the referenced order
	must be APPROVED (submitted). A pending order isn't usable yet; a rejected one is waiting
	on the admin; a cancelled one is closed."""
	if not order:
		return
	row = frappe.db.get_value("MM Sales Order", order, ["docstatus", "order_state"], as_dict=True)
	if not row:
		return
	if row.order_state == "Cancelled" or row.docstatus == 2:
		frappe.throw(_("Order {0} is cancelled.").format(order))
	if row.order_state == "Rejected":
		frappe.throw(
			_("Order {0} was rejected — an admin has to edit and approve it before it can be "
			  "used.").format(order)
		)
	if row.docstatus == 0:
		frappe.throw(_("Order {0} is pending admin approval — it can't be used until approved.").format(order))


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
def order_line_summary(orders=None):
	"""Per-order line detail for the list: colours, and the purchase/sale rate pair.

	Purchase and sale rate belong on the same row — that is the whole point of showing
	them together: what the material cost against what it sold for, readable at a glance
	without opening the order. A multi-line order has more than one of each, so the range
	is carried rather than a single figure pretending to be the only one.
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
		fields=["parent", "color_name", "cut", "purchase_rate", "sale_rate"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	)

	out = {}
	for r in rows:
		e = out.setdefault(r.parent, {"colours": [], "cuts": [], "p_rates": [], "s_rates": []})
		if r.color_name and r.color_name not in e["colours"]:
			e["colours"].append(r.color_name)
		if r.cut and r.cut not in e["cuts"]:
			e["cuts"].append(r.cut)
		if float(r.purchase_rate or 0) > 0:
			e["p_rates"].append(float(r.purchase_rate))
		if float(r.sale_rate or 0) > 0:
			e["s_rates"].append(float(r.sale_rate))

	def rng(vals):
		"""One rate, or the spread when the lines disagree — never a misleading average."""
		if not vals:
			return None
		lo, hi = min(vals), max(vals)
		return {"lo": round(lo, 2), "hi": round(hi, 2), "same": lo == hi}

	for e in out.values():
		e["purchase_rate"] = rng(e.pop("p_rates"))
		e["sale_rate"] = rng(e.pop("s_rates"))
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


# ── The states an order is read by ──────────────────────────────────
# They answer different questions and are deliberately kept apart:
#   Approval   — has an admin accepted this order? (Pending / Accepted / Rejected)
#   Fulfilment — has all of it gone out? (Complete / Incomplete) — the order status
#   Purchase   — has a purchase order been raised, and has its material arrived?
# All are derived here so the order list and the order register cannot disagree.


def purchase_state(ordered, inwarded, has_po=False, tol=None):
	"""Completed / Partial / Pending, from what the order needs against what came in.

	Judged on the ORDER's requirement rather than the purchase order's own weight: a PO
	raised for only part of a shortage still leaves the order short, and it is the order
	the floor is asking about. The same tolerance the inward auto-complete uses decides
	"met", so a receipt that closes an order cannot simultaneously read as Partial here.
	"""
	ordered = float(ordered or 0)
	inwarded = float(inwarded or 0)
	if inwarded <= 0:
		# Nothing bought and nothing arrived: there is no purchase to have a state. "Pending"
		# read as "a purchase order is waiting on someone" on an order where none was ever
		# raised — an empty state is the honest answer, and the list shows it as a blank cell.
		return "Pending" if has_po else ""
	if ordered <= 0:
		# Nothing to measure against (a box-only order), but material did arrive.
		return "Completed"
	if tol is None:
		tol = get_inward_match_tolerance()
	if inwarded >= ordered * (1 - tol / 100.0):
		return "Completed"
	return "Partial"


def fulfilment_state(ordered, dispatched, completion_mode=None, tol=None,
	ordered_box=0, dispatched_box=0):
	"""Complete / Incomplete — THE order status, and the only two values it has.

	Measured on what has GONE OUT, not what came in: an order is finished when challans
	covering it have been raised off production (or as a straight sales challan) for the
	whole ordered weight, within the variance limit. 800 kg dispatched against a 1,200 kg
	order is Incomplete — receiving the material is not delivering it.

	`completion_mode` is the only thing that can override the arithmetic:
	  · Force    — an admin closed the order by hand, and that sticks;
	  · Dispatch — `mark_dispatched` already found the challans cover it.
	Inward-mode completion is deliberately NOT honoured here: material arriving says
	nothing about whether the customer has had it.

	AN ORDER PLACED IN BOXES IS JUDGED IN BOXES. The shop sells a colour as so many boxes,
	and the weight of that order is worked out from the box (see `_derive_box_weights`) —
	so measuring delivery in kg asks a question nobody placed the order in. 24 of 25 boxes
	is what "one box short" looks like, and the kilos it happens to weigh are a consequence,
	not the promise. Weight remains the measure for every line ordered by weight, which is
	most of them.

	`tol` lets a caller looping over a whole register read the tolerance once instead of
	once per row — it is a raw settings query, and a 600-order report would make 600.
	"""
	if completion_mode in ("Force", "Dispatch"):
		return "Complete"
	if tol is None:
		tol = get_inward_match_tolerance()
	ordered_box = float(ordered_box or 0)
	if ordered_box > 0:
		# EXACTLY the boxes ordered — the tolerance does not apply to a count.
		#
		# The variance allowance exists because weight is measured: 597 kg against 600 is
		# the same delivery, weighed on a different scale on a different day. A box is
		# counted, and 24 of 25 is not 25 by any tolerance — it is one box the customer
		# has paid for and not received. Letting the weight allowance run on a box order
		# would close it two boxes short and bill it as delivered.
		return "Complete" if float(dispatched_box or 0) >= ordered_box else "Incomplete"
	ordered = float(ordered or 0)
	dispatched = float(dispatched or 0)
	if ordered <= 0:
		# Neither a weight nor a box target: anything sent out closes it.
		return "Complete" if dispatched > 0 else "Incomplete"
	return "Complete" if dispatched >= ordered * (1 - tol / 100.0) else "Incomplete"


def approval_state(docstatus, order_state=None):
	"""Pending / Accepted / Rejected / Cancelled — where the order stands with the admin.

	This is the ONLY thing the order list's status column answers, so it never blends in
	whether the goods have been received or gone out; those are separate columns with
	separate rules. Cancelled is carried even though it is not one of the three the floor
	asks for, because folding it into any of them would state something untrue about an
	order that is over.
	"""
	docstatus = int(docstatus or 0)
	if order_state == "Cancelled" or docstatus == 2:
		return "Cancelled"
	if order_state == "Rejected":
		return "Rejected"
	# The field stores "Approved" (submitting the order is what sets it); the floor reads
	# it as "Accepted", so the wording is translated here rather than migrating the data.
	return "Accepted" if docstatus == 1 or order_state == "Approved" else "Pending"


def dispatched_by_order(orders):
	"""What has gone out on submitted challans, per order — kilos AND boxes.

	The order status is decided on these figures, so they are summed the same way the
	dispatch CHECK below decides membership: job challans send material to a worker and
	fulfil nothing, and a challan line naming its own order wins over the header's.

	Boxes are carried alongside the weight because an order placed in boxes is closed on
	boxes; one query answers both rather than the register making a second pass.
	"""
	if not orders:
		return {}
	rows = frappe.db.sql(
		"""
		select coalesce(nullif(ci.sales_order, ''), c.sales_order) as so,
			coalesce(sum(ci.weight), 0) as wt, coalesce(sum(ci.qty_box), 0) as box
		from `tabMM Sales Challan` c
		join `tabMM Sales Challan Item` ci on ci.parent = c.name
		where c.docstatus = 1
			and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
			and coalesce(nullif(ci.sales_order, ''), c.sales_order) in %(o)s
		group by so
		""",
		{"o": tuple(orders)},
		as_dict=True,
	)
	return {
		r.so: {"weight": round(float(r.wt or 0), 3), "box": round(float(r.box or 0), 3)}
		for r in rows if r.so
	}


def dispatched_weight_by_order(orders):
	"""Just the kilos, for callers that only ask about weight."""
	return {k: v["weight"] for k, v in dispatched_by_order(orders).items()}


def dispatched_box_by_order(orders):
	"""Just the boxes."""
	return {k: v["box"] for k, v in dispatched_by_order(orders).items()}


def order_dispatched_weight(order) -> float:
	"""The same figure for one order."""
	return dispatched_weight_by_order([order]).get(order, 0.0) if order else 0.0


def orders_with_dispatch(orders):
	"""The subset of `orders` that have a submitted Sales challan against them."""
	if not orders:
		return set()
	rows = frappe.db.sql(
		"""
		select distinct coalesce(ci.sales_order, c.sales_order) as so
		from `tabMM Sales Challan` c
		left join `tabMM Sales Challan Item` ci on ci.parent = c.name
		where c.docstatus = 1
			and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
			and (c.sales_order in %(o)s or ci.sales_order in %(o)s)
		""",
		{"o": tuple(orders)},
	)
	return {r[0] for r in rows if r[0]}


@frappe.whitelist()
def order_states(orders=None):
	"""Approval, fulfilment, purchase and sales state per order, for the order list."""
	import json as _json

	if isinstance(orders, str):
		orders = _json.loads(orders or "[]")

	# No docstatus filter: a cancelled order is still on the list, and leaving it out of
	# this map left its row falling back to whatever the default badge happened to be.
	filters = {"name": ["in", orders]} if orders else {}
	rows = frappe.get_all(
		"MM Sales Order",
		filters=filters,
		fields=[
			"name", "ordered_weight", "ordered_box", "inwarded_weight", "docstatus",
			"order_state", "completed", "completion_mode",
		],
		limit_page_length=0,
	)
	names = [r.name for r in rows]

	with_po = {
		p.sales_order
		for p in frappe.get_all(
			"MM Purchase Order",
			filters={"sales_order": ["in", names], "docstatus": ["<", 2]} if names else {"name": ["in", []]},
			fields=["sales_order"],
		)
		if p.sales_order
	}
	dispatched = orders_with_dispatch(names)
	out_by = dispatched_by_order(names)
	# Whether anything has been RECEIVED against the order — one grouped query for the whole
	# list, because it is now what decides editability and the screen has to agree with the
	# server about it rather than guessing from a netted weight (a goods return can take
	# `inwarded_weight` back to zero while the inwards themselves still stand).
	with_inward = set()
	if names:
		with_inward = {
			r[0]
			for r in frappe.db.sql(
				"""
				select distinct ii.customer_order
				from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
				where i.docstatus = 1 and ii.customer_order in %(o)s
				""",
				{"o": tuple(names)},
			)
			if r[0]
		}
	tol = get_inward_match_tolerance()

	out = {}
	for r in rows:
		out[r.name] = {
			"purchase": purchase_state(r.ordered_weight, r.inwarded_weight, r.name in with_po, tol),
			"has_po": r.name in with_po,
			# Where the order stands with the admin — the list's status column.
			"approval": approval_state(r.docstatus, r.order_state),
			# The order status proper: has all of it gone out to the customer?
			"fulfilment": fulfilment_state(
				r.ordered_weight, (out_by.get(r.name) or {}).get("weight", 0), r.completion_mode, tol,
				ordered_box=r.ordered_box, dispatched_box=(out_by.get(r.name) or {}).get("box", 0),
			),
			"dispatched_weight": (out_by.get(r.name) or {}).get("weight", 0),
			"dispatched_box": (out_by.get(r.name) or {}).get("box", 0),
			"ordered_box": r.ordered_box or 0,
			# Receipt, not approval, is what closes an order to editing now.
			"has_inward": r.name in with_inward,
			# A challan against the order is the whole test: the goods have gone out.
			"sales": "Completed" if r.name in dispatched else "Pending",
		}
	return out


@frappe.whitelist()
def save_order(sales_order, header=None, items=None):
	"""Save an order that is already APPROVED, from the Orders screen.

	A plain REST PUT cannot do this job. Frappe routes any save of a submitted document
	through `update_after_submit`, and that path does two things that make it the wrong
	door here:

	  · it calls `check_permission("submit")` — and MM Sales Team and MM Operations, the
	    two roles that actually key orders, have write but deliberately NOT submit. They
	    would get a bare PermissionError on an order they are entitled to edit, while the
	    fix — granting them submit — would hand them the power to approve orders, which is
	    the one thing approval exists to keep to an admin.

	  · it refuses any field without `allow_on_submit`, which would mean flagging the whole
	    document and its child table. That flag is global: it would also let the desk edit
	    an approved order with no rules at all, since `validate` does not run on that path.

	So the edit comes through here instead, where the authorisation asked for is WRITE, the
	editability rule is checked explicitly, and `before_update_after_submit` on the
	controller still applies every line rule and recomputes the weights. Draft orders are
	untouched by this — they save the ordinary way.
	"""
	import json as _json

	if isinstance(header, str):
		header = _json.loads(header or "{}")
	if isinstance(items, str):
		items = _json.loads(items or "[]")

	doc = frappe.get_doc("MM Sales Order", sales_order)
	# Write is the right permission to demand: this is an edit, not an approval.
	doc.check_permission("write")
	if doc.docstatus != 1:
		frappe.throw(
			_("Order {0} is not approved — save it the ordinary way.").format(doc.name)
		)
	assert_order_editable(doc.name)

	# Only the fields the Orders screen owns. Everything else on the document — the state,
	# the counters, the completion — is derived, and a client must not be able to post over it.
	for field in ("transaction_date", "delivery_date", "party", "company_name",
		"enforce_purchase_multiple"):
		if header and field in header:
			doc.set(field, header.get(field))

	if items is not None:
		allowed = (
			"name", "idx", "color_name", "cut", "delivery_date", "qty_weight", "qty_box",
			"sale_rate", "purchase_party", "purchase_rate",
		)
		doc.set("items", [{k: row.get(k) for k in allowed if k in row} for row in items])

	# The two flags are what let a submitted document be saved at all. They are safe ONLY
	# because everything they switch off has been done above by hand: permission was
	# checked as write, and the field whitelist plus `before_update_after_submit` do the
	# work `allow_on_submit` and `validate` would have done.
	doc.flags.ignore_permissions = True
	doc.flags.ignore_validate_update_after_submit = True
	doc.save()
	doc.reload()
	return {
		"order": doc.name,
		"docstatus": doc.docstatus,
		"order_state": doc.order_state,
		"ordered_weight": doc.ordered_weight,
		"required_weight": doc.required_weight,
	}
