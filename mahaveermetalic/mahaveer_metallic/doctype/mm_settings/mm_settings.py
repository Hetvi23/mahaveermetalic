# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMSettings(Document):
	pass


def _mm_setting_float(field: str, default: float) -> float:
	"""Read a MM Settings float. `get_single_value` returns 0.0 for an *unset* Single
	field (indistinguishable from a real 0), which would wrongly override the default —
	so read tabSingles directly: use the stored value only when a row actually exists."""
	rows = frappe.db.sql(
		"select value from tabSingles where doctype='MM Settings' and field=%s", (field,)
	)
	if rows and rows[0][0] not in (None, ""):
		return float(rows[0][0])
	return default


def get_tolerance_percent() -> float:
	"""Production variance tolerance (%). Defaults to 4 (SRS) when unset."""
	return _mm_setting_float("production_tolerance_percent", 4.0)


def get_leftover_tolerance() -> float:
	"""Leftover weight (Kg) at or below which a cutting/production counts as spent and
	can auto-close. Defaults to 1 kg when unset."""
	return _mm_setting_float("leftover_tolerance_kg", 1.0)


def auto_close_enabled() -> bool:
	"""Whether leftover cuttings/productions auto-close at all (default on)."""
	rows = frappe.db.sql(
		"select value from tabSingles where doctype='MM Settings' and field='auto_close_leftover'"
	)
	if rows and rows[0][0] not in (None, ""):
		return bool(int(float(rows[0][0])))
	return True


def get_inward_match_tolerance() -> float:
	"""How far SHORT a receipt may fall and still count as complete (%).

	An order closes once its inwarded weight is within this much of the ordered weight,
	so 10 means 90% of the order is accepted as delivered. Defaults to 10.
	"""
	return _mm_setting_float("inward_match_tolerance_percent", 10.0)


def get_inward_over_tolerance() -> float:
	"""How far OVER the expected weight a receipt may go before it is refused (%).

	Kept separate from the under-receipt figure because the two are not symmetric: a
	little short is a normal delivery, a lot extra is usually a keying error, and the
	shop accepts far more of the former than the latter. Defaults to 20.
	"""
	return _mm_setting_float("inward_over_tolerance_percent", 20.0)


@frappe.whitelist()
def inward_tolerances():
	"""Both figures, so the Inward screen warns on exactly what the server will enforce
	instead of mirroring a constant that can drift out of step with it."""
	return {"under": get_inward_match_tolerance(), "over": get_inward_over_tolerance()}


def verify_admin_pin(pin) -> bool:
	"""True when `pin` matches the configured Admin Override PIN.

	With no PIN configured the override used to throw outright, which left the floor
	unable to submit a production at all: the variance gate demanded an override and the
	override refused to exist. The PIN gates the override for ORDINARY users, so when none
	is set an admin — who could set it themselves anyway — is allowed through, and everyone
	else is told who to ask.
	"""
	settings = frappe.get_single("MM Settings")
	stored = settings.get_password("admin_override_pin", raise_exception=False) if settings.admin_override_pin else None
	if not stored:
		if "MM Admin" in frappe.get_roles() or "Administrator" in frappe.get_roles():
			return True
		frappe.throw(
			_(
				"No Admin Override PIN is set. Ask an admin to set one in MM Settings "
				"(Admin Override PIN), or to approve this themselves."
			)
		)
	return bool(pin) and str(pin) == str(stored)


def require_admin_pin(pin, action=None):
	"""Check the Admin Override PIN and throw a message that says which problem it is.

	Callers used one message for both "no PIN entered" and "wrong PIN", so typing a wrong
	PIN reported that a PIN was required — with no way to tell a typo from a missing entry.
	"""
	if not str(pin or "").strip():
		frappe.throw(
			_("Enter the Admin Override PIN{0}.").format(f" to {action}" if action else "")
		)
	if not verify_admin_pin(pin):
		frappe.throw(_("That Admin Override PIN is incorrect."))
	return True
