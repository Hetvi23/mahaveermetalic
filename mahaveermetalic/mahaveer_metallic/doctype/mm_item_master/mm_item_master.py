# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The colour/item catalogue.

A colour's name is its identity here: MM Item Master autonames `field:item_name`, so the
record's id IS the name that was typed when it was created. Everything downstream then
stores that text — and mostly as PLAIN DATA, not as a link:

    MM Inward Item.color_name       MM Sales Order Item.color_name
    MM Roll Inventory.color_name    MM Stock Ledger Entry.color_name
    MM Purchase Order.color         MM Cutting.shade / MM Cutting Patti.shade
    MM Program.shade / .patty       MM Production.shade

Rename the master and none of that follows. The order still says "K Anmol BSM", the lot
still says "K Anmol BSM", and the master says something else — so the colour that was
ordered can no longer be found from the colour that arrived, and no error is raised
anywhere. That is why a colour in use is frozen: not to be awkward, but because the app
has no way to carry the change through, and a silent split is worse than a refusal.
"""

import frappe
from frappe import _
from frappe.model.document import Document


def colour_key(text):
	"""A colour compared the way the floor reads it — neither case nor spacing is a
	difference. "R ANMOL" and "RANMOL" are one colour typed two ways, and so are
	"LG DT BSM" and "LGDT BSM" (Hetvi: "keep uniqueness common like R anmol and Ranmol
	will be same"). Spaces are dropped ENTIRELY, not just collapsed: the whole point is
	that where a person put the gaps is not part of the name."""
	return "".join((text or "").split()).casefold()

#: Every place a colour's NAME is written down. Link fields and plain Data alike — the
#: framework's own link check only sees the Link ones, and it is the Data ones that break
#: quietly. Keep this list in step with the schema; the doctype JSONs are the source.
COLOUR_USES = (
	("MM Inward", "item_type"),
	("MM Inward Item", "color_name"),
	("MM Sales Order Item", "color_name"),
	("MM Sales Challan Item", "color_name"),
	("MM Purchase Order", "color"),
	("MM Roll Inventory", "color_name"),
	("MM Roll Inventory", "item_type"),
	("MM Stock Ledger Entry", "color_name"),
	("MM Stock Ledger Entry", "item_type"),
	("MM Cutting", "shade"),
	("MM Cutting Patti", "shade"),
	("MM Program", "shade"),
	("MM Program Patty", "shade"),
	("MM Production", "shade"),
	("MM Lot", "color"),
	("MM Lot Remark", "color"),
)


def where_used(colour: str, uses=COLOUR_USES):
	"""First place this name is written down, as (label, count) — or None if nowhere.

	Stops at the first hit: the answer to "may I rename this?" is yes or no, and counting
	every table to say no more firmly costs a query per table for nothing.
	"""
	if not colour:
		return None
	for doctype, field in uses:
		try:
			n = frappe.db.count(doctype, {field: colour})
		except Exception:
			# A doctype from a newer schema than this site has — not a reason to fail a save.
			continue
		if n:
			return (doctype, n)
	return None


class MMItemMaster(Document):
	def before_insert(self):
		"""CAPS, AND ONE COLOUR PER NAME — both settled before the id is minted.

		Uppercasing has to happen here rather than in validate(): autoname is
		`field:item_name`, so the record's id is whatever this field holds when
		set_new_name runs, which is after before_insert and before validate. Uppercase it
		any later and the id keeps the old case while the field moves on — which is exactly
		the split validate() below refuses.

		Only on the way in, for the same reason. The colours already on file are left in
		the case they were typed: a master in use cannot be renamed (see the module
		docstring), so re-casing an existing row would part it from every table that wrote
		its name down, and would make rows like "Silver BSM" impossible to save at all.
		"""
		# Runs of whitespace collapse to one on the way in too — "LOTR  MIXED  SHADE" is
		# nobody's intention, and since spacing is not part of the identity anyway (see
		# colour_key) tidying it costs nothing.
		self.item_name = " ".join((self.item_name or "").split()).upper()
		self._guard_duplicate_colour()

	def _guard_duplicate_colour(self):
		"""A colour that is already on file under different spacing or case is refused.

		Frappe's own unique check on item_name compares the text as typed, so "R ANMOL"
		walked straight past an existing "RANMOL" and stood a second row beside it. That
		duplicate is permanent — the name is the identity and a colour in use can never be
		renamed — and it splits one colour's material in two: mm.mahaveermetalic.com is
		carrying "LG DT BSM" (16 records) and "LGDT BSM" (2) for that reason.

		Checked ON INSERT ONLY. The pairs already on file cannot be merged from here, and
		refusing to save them would leave the floor unable to so much as correct their
		type.
		"""
		key = colour_key(self.item_name)
		if not key:
			return
		# "Not me" is settled in PYTHON, not in the filter: MySQL compares names
		# case-insensitively, so a `name !=` filter quietly hides the very row being looked
		# for. Same trap as MM Party Master.
		me = self.name or ""
		for other in frappe.get_all(
			"MM Item Master", fields=["name", "item_name"], limit_page_length=0
		):
			if other.name == me:
				continue
			if colour_key(other.item_name) == key:
				frappe.throw(
					_(
						"{0} is already on file as {1} — the same colour with the spacing or "
						"capitals typed differently. Use that one; adding it again splits the "
						"colour's material in two and cannot be undone."
					).format(self.item_name, other.item_name or other.name),
					title=_("Colour already exists"),
				)

	def validate(self):
		if self.is_new():
			return
		# `name` is what every other table wrote down; `item_name` is what the form now
		# holds. They part company the moment somebody edits the field.
		if self.has_value_changed("item_name") and (self.item_name or "") != self.name:
			used = where_used(self.name)
			if used:
				frappe.throw(
					_(
						"{0} is already used on {1} ({2} record(s)), so its name cannot be changed — "
						"those records keep the old name and nothing would connect them again. "
						"Create a new colour instead."
					).format(self.name, used[0], used[1])
				)

	def on_trash(self):
		used = where_used(self.name)
		if used:
			frappe.throw(
				_("{0} is used on {1} ({2} record(s)) and cannot be deleted.").format(
					self.name, used[0], used[1]
				)
			)
