# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document

from mahaveermetalic.mahaveer_metallic import stock_ledger

# Which way each challan type moves stock. Sales and Job Out send material away;
# Job In is the job worker returning it. Anything else (Challan, Delivery Challan,
# Job Challan) is goods leaving, so the "out" / "Dispatch" fallbacks below are right.
_DIRECTION = {"Sales": "out", "Job Out": "out", "Job In": "in"}
_VOUCHER_TYPE = {"Sales": "Dispatch", "Job Out": "Job Out", "Job In": "Job In"}

# Types that do NOT fulfil a customer order. Everything else — Sales, Challan, Delivery
# Challan — is goods gone out to the customer and closes the order it references.
#
# Kept as an exclusion list, not an "is it Sales?" test: the code used to ask
# `challan_type = 'Sales'` in five places, so every type added later would silently stop
# counting as a dispatch — the order would stay open and could be dispatched twice.
#
# The same rule is spelled in SQL by the four queries that ask "has this order gone
# out?" — mm_sales_order (dispatch check + bulk dispatch map), mm_inward, and
# api/challan.orders_for_challan. Grep `not in ('Job Out', 'Job In', 'Job Challan')` to
# find them all if this list ever changes.
NON_DISPATCH_TYPES = ("Job Out", "Job In", "Job Challan")


def _key(colour):
	"""Colours are matched the way the rest of the app matches them — case and spacing on
	a hand-typed shade are not a difference in material."""
	return "".join((colour or "").lower().split())


def is_dispatch(challan_type) -> bool:
	"""True when this challan type sends goods to the customer against their order."""
	return (challan_type or "Sales") not in NON_DISPATCH_TYPES


