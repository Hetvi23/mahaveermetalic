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
		"""SRS rule (non-negotiable): don't create a new order that duplicates an
		open order for the same party + colour + cut. Enforced on creation only so
		edits to an existing order are never blocked."""
		if not self.is_new():
			return
		for it in self.items:
			dup = frappe.db.sql(
				"""
				select so.name
				from `tabMM Sales Order` so
				join `tabMM Sales Order Item` soi on soi.parent = so.name
				where so.party = %s
					and so.name != %s
					and so.docstatus < 2
					and ifnull(so.production_completed_percent, 0) < 100
					and soi.color_name = %s
					and ifnull(soi.cut, '') = ifnull(%s, '')
				limit 1
				""",
				(self.party, self.name or "", it.color_name, it.cut or ""),
			)
			if dup:
				frappe.throw(
					_(
						"Open order {0} already exists for {1} — {2}/{3}. "
						"Add to that order instead of creating a duplicate."
					).format(dup[0][0], self.party, it.color_name, it.cut or "—")
				)

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
	if mode == "Force":
		return  # a manual force-complete is sticky

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
		# was auto-completed, but a cancelled/amended inward pulled it back below tolerance
		frappe.db.set_value(
			"MM Sales Order", order,
			{"completed": 0, "completion_mode": "", "completed_on": None},
			update_modified=False,
		)


@frappe.whitelist()
def force_complete_order(order, pin):
	"""Close an order regardless of inward weight, gated by the Admin Override PIN."""
	from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import verify_admin_pin

	if not order or not frappe.db.exists("MM Sales Order", order):
		frappe.throw(_("Order {0} not found.").format(order))
	if not verify_admin_pin(pin):
		frappe.throw(_("Invalid Admin Override PIN."))
	frappe.db.set_value(
		"MM Sales Order", order,
		{"completed": 1, "completion_mode": "Force", "completed_on": frappe.utils.now()},
		update_modified=False,
	)
	return {"order": order, "completed": True, "mode": "Force"}


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
