# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Lot remarks — the reason a lot stopped short, carried everywhere that lot appears.

Writing one is a side effect of an action the operator was already taking (a partial
completion, a revert, a cancel), so `record` is deliberately NOT whitelisted and never
raises: losing the revert itself because a remark could not be filed would be a far worse
outcome than a missing note. `add_remark` is the manual path for the same thing.

Reading is one call per SCREEN, not one per row. The Program board polls every twenty
seconds and shows dozens of tiles; `remarks` therefore takes every key on the screen at
once and answers with both maps, because the rows on one screen do not all hold the same
key — MM Roll Inventory and MM Stock Ledger Entry rows carry only the human `lot_id`
string, while cuttings, programs and productions carry the MM Lot doc name.

A LOT ID IS NOT A KEY ON ITS OWN. Lot numbers run per colour, per financial year (see
MM Lot), so LT1/26-27 exists once for every colour that has been received — a fact the
lot master states plainly and this file used to ignore. `by_lot_id` was keyed on the bare
id, so one colour's reason was handed to every other colour holding the same number, and
the eye appeared on material nothing had ever been said about. The map is keyed on
COLOUR + id instead, and the colour is taken from MM Lot rather than trusted from the
remark, because the lot master is the only place it cannot be wrong.

`by_lot` needs none of this: an MM Lot doc name identifies one lot outright.
"""

import json

import frappe
from frappe import _

REMARK_FIELDS = ["name", "lot", "lot_id", "reason", "event_type", "program", "owner",
	"creation", "resolved"]


def colour_key(value):
	"""How a colour is matched here: case and spacing on a hand-typed shade are not a
	difference in material. Mirrors api.challan._key, and the SPA's own `lotIdKey` has to
	produce the same string — it builds the lookup key this function's output is half of."""
	return "".join((value or "").lower().split())


def lot_id_key(colour, lot_id):
	"""The composite `by_lot_id` key. An empty colour is allowed and meaningful: it is the
	bucket for remarks whose colour could not be resolved, which the caller falls back to
	rather than lose."""
	return f"{colour_key(colour)}||{lot_id or ''}"


def _as_list(value):
	"""Accept a JSON string (how the SPA sends an array), a list, or a bare string."""
	if value in (None, "", []):
		return []
	if isinstance(value, str):
		value = value.strip()
		if value.startswith("["):
			value = json.loads(value)
		else:
			return [value]
	if isinstance(value, (list, tuple, set)):
		return [str(v) for v in value if v]
	return [str(value)]


def _resolve_lot(lot=None, lot_id=None, color=None):
	"""Fill in whichever of (lot, lot_id, colour) the caller did not have.

	Colour narrows the lot_id lookup first. Lot ids run per colour, so two lots both read
	"LT1/26-27" — one gold, one silver — and a bare lot_id lookup returns whichever row the
	database hands back. The eye would then appear on the wrong colour's patti and never on
	the material the reason is about. Every other lot lookup in this app filters on colour
	first and falls back; this matches them.

	The colour is also filled IN, from the lot, whenever the caller did not pass one. It is
	what the read side keys on, and the write points do not all know it — `_program_lots`
	hands back bare lot ids for a program that drew patty from several cuttings. Deriving it
	here means a remark cannot be filed colourless while its lot knows the answer.
	"""
	lot = (lot or "").strip() or None
	lot_id = (lot_id or "").strip() or None
	color = (color or "").strip() or None
	if lot and not lot_id:
		lot_id = frappe.db.get_value("MM Lot", lot, "lot_id")
	elif lot_id and not lot:
		lot = (
			(frappe.db.get_value("MM Lot", {"lot_id": lot_id, "color": color}, "name") if color else None)
			or frappe.db.get_value("MM Lot", {"lot_id": lot_id}, "name")
		)
	if not color and lot:
		color = frappe.db.get_value("MM Lot", lot, "color")
	return lot, lot_id, color


def record(lot=None, lot_id=None, reason=None, event_type=None, program=None,
	source_doctype=None, source_name=None, color=None):
	"""File a remark against a lot. Internal — called from the write points.

	Silently does nothing when there is no lot to attach to. A program planned off an
	uncut roll genuinely has none (the lot is only known once the roll is picked), and a
	remark is a note, not a gate: the revert the operator asked for must still happen.
	Returns the remark name, or None when nothing was filed.
	"""
	reason = (reason or "").strip()
	if not reason:
		return None
	lot, lot_id, color = _resolve_lot(lot, lot_id, color)
	if not lot and not lot_id:
		return None
	try:
		doc = frappe.get_doc({
			"doctype": "MM Lot Remark",
			"lot": lot,
			"lot_id": lot_id,
			"color": color or None,
			"reason": reason,
			"event_type": event_type or "Other",
			"program": program,
			"source_doctype": source_doctype,
			"source_name": source_name,
		})
		doc.insert(ignore_permissions=True)
		return doc.name
	except Exception:
		# Same reasoning as the no-lot case: the action the operator performed is the
		# thing that must survive. Logged so a failing write is still visible.
		frappe.log_error(frappe.get_traceback(), "MM Lot Remark could not be recorded")
		return None


