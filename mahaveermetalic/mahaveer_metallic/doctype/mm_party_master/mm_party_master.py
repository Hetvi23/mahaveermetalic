# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import re

import frappe
from frappe import _
from frappe.model.document import Document


def _key(text):
	"""A name compared the way a person reads it: case and spacing are not a difference.
	"SHREEJI  JARI" and "Shreeji Jari" are the same customer being typed twice."""
	return " ".join((text or "").split()).casefold()


def _digits(number):
	"""A phone number compared by its digits. +91 78780-36126 and 7878036126 are one
	number, written by two people."""
	d = re.sub(r"\D", "", number or "")
	# Indian mobiles are ten digits; a country code in front is the same phone.
	return d[-10:] if len(d) > 10 else d


class MMPartyMaster(Document):
	def validate(self):
		self._guard_duplicate_customer()

	def _guard_duplicate_customer(self):
		"""THE SAME CUSTOMER ENTERED TWICE — same name AND same mobile — is refused
		(Hetvi: "in customer, party+mobile number unique validation").

		Only the pair. One number can still belong to two customers, because it genuinely
		does: a father and son, or two firms run from one office, share a phone, and the
		live data already carries such a pair. The name on its own is the record's id, so
		Frappe refuses an identical one before this runs; what this catches is the same name
		typed with different spacing or case, which slips past that.
		"""
		name_key, phone = _key(self.party_name), _digits(self.mobile_number)
		if not name_key or not phone:
			return
		# "Not me" is compared in PYTHON, not in the filter: MySQL matches names
		# case-insensitively, so `name != self.name` quietly excluded the very record this
		# is looking for — an existing SHREEJI JARI while saving "shreeji jari".
		me = self.name or ""
		for other in frappe.get_all(
			"MM Party Master",
			fields=["name", "party_name", "mobile_number"],
			limit_page_length=0,
		):
			if other.name == me:
				continue
			if _key(other.party_name) == name_key and _digits(other.mobile_number) == phone:
				frappe.throw(
					_("{0} is already on file with mobile {1}. Open that customer instead of adding it again.").format(
						other.party_name or other.name, other.mobile_number
					),
					title=_("Customer already exists"),
				)
