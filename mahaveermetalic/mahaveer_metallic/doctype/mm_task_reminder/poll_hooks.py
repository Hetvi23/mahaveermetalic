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
	if not frappe_user:
		return

	if is_yes:
		r = frappe.get_doc("MM Task Reminder", parent_reminder)
		if r.status in ("Completed", "Cancelled"):
			return

		frappe.enqueue(
			"mahaveermetalic.mahaveer_metallic.doctype.mm_task_reminder.poll_hooks._complete_reminder_background",
			queue="short",
			job_name=f"complete-mm-task-reminder-{parent_reminder}",
			reminder_name=parent_reminder,
			frappe_user=frappe_user,
		)
	else:
		# "No" vote:
		# 1. Delete message with poll
		msg_name = frappe.db.get_value("Raven Message", {"poll_id": poll_id}, "name")
		if msg_name:
			try:
				frappe.delete_doc("Raven Message", msg_name, ignore_permissions=True, delete_permanently=True)
			except Exception:
				pass

		# 2. Set cache key for 5 minutes
		frappe.cache().set_value(f"task_reminder_no_vote:{frappe_user}", parent_reminder, expires_in_sec=300)

		# 3. Send bot prompt for remark
		reminder_title = frappe.db.get_value("MM Task Reminder", parent_reminder, "title") or "Task"
		from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery
		from frappe.utils.data import escape_html
		delivery = RavenTaskDelivery()
		msg = (
			f"<p>You marked <strong>No</strong> on task: <em>{escape_html(reminder_title)}</em>.</p>"
			f"<p>If you'd like to add an optional remark explaining why, please type it in this chat.</p>"
		)
		delivery.send_html_dm(frappe_user, msg)


def _complete_reminder_background(reminder_name: str | None = None, frappe_user: str | None = None):
	if not reminder_name:
		return
	doc = frappe.get_doc("MM Task Reminder", reminder_name)
	if doc.status in ("Completed", "Cancelled"):
		return

	# Import helper from scheduler to check individual completion
	from mahaveermetalic.mahaveer_metallic.task_reminder.scheduler import has_user_completed

	# Check if all recipients have completed
	all_completed = True
	for row in doc.reminder_recipients:
		if not row.user:
			continue
		if row.user == frappe_user:
			continue
		if not has_user_completed(doc, row.user):
			all_completed = False
			break

	if all_completed:
		doc.flags.ignore_permissions = True
		doc.mark_completed_via_raven(frappe_user or frappe.session.user or "Administrator")


def on_raven_message_after_insert(doc, method=None):
	if doc.is_bot_message or not doc.owner:
		return

	# Check if user has a pending "No" vote awaiting remark
	reminder_name = frappe.cache().get_value(f"task_reminder_no_vote:{doc.owner}")
	if not reminder_name:
		return

	# Clear cache key immediately
	frappe.cache().delete_value(f"task_reminder_no_vote:{doc.owner}")

	full_name = frappe.db.get_value("User", doc.owner, "full_name") or doc.owner
	remark_text = doc.content or doc.text or ""

	from bs4 import BeautifulSoup
	soup = BeautifulSoup(remark_text, "html.parser")
	cleaned_remark = soup.get_text(" ", strip=True)

	if cleaned_remark:
		# Add a timeline comment to the MM Task Reminder document
		r_doc = frappe.get_doc("MM Task Reminder", reminder_name)
		r_doc.add_comment("Comment", text=f"<strong>{full_name}</strong> voted No on poll. Remark: {cleaned_remark}")

		# Send confirmation message
		from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery
		delivery = RavenTaskDelivery()
		delivery.send_html_dm(doc.owner, f"<p>Thank you, your remark has been recorded: <em>\"{cleaned_remark}\"</em></p>")
