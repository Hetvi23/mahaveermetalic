# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Cut → Patty configuration.

How many patty a cut normally yields is a shop constant, not something to re-type on
every cutting. One row per cut holds it; the Cutting screen fetches it as the starting
figure and the operator overrides it whenever the roll disagrees — the config is a
default, never a rule.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class MMCutPattyConfig(Document):
	def validate(self):
		self.cut = (self.cut or "").strip()
		if not self.cut:
			frappe.throw(_("Enter the cut."))
		if frappe.utils.cint(self.no_of_patty) < 0:
			frappe.throw(_("No of Patty cannot be negative."))
		if frappe.utils.flt(self.weight_per_patty) < 0:
			frappe.throw(_("Weight per Patty cannot be negative."))
		if not frappe.utils.cint(self.no_of_patty) and not frappe.utils.flt(self.weight_per_patty):
			frappe.throw(_("Set a No of Patty, a Weight per Patty, or both — an empty row configures nothing."))


@frappe.whitelist()
def patty_for_cut(cut=None, weight=None):
	"""What to start the No of Patty box at for this cut.

	Returns the configured count when there is one. Failing that, and only when a weight
	is known, the count is worked out from the configured per-patty rate — a 300 kg roll
	at 100 kg per patty is three. Nothing configured returns no suggestion at all rather
	than a made-up 1, so the screen can tell "the shop says three" apart from "nobody has
	said".
	"""
	cut = (cut or "").strip()
	if not cut:
		return None
	row = frappe.db.get_value(
		"MM Cut Patty Config", cut, ["cut", "no_of_patty", "weight_per_patty"], as_dict=True
	)
	if not row:
		return None

	count = frappe.utils.cint(row.no_of_patty)
	source = "config"
	per = frappe.utils.flt(row.weight_per_patty)
	if not count:
		w = frappe.utils.flt(weight)
		if not (per > 0 and w > 0):
			# Configured by weight alone, and no weight to apply it to — hand back the rate
			# so the screen can fill the count in itself once rolls are picked.
			return {"cut": row.cut, "no_of_patty": None, "weight_per_patty": per or None, "source": "rate"}
		count = max(1, int(round(w / per)))
		source = "weight"
	return {
		"cut": row.cut,
		"no_of_patty": count,
		"weight_per_patty": per or None,
		"source": source,
	}
