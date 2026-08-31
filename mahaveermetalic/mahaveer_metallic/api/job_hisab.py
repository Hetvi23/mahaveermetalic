# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Forming and signing off a job-work hisab.

The register (api.challan.job_work_hisab) computes what went out and what came back. This
is what happens after the shop agrees those figures: rates are put to them, and the
settlement walks a four-step signature before it is done.

    Draft  --accountant--> Accountant Approved  --admin--> Admin Approved
           --accountant (bill no)--> Billed  --admin (cheque)--> Completed

Two people, alternating, on purpose: the accountant proposes the money and later records
the bill; the admin agrees the money and later releases the cheque. Each step is guarded
by role AND by the status before it, so the chain cannot be entered halfway or replayed.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

ACCOUNTS_ROLES = ("MM Accounts", "MM Admin", "System Manager")
ADMIN_ROLES = ("MM Admin", "System Manager")


def _require(roles, what):
	"""Refuse the step unless the user holds one of these roles.

	Checked on the server for every transition. The screen hides the buttons a user cannot
	press, but hiding a button is a courtesy, not a permission.
	"""
	if not set(roles) & set(frappe.get_roles()):
		frappe.throw(
			_("Only {0} can {1}.").format(" or ".join(roles[:-1]), what),
			frappe.PermissionError,
		)


def _hisab(name):
	return frappe.get_doc("MM Job Hisab", name)


@frappe.whitelist()
def hisab_for(job_out):
	"""The hisab on a Job Out, or None — so the screen can offer to form one."""
	name = frappe.db.get_value("MM Job Hisab", {"job_out": job_out}, "name")
	return _hisab(name).as_dict() if name else None


@frappe.whitelist()
def save_hisab(job_out, rate_out, rate_in, posting_date=None, remarks=None):
	"""Form the hisab, or re-rate one that has not been signed yet.

	Weights are never accepted from the caller — the controller pulls them off the challans
	so a settlement cannot be agreed against figures no paper supports. Only the two rates
	and the remark come from the screen.
	"""
	_require(ACCOUNTS_ROLES, _("form a hisab"))
	name = frappe.db.get_value("MM Job Hisab", {"job_out": job_out}, "name")
	doc = _hisab(name) if name else frappe.new_doc("MM Job Hisab")
	if doc.get("status") and doc.status != "Draft":
		frappe.throw(_("This hisab is already {0} — rates can only be changed while it is a Draft.").format(doc.status))
	doc.job_out = job_out
	doc.rate_out = flt(rate_out)
	doc.rate_in = flt(rate_in)
	if posting_date:
		doc.posting_date = posting_date
	doc.remarks = remarks
	doc.status = "Draft"
	doc.save(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def accountant_approve(name):
	"""Step 1 — the accountant agrees the rates and the total."""
	_require(ACCOUNTS_ROLES, _("give the accountant's approval"))
	doc = _hisab(name)
	if doc.status != "Draft":
		frappe.throw(_("Only a Draft can be approved by the accountant — this one is {0}.").format(doc.status))
	if not (flt(doc.rate_out) or flt(doc.rate_in)):
		frappe.throw(_("Put a rate on the hisab before approving it."))
	doc.status = "Accountant Approved"
	doc.accountant_approved_by = frappe.session.user
	doc.accountant_approved_on = now_datetime()
	doc.save(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def admin_approve(name):
	"""Step 2 — the admin agrees it. Every hisab passes here.

	A hisab over the wastage limit is flagged, not blocked: the admin is the person who
	decides whether 7% on this lot is the job worker's fault or the material's, and that
	is a judgement the software has no business making for them.
	"""
	_require(ADMIN_ROLES, _("give the admin's approval"))
	doc = _hisab(name)
	if doc.status != "Accountant Approved":
		frappe.throw(_("The accountant has to approve this first — it is {0}.").format(doc.status))
	doc.status = "Admin Approved"
	doc.admin_approved_by = frappe.session.user
	doc.admin_approved_on = now_datetime()
	doc.save(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def enter_bill(name, bill_no):
	"""Step 3 — the accountant records the bill number against the approved hisab."""
	_require(ACCOUNTS_ROLES, _("enter the bill number"))
	if not (bill_no or "").strip():
		frappe.throw(_("Enter the bill number."))
	doc = _hisab(name)
	if doc.status != "Admin Approved":
		frappe.throw(_("A bill number goes on after the admin has approved — this is {0}.").format(doc.status))
	doc.bill_no = (bill_no or "").strip()
	doc.bill_entered_by = frappe.session.user
	doc.status = "Billed"
	doc.save(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def final_approve(name, cheque=1):
	"""Step 4 — the admin ticks the cheque and closes the hisab."""
	_require(ADMIN_ROLES, _("give the final approval"))
	doc = _hisab(name)
	if doc.status != "Billed":
		frappe.throw(_("The bill number has to be entered first — this is {0}.").format(doc.status))
	doc.cheque = cint(cheque)
	doc.status = "Completed"
	doc.final_approved_by = frappe.session.user
	doc.final_approved_on = now_datetime()
	doc.save(ignore_permissions=True)
	return doc.as_dict()


@frappe.whitelist()
def reopen(name, reason=None):
	"""Send a hisab back to Draft.

	Someone will put 12.50 where they meant 1.250, and without this the only way back is a
	second hisab on the same Job Out. Admin only, and never once the cheque is out.
	"""
	_require(ADMIN_ROLES, _("reopen a hisab"))
	doc = _hisab(name)
	if doc.status == "Completed":
		frappe.throw(_("This hisab is completed and the cheque is recorded against it."))
	doc.status = "Draft"
	doc.accountant_approved_by = doc.accountant_approved_on = None
	doc.admin_approved_by = doc.admin_approved_on = None
	doc.bill_no = doc.bill_entered_by = None
	if reason:
		doc.remarks = f"{doc.remarks or ''}\nReopened: {reason}".strip()
	doc.save(ignore_permissions=True)
	return doc.as_dict()
