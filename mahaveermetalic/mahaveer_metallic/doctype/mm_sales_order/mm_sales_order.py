# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import make_autoname

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
		self._require_weight_or_box()
		self._compute_ordered_weight()
		self._prevent_duplicate_order()
		self._enforce_lock_rules()

	def on_update(self):
		self._sync_purchase_orders()

	def _require_weight_or_box(self):
		"""Each line must carry a Weight or a Box quantity (at least one, both allowed)."""
		for it in self.items:
			if (it.qty_weight or 0) <= 0 and (it.qty_box or 0) <= 0:
				frappe.throw(
					_("Row #{0}: enter a Weight or a Box quantity (at least one is required).").format(it.idx)
				)

	def _sync_purchase_orders(self):
		"""One Purchase Order per order line that names a supplier. Idempotent: a PO is
		matched back by its so_item ref, so re-saving the order updates the existing PO
		instead of creating a duplicate. Same item + same supplier on a different order
		stays a separate PO (the dashboard combines them per supplier+item)."""
		for it in self.items:
			if not it.purchase_party:
				continue
			existing = frappe.db.get_value("MM Purchase Order", {"so_item": it.name}, "name")
			po = frappe.get_doc("MM Purchase Order", existing) if existing else frappe.new_doc("MM Purchase Order")
			self._fill_po(po, it)
			if existing:
				po.save(ignore_permissions=True)
			else:
				po.insert(ignore_permissions=True)

	def _fill_po(self, po, it):
		po.supplier = it.purchase_party
		po.sales_order = self.name
		po.so_item = it.name
		po.transaction_date = self.transaction_date
		po.branch = self.branch
		po.location = self.location
		po.color = it.color_name
		po.cut = it.cut
		po.qty_kg = it.qty_weight or 0
		po.qty_box = it.qty_box or 0
		po.rate = it.purchase_rate
		po.delivery_date = it.delivery_date

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
