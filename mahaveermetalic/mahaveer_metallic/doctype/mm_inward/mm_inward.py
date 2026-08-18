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
		# A GOODS RETURN is the same document read backwards: its rolls carry NEGATIVE weight,
		# which is what takes them back out of stock and nets the quantity off the register.
		# So the sign rules invert for it, and only for it.
		if self.is_gr:
			if not self.gr_against:
				frappe.throw(_("A goods return must say which inward it returns."))
			for row in self.items:
				if (row.weight or 0) > 0 or (row.qty_box or 0) > 0:
					frappe.throw(_("Row #{0}: a goods return's weight and box must be negative.").format(row.idx))
				if (row.weight or 0) == 0 and (row.qty_box or 0) == 0:
					frappe.throw(_("Row #{0}: nothing to return.").format(row.idx))
		else:
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
		inward against a closed challan. Partial inwards leave the challan open.

		EVERY challan on the document is checked, not just the header's: a challan belongs
		to the row it was entered on, so one inward can receive several of them and the
		header names one only when the whole inward shares it.
		"""
		from mahaveermetalic.mahaveer_metallic.api.inward import challan_closed_by

		# A return doesn't receive anything, so a closed challan is no reason to refuse it.
		if self.is_gr:
			return
		challans = {(self.challan_number or "").strip()} | {
			(row.challan_number or "").strip() for row in self.items
		}
		for challan in sorted(c for c in challans if c):
			closed = challan_closed_by(challan, exclude=self.name or "")
			if closed:
				frappe.throw(
					_("Challan {0} is already fully received (inward {1}). No further inward is allowed.").format(
						challan, closed
					)
				)

	def _set_company(self):
		"""Rolls are received COMPANY-wise, not party-wise.

		The entry screen doesn't ask for it, so work it out: from the header sales order,
		else from the first row that names one, else from the party when they have exactly
		one company. A party with several companies must be told apart by hand — guessing
		would file the stock against the wrong one.
		"""
		if self.company_name:
			return
		order = self.sales_order or next((row.customer_order for row in self.items if row.customer_order), None)
		if order:
			self.company_name = frappe.db.get_value("MM Sales Order", order, "company_name")
		if not self.company_name and self.party:
			companies = frappe.get_all(
				"MM Party Company",
				filters={"parent": self.party, "parenttype": "MM Party Master"},
				pluck="company_name",
			)
			if len(companies) == 1:
				self.company_name = companies[0]
			elif not companies:
				# No company on file for this customer — fall back to the customer's own
				# name rather than blocking the receipt on a mandatory field they have no
				# way to fill.
				self.company_name = frappe.db.get_value("MM Party Master", self.party, "party_name") or self.party
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
		"""SRS 5.4 output: posting an inward increases Roll inventory (a GR decreases it)."""
		self._apply_to_roll_inventory(sign=1)
		self._refresh_order_fulfilment()
		self._mark_returned(1)

	def on_cancel(self):
		self._block_cancel_if_dispatched()
		self._apply_to_roll_inventory(sign=-1)
		self._refresh_order_fulfilment()
		self._mark_returned(0)
		self._release_lots()

	def _mark_returned(self, on: int):
		"""Mark (or unmark) the inward this GR returns.

		The original STAYS SUBMITTED — its rolls really did arrive, and the register has to
		keep saying so. The flag is what tells the screens its quantity has been given back,
		while the GR's negative rows are what actually net it off.
		"""
		if not self.is_gr or not self.gr_against:
			return
		if not frappe.db.exists("MM Inward", self.gr_against):
			return
		if not on:
			# Another live GR may still stand against it.
			others = frappe.db.count(
				"MM Inward",
				{"gr_against": self.gr_against, "is_gr": 1, "docstatus": 1, "name": ["!=", self.name]},
			)
			if others:
				return
		frappe.db.set_value("MM Inward", self.gr_against, "gr_returned", 1 if on else 0, update_modified=False)

	def _block_cancel_if_dispatched(self):
		"""(A GR is exempt: cancelling a return puts stock BACK, it never pulls any out.)"""
		if self.is_gr:
			return
		self._block_cancel_if_dispatched_check()

	def _block_cancel_if_dispatched_check(self):
		"""Refuse to cancel an inward whose material has already gone out.

		Reversing it would pull stock the challan has already shipped, which the inventory
		guard then rejects with "Available stock cannot be negative" — true, but it tells
		the operator nothing. Name the challan and the order of operations instead.
		"""
		orders = {it.customer_order for it in self.items if it.customer_order}
		if self.sales_order:
			orders.add(self.sales_order)
		orders = {o for o in orders if o}
		if not orders:
			return
		hit = frappe.db.sql(
			"""
			select c.name, c.sales_order, ci.sales_order as line_order
			from `tabMM Sales Challan` c
			left join `tabMM Sales Challan Item` ci on ci.parent = c.name
			where c.docstatus = 1
				and ifnull(c.challan_type, 'Sales') not in ('Job Out', 'Job In', 'Job Challan')
				and (c.sales_order in %(orders)s or ci.sales_order in %(orders)s)
			limit 1
			""",
			{"orders": tuple(orders)},
			as_dict=True,
		)
		if hit:
			frappe.throw(
				_(
					"This inward can't be cancelled — its material has already been dispatched "
					"on challan {0}. Cancel that challan first, then cancel this inward."
				).format(hit[0].name)
			)

	def _release_lots(self):
		"""Give the lot numbers back when a cancelled inward leaves them unused.

		Lot numbers come from max(lot_no) per colour, and cancelling an inward left its
		MM Lot behind — so cancelling LT1/26-27 and re-entering produced LT2/26-27 with a
		hole at LT1. A lot is only removed when nothing else still points at it: another
		live inward, a cutting, a program or a production keeps it.

		Every lot on the document is considered, because lots are assigned per entry row —
		one inward can hold several.
		"""
		lots = {self.lot} | {row.lot for row in self.items if row.lot}
		lots = {lot for lot in lots if lot}
		if not lots:
			return
		# Drop this document's own claim first, so a lot used only by these rows reads as
		# unused. lot_number (the display id) is left on the rows as the audit trail.
		if self.lot:
			self.db_set("lot", None, update_modified=False)
		frappe.db.sql("update `tabMM Inward Item` set lot = null where parent = %s", (self.name,))
		for lot in sorted(lots):
			if self._lot_still_used(lot):
				continue
			try:
				frappe.delete_doc("MM Lot", lot, ignore_permissions=True, force=True)
			except Exception:
				# Something else still references it — leave the lot alone rather than fail
				# the cancellation the operator actually asked for.
				frappe.log_error(title=f"could not release lot {lot}")

	def _lot_still_used(self, lot: str) -> bool:
		"""Does anything other than this cancelled inward still point at the lot?"""
		return bool(
			frappe.db.sql(
				"""
				select 1 from `tabMM Inward` where lot = %(lot)s and name != %(me)s and docstatus < 2
				union all
				select 1 from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
					where ii.lot = %(lot)s and i.name != %(me)s and i.docstatus < 2
				union all select 1 from `tabMM Cutting`    where lot = %(lot)s and docstatus < 2
				union all select 1 from `tabMM Program`    where lot = %(lot)s and docstatus < 2
				union all select 1 from `tabMM Production` where lot = %(lot)s and docstatus < 2
				limit 1
				""",
				{"lot": lot, "me": self.name},
			)
		)

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

	def _find_roll(self, color_name, lot_number):
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
				and (c.lot_number or "") == (lot_number or "")
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

			# The ROW's lot: rolls weighed on different entry rows are different lots, and
			# stock is held lot-wise. Falls back to the header for rows keyed before lots
			# moved onto them.
			lot_number = row.lot_number or self.lot_number
			existing = self._find_roll(row.color_name, lot_number)

			if existing:
				doc = frappe.get_doc("MM Roll Inventory", existing)
				doc.stock_weight = round((doc.stock_weight or 0) + weight, 3)
				doc.stock_box = round((doc.stock_box or 0) + boxes, 3)
				doc.save(ignore_permissions=True)
			elif sign > 0 and not self.is_gr:
				doc = frappe.get_doc(
					{
						"doctype": "MM Roll Inventory",
						"roll_no": row.roll_name,
						"lot_number": lot_number,
						"branch": self.branch,
						"location": self.location,
						"supplier": row.supplier,
						"color_name": row.color_name,
						"item_type": self.item_type,
						"stock_weight": weight,
						"stock_box": boxes,
					}
				)
				doc.insert(ignore_permissions=True)
			elif self.is_gr:
				# Returning material that isn't in stock any more (cut, dispatched, already
				# returned). Say so plainly — the alternative is inventing a negative stock row.
				frappe.throw(
					_("Cannot return {0} / lot {1}: it is no longer in stock at {2}.").format(
						row.color_name, lot_number or "—", self.location or "—"
					)
				)
			else:
				# Cancelling but no matching stock row — nothing to reverse.
				frappe.throw(
					_("Cannot cancel: no matching roll stock for color {0} / lot {1}.").format(
						row.color_name, lot_number or "—"
					)
				)

			# Ledger: IN on submit, reversing OUT on cancel; balance is read back from
			# the roll row so the ledger and live inventory always agree. A GR's rolls are
			# negative, so `weight` above is already the movement — take its direction from
			# there rather than from `sign`, or a return would post as an IN of minus 200 kg.
			mag_w = abs(round(row.weight or 0, 3))
			mag_b = abs(round(row.qty_box or 0, 3))
			inbound = weight > 0 or boxes > 0
			stock_ledger.post_movement(
				voucher_type="Inward",
				voucher_no=self.name,
				branch=self.branch,
				location=self.location,
				lot_number=lot_number,
				color_name=row.color_name,
				roll_no=row.roll_name,
				item_type=self.item_type,
				in_weight=mag_w if inbound else 0,
				out_weight=0 if inbound else mag_w,
				in_box=mag_b if inbound else 0,
				out_box=0 if inbound else mag_b,
				balance_weight=doc.stock_weight,
				balance_box=doc.stock_box,
				customer_order=row.customer_order or self.sales_order,
				challan_number=row.challan_number or self.challan_number,
				remarks=(
					"Inward cancelled" if sign < 0 and not self.is_gr
					else "Goods return" if self.is_gr and sign > 0
					else "Goods return cancelled" if self.is_gr
					else None
				),
			)
