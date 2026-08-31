# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
import frappe.model.naming
from frappe import _
from frappe.model.document import Document


class MMProduction(Document):
	def validate(self):
		self._compute_weights()
		self._enforce_tolerance()
		self._assign_box_barcodes()

	def _assign_box_barcodes(self):
		"""Every produced box gets its own barcode — printed on the sticker and used by
		Scan Box on the challan. Format: MM + yymmdd + a running number."""
		stamp = frappe.utils.getdate(self.posting_date or frappe.utils.nowdate()).strftime("%y%m%d")
		for b in self.boxes or []:
			if b.barcode:
				continue
			b.barcode = frappe.model.naming.make_autoname(f"MM{stamp}.######")

	def _compute_weights(self):
		"""SRS 5.7: Net = Gross − Bobbin − Box, per box and rolled up to the voucher.

		New model — one row per produced box (gross, bobbin = pcs × per-pcs weight, box
		tare); the voucher totals are the sums of the box rows. Legacy single-entry docs
		(a whole-doc bobbins table + box_qty/box_weight) still compute the old way."""
		if self.boxes:
			g_total = bob_total = box_total = net_total = 0.0
			for b in self.boxes:
				tbw = float(b.total_bobbin_weight or 0)
				if not tbw:
					tbw = round(float(b.bobbin_pcs or 0) * float(b.bobbin_pcs_weight or 0), 3)
					b.total_bobbin_weight = tbw
				b.net_weight = round(float(b.gross_weight or 0) - tbw - float(b.box_weight or 0), 3)
				g_total += float(b.gross_weight or 0)
				bob_total += tbw
				box_total += float(b.box_weight or 0)
				net_total += b.net_weight
			self.gross_weight = round(g_total, 3)
			self.bobbin_weight = round(bob_total, 3)
			self.box_weight = round(box_total, 3)
			self.box_qty = len(self.boxes)
			self.net_weight = round(net_total, 3)
		else:
			bobbin_total = 0.0
			for row in self.bobbins or []:
				if row.bobbin:
					master = frappe.db.get_value(
						"MM Bobbin Master", row.bobbin, ["weight", "quality"], as_dict=True
					)
					if master:
						if not row.quality:
							row.quality = master.quality
						if not row.weight:
							row.weight = round(float(row.qty or 0) * float(master.weight or 0), 3)
				bobbin_total += float(row.weight or 0)
			self.bobbin_weight = round(bobbin_total, 3)
			self.net_weight = round(
				float(self.gross_weight or 0) - self.bobbin_weight - float(self.box_weight or 0), 3
			)

		base = float(self.input_weight or 0)
		self.variance_percent = round((self.net_weight - base) / base * 100, 2) if base else 0.0

	def _enforce_tolerance(self):
		"""Nothing to enforce on a shortfall — deliberately.

		A program is boxed over SEVERAL vouchers, so the first 200 kg of a 1,200 kg program
		is 200 kg boxed, not a 1,000 kg variance. This gate measured every voucher against
		the whole program on its own and demanded the Admin Override PIN for the ordinary
		act of boxing part of a run. `variance_percent` is still computed and stored, so the
		figure is on the record; it simply no longer stops anybody.

		Over-production IS still refused, but it cannot be judged from here: one voucher
		cannot see the others, and the rule is about the RUNNING TOTAL across them. It
		lives in api/production.create_production, which can.
		"""
		return

	def on_submit(self):
		self._sync_source_program(link=True)
		self._refresh_order_production()
		self._post_bobbin_usage()
		self._add_to_inventory()
		self._raise_sales_challan()

	def _post_bobbin_usage(self):
		"""Bobbins entered on the boxes are consumed out of bobbin stock."""
		from mahaveermetalic.mahaveer_metallic.api.bobbin import post_production

		try:
			post_production(self)
		except Exception:
			frappe.log_error(title=f"bobbin ledger for {self.name} failed")

	def _add_to_inventory(self):
		"""Produced boxes become finished-goods stock (SRS 5.10 step 10). Weight lands in
		roll inventory + the stock ledger so it shows on Inventory / Stock Ledger and can
		be dispatched later."""
		from mahaveermetalic.mahaveer_metallic import stock_ledger

		net = round(float(self.net_weight or 0), 3)
		if net <= 0:
			return
		# Roll inventory is keyed by location. Fall back to the source program/cutting's
		# location before giving up, so a colour-planned job still stocks its output.
		if not self.location and self.source_program:
			for dt, name in (("MM Program", self.source_program),
				("MM Cutting", frappe.db.get_value("MM Program", self.source_program, "source_cutting"))):
				if not name:
					continue
				loc, br = frappe.db.get_value(dt, name, ["location", "branch"]) or (None, None)
				if loc:
					self.db_set("location", loc, update_modified=False)
					if br and not self.branch:
						self.db_set("branch", br, update_modified=False)
					break
		if not self.location:
			frappe.msgprint(
				_("No location on this production, so its output wasn't added to inventory."), alert=True
			)
			return
		lot_no = frappe.db.get_value("MM Lot", self.lot, "lot_id") if self.lot else None
		key = {
			"branch": self.branch,
			"location": self.location,
			"lot_number": lot_no,
			"color_name": self.shade,
		}
		existing = None
		for cand in frappe.get_all("MM Roll Inventory", filters={"color_name": self.shade}, fields=["name", "branch", "location", "lot_number"]):
			if (cand.branch or "") == (self.branch or "") and (cand.location or "") == (self.location or "") \
				and (cand.lot_number or "") == (lot_no or ""):
				existing = cand.name
				break
		boxes = float(self.box_qty or 0) or len(self.boxes or [])
		if existing:
			row = frappe.get_doc("MM Roll Inventory", existing)
			row.stock_weight = round(float(row.stock_weight or 0) + net, 3)
			row.stock_box = round(float(row.stock_box or 0) + boxes, 3)
			row.save(ignore_permissions=True)
		else:
			row = frappe.get_doc(dict({"doctype": "MM Roll Inventory", "roll_no": self.roll_no or self.shade,
				"stock_weight": net, "stock_box": boxes}, **key))
			row.insert(ignore_permissions=True)
		stock_ledger.post_movement(
			voucher_type="Adjustment",
			voucher_no=self.name,
			branch=self.branch,
			location=self.location,
			lot_number=lot_no,
			color_name=self.shade,
			roll_no=self.roll_no,
			in_weight=net,
			in_box=boxes,
			balance_weight=row.stock_weight,
			balance_box=row.stock_box,
			customer_order=self.customer_order,
			remarks=_("Produced in {0}").format(self.name),
		)

	def _raise_sales_challan(self):
		"""Production is where boxes/bobbins are entered — the dispatch challan is raised
		from it. With a Sales Order the challan is raised and submitted; without one the boxes simply stay in hand for a later challan."""
		if not self.customer_order:
			return
		# A JOB IN production is material coming BACK from a worker, not going out to the
		# customer. It carries the order so the receipt is attributed correctly, but raising
		# a dispatch challan off it would have the goods leaving the moment they arrived.
		if self.flags.get("skip_dispatch_challan"):
			return
		from mahaveermetalic.mahaveer_metallic.api.challan import create_challan_from_production

		try:
			name = create_challan_from_production(self.name)
			if name:
				frappe.msgprint(_("Sales Challan {0} created from this production.").format(name), alert=True)
		except Exception:
			frappe.log_error(title=f"challan from production {self.name} failed")

	def on_cancel(self):
		self._sync_source_program(link=False)
		self._refresh_order_production()

	def _sync_source_program(self, link: bool):
		"""Mark the source program done (and link it) on submit; release it on cancel so
		it returns to 'In Threads Processing'."""
		if not self.source_program or not frappe.db.exists("MM Program", self.source_program):
			return
		if link:
			# A PROGRAM IS NOT DONE JUST BECAUSE A VOUCHER TOUCHED IT. The first production
			# marked it Completed outright, so a 1,200 kg program that had boxed 200 kg
			# vanished off "In Threads Processing" and the other 1,000 kg had nowhere to be
			# entered. It stays until there is genuinely nothing left to box.
			# `production` is what REMOVES the program from the queue: api.production
			# threads_processing filters on "production is not set", and create_production
			# refuses a program that has one. So it must only be stamped once the program is
			# genuinely finished — stamped on the first voucher, a 1,200 kg program boxed
			# 200 kg vanished off the floor's list and could never be produced against again.
			status = self._program_status_after()
			fills = {"status": status}
			if status == "Completed":
				fills["production"] = self.name
			frappe.db.set_value("MM Program", self.source_program, fills, update_modified=False)
		else:
			frappe.db.set_value(
				"MM Program",
				self.source_program,
				{"production": None, "status": "In Progress"},
				update_modified=False,
			)

	def _program_status_after(self) -> str:
		"""Completed only when the program has nothing left worth boxing.

		Two conditions, and both have to hold:

		1. What is still unboxed is within the leftover tolerance in MM Settings. A program
		   is rarely boxed to the exact gram, so a few hundred grams left over is finished
		   in every sense that matters; 100 kg is not.
		2. Nothing of that lot is still on the floor. Stock outlives the arithmetic — a
		   patty or roll of the same lot sitting in inventory is material that can still be
		   wound, and closing the program while it exists strands it.
		"""
		from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
			get_leftover_tolerance,
		)

		produced = round(
			float(
				frappe.db.sql(
					"""select coalesce(sum(net_weight), 0) from `tabMM Production`
					where source_program = %s and docstatus = 1 and name != %s""",
					(self.source_program, self.name),
				)[0][0]
				or 0
			)
			+ float(self.net_weight or 0),
			3,
		)
		planned = float(frappe.db.get_value("MM Program", self.source_program, "net_weight") or 0)
		remaining = round(planned - produced, 3)
		if planned and remaining > get_leftover_tolerance():
			return "Partially Done"
		if self._lot_still_in_stock():
			return "Partially Done"
		return "Completed"

	def _lot_still_in_stock(self) -> bool:
		"""Is any roll of this program's lot still holding stock?"""
		lot = frappe.db.get_value("MM Program", self.source_program, "lot")
		lot_id = frappe.db.get_value("MM Lot", lot, "lot_id") if lot else None
		if not lot_id:
			return False
		return bool(
			frappe.db.sql(
				"""select 1 from `tabMM Roll Inventory`
				where lot_number = %s and ifnull(stock_weight, 0) > 0 limit 1""",
				(lot_id,),
			)
		)

	def _refresh_order_production(self):
		if self.customer_order:
			from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import (
				recalculate_production_completed,
			)

			recalculate_production_completed(self.customer_order)
