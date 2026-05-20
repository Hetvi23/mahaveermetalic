# Copyright (c) 2026, Mahaveer and contributors

import os
import logging
import frappe
from frappe.utils import get_datetime, now_datetime

from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery


def get_mahaveer_logger():
	logger = logging.getLogger("mahaveer_task_reminders")
	logger.setLevel(logging.INFO)
	if not logger.handlers:
		log_dir = "/home/frappe/frappe-bench/logs"
		log_file = os.path.join(log_dir, "mahaveer_task_reminders.log")
		try:
			if not os.path.exists(log_dir):
				os.makedirs(log_dir)
			handler = logging.FileHandler(log_file)
			handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
			logger.addHandler(handler)
		except Exception:
			pass
	return logger


def log_reminder_activity(message, level="Info", task_name=None):
	logger = get_mahaveer_logger()
	if level.lower() == "info":
		logger.info(message)
	elif level.lower() == "warn":
		logger.warn(message)
	elif level.lower() == "error":
		logger.error(message)

	# Also record in our new dedicated "MM Task Reminder Log" doctype
	try:
		frappe.get_doc({
			"doctype": "MM Task Reminder Log",
			"title": f"Scheduler Log - {task_name}" if task_name else "Scheduler Global Event",
			"level": level.capitalize(),
			"message": message,
			"timestamp": now_datetime(),
			"task": task_name
		}).insert(ignore_permissions=True)
	except Exception:
		pass


def run_reminder_checks():
	log_reminder_activity("Scheduler Triggered: starting reminder checks...", "info")

	tasks = frappe.get_all(
		"MM Task Reminder",
		filters={"status": "Active"},
		pluck="name",
		order_by="modified desc",
	)
	now = now_datetime()
	log_reminder_activity(f"Found {len(tasks)} active task reminder(s) in system.", "info")

	for name in tasks:
		doc = frappe.get_doc("MM Task Reminder", name)
		try:
			_process(doc, now)
		except Exception as e:
			log_reminder_activity(f"Error processing task reminder '{name}': {str(e)}", "error", task_name=name)
			frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Scheduler {name}")

	log_reminder_activity("Scheduler completed reminder checks.", "info")


def has_user_completed(doc, user_id):
	polls = [row.poll_id for row in doc.poll_links if row.for_user == user_id and row.poll_id]
	if not polls:
		return False

	votes = frappe.get_all(
		"Raven Poll Vote",
		filters={"poll_id": ["in", polls]},
		fields=["name"]
	)

	for v in votes:
		vote_doc = frappe.get_doc("Raven Poll Vote", v.name)
		
		# Safe check for old Raven (option field)
		opt_val = vote_doc.get("option")
		if opt_val and opt_val.strip().lower() == "yes":
			return True

		# Safe check for new Raven (vote_selection child table)
		if vote_doc.get("vote_selection"):
			for row in vote_doc.get("vote_selection"):
				opt_val_child = row.get("option")
				if opt_val_child:
					opt_text = frappe.db.get_value("Raven Poll Option", opt_val_child, "option") or opt_val_child
					if opt_text and opt_text.strip().lower() == "yes":
						return True
	return False


def _cleanup_old_polls(doc, user_id):
	polls = [row.poll_id for row in doc.poll_links if row.for_user == user_id and row.poll_id]
	if not polls:
		return
	msg_names = frappe.get_all("Raven Message", filters={"poll_id": ["in", polls]}, pluck="name")
	for msg_name in msg_names:
		try:
			frappe.delete_doc("Raven Message", msg_name, ignore_permissions=True, delete_permanently=True)
		except Exception:
			pass


