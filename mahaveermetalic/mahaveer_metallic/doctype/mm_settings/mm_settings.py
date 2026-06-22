# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class MMSettings(Document):
	pass


def get_tolerance_percent() -> float:
	"""Production variance tolerance (%). Defaults to 4 (SRS) when unset."""
	val = frappe.db.get_single_value("MM Settings", "production_tolerance_percent")
	return float(val) if val not in (None, "") else 4.0


def verify_admin_pin(pin) -> bool:
	"""True when `pin` matches the configured Admin Override PIN. Raises if no PIN
	has been configured (so an override can never silently pass)."""
	settings = frappe.get_single("MM Settings")
	stored = settings.get_password("admin_override_pin", raise_exception=False) if settings.admin_override_pin else None
	if not stored:
		frappe.throw(_("No Admin Override PIN is configured in MM Settings."))
	return bool(pin) and str(pin) == str(stored)
