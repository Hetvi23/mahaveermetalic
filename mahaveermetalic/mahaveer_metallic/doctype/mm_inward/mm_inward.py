# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMInward(Document):
	def validate(self):
		self._set_branch_location_from_employee()
		self._set_company()
		if not self.items:
			frappe.throw(_("Add at least one inward item."))
		for row in self.items:
			if (row.weight or 0) < 0 or (row.qty_box or 0) < 0:
				frappe.throw(_("Row #{0}: weight and box cannot be negative.").format(row.idx))
			if (row.weight or 0) <= 0 and (row.qty_box or 0) <= 0:
				frappe.throw(_("Row #{0}: enter a Weight or Box quantity.").format(row.idx))
		# is_partial (a user-facing checkbox) must win even though receipt_status carries a
		# JSON default of "Complete" on desk-created inwards; only fall back to Complete
		# when nothing set it (post_inward sets it explicitly on the SPA path).
		if self.is_partial:
			self.receipt_status = "Partial"
		elif not self.receipt_status:
			self.receipt_status = "Complete"
		self._guard_challan_not_closed()

	def _guard_challan_not_closed(self):
		"""One inward per challan — unless the earlier one was Partial. A challan is
		closed once any submitted inward for it is marked Complete; block any further
		inward against a closed challan. Partial inwards leave the challan open."""
		if not self.challan_number:
			return
		closed = frappe.db.get_value(
			"MM Inward",
			{
				"challan_number": self.challan_number,
				"docstatus": 1,
				"receipt_status": "Complete",
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if closed:
			frappe.throw(
				_("Challan {0} is already fully received (inward {1}). No further inward is allowed.").format(
					self.challan_number, closed
				)
			)

	def _set_company(self):
		"""Rolls are received COMPANY-wise, not party-wise.

		Company is mandatory on the doctype, so fill it in before the mandatory check runs
		rather than blocking a receipt the system can work out for itself: take it from the
		sales order if there is one, else from the party when they have exactly one company.
		A party with several companies must be told apart by hand — guessing would file the
		stock against the wrong one.
		"""
		if self.company_name:
			return
		if self.sales_order:
			self.company_name = frappe.db.get_value("MM Sales Order", self.sales_order, "company_name")
		if not self.company_name and self.party:
			companies = frappe.get_all(
				"MM Party Company",
				filters={"parent": self.party, "parenttype": "MM Party Master"},
				pluck="company_name",
			)
			if len(companies) == 1:
				self.company_name = companies[0]
			elif len(companies) > 1:
				frappe.throw(
					_("{0} has {1} companies — choose which one this inward is for.").format(
						self.party, len(companies)
					)
				)


	def _set_branch_location_from_employee(self):
		"""Default Branch/Location from the posting (logged-in) user's MM Employee
		Master, but only when left blank — they are shown on the form and remain
		editable, so a user-set value must win."""
		if self.branch and self.location:
			return
		emp = frappe.db.get_value(
			"MM Employee Master",
			{"user": frappe.session.user},
			["branch", "location"],
			as_dict=True,
		)
		if emp:
			if not self.branch and emp.branch:
				self.branch = emp.branch
			if not self.location and emp.location:
				self.location = emp.location

	def on_submit(self):
		"""SRS 5.4 output: posting an inward increases Roll inventory."""
		self._apply_to_roll_inventory(sign=1)
		self._refresh_order_fulfilment()

	def on_cancel(self):
		self._apply_to_roll_inventory(sign=-1)
		self._refresh_order_fulfilment()
		self._release_lot()

	def _release_lot(self):
		"""Give the lot number back when a cancelled inward leaves it unused.

		Lot numbers come from max(lot_no) per colour, and cancelling an inward left its
		MM Lot behind — so cancelling LT1/26-27 and re-entering produced LT2/26-27 with a
		hole at LT1. The lot is only removed when nothing else still points at it: another
		live inward, a cutting, a program or a production keeps it.
		"""
		if not self.lot:
			return
		still_used = frappe.db.sql(
			"""
			select 1 from `tabMM Inward` where lot = %(lot)s and name != %(me)s and docstatus < 2
			union all select 1 from `tabMM Cutting`    where lot = %(lot)s and docstatus < 2
			union all select 1 from `tabMM Program`    where lot = %(lot)s and docstatus < 2
			union all select 1 from `tabMM Production` where lot = %(lot)s and docstatus < 2
			limit 1
			""",
			{"lot": self.lot, "me": self.name},
		)
		if still_used:
			return
		lot = self.lot
		self.db_set("lot", None, update_modified=False)
		try:
			frappe.delete_doc("MM Lot", lot, ignore_permissions=True, force=True)
		except Exception:
			# Something else still references it — leave the lot alone rather than fail
			# the cancellation the operator actually asked for.
			frappe.log_error(title=f"could not release lot {lot}")

	def _refresh_order_fulfilment(self):
		"""Update Inwards/Required (Kg) on every Sales Order touched by this inward
		(per-line customer_order, plus the header SO if set)."""
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
			recalculate_order_fulfilment,
		)
		from mahaveermetalic.mahaveer_metallic.doctype.mm_purchase_order.mm_purchase_order import (
			recompute_po_status_for_order,
		)

		orders = {row.customer_order for row in self.items if row.customer_order}
		if self.sales_order:
			orders.add(self.sales_order)
		for order in orders:
			recalculate_order_fulfilment(order)
			recompute_po_status_for_order(order)

	def _find_roll(self, color_name):
		"""Match the Roll Inventory row by the same key Roll Inventory dedups on
		(branch, location, lot_number, color_name). Empty Link/Data fields are
		stored as NULL, so compare in Python to avoid ''-vs-NULL mismatches."""
		candidates = frappe.get_all(
			"MM Roll Inventory",
			filters={"location": self.location, "color_name": color_name},
			fields=["name", "branch", "lot_number"],
		)
		for c in candidates:
			if (
				(c.branch or "") == (self.branch or "")
				and (c.lot_number or "") == (self.lot_number or "")
			):
				return c.name
		return None

	def _apply_to_roll_inventory(self, sign: int):
		from mahaveermetalic.mahaveer_metallic import stock_ledger

		for row in self.items:
			weight = round((row.weight or 0) * sign, 3)
			boxes = round((row.qty_box or 0) * sign, 3)
			if not weight and not boxes:
				continue

			existing = self._find_roll(row.color_name)

			if existing:
				doc = frappe.get_doc("MM Roll Inventory", existing)
				doc.stock_weight = round((doc.stock_weight or 0) + weight, 3)
				doc.stock_box = round((doc.stock_box or 0) + boxes, 3)
				doc.save(ignore_permissions=True)
			elif sign > 0:
				doc = frappe.get_doc(
					{
						"doctype": "MM Roll Inventory",
						"roll_no": row.roll_name,
						"lot_number": self.lot_number,
						"branch": self.branch,
						"location": self.location,
						"color_name": row.color_name,
						"item_type": self.item_type,
						"stock_weight": weight,
						"stock_box": boxes,
					}
				)
				doc.insert(ignore_permissions=True)
			else:
				# Cancelling but no matching stock row — nothing to reverse.
				frappe.throw(
					_("Cannot cancel: no matching roll stock for color {0} / lot {1}.").format(
						row.color_name, self.lot_number or "—"
					)
				)

			# Ledger: IN on submit, reversing OUT on cancel; balance is read back from
			# the roll row so the ledger and live inventory always agree.
			mag_w = round(row.weight or 0, 3)
			mag_b = round(row.qty_box or 0, 3)
			stock_ledger.post_movement(
				voucher_type="Inward",
				voucher_no=self.name,
				branch=self.branch,
				location=self.location,
				lot_number=self.lot_number,
				color_name=row.color_name,
				roll_no=row.roll_name,
				item_type=self.item_type,
				in_weight=mag_w if sign > 0 else 0,
				out_weight=mag_w if sign < 0 else 0,
				in_box=mag_b if sign > 0 else 0,
				out_box=mag_b if sign < 0 else 0,
				balance_weight=doc.stock_weight,
				balance_box=doc.stock_box,
				customer_order=row.customer_order or self.sales_order,
				challan_number=self.challan_number,
				remarks="Inward cancelled" if sign < 0 else None,
			)