def _process(doc, now):
	log_reminder_activity(f"Processing task '{doc.name}' ('{doc.title}')", "info", task_name=doc.name)

	if doc.status != "Active":
		log_reminder_activity(f"Task '{doc.name}' is not Active (current status: '{doc.status}'). Skipping.", "info", task_name=doc.name)
		return

	# Skip reminder notifications during quiet hours: 8 PM (20:00) to 8 AM (08:00)
	if now.hour >= 20 or now.hour < 8:
		log_reminder_activity(f"Skipping task '{doc.name}' ('{doc.title}') - Quiet hours active (8 PM to 8 AM). Current hour: {now.hour}", "info", task_name=doc.name)
		return

	start = get_datetime(doc.from_datetime)
	if now < start:
		log_reminder_activity(f"Skipping task '{doc.name}' - Start datetime '{doc.from_datetime}' is in the future. Current time: '{now}'", "info", task_name=doc.name)
		return

	end = get_datetime(doc.to_datetime) if doc.to_datetime else None
	if end and now > end:
		# The deadline has passed and the task is still Active (incomplete).
		# Identify all recipients who did not complete the task.
		log_reminder_activity(f"Task '{doc.name}' deadline passed ('{doc.to_datetime}'). checking for unfinished users...", "info", task_name=doc.name)
		unfinished_users = []
		for row in doc.reminder_recipients:
			if not row.user:
				continue
			if not has_user_completed(doc, row.user):
				unfinished_users.append(row.user)

		if unfinished_users:
			log_reminder_activity(f"Task '{doc.name}' ('{doc.title}') not completed by users: {unfinished_users}", "warn", task_name=doc.name)
			if doc.owner:
				try:
					from frappe.utils.data import escape_html
					user_names = []
					for u in unfinished_users:
						fn = frappe.db.get_value("User", u, "full_name") or u
						user_names.append(f"<strong>{escape_html(fn)}</strong> ({escape_html(u)})")

					msg = (
						f"<p><strong>⚠️ Task Reminder Deadline Passed</strong></p>"
						f"<p>The task <strong>\"{escape_html(doc.title)}\"</strong> reached its end time "
						f"({frappe.utils.format_datetime(doc.to_datetime)}) but was not completed by the following assignees:</p>"
						f"<ul>"
					)
					for name in user_names:
						msg += f"<li>{name}</li>"
					msg += f"</ul>"

					delivery = RavenTaskDelivery()
					log_reminder_activity(f"Notifying task owner '{doc.owner}' of unfinished assignees.", "info", task_name=doc.name)
					delivery.send_html_dm(doc.owner, msg)
				except Exception as e:
					log_reminder_activity(f"Failed to notify task owner '{doc.owner}' of unfinished assignees for task '{doc.name}': {str(e)}", "error", task_name=doc.name)
					frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Deadline Notification Failure {doc.name}")
		else:
			log_reminder_activity(f"All assignees completed task '{doc.name}' before deadline.", "info", task_name=doc.name)

		# Cancel the task to prevent further processing or reminders
		log_reminder_activity(f"Marking task '{doc.name}' as Cancelled since the deadline has passed.", "info", task_name=doc.name)
		doc.status = "Cancelled"
		doc.flags.ignore_permissions = True
		doc.save()
		return

	from mahaveermetalic.mahaveer_metallic.doctype.mm_task_reminder.mm_task_reminder import get_interval_minutes
	interval_minutes = get_interval_minutes(doc)
	if interval_minutes <= 0:
		log_reminder_activity(f"Task '{doc.name}' has invalid interval minutes ({interval_minutes}). Skipping.", "warn", task_name=doc.name)
		return

	base_time = doc.last_reminder_sent or doc.from_datetime
	next_at = frappe.utils.add_to_date(get_datetime(base_time), minutes=interval_minutes)
	if now < next_at:
		log_reminder_activity(f"Skipping task '{doc.name}' - next reminder scheduled at '{next_at}' (current time: '{now}')", "info", task_name=doc.name)
		return

	delivery = RavenTaskDelivery()
	sent_any = False
	for row in doc.reminder_recipients:
		if not row.user:
			continue
		if has_user_completed(doc, row.user):
			log_reminder_activity(f"Assignee '{row.user}' already completed task '{doc.name}'. Skipping reminder.", "info", task_name=doc.name)
			continue
		
		log_reminder_activity(f"Sending recurring reminder bundle to assignee '{row.user}' for task '{doc.name}'", "info", task_name=doc.name)
		_cleanup_old_polls(doc, row.user)
		delivery.send_reminder_bundle(doc, row.user)
		sent_any = True

	if sent_any:
		log_reminder_activity(f"Updating last reminder sent timestamp for task '{doc.name}' to '{now}'", "info", task_name=doc.name)
		doc.db_set("last_reminder_sent", now, update_modified=False)
