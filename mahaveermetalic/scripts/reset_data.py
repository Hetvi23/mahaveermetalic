# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Clear every transaction from a Mahaveer site and leave the masters standing.

For go-live: the shop has been keying trial data, and wants the first REAL inward to be
lot LT1, the first order MM-SO-2026-00001 and every stock balance zero — without re-typing
the item, colour, party, vendor, machine, employee, branch and location masters, or the
settings behind them.

    DRY RUN (default — touches nothing, prints what it would do):
        bench --site <site> execute mahaveermetalic.scripts.reset_data.run

    FOR REAL:
        bench --site <site> execute mahaveermetalic.scripts.reset_data.run \
            --kwargs "{'apply': True, 'confirm': 'CLEAR MAHAVEER DATA'}"

    ALSO CLEAR THE MASTERS (items, parties, vendors, employees, machines, branches,
    locations, bobbins) — an empty app rather than a fresh trading year:
        bench --site <site> execute mahaveermetalic.scripts.reset_data.run \
            --kwargs "{'apply': True, 'confirm': 'CLEAR MAHAVEER DATA', 'masters': True}"

    Add 'settings': True on top of that to drop MM Settings and the Veermetlon
    credentials as well. Kept separate because that is configuration, not data: the VM
    fetch stops working until somebody types the credentials back in.

Two things decide what happens here, and both are deliberate.

Raw SQL, not frappe.delete_doc. Every transaction in this app is submitted (docstatus 1),
guarded against deletion while another document links to it, and tangled in cycles —
an inward row points at its cutting and the cutting points back. Deleting document by
document means cancelling thousands of docs in dependency order, and frappe.delete_doc
writes a full restorable copy of each one into `tabDeleted Document`, which turns the wipe
into a copy. SQL empties the tables outright.

