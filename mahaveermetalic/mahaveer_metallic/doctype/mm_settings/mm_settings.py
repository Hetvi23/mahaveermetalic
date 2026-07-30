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


def get_inward_match_tolerance() -> float:
	"""Inward-to-order match tolerance (%). An order auto-completes once its inwarded
	weight is within this % of the ordered weight. Defaults to 2 when unset."""
	return _mm_setting_float("inward_match_tolerance_percent", 2.0)


def verify_admin_pin(pin) -> bool:
	"""True when `pin` matches the configured Admin Override PIN. Raises if no PIN
	has been configured (so an override can never silently pass)."""
	settings = frappe.get_single("MM Settings")
	stored = settings.get_password("admin_override_pin", raise_exception=False) if settings.admin_override_pin else None
	if not stored:
		frappe.throw(_("No Admin Override PIN is configured in MM Settings."))
	return bool(pin) and str(pin) == str(stored)
