# Copyright (c) 2026, Mahaveer and contributors

import frappe


def on_raven_poll_vote_before_insert(doc, method=None):
	"""
	Set a short title on Raven Poll Vote before insert to avoid the
	140-char limit error that occurs when Frappe tries to use the full
	doc dict as the title (triggered by the custom 'title' field on the site).
	"""
	try:
		poll_id = (doc.get("poll_id") or "")[:50]
		user_id = (doc.get("user_id") or "")[:50]
		doc.title = f"{poll_id}-{user_id}"[:140]
	except Exception:
		pass


def on_raven_poll_vote_after_insert(doc, method=None):
	if not frappe.db.exists("DocType", "MM Task Reminder Poll Link"):
		return

	# Handle both old Raven (option field) and new Raven (vote_selection child table)
	options_selected = []
	
	try:
		# Old Raven
		if doc.get("option"):
			options_selected.append(doc.get("option"))
		
		# New Raven (child table)
		if doc.get("vote_selection"):
			for row in doc.get("vote_selection"):
				# In newer Raven, 'option' might be a link or ID, we need to check its text
				opt_val = row.get("option")
				if opt_val:
					# If opt_val is an ID, get its actual text
					# (Raven Poll Option.option)
					opt_text = frappe.db.get_value("Raven Poll Option", opt_val, "option") or opt_val
					options_selected.append(opt_text)
	except Exception as e:
		frappe.log_error(f"Failed to extract options: {str(e)}", "MM Task Reminder Debug")

	is_yes = any((o or "").strip().lower() == "yes" for o in options_selected)

	if not is_yes:
		return

	try:
		poll_id = doc.get("poll_id")
		user_id = doc.get("user_id")
	except Exception as e:
		frappe.log_error(f"Failed to get doc fields: {str(e)}", "MM Task Reminder Debug")
		return

	parent_reminder = frappe.db.get_value("MM Task Reminder Poll Link", {"poll_id": poll_id}, "parent")

	if not parent_reminder:
		return

	frappe_user = frappe.db.get_value("Raven User", user_id, "user")

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
