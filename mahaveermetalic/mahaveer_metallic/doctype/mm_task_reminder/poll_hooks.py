# Copyright (c) 2026, Mahaveer and contributors

import frappe


def on_raven_poll_vote_after_insert(doc, method=None):
	if not frappe.db.exists("DocType", "MM Task Reminder Poll Link"):
		return

	option_norm = (doc.option or "").strip().lower()

	if option_norm not in {"yes"}:
		return

	parent_reminder = frappe.db.get_value("MM Task Reminder Poll Link", {"poll_id": doc.poll_id}, "parent")

	if not parent_reminder:
		return

	frappe_user = frappe.db.get_value("Raven User", doc.user_id, "user")

	r = frappe.get_doc("MM Task Reminder", parent_reminder)
	if r.status in ("Completed", "Cancelled"):
		return

	frappe.enqueue(
		"mahaveermetalic.mahaveer_metallic.task_reminder.poll_hooks._complete_reminder_background",
		queue="short",
		job_name=f"complete-mm-task-reminder-{parent_reminder}",
		reminder_name=parent_reminder,
		frappe_user=frappe_user,
	)


def _complete_reminder_background(reminder_name: str | None = None, frappe_user: str | None = None):
	if not reminder_name:
		return
	doc = frappe.get_doc("MM Task Reminder", reminder_name)
	if doc.status in ("Completed", "Cancelled"):
		return
	doc.flags.ignore_permissions = True
	doc.mark_completed_via_raven(frappe_user or frappe.session.user or "Administrator")
