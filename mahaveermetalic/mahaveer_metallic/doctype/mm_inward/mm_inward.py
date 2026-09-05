# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document

# Absolute kg of slack under the percentage over-tolerance, for scale rounding — the same
# floor the challan-level over-receipt check uses.
_ORDER_RECEIPT_TOLERANCE = 0.5


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
				# A ROLL WITHOUT A WEIGHT IS NOT A ROLL. The rule above only refused a line
				# that was empty on BOTH counts, so "1 box, 0.000 kg" posted happily — and
				# the register then counted it among the rolls received and added nothing to
				# the kilos, which is how a lot came to hold rolls weighing nothing.
				#
				# Box-only material is the one real exception and it is kept: an order with
				# no weight target at all (ordered_weight = 0) is counted in boxes, so a
				# weightless line against one of those is the intended reading rather than a
				# missed keystroke. Everything else — including a row with no order on it —
				# has to carry a weight.
				if (row.weight or 0) <= 0 and not self._is_box_only(row):
					frappe.throw(
						_("Row #{0}: enter the weight. A roll cannot be received at 0 kg.").format(row.idx)
					)
		# is_partial (a user-facing checkbox) must win even though receipt_status carries a
		# JSON default of "Complete" on desk-created inwards; only fall back to Complete
		# when nothing set it (post_inward sets it explicitly on the SPA path).
		if self.is_partial:
			self.receipt_status = "Partial"
		elif not self.receipt_status:
			self.receipt_status = "Complete"
		self._require_challan()
		self._guard_challan_not_closed()
		self._guard_order_over_receipt()
		self._guard_purchase_over_receipt()

	def _guard_order_over_receipt(self):
		"""An order cannot receive more than it ordered.

		1,200 kg ordered and 1,801.5 kg received left Required (Kg) at −601.5 — a negative
		requirement, which is not a thing: the extra 600 kg belongs to some other order, or
		the weight was keyed wrong. Either way it must be caught at the door, because once
		it is in, every figure downstream is measured against a quantity that was never
		ordered.

		Cumulative across every inward on the order, not just this one, so the limit cannot
		be walked past in small steps. The same over-tolerance the challan check uses
		applies (goods rarely weigh to the gram), with an absolute floor underneath it so a
		scale rounding on a tiny order isn't refused.

		A GOODS RETURN is exempt — it only ever gives weight back.
		"""
		from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
			get_inward_over_tolerance,
		)

		if self.is_gr:
			return
		mine = {}
		for row in self.items:
			# Surplus bought over and above what was sold. It is stock, not fulfilment, so
			# it is measured against the PURCHASE order (see _guard_purchase_over_receipt)
			# and never against the sales order's own weight.
			if row.to_inventory:
				continue
			order = row.customer_order or self.sales_order
			if not order:
				continue
			acc = mine.setdefault(order, [0.0, 0.0])
			acc[0] = round(acc[0] + float(row.weight or 0), 3)
			acc[1] = round(acc[1] + float(row.qty_box or 0), 3)
		over_pct = get_inward_over_tolerance() / 100.0
		for order in sorted(mine):
			this_w, this_b = mine[order]
			so = (
				frappe.db.get_value(
					"MM Sales Order", order, ["ordered_weight", "ordered_box"], as_dict=True
				)
				or {}
			)
			# AN ORDER PLACED IN BOXES IS CAPPED IN BOXES. Its weight is derived from the box
			# (MMSalesOrder._derive_box_weights), so a delivery of exactly the boxes ordered
			# that happens to run a shade heavy is the right delivery — refusing it on kg
			# would block the very receipt the order was placed for.
			by_box = float(so.get("ordered_box") or 0) > 0
			ordered = float((so.get("ordered_box") if by_box else so.get("ordered_weight")) or 0)
			this = this_b if by_box else this_w
			unit = _("box") if by_box else _("kg")
			if ordered <= 0 or this <= 0:
				# No target in the unit this order is read in — nothing to measure against.
				continue
			# Everything already received on the order, this document excluded so an amend
			# is not counted twice. Goods returns are in the sum with their negative figure,
			# which is what makes returned material receivable again.
			column = "qty_box" if by_box else "weight"
			prior = float(
				frappe.db.sql(
					f"""
					select coalesce(sum(ii.{column}), 0)
					from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
					where ii.customer_order = %(o)s and i.docstatus = 1 and i.name != %(me)s
						and ifnull(ii.to_inventory, 0) = 0
					""",
					{"o": order, "me": self.name or ""},
				)[0][0]
				or 0
			)
			cum = round(prior + this, 3)
			allowed = round(ordered + max(_ORDER_RECEIPT_TOLERANCE, ordered * over_pct), 3)
			if cum > allowed:
				frappe.throw(
					_(
						"Over-receipt blocked: order {0} is for {1} {6} and {2} {6} has already been "
						"received against it. This inward adds {3} {6}, taking it to {4} {6} — more "
						"than the {5} {6} limit. Check the entry, or receive the extra against the "
						"order it belongs to."
					).format(order, ordered, round(prior, 3), this, cum, allowed, unit)
				)

	def _require_challan(self):
		"""Every receipt names the challan it came in on.

		The challan is how a delivery is identified afterwards — it is what the supplier is
		paid against, what the over-receipt and closed checks key on, and the only thing
		tying a lot back to the paperwork it arrived with. A row without one cannot be
		reconciled with anything later, so it is refused at the door.

		A GOODS RETURN is exempt: it references the inward it returns, not a challan.
		"""
		if self.is_gr:
			return
		header = (self.challan_number or "").strip()
		for row in self.items:
			if not ((row.challan_number or "").strip() or header):
				frappe.throw(_("Row #{0}: enter the challan number this material came in on.").format(row.idx))

	def _guard_purchase_over_receipt(self):
		"""A purchase order cannot receive more than it bought.

		The sales order and the purchase order are two different ceilings and the shop
		works between them: 900 kg is sold, 1,200 kg is bought, and the 300 kg surplus is
		real material that has to come in. The sales-order guard above measures fulfilment
		and would refuse it at 1,080; this one measures the PURCHASE and lets the whole
		1,200 through, surplus included, while still catching a keyed 12,000.

		Every row counts here — stock-only rows especially, since the purchase is exactly
		what they were bought against. Matched to the PO the way MM Purchase Order matches
		its own status: same sales order, same colour, and the cut only when both sides
		carry one.

		A row with no purchase order behind it is not measured — nothing was bought, so
		there is nothing to exceed, and the sales-order guard is the only ceiling.

		A GOODS RETURN is exempt — it only ever gives weight back.
		"""
		from mahaveermetalic.mahaveer_metallic.doctype.mm_purchase_order.mm_purchase_order import _norm
		from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
			get_inward_over_tolerance,
		)

		if self.is_gr:
			return
		# (order, normalised colour) -> weight this document puts on it.
		mine = {}
		for row in self.items:
			order = row.customer_order or self.sales_order
			if not order or float(row.weight or 0) <= 0:
				continue
			key = (order, _norm(row.color_name), (row.cut or "").strip())
			mine[key] = round(mine.get(key, 0.0) + float(row.weight or 0), 3)
		if not mine:
			return
		over_pct = get_inward_over_tolerance() / 100.0
		for (order, colour, cut) in sorted(mine):
			pos = frappe.get_all(
				"MM Purchase Order",
				filters={"sales_order": order, "docstatus": ["<", 2]},
				fields=["name", "color", "cut", "qty_kg"],
			)
			po = next(
				(
					p
					for p in pos
					if _norm(p.color) == colour
					and not (cut and (p.cut or "").strip() and (p.cut or "").strip() != cut)
				),
				None,
			)
			bought = float(po.qty_kg or 0) if po else 0.0
			if not po or bought <= 0:
				continue
			# Everything already received on this PO line, this document excluded so an
			# amend is not counted twice. Goods returns net themselves off.
			prior = 0.0
			for r in frappe.db.sql(
				"""
				select ii.color_name, ii.cut, ii.weight
				from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
				where ii.customer_order = %(o)s and i.docstatus = 1 and i.name != %(me)s
				""",
				{"o": order, "me": self.name or ""},
				as_dict=True,
			):
				if _norm(r.color_name) != colour:
					continue
				po_cut = (po.cut or "").strip()
				if po_cut and (r.cut or "").strip() and (r.cut or "").strip() != po_cut:
					continue
				prior += float(r.weight or 0)
			this_w = mine[(order, colour, cut)]
			cum = round(prior + this_w, 3)
			allowed = round(bought + max(_ORDER_RECEIPT_TOLERANCE, bought * over_pct), 3)
			if cum > allowed:
				frappe.throw(
					_(
						"Over-receipt blocked: purchase order {0} bought {1} kg of {2} and {3} kg "
						"has already been received against it. This inward adds {4} kg, taking it "
						"to {5} kg — more than the {6} kg limit."
					).format(po.name, bought, po.color or colour, round(prior, 3), this_w, cum, allowed)
				)

	def _guard_challan_not_closed(self):
		"""One inward per challan — unless the earlier one was Partial. A challan is
		closed once any submitted inward for it is marked Complete; block any further
		inward against a closed challan. Partial inwards leave the challan open.

		EVERY challan on the document is checked, not just the header's: a challan belongs
		to the row it was entered on, so one inward can receive several of them and the
		header names one only when the whole inward shares it.

		Scoped by SUPPLIER. A challan number is the supplier's own serial — they all number
		from 1 — so two suppliers may each send a challan 123 and neither closes the other.
		A row with no supplier on file still matches on the number alone.
		"""
		from mahaveermetalic.mahaveer_metallic.api.inward import challan_closed_by

		# A return doesn't receive anything, so a closed challan is no reason to refuse it.
		if self.is_gr:
			return
		header = (self.challan_number or "").strip()
		# challan -> the supplier the rows put against it (first one that names any).
		pairs = {}
		for row in self.items:
			challan = (row.challan_number or "").strip() or header
			if not challan:
				continue
			pairs.setdefault(challan, "")
			if not pairs[challan]:
				pairs[challan] = (row.supplier or "").strip()
		if header:
			pairs.setdefault(header, "")
		for challan in sorted(pairs):
			closed = challan_closed_by(challan, exclude=self.name or "", supplier=pairs[challan])
			if closed:
				frappe.throw(
					_(
						"Challan {0} from this supplier is already fully received (inward {1}). "
						"No further inward is allowed."
					).format(challan, closed)
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


	def _is_box_only(self, row) -> bool:
		"""True when this line's ORDER is counted in boxes and carries no weight target.

		Read off the order rather than guessed from the line: a line with boxes and no
		weight looks identical whether it is box-only material or a weight somebody forgot
		to key, and only the order it is received against can tell the two apart.
		"""
		if not row.get("customer_order"):
			return False
		ordered = frappe.db.get_value("MM Sales Order", row.customer_order, "ordered_weight")
		return frappe.utils.flt(ordered) <= 0 and (row.qty_box or 0) > 0

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

	def _find_roll(self, color_name, lot_number, roll_name=None, allow_legacy=False):
		"""Match the Roll Inventory row for ONE ROLL.

		The key used to be (branch, location, lot_number, color_name) — the ROLL was not
		part of it. So the second roll of a lot was added into the first roll's row, and
		the third into the same one again: a lot received as five rolls of 242 kg became a
		single stock row of 1,210 kg carrying the first roll's name. Everything that picks
		stock reads these rows, so Cutting and the Sales Voucher could only ever offer the
		whole lot — "select rolls" listed one line, and a single roll could not be cut or
		sold on its own.

		The roll is part of the key now, so each one keeps its own row and its own weight.

		`allow_legacy` widens the match back to the old key, and is used ONLY when
		reversing — a goods return or a cancellation of an inward posted before this
		change has to find the merged row it actually went into. Receiving never sets it,
		or the merge would simply happen again.
		"""
		candidates = frappe.get_all(
			"MM Roll Inventory",
			filters={"location": self.location, "color_name": color_name},
			fields=["name", "branch", "lot_number", "roll_no"],
		)
		# Empty Link/Data fields are stored as NULL, so compare in Python to avoid
		# ''-vs-NULL mismatches.
		same_lot = [
			c for c in candidates
			if (c.branch or "") == (self.branch or "") and (c.lot_number or "") == (lot_number or "")
		]
		for c in same_lot:
			if (c.roll_no or "") == (roll_name or ""):
				return c.name
		if allow_legacy and same_lot:
			return same_lot[0].name
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
			# Receiving keys on the roll itself; reversing may have to reach a row merged
			# under the old key. See _find_roll.
			receiving = sign > 0 and not self.is_gr
			existing = self._find_roll(
				row.color_name, lot_number, row.roll_name, allow_legacy=not receiving
			)

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
