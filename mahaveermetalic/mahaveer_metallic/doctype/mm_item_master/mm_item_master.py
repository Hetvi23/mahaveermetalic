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
