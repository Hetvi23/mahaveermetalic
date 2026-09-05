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


def get_production_tolerance_kg() -> float:
	"""Absolute kg of shortfall a production voucher may run without an override.

	The percentage on its own is unusable on small programs: at the default 4%, a 20 kg
	program is over tolerance the moment it comes up 1 kg short, and the floor was being
	asked for an admin PIN to accept a rounding. This is the floor UNDER the percentage —
	an override is required only when the shortfall breaks BOTH. Defaults to 2 kg.

	Deliberately one-sided. It softens producing LESS than went in, which is ordinary
	(waste, a short run, scale rounding). Producing MORE is never a tolerance question and
	is refused outright wherever it is checked.
	"""
	return _mm_setting_float("production_tolerance_kg", 2.0)


def variance_needs_override(input_weight, net, tol=None, floor_kg=None) -> bool:
	"""Does this production shortfall need the Admin Override PIN?

	Only when it breaks BOTH the percentage tolerance AND the absolute kg floor. Either
	one alone is the wrong test: the percentage refuses a 1 kg rounding on a 20 kg
	program, and the kg floor alone would wave through 40 kg missing off a 1,000 kg one.

	Lives here, not in api/production, because the MM Production controller enforces the
	same gate on save. Two copies of this rule is two rules, and they drift.

	Producing MORE than went in never reaches here — both callers refuse it outright,
	because that weight came from somewhere else and the voucher is simply wrong.
	"""
	base = float(input_weight or 0)
	if not base:
		return False
	if tol is None:
		tol = get_tolerance_percent()
	if floor_kg is None:
		floor_kg = get_production_tolerance_kg()
	off_pct = abs(round((float(net) - base) / base * 100, 2))
	off_kg = abs(round(float(net) - base, 3))
	return off_pct > tol and off_kg > floor_kg


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


def get_purchase_qty_multiple() -> float:
	"""The lot size some material is bought in, in kg. Defaults to 600 when unset.

	Configurable because it is a SUPPLIER's figure — how the beam comes — not a fact about
	the app. Which orders it applies to is a separate decision and lives on the order
	itself (`enforce_purchase_multiple`), because one customer's colour comes in fixed lots
	and the next one's does not.
	"""
	return _mm_setting_float("purchase_qty_multiple", 600.0)


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
