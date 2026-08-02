# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Leftover close-out for Cutting and Production.

A cutting can hold more weight than the program takes: plan 4 batches out of a cutting
that could yield 5 and some weight sits unused. That leftover is closed out so it stops
showing as available — automatically when it is within the configured tolerance, or
manually with Force close.

The one exception: if more of the SAME colour + lot is still coming in (an inward whose
rolls aren't cut yet), the leftover is kept open so the next cutting simply adds onto it.

Everything closed lands on the close-out stack, where it can be reverted.
"""

import frappe
from frappe import _

from mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings import (
	auto_close_enabled,
	get_leftover_tolerance,
)

CLOSABLE = ("MM Cutting", "MM Production")


def _assert_closable(doctype):
	if doctype not in CLOSABLE:
		frappe.throw(_("{0} cannot be closed out.").format(doctype))


def has_more_incoming(color, lot):
	"""True when more of this colour+lot is still expected — an inward whose rolls
	haven't been cut yet. Keeps the leftover open so the next cutting adds onto it."""
	if not color:
		return False
	conds = ["inw.docstatus = 1", "item.cutting is null", "item.color_name = %(color)s"]
	vals = {"color": color}
	if lot:
		conds.append("inw.lot = %(lot)s")
		vals["lot"] = lot
	row = frappe.db.sql(
		f"""select 1 from `tabMM Inward Item` item
		join `tabMM Inward` inw on inw.name = item.parent
		where {" and ".join(conds)} limit 1""",
		vals,
	)
	return bool(row)


def maybe_auto_close_cutting(cutting, leftover):
	"""Close a cutting's leftover when it's within tolerance and nothing more of that
	colour+lot is on the way. Returns True when it closed."""
	leftover = round(float(leftover or 0), 3)
	# leftover 0 counts as "nothing left" and closes too; only a real remainder above the
	# tolerance keeps it open.
	if leftover < 0 or not auto_close_enabled():
		return False
	if leftover > get_leftover_tolerance():
		return False
	c = frappe.db.get_value("MM Cutting", cutting, ["shade", "lot", "closed"], as_dict=True)
	if not c or c.closed:
		return False
	if has_more_incoming(c.shade, c.lot):
		return False  # more of this lot is coming — let it accumulate instead
	_set_closed("MM Cutting", cutting, "Auto", leftover)
	return True


def _set_closed(doctype, name, mode, leftover=None):
	values = {"closed": 1, "close_mode": mode, "closed_on": frappe.utils.now()}
	if leftover is not None:
		values["leftover_weight"] = round(float(leftover), 3)
	frappe.db.set_value(doctype, name, values, update_modified=False)


@frappe.whitelist()
def force_close(doctype, name, reason=None):
	"""Close a cutting/production by hand, regardless of leftover or incoming stock."""
	_assert_closable(doctype)
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found.").format(doctype, name))
	if frappe.db.get_value(doctype, name, "closed"):
		frappe.throw(_("{0} is already closed.").format(name))
	_set_closed(doctype, name, "Force")
	if reason:
		frappe.get_doc(doctype, name).add_comment("Comment", _("Force closed: {0}").format(reason))
	return {"doctype": doctype, "name": name, "closed": True, "mode": "Force"}


@frappe.whitelist()
def reopen(doctype, name):
	"""Revert a close-out from the stack — the record becomes available again."""
	_assert_closable(doctype)
	if not frappe.db.exists(doctype, name):
		frappe.throw(_("{0} {1} not found.").format(doctype, name))
	if not frappe.db.get_value(doctype, name, "closed"):
		frappe.throw(_("{0} is not closed.").format(name))
	frappe.db.set_value(
		doctype, name,
		{"closed": 0, "close_mode": "", "closed_on": None},
		update_modified=False,
	)
	return {"doctype": doctype, "name": name, "closed": False}


@frappe.whitelist()
def closed_stack(doctype=None, limit=200):
	"""The close-out stack: everything closed, newest first, ready to revert."""
	out = []
	types = [doctype] if doctype in CLOSABLE else list(CLOSABLE)
	for dt in types:
		fields = ["name", "closed_on", "close_mode", "leftover_weight", "customer_order", "lot"]
		fields += ["shade", "cut", "total_net_weight"] if dt == "MM Cutting" else ["shade", "cut", "net_weight"]
		for r in frappe.get_all(
			dt, filters={"closed": 1}, fields=fields, order_by="closed_on desc", limit_page_length=int(limit)
		):
			out.append(
				{
					"doctype": dt,
					"name": r.name,
					"closed_on": str(r.closed_on) if r.closed_on else None,
					"close_mode": r.close_mode,
					"leftover_weight": r.leftover_weight,
					"customer_order": r.customer_order,
					"lot_id": frappe.db.get_value("MM Lot", r.lot, "lot_id") if r.lot else None,
					"color": r.shade,
					"cut": r.cut,
					"weight": r.get("total_net_weight") if dt == "MM Cutting" else r.get("net_weight"),
				}
			)
	out.sort(key=lambda x: x["closed_on"] or "", reverse=True)
	return out
