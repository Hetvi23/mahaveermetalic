# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import re

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


def _norm(s):
	return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def recompute_po_status(po_name):
	"""A PO closes once the inwards received against its Sales Order line (matched on
	colour, plus cut when the inward carries one) meet the PO weight. Recomputed whenever
	an inward for the order is posted or cancelled."""
	# On sites where the `status` column hasn't been synced yet (pre-migrate), skip rather
	# than 500 the inward that triggered this recompute — the reload patch adds it on migrate.
	if not frappe.db.has_column("MM Purchase Order", "status"):
		return None
	po = frappe.db.get_value(
		"MM Purchase Order", po_name, ["sales_order", "color", "cut", "qty_kg"], as_dict=True
	)
	if not po or not po.sales_order:
		return None
	rows = frappe.db.sql(
		"""
		select ii.color_name, ii.cut, ii.weight
		from `tabMM Inward Item` ii join `tabMM Inward` i on i.name = ii.parent
		where i.docstatus = 1 and ii.customer_order = %s
		""",
		(po.sales_order,),
		as_dict=True,
	)
	want_c = _norm(po.color)
	want_cut = (po.cut or "").strip()
	received = 0.0
	for r in rows:
		if _norm(r.color_name) != want_c:
			continue
		# Only enforce cut when BOTH sides carry one (inward may not capture size).
		if want_cut and (r.cut or "").strip() and (r.cut or "").strip() != want_cut:
			continue
		received += float(r.weight or 0)
	qty = float(po.qty_kg or 0)
	if received <= 0.001:
		status = "Pending"
	elif qty > 0 and received + 0.001 >= qty:
		status = "Received"
	else:
		status = "Partially Received"
	frappe.db.set_value("MM Purchase Order", po_name, "status", status, update_modified=False)
	return status


def recompute_po_status_for_order(sales_order):
	"""Recompute status for every PO tied to a Sales Order."""
	if not sales_order:
		return
	for name in frappe.get_all("MM Purchase Order", filters={"sales_order": sales_order}, pluck="name"):
		recompute_po_status(name)


class MMPurchaseOrder(Document):
	def autoname(self):
		"""The PO id mirrors its Sales Order id — one order, one purchase order, same
		number (SO 5 → PO 5). If a single Sales Order ever spawns more than one PO
		(a multi-line order), the extras are suffixed (5-2, 5-3 …) to stay unique.
		POs created without a Sales Order fall back to a plain running number."""
		if self.sales_order:
			base = str(self.sales_order)
			name, n = base, 2
			while frappe.db.exists("MM Purchase Order", name):
				name = f"{base}-{n}"
				n += 1
			self.name = name
		else:
			# No Sales Order to mirror — keep the MMPO- prefix (e.g. MMPO-00001) so the
			# name lives in its own namespace and can't collide with the plain-integer
			# names of SO-mirrored POs.
			self.name = make_autoname("MMPO-.#####")

	def _reject_negatives(self):
		"""Weight and rate can never be negative — a negative PO orders nothing and
		quietly corrupts every total it feeds (shortage, order value, supplier pending)."""
		from frappe import _

		if float(self.qty_kg or 0) < 0:
			frappe.throw(_("Purchase weight cannot be negative."))
		if float(self.rate or 0) < 0:
			frappe.throw(_("Purchase rate cannot be negative."))

	def validate(self):
		self._reject_negatives()
		if self.sales_order:
			self.po_number = self.sales_order
