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

	# Save Completed at Reminder Count in the task reminder recipients table
	reminder_count = len([r for r in doc.poll_links if r.for_user == frappe_user])
	if reminder_count == 0:
		reminder_count = 1

	updated_row = False
	for row in doc.reminder_recipients:
		if row.user == frappe_user:
			row.completed_at_reminder = reminder_count
			row.completed_time = frappe.utils.now_datetime()
			updated_row = True

	if updated_row:
		doc.flags.ignore_permissions = True
		doc.save()

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

	# Only respond to messages in our bot's DM channel with the user
	from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery
	delivery = RavenTaskDelivery()
	bot_name = delivery.bot_name
	if not bot_name:
		return

	try:
		bot = frappe.get_doc("Raven Bot", bot_name)
		bot_dm_channel = bot.create_direct_message_channel(doc.owner)
	except Exception:
		return

	if doc.channel_id != bot_dm_channel:
		return

	remark_text = doc.content or doc.text or ""
	from bs4 import BeautifulSoup
	soup = BeautifulSoup(remark_text, "html.parser")
	cleaned_text = soup.get_text(" ", strip=True)

	# 1. Check if user has a pending "No" vote awaiting remark
	reminder_name = frappe.cache().get_value(f"task_reminder_no_vote:{doc.owner}")
	if reminder_name:
		# Clear cache key immediately
		frappe.cache().delete_value(f"task_reminder_no_vote:{doc.owner}")

		full_name = frappe.db.get_value("User", doc.owner, "full_name") or doc.owner

		if cleaned_text:
			# Add a timeline comment to the MM Task Reminder document
			r_doc = frappe.get_doc("MM Task Reminder", reminder_name)
			r_doc.add_comment("Comment", text=f"<strong>{full_name}</strong> voted No on poll. Remark: {cleaned_text}")

			# Save the remark to the child recipients row
			updated_row = False
			for row in r_doc.reminder_recipients:
				if row.user == doc.owner:
					row.remark = cleaned_text
					updated_row = True

			if updated_row:
				r_doc.flags.ignore_permissions = True
				r_doc.save()

			# Send confirmation message
			delivery.send_html_dm(doc.owner, f"<p>Thank you, your remark has been recorded: <em>\"{cleaned_text}\"</em></p>")
		return

	# 2. By default, show active tasks list for any other incoming message
	active_reminders = frappe.get_all(
		"MM Task Reminder",
		filters={"status": "Active"},
		pluck="name"
	)

	from mahaveermetalic.mahaveer_metallic.task_reminder.scheduler import has_user_completed
	from frappe.utils.data import escape_html

	users_tasks = []
	for r_name in active_reminders:
		r_doc = frappe.get_doc("MM Task Reminder", r_name)
		is_recipient = any(row.user == doc.owner for row in r_doc.reminder_recipients if row.user)
		is_owner = (r_doc.owner == doc.owner)

		if is_recipient or is_owner:
			completed = False
			if is_recipient:
				completed = has_user_completed(r_doc, doc.owner)
			else:
				completed = all(has_user_completed(r_doc, row.user) for row in r_doc.reminder_recipients if row.user)

			if not completed:
				users_tasks.append({
					"doc": r_doc,
					"is_owner": is_owner and not is_recipient
				})

	if users_tasks:
		reply = f"<p>📋 <strong>Your Active Tasks ({len(users_tasks)})</strong></p>"
		for i, t_info in enumerate(users_tasks, 1):
			t = t_info["doc"]
			is_owner = t_info["is_owner"]
			created_by = t.owner or "System"
			creator_name = frappe.db.get_value("User", created_by, "full_name") or created_by
			url = frappe.utils.get_url_to_form("MM Task Reminder", t.name)
			
			role_badge = "[Owner]" if is_owner else "[Assignee]"
			
			reply += (
				f"<p><strong>{i}. {escape_html(t.title)}</strong> <strong>{role_badge}</strong><br>"
			)
			if is_owner:
				assignees = [frappe.db.get_value("User", row.user, "full_name") or row.user for row in t.reminder_recipients if row.user]
				reply += f"Assigned to: <em>{escape_html(', '.join(assignees) or 'None')}</em><br>"
			else:
				reply += f"Assigned by: <em>{escape_html(creator_name)}</em><br>"

			if t.description:
				reply += f"Details: <em>{escape_html(t.description)}</em><br>"
			
			# Format interval
			interval_min = t.get("reminder_interval_minutes") or (int(t.get("reminder_interval_hours") * 60) if t.get("reminder_interval_hours") else 60)
			if interval_min < 60:
				interval_str = f"{interval_min} min"
			elif interval_min % 60 == 0:
				hrs = interval_min // 60
				interval_str = f"{hrs} hr"
			else:
				hrs = interval_min / 60
				interval_str = f"{hrs:g} hr"
				
			reply += (
				f"Reminds every: <strong>{interval_str}</strong><br>"
				f'<a href="{url}">View Task Details</a></p>'
			)
	else:
		reply = "<p>🎉 <strong>You have no active or pending tasks at the moment!</strong></p>"

	delivery.send_html_dm(doc.owner, reply)


@frappe.whitelist()
def get_active_tasks_for_user():
	user = frappe.session.user
	# Get all active task reminders
	active_reminders = frappe.get_all(
		"MM Task Reminder",
		filters={"status": "Active"},
		fields=["name", "title", "description", "owner", "from_datetime", "to_datetime", "reminder_interval_minutes"]
	)

	from mahaveermetalic.mahaveer_metallic.task_reminder.scheduler import has_user_completed

	users_tasks = []
	for r in active_reminders:
		r_doc = frappe.get_doc("MM Task Reminder", r.name)
		is_recipient = any(row.user == user for row in r_doc.reminder_recipients if row.user)
		is_owner = (r_doc.owner == user)

		if is_recipient or is_owner:
			completed = False
			if is_recipient:
				completed = has_user_completed(r_doc, user)
			else:
				completed = all(has_user_completed(r_doc, row.user) for row in r_doc.reminder_recipients if row.user)

			if not completed:
				# Format full creator name
				created_by = r_doc.owner or "System"
				creator_name = frappe.db.get_value("User", created_by, "full_name") or created_by

				# List of assignee names
				assignees = []
				for row in r_doc.reminder_recipients:
					if row.user:
						fn = frappe.db.get_value("User", row.user, "full_name") or row.user
						assignees.append(fn)

				users_tasks.append({
					"name": r.name,
					"title": r.title,
					"description": r.description,
					"creator_name": creator_name,
					"assignees": assignees,
					"from_datetime": r.from_datetime,
					"to_datetime": r.to_datetime,
					"reminder_interval_minutes": r.reminder_interval_minutes,
					"status": r_doc.status,
					"role": "Owner" if is_owner and not is_recipient else "Assignee"
				})
	return users_tasks