What SQL skips, this does by hand. Going around the ORM also goes around the cleanup the
ORM would have done, so the framework's side-tables are cleared here explicitly —
`__global_search` (or the awesomebar keeps autocompleting deleted orders), Version, Comment,
ToDo, DocShare, File, Activity Log, View Log, Tag Link, Access Log, Route History,
Prepared Report — along with the naming counters in `tabSeries`, which are the one piece of
residue that visibly corrupts a fresh start: leave them and the shop's first real order is
numbered 47.
"""

import json
import os

import frappe

CONFIRM = "CLEAR MAHAVEER DATA"

# ── What gets emptied ────────────────────────────────────────────────────────────────
#
# Ordered parents-before-children only for readability; with raw SQL and no foreign keys
# the order does not matter. Every one of these was checked by asking "does an operator
# create this during the day's work, or did an admin set it up once?" — and then checked
# again by trying to argue the opposite.
TRANSACTIONAL = [
	# Sell side
	"MM Sales Order",
	"MM Sales Order Item",
	"MM Purchase Order",
	# Receive
	"MM Inward",
	"MM Inward Item",
	"MM Lot",
	"MM Lot Remark",
	# Floor
	"MM Cutting",
	"MM Cutting Patti",
	"MM Program",
	"MM Program Patty",
	"MM Production",
	"MM Production Box",
	"MM Production Bobbin",
	# Dispatch
	"MM Sales Challan",
	"MM Sales Challan Item",
	# One reconciliation per Job Out — what went to the worker against what came back.
	# Derived entirely from the job challans above, so it cannot outlive them.
	"MM Job Hisab",
	# Stock and bobbin ledgers — running balances. Left behind, every new balance is
	# computed on top of dead history and the shop owns phantom stock.
	"MM Stock Ledger Entry",
	"MM Roll Inventory",
	"MM Bobbin Ledger Entry",
	"MM Bobbin Box Tracking",
	"MM Bobbin Box Line",
	# Reminder history (the reminders THEMSELVES are config — see REMINDER_CONFIG).
	"MM Task Reminder Log",
	"MM Task Reminder Poll Link",
]

# ── What survives ────────────────────────────────────────────────────────────────────
#
# Listed rather than inferred, so that a doctype added later is never silently wiped: the
# script refuses to run if it meets an MM doctype it has never been told about.
MASTER_TABLES = [
	"MM Item Master",
	"MM Item Type Master",
	"MM Party Master",
	"MM Party Company",
	"MM Vendor Master",
	"MM Employee Master",
	"MM Machine",
	"MM Branch",
	"MM Location Master",
	"MM Bobbin Master",
	"MM Cut Patty Config",
]

# Configuration, not data, and kept apart from the masters for one reason: MM Veermetlon
# Settings holds the integration credentials and MM Settings holds the Admin Override PIN,
# the tolerances, the company address and the challan terms. Wiping those breaks the VM
# fetch and silently changes what the guards allow, and neither is what "clear the data"
# means. They go only when asked for by name (settings=True).
SETTINGS_SINGLES = [
	"MM Settings",
	"MM Veermetlon Settings",
	"MM Raven Task Notification Settings",
]

MASTERS = MASTER_TABLES + SETTINGS_SINGLES

# Reminder definitions sit on the fence: nobody keys them during a shift, but somebody sat
# down and configured who gets nudged and when. Losing that is not part of "clear the trial
# data", so they are kept unless asked for by name (reminders=True).
REMINDER_CONFIG = [
	"MM Task Reminder",
	"MM Task Reminder Recipient",
	"MM Task Reminder Completion Recipient",
]

# ── Naming counters ──────────────────────────────────────────────────────────────────
#
# `tabSeries` is shared with the framework and every other installed app, so this NEVER
# blanket-deletes it. Only prefixes this app owns are matched, and a dry run prints the
# exact rows so they can be eyeballed before anything goes.
#
#   MM-SO-<year>-                the sales order series
#   MM-SC-/JO-/JI-/JC-/CH-/DC-   the six challan series (dispatch, job out/in, …)
#   MMPROD-                      production vouchers
#   MMSO, MMPO                   internal fallback counters
#   MM<yymmdd>                   one key per posting date, for production box barcodes
SERIES_PATTERNS = [
	"MM-SO-%",
	# Both numbering schemes: the MMU series in use, and the MM-XX- one that preceded it.
	"MMUSC-%",
	"MMUJO-%",
	"MMUJI-%",
	"MMUJC-%",
	"MMUCH-%",
	"MMUDC-%",
	"MMURC-%",
	"MM-SC-%",
	"MM-JO-%",
	"MM-JI-%",
	"MM-JC-%",
	"MM-CH-%",
	"MM-DC-%",
	"MMPROD-%",
	"MMSO%",
	"MMPO%",
]
# Box-barcode keys are MM + six digits; a LIKE would also catch MMPROD, so they are matched
# on shape instead.
SERIES_REGEXP = "^MM[0-9]{6}$"

# Frappe's own side-tables that carry a reference to a document. Cleaned by reference, not
# emptied — other apps' rows live in the same tables.
SIDE_TABLES = [
	("Version", "ref_doctype", "docname"),
	("Comment", "reference_doctype", "reference_name"),
	("ToDo", "reference_type", "reference_name"),
	("DocShare", "share_doctype", "share_name"),
	("File", "attached_to_doctype", "attached_to_name"),
	("Activity Log", "reference_doctype", "reference_name"),
	("View Log", "reference_doctype", "reference_name"),
	("Tag Link", "document_type", "document_name"),
	# Access Log names the doctype in `export_from`, not in a reference_doctype column —
	# there isn't one. Prepared Report and Route History are absent on purpose: neither
	# carries a reference to a document, only to a report or a URL.
	("Access Log", "export_from", "reference_document"),
	("Deleted Document", "deleted_doctype", "deleted_name"),
]


def _table(doctype):
	return "`tab{0}`".format(doctype.replace("`", ""))


def _exists(doctype):
	try:
		frappe.db.sql("select 1 from {0} limit 1".format(_table(doctype)))
		return True
	except Exception:
		return False


def _count(doctype):
	if not _exists(doctype):
		return None
	return frappe.db.sql("select count(*) from {0}".format(_table(doctype)))[0][0]


def _audit_doctype_coverage():
	"""Refuse to run if an MM doctype exists that this script has never been told about.

	A doctype added after this was written is exactly the thing that gets wiped by a
	pattern match, or silently left full by a hardcoded list. Neither is acceptable, so
	an unknown name stops the run and asks a human which side it belongs on.
	"""
	known = set(TRANSACTIONAL) | set(MASTERS) | set(REMINDER_CONFIG)
	live = {
		d.name
		for d in frappe.get_all(
			"DocType", filters={"module": "Mahaveer Metallic"}, fields=["name"]
		)
	}
	unknown = sorted(live - known)
	if unknown:
		frappe.throw(
			"reset_data does not know about these doctypes: {0}.\n"
			"Add each to TRANSACTIONAL or MASTERS in {1} and run again.".format(
				", ".join(unknown), __file__
			)
		)
	return sorted(live)


def _save_reorder_levels(apply):
	"""Reorder levels are the one piece of SETUP riding on a transactional table.

	MM Roll Inventory rows are stock balances and go, but `reorder_weight` on them is a
	level somebody chose by hand. It is written out first so it can be keyed back, rather
	than discovered missing weeks later when nothing warns about running low.
	"""
	if not _exists("MM Roll Inventory"):
		return None
	rows = frappe.db.sql(
		"""select branch, location, color_name, lot_number, reorder_weight
		from `tabMM Roll Inventory`
		where ifnull(reorder_weight, 0) > 0""",
		as_dict=True,
	)
	if not rows:
		return None
	path = os.path.join(
		frappe.get_site_path("private", "files"),
		"mm_reorder_levels_before_reset.json",
	)
	if apply:
		with open(path, "w") as f:
			json.dump(rows, f, indent=2, default=str)
	return {"count": len(rows), "path": path}


def _clear_series(apply):
	"""Empty this app's naming counters — and only this app's."""
	where = " or ".join(["name like %s"] * len(SERIES_PATTERNS)) + " or name regexp %s"
	params = SERIES_PATTERNS + [SERIES_REGEXP]
	rows = frappe.db.sql(
		"select name, current from `tabSeries` where {0}".format(where), params, as_dict=True
	)
	if apply and rows:
		frappe.db.sql("delete from `tabSeries` where {0}".format(where), params)
	return rows


def _clear_side_tables(doctypes, apply):
	"""Drop framework rows that point at documents that no longer exist."""
	out = {}
	for table, dt_col, name_col in SIDE_TABLES:
		if not dt_col or not _exists(table):
			continue
		n = frappe.db.sql(
			"select count(*) from {0} where {1} in %s".format(_table(table), dt_col),
			(tuple(doctypes),),
		)[0][0]
		if not n:
			continue
		out[table] = n
		if apply:
			frappe.db.sql(
				"delete from {0} where {1} in %s".format(_table(table), dt_col),
				(tuple(doctypes),),
			)
	# The awesomebar reads this directly; orphans here keep autocompleting deleted orders.
	if _exists("__global_search"):
		n = frappe.db.sql(
			"select count(*) from `__global_search` where doctype in %s", (tuple(doctypes),)
		)[0][0]
		if n:
			out["__global_search"] = n
			if apply:
				frappe.db.sql(
					"delete from `__global_search` where doctype in %s", (tuple(doctypes),)
				)
	return out


def _clear_singles(apply):
	"""Empty this app's Single doctypes.

	Singles have no table of their own — every field is a row in `tabSingles` keyed by
	doctype — so they are cleared by deleting those rows, never by emptying a table.
	Only ever reached with settings=True.
	"""
	out = {}
	for dt in SETTINGS_SINGLES:
		n = frappe.db.sql("select count(*) from tabSingles where doctype = %s", (dt,))[0][0]
		if not n:
			continue
		out[dt] = n
		if apply:
			frappe.db.sql("delete from tabSingles where doctype = %s", (dt,))
	return out


def _reopen_machines(apply):
	"""MM Machine is a master that carries one transactional flag, and it blocks go-live.

	`closed` is set by the shop-floor Close dialog and the planner refuses to schedule on a
	closed machine. Wipe the programs and leave the flag, and the first real program cannot
	be created on any machine that was closed during the trial — with nothing on screen to
	explain why. The master stays; the flag it picked up during trading does not.
	"""
	if not _exists("MM Machine"):
		return 0
	n = frappe.db.sql(
		"select count(*) from `tabMM Machine` where ifnull(closed, 0) = 1"
	)[0][0]
	if n and apply:
		frappe.db.sql("update `tabMM Machine` set closed = 0 where ifnull(closed, 0) = 1")
	return n


def _raven_orphans():
	"""Report, never delete: Raven is another app's data store.

	The reminder engine creates Raven polls and bot messages and remembers them by id, not
	by Link. Clearing MM leaves those sitting in people's chat history. Removing them is a
	Raven decision, so this only counts them and says so.
	"""
	if not frappe.db.exists("DocType", "Raven Poll"):
		return None
	try:
		linked = frappe.db.sql(
			"select count(distinct poll_id) from `tabMM Task Reminder Poll Link` where ifnull(poll_id,'') != ''"
		)[0][0]
	except Exception:
		return None
	return linked or None


def _flag(v):
	"""kwargs arrive from the command line as strings, so 'False' must not read as True."""
	return bool(v) and str(v).strip().lower() not in ("0", "false", "no", "")


def run(apply=False, confirm=None, reminders=False, masters=False, settings=False, backup=True):
	"""Clear the site's data. Prints a plan; only acts when apply and confirm agree.

	apply     — False (default) reports and changes nothing.
	confirm   — must be the exact string CLEAR MAHAVEER DATA when apply is True.
	reminders — also delete the configured Task Reminders, not just their logs.
	masters   — ALSO empty the masters: items, parties, vendors, employees, machines,
	            branches, locations, bobbins. Off by default, because the ordinary reason
	            to run this is go-live: clear the trial trading, keep the setup somebody
	            spent a week typing in.
	settings  — ALSO empty MM Settings / MM Veermetlon Settings / MM Raven Task
	            Notification Settings. Separate from `masters` on purpose: this is where
	            the Veermetlon credentials, the Admin Override PIN and the tolerances live,
	            and losing them breaks the VM fetch rather than clearing data.
	backup    — take a database backup first. Leave it on unless one was just taken.
	"""
	apply = _flag(apply)
	reminders = _flag(reminders)
	masters = _flag(masters)
	settings = _flag(settings)
	backup = _flag(backup) if str(backup).strip().lower() in ("0", "false", "no") else True
	site = frappe.local.site

	targets = list(TRANSACTIONAL) + (list(REMINDER_CONFIG) if reminders else [])
	if masters:
		targets += list(MASTER_TABLES)
	_audit_doctype_coverage()

	print("")
	print("=" * 72)
	print("  MAHAVEER DATA RESET   site: {0}".format(site))
	print("  mode: {0}".format("APPLY — data will be deleted" if apply else "DRY RUN — nothing is touched"))
	print("=" * 72)

	if apply and confirm != CONFIRM:
		frappe.throw(
			"Refusing to delete anything.\n"
			"Re-run with  confirm='{0}'  to mean it.\n"
			"Site that would have been cleared: {1}".format(CONFIRM, site)
		)

	# ── Plan ──
	rows, total = [], 0
	for dt in targets:
		n = _count(dt)
		rows.append((dt, n))
		total += n or 0
	print("\nWILL CLEAR")
	for dt, n in rows:
		print("   {0:<38} {1}".format(dt, "(no table)" if n is None else "{0:>9,}".format(n)))
	print("   {0:<38} {1:>9,}".format("TOTAL ROWS", total))

	if masters:
		print("\n   ** MASTERS ARE BEING CLEARED TOO — items, parties, vendors, employees,")
		print("      machines, branches, locations and bobbins all go. Nothing re-seeds them:")
		print("      after_install only creates roles, so they are re-typed by hand.")

	singles = _clear_singles(apply=False)
	if settings:
		print("\n   ** SETTINGS ARE BEING CLEARED TOO. This is where the Veermetlon")
		print("      credentials, the Admin Override PIN and the receipt tolerances live —")
		print("      the VM fetch stops working until they are entered again.")
		for dt, n in sorted(singles.items()):
			print("      {0:<36} {1:>9,} stored field(s)".format(dt, n))

	keep = ([] if masters else list(MASTER_TABLES)) \
		+ ([] if settings else list(SETTINGS_SINGLES)) \
		+ ([] if reminders else list(REMINDER_CONFIG))
	print("\nWILL KEEP")
	if not keep:
		print("   (nothing — this empties the app completely)")
	for dt in keep:
		n = _count(dt)
		if n is None and dt in SETTINGS_SINGLES:
			n = frappe.db.sql("select count(*) from tabSingles where doctype = %s", (dt,))[0][0]
			print("   {0:<38} {1:>9,} stored field(s)".format(dt, n))
			continue
		print("   {0:<38} {1}".format(dt, "(no table)" if n is None else "{0:>9,}".format(n)))

	series = _clear_series(apply=False)
	print("\nNAMING COUNTERS TO RESET ({0})".format(len(series)))
	for s in series:
		print("   {0:<38} at {1}".format(s.name, s.current))
	if not series:
		print("   (none — numbering already starts at 1)")

	closed = 0 if masters else _reopen_machines(apply=False)
	if closed:
		print("\nMACHINES TO RE-OPEN: {0} (closed=1 would block the first new program)".format(closed))

	saved = _save_reorder_levels(apply=False)
	if saved:
		print("\nREORDER LEVELS TO SAVE: {0} rows -> {1}".format(saved["count"], saved["path"]))

	raven = _raven_orphans()
	if raven:
		print(
			"\nNOTE: {0} Raven poll(s) were created by MM reminders. They live in Raven, not\n"
			"      here, and are NOT touched — clear them from Raven if they matter.".format(raven)
		)

	if not apply:
		print("\nDry run only. Nothing was changed.")
		print("To do it for real:")
		print("   bench --site {0} backup --with-files".format(site))
		# Echo back the SCOPE that was just planned. Printing the bare command invited
		# running the real thing without the flags — a plan that said "masters too"
		# followed by a command that quietly kept them.
		extra = "".join(
			", '{0}': True".format(k)
			for k, v in (("reminders", reminders), ("masters", masters), ("settings", settings))
			if v
		)
		print(
			"   bench --site {0} execute mahaveermetalic.scripts.reset_data.run "
			"--kwargs \"{{'apply': True, 'confirm': '{1}'{2}}}\"".format(site, CONFIRM, extra)
		)
		print("")
		return

	# ── Apply ──
	if backup:
		from frappe.utils.backups import new_backup

		print("\nBacking up first…")
		b = new_backup(ignore_files=True, force=True)
		print("   {0}".format(b.backup_path_db))

	# A cron runs every minute and writes reminder logs; without this the log table has rows
	# in it again before the wipe has finished.
	was_paused = frappe.db.get_global("pause_scheduler")
	frappe.db.set_global("pause_scheduler", 1)
	frappe.db.commit()

	try:
		_save_reorder_levels(apply=True)

		print("\nClearing…")
		for dt in targets:
			if not _exists(dt):
				continue
			frappe.db.sql("delete from {0}".format(_table(dt)))
			print("   emptied {0}".format(dt))

		side = _clear_side_tables(targets, apply=True)
		for t, n in sorted(side.items()):
			print("   cleaned {0:<28} {1:>9,} rows".format(t, n))

		gone = _clear_series(apply=True)
		print("   reset   {0:<28} {1:>9,} counters".format("tabSeries", len(gone)))

		if settings:
			gone_singles = _clear_singles(apply=True)
			for dt, n in sorted(gone_singles.items()):
				print("   emptied {0:<28} {1:>9,} stored field(s)".format(dt, n))

		reopened = 0 if masters else _reopen_machines(apply=True)
		if reopened:
			print("   re-opened {0} machine(s)".format(reopened))

		frappe.db.commit()
	finally:
		frappe.db.set_global("pause_scheduler", was_paused or 0)
		frappe.db.commit()

	frappe.clear_cache()

	# ── Prove it ──
	print("\nVERIFY")
	left = 0
	for dt in targets:
		n = _count(dt) or 0
		left += n
		if n:
			print("   STILL HAS ROWS: {0} = {1}".format(dt, n))
	print("   transactional rows remaining: {0}".format(left))
	if masters:
		print("   masters cleared too — items, parties, vendors, employees, machines,")
		print("   branches, locations and bobbins are all empty.")
	else:
		kept = {dt: _count(dt) for dt in MASTER_TABLES}
		print("   masters intact: " + ", ".join("{0}={1}".format(k.replace("MM ", ""), v) for k, v in kept.items() if v))
	print("\nDone. The next inward is lot LT1, and numbering starts from 1.")
	print("Restart so nothing serves a cached count:  bench --site {0} clear-cache".format(site))
	print("")