class MMSalesChallan(Document):
	def validate(self):
		if not self.challan_type:
			self.challan_type = "Sales"
		if not self.items:
			frappe.throw(_("Add at least one item to the {0} challan.").format(self.challan_type))
		for it in self.items:
			if (it.qty_box or 0) < 0 or (it.weight or 0) < 0:
				frappe.throw(_("Row #{0}: box and weight cannot be negative.").format(it.idx))
		self.total_box = round(sum(float(i.qty_box or 0) for i in self.items), 3)
		self.total_weight = round(sum(float(i.weight or 0) for i in self.items), 3)
		self._apply_rates()

	def _apply_rates(self):
		"""Carry the agreed rate onto the challan, and foot it.

		The rate lives on the sales order and the challan never carried it, so the paper
		that goes out with the goods showed weights and no money — the customer had to be
		told the price separately and the office had to re-look it up to bill.

		Done on the document, not in the four different places a challan gets built
		(production, job work, hand-picked boxes, hand-picked rolls), so every path gets it
		and none of them can drift.

		Only a BLANK rate is filled: a rate typed on the line is a deliberate decision to
		bill this dispatch differently, and the order must not overwrite it. A challan with
		no order behind it simply has no rate to find, which is not an error — it foots at
		zero and the line can still be priced by hand.
		"""
		rates = {}
		orders = {(it.sales_order or self.sales_order) for it in self.items}
		for order in filter(None, orders):
			for r in frappe.get_all(
				"MM Sales Order Item",
				filters={"parent": order, "parenttype": "MM Sales Order"},
				fields=["color_name", "cut", "sale_rate"],
			):
				if float(r.sale_rate or 0) <= 0:
					continue
				# Keyed by colour AND cut, plus a colour-only fallback: the challan does not
				# always record a cut, and an order that prices one colour at one rate should
				# still price it then.
				rates.setdefault((order, _key(r.color_name), (r.cut or "").strip()), float(r.sale_rate))
				rates.setdefault((order, _key(r.color_name), None), float(r.sale_rate))
		total = 0.0
		for it in self.items:
			order = it.sales_order or self.sales_order
			if not float(it.rate or 0) and order:
				ckey, cut = _key(it.color_name), (it.cut or "").strip()
				it.rate = rates.get((order, ckey, cut)) or rates.get((order, ckey, None)) or 0
			# Per KG — weight is the quantity this trade prices on, and it is the figure
			# the line already carries as its own total.
			it.amount = round(float(it.rate or 0) * float(it.weight or 0), 2)
			total += float(it.amount or 0)
		self.total_amount = round(total, 2)

	def on_submit(self):
		"""Dispatching finally moves stock.

		Until now a challan was paperwork only: boxes and rolls stayed in inventory after
		they had physically left, so the barcode could never do what it is for — deduct
		from inventory. Submitting now posts the movement and cancelling reverses it.
		"""
		self._move_stock(reverse=False)
		self._post_bobbins()
		self._mark_orders_dispatched()

	def on_cancel(self):
		self._move_stock(reverse=True)
		self._clear_bobbins()
		# Cancelling a challan takes weight back OFF the order, which can reopen it. The
		# recount is the same one submit runs, so completion never drifts from the challans.
		self._mark_orders_dispatched()

	def _mark_orders_dispatched(self):
		"""Recount what has gone out against every order this challan touches.

		A job challan is skipped: it sends material to a worker, which does not fulfil the
		customer's order. Every other type counts — a Delivery Challan against an order is
		as much a dispatch as a Sales challan. `mark_dispatched` closes an order only once
		the challans COVER it, so a part-delivery no longer closes one and cancelling a
		challan can open one back up.
		"""
		if not is_dispatch(self.challan_type):
			return
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import mark_dispatched

		orders = {self.sales_order} | {it.sales_order for it in self.items if it.sales_order}
		for order in filter(None, orders):
			if self.docstatus == 2:
				# On CANCEL the recount is the correction, not a nicety: swallowing it here
				# leaves a cancelled challan's order still reading Complete on a register the
				# customer is billed from. Let it raise and take the cancel down with it.
				mark_dispatched(order)
				continue
			try:
				mark_dispatched(order)
			except Exception:
				frappe.log_error(title=f"could not recount order {order} from challan {self.name}")

	def _post_bobbins(self):
		"""Bobbins carried on a job challan hit the bobbin ledger too."""
		from mahaveermetalic.mahaveer_metallic.api.bobbin import post_job_challan

		try:
			post_job_challan(self)
		except Exception:
			frappe.log_error(title=f"bobbin ledger for challan {self.name} failed")

	def _clear_bobbins(self):
		from mahaveermetalic.mahaveer_metallic.api.bobbin import clear_voucher

		try:
			clear_voucher(self.name)
		except Exception:
			frappe.log_error(title=f"bobbin ledger clear for challan {self.name} failed")

	def _move_stock(self, reverse: bool):
		direction = _DIRECTION.get(self.challan_type or "Sales", "out")
		# Cancelling undoes the original direction.
		if reverse:
			direction = "in" if direction == "out" else "out"

		for it in self.items:
			weight = round(float(it.weight or 0), 3)
			boxes = round(float(it.qty_box or 0), 3)
			if weight <= 0 and boxes <= 0:
				continue
			row = self._inventory_row(it)
			if not row:
				continue
			if direction == "out":
				row.stock_weight = round(float(row.stock_weight or 0) - weight, 3)
				row.stock_box = round(float(row.stock_box or 0) - boxes, 3)
			else:
				row.stock_weight = round(float(row.stock_weight or 0) + weight, 3)
				row.stock_box = round(float(row.stock_box or 0) + boxes, 3)
			row.save(ignore_permissions=True)

			stock_ledger.post_movement(
				voucher_type=_VOUCHER_TYPE.get(self.challan_type or "Sales", "Dispatch"),
				voucher_no=self.name,
				branch=self.branch,
				location=self.location or row.location,
				lot_number=row.lot_number,
				color_name=it.color_name,
				roll_no=row.roll_no,
				in_weight=weight if direction == "in" else 0.0,
				in_box=boxes if direction == "in" else 0.0,
				out_weight=weight if direction == "out" else 0.0,
				out_box=boxes if direction == "out" else 0.0,
				balance_weight=row.stock_weight,
				balance_box=row.stock_box,
				customer_order=it.sales_order or self.sales_order,
				challan_number=self.challan_no or self.name,
				remarks=_("{0} challan {1}").format(self.challan_type, self.name),
			)

	def _inventory_row(self, it):
		"""The inventory row a challan line draws from / returns to.

		A line picked straight off inventory carries its row; a produced box does not, so
		fall back to the (location, colour) key. A Job In brings material back that may
		never have had a row here, so create one rather than dropping the movement.
		"""
		if it.get("roll_inventory") and frappe.db.exists("MM Roll Inventory", it.roll_inventory):
			return frappe.get_doc("MM Roll Inventory", it.roll_inventory)

		filters = {"color_name": it.color_name}
		if self.location:
			filters["location"] = self.location
		match = frappe.get_all("MM Roll Inventory", filters=filters, fields=["name"], limit=1)
		if match:
			return frappe.get_doc("MM Roll Inventory", match[0].name)

		if not self.location:
			frappe.msgprint(
				_("Row #{0}: no location, so stock was not adjusted for {1}.").format(it.idx, it.color_name),
				alert=True,
			)
			return None
		return frappe.get_doc(
			{
				"doctype": "MM Roll Inventory",
				"roll_no": it.color_name,
				"color_name": it.color_name,
				"location": self.location,
				"branch": self.branch,
				"stock_weight": 0,
				"stock_box": 0,
			}
		).insert(ignore_permissions=True)