@frappe.whitelist()
def add_remark(lot=None, lot_id=None, reason=None, event_type=None, program=None,
	source_doctype=None, source_name=None, color=None):
	"""Write a remark by hand, from a screen. Unlike `record` this one reports failure —
	the operator typed it deliberately and has to be told when it did not stick."""
	reason = (reason or "").strip()
	if len(reason) < 3:
		frappe.throw(_("Please type a reason (at least 3 characters)."))
	lot, lot_id, color = _resolve_lot(lot, lot_id, color)
	if not lot and not lot_id:
		frappe.throw(_("A lot is required to attach a remark to."))
	doc = frappe.get_doc({
		"doctype": "MM Lot Remark",
		"lot": lot,
		"lot_id": lot_id,
		"color": color or None,
		"reason": reason,
		"event_type": event_type or "Other",
		"program": program,
		"source_doctype": source_doctype,
		"source_name": source_name,
	})
	doc.insert(ignore_permissions=True)
	return {"name": doc.name, "lot": doc.lot, "lot_id": doc.lot_id}


@frappe.whitelist()
def remarks(lots=None, lot_ids=None, include_resolved=0):
	"""Every remark for the keys a screen is showing, in ONE query.

	Answers `{"by_lot": {...}, "by_lot_id": {...}}`, each mapping a key to the LIST of its
	remarks (newest first) — a lot can collect several reasons over its life and the badge
	shows all of them. A row appears under BOTH maps whenever it has both keys, so a
	caller looks up whichever key its rows happen to carry without knowing the other.

	`by_lot` is keyed on the MM Lot doc name. `by_lot_id` is keyed COLOUR + id (see the
	module note) — the caller builds the same key with the colour its row is showing, and
	falls back to the empty-colour bucket for the few remarks whose colour is unknown.
	"""
	lots = _as_list(lots)
	lot_ids = _as_list(lot_ids)
	if not lots and not lot_ids:
		return {"by_lot": {}, "by_lot_id": {}}

	# One OR'd query rather than a pass per key: the Program board asks for dozens of keys
	# on a twenty-second poll.
	conditions = []
	values = {}
	if lots:
		conditions.append("r.lot in %(lots)s")
		values["lots"] = tuple(lots)
	if lot_ids:
		conditions.append("r.lot_id in %(lot_ids)s")
		values["lot_ids"] = tuple(lot_ids)
	where = f"({' or '.join(conditions)})"
	if not frappe.utils.cint(include_resolved):
		where += " and ifnull(r.resolved, 0) = 0"

	# The colour comes off MM LOT, not off the remark. The remark carries a colour only when
	# whoever filed it happened to know one — `_program_lots` hands back bare lot ids — while
	# the lot has always had to have one. The remark's own value is the fallback for the rare
	# row whose lot has since gone.
	rows = frappe.db.sql(
		f"""
		select {", ".join(f"r.`{f}`" for f in REMARK_FIELDS)},
			coalesce(nullif(l.color, ''), r.color) as colour
		from `tabMM Lot Remark` r
		left join `tabMM Lot` l on l.name = r.lot
		where {where}
		order by r.creation desc
		""",
		values,
		as_dict=True,
	)

	by_lot, by_lot_id = {}, {}
	for r in rows:
		r["resolved"] = int(r.get("resolved") or 0)
		colour = r.pop("colour", None)
		if r.get("lot"):
			by_lot.setdefault(r["lot"], []).append(r)
		if r.get("lot_id"):
			by_lot_id.setdefault(lot_id_key(colour, r["lot_id"]), []).append(r)
	return {"by_lot": by_lot, "by_lot_id": by_lot_id}


@frappe.whitelist()
def resolve_remark(name):
	"""Mark a remark dealt with. The row stays — it is the audit trail of why the lot
	stopped — but the eye icon stops offering it."""
	if not frappe.db.exists("MM Lot Remark", name):
		frappe.throw(_("Remark {0} not found.").format(name))
	frappe.db.set_value("MM Lot Remark", name, {
		"resolved": 1,
		"resolved_on": frappe.utils.now_datetime(),
		"resolved_by": frappe.session.user,
	})
	return {"name": name, "resolved": True}
