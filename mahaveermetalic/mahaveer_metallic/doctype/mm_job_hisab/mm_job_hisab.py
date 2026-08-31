# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The job-work settlement for ONE Job Out.

The hisab register itself is computed live from the challans (api.challan.job_work_hisab)
and always was. This is the other half: once the shop agrees the figures, the settlement
becomes a document — because a bill number, a cheque and four signatures cannot live in a
report that is recomputed on every page load.

The money:

    A = Job Out weight  x  Rate Out
    B = Job In weight   x  Rate In
    Total = (A - B) + markup%          markup lives in MM Settings, 5% by default

The wastage, which is what the shop actually argues about:

    C = Job Out weight - Job In weight
    Wastage % = 100 x C / Job Out weight

Over the limit in MM Settings, the hisab is FLAGGED for the admin — it is not blocked.
The admin signs every hisab either way; the flag says which ones to look at twice.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

#: Fallbacks for a site whose MM Settings has never been opened. Both are configurable.
DEFAULT_MARKUP_PERCENT = 5.0
DEFAULT_WASTAGE_LIMIT_PERCENT = 5.0


def settings_percents() -> tuple:
	"""(markup %, wastage limit %) from MM Settings, with the defaults behind them.

	Read through db.get_value rather than get_single so a site that has never saved the
	single still gets numbers instead of an exception on the first hisab.
	"""
	row = frappe.db.get_value(
		"MM Settings", "MM Settings",
		["job_markup_percent", "job_wastage_limit_percent"], as_dict=True,
	) or {}
	markup = flt(row.get("job_markup_percent"))
	limit = flt(row.get("job_wastage_limit_percent"))
	return (
		markup if markup > 0 else DEFAULT_MARKUP_PERCENT,
		limit if limit > 0 else DEFAULT_WASTAGE_LIMIT_PERCENT,
	)


class MMJobHisab(Document):
	def validate(self):
		self.pull_weights()
		self.compute()

	def pull_weights(self):
		"""Weights come from the challans, never from the keyboard.

		The whole point of the hisab is that it agrees with the paper that moved the
		material. Letting either weight be typed would let a settlement be agreed against
		figures no challan supports.
		"""
		if not self.job_out:
			return
		jo = frappe.db.get_value(
			"MM Sales Challan", self.job_out,
			["party", "total_weight", "challan_type", "docstatus"], as_dict=True,
		)
		if not jo:
			frappe.throw(_("Job Out {0} not found.").format(self.job_out))
		if jo.challan_type != "Job Out":
			frappe.throw(_("{0} is a {1} challan — a hisab settles a Job Out.").format(
				self.job_out, jo.challan_type or "?"))
		if cint(jo.docstatus) != 1:
			frappe.throw(_("Job Out {0} is not submitted.").format(self.job_out))
		self.party = jo.party
		self.out_weight = flt(jo.total_weight, 3)
		# Every Job In raised against this Job Out. `against_job_out` is what ties them
		# together — a job worker returns one lot over several challans.
		self.in_weight = flt(
			frappe.db.sql(
				"""select coalesce(sum(total_weight), 0) from `tabMM Sales Challan`
				where against_job_out = %s and challan_type = 'Job In' and docstatus = 1""",
				(self.job_out,),
			)[0][0],
			3,
		)

	def compute(self):
		markup, limit = settings_percents()
		self.markup_percent = markup

		# Wastage is measured on WEIGHT and is independent of any rate — it is the
		# material question, and it is answerable before a rate has been agreed.
		out_w = flt(self.out_weight)
		self.wastage_weight = flt(out_w - flt(self.in_weight), 3)
		self.wastage_percent = flt(100.0 * self.wastage_weight / out_w, 2) if out_w else 0.0
		self.wastage_over_limit = 1 if self.wastage_percent > limit else 0

		self.out_amount = flt(out_w * flt(self.rate_out), 2)
		self.in_amount = flt(flt(self.in_weight) * flt(self.rate_in), 2)
		self.total_amount = flt((self.out_amount - self.in_amount) * (1 + markup / 100.0), 2)

	def on_trash(self):
		# A settled hisab is a financial record — the bill number and the cheque are on it.
		if self.status not in ("Draft", "Accountant Approved"):
			frappe.throw(_("A hisab that has reached {0} cannot be deleted.").format(self.status))
