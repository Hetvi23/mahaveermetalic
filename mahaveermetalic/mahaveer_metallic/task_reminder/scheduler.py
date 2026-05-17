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


def run_reminder_checks():
	logger = get_mahaveer_logger()
	logger.info("Scheduler Triggered: starting reminder checks...")

	tasks = frappe.get_all(
		"MM Task Reminder",
		filters={"status": "Active"},
		pluck="name",
		order_by="modified desc",
	)
	now = now_datetime()
	logger.info(f"Found {len(tasks)} active task reminder(s) in system.")

	for name in tasks:
		doc = frappe.get_doc("MM Task Reminder", name)
		try:
			_process(doc, now)
		except Exception as e:
			logger.error(f"Error processing task reminder '{name}': {str(e)}")
			frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Scheduler {name}")

	logger.info("Scheduler completed reminder checks.")


def has_user_completed(doc, user_id):
	polls = [row.poll_id for row in doc.poll_links if row.for_user == user_id and row.poll_id]
	if not polls:
		return False

	votes = frappe.get_all(
		"Raven Poll Vote",
		filters={"poll_id": ["in", polls]},
		fields=["name", "option"]
	)

	for v in votes:
		if v.option and v.option.strip().lower() == "yes":
			return True

		vote_doc = frappe.get_doc("Raven Poll Vote", v.name)
		if vote_doc.get("vote_selection"):
			for row in vote_doc.get("vote_selection"):
				opt_val = row.get("option")
				if opt_val:
					opt_text = frappe.db.get_value("Raven Poll Option", opt_val, "option") or opt_val
					if opt_text and opt_text.strip().lower() == "yes":
						return True
	return False


def _process(doc, now):
	logger = get_mahaveer_logger()
	logger.info(f"Processing task '{doc.name}' ('{doc.title}')")

	if doc.status != "Active":
		logger.info(f"Task '{doc.name}' is not Active (current status: '{doc.status}'). Skipping.")
		return

	# Skip reminder notifications during quiet hours: 8 PM (20:00) to 8 AM (08:00)
	if now.hour >= 20 or now.hour < 8:
		logger.info(f"Skipping task '{doc.name}' ('{doc.title}') - Quiet hours active (8 PM to 8 AM). Current hour: {now.hour}")
		return

	start = get_datetime(doc.from_datetime)
	if now < start:
		logger.info(f"Skipping task '{doc.name}' - Start datetime '{doc.from_datetime}' is in the future. Current time: '{now}'")
		return

	end = get_datetime(doc.to_datetime) if doc.to_datetime else None
	if end and now > end:
		# The deadline has passed and the task is still Active (incomplete).
		# Identify all recipients who did not complete the task.
		logger.info(f"Task '{doc.name}' deadline passed ('{doc.to_datetime}'). checking for unfinished users...")
		unfinished_users = []
		for row in doc.reminder_recipients:
			if not row.user:
				continue
			if not has_user_completed(doc, row.user):
				unfinished_users.append(row.user)

		if unfinished_users:
			logger.warn(f"Task '{doc.name}' ('{doc.title}') not completed by users: {unfinished_users}")
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
					logger.info(f"Notifying task owner '{doc.owner}' of unfinished assignees.")
					delivery.send_html_dm(doc.owner, msg)
				except Exception as e:
					logger.error(f"Failed to notify task owner '{doc.owner}' of unfinished assignees for task '{doc.name}': {str(e)}")
					frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Deadline Notification Failure {doc.name}")
		else:
			logger.info(f"All assignees completed task '{doc.name}' before deadline.")

		# Cancel the task to prevent further processing or reminders
		logger.info(f"Marking task '{doc.name}' as Cancelled since the deadline has passed.")
		doc.status = "Cancelled"
		doc.flags.ignore_permissions = True
		doc.save()
		return

	interval_minutes = doc.reminder_interval_minutes or 60
	if interval_minutes <= 0:
		logger.warn(f"Task '{doc.name}' has invalid interval minutes ({interval_minutes}). Skipping.")
		return

	if doc.last_reminder_sent:
		next_at = frappe.utils.add_to_date(get_datetime(doc.last_reminder_sent), minutes=interval_minutes)
		if now < next_at:
			logger.info(f"Skipping task '{doc.name}' - next reminder scheduled at '{next_at}' (current time: '{now}')")
			return

	delivery = RavenTaskDelivery()
	sent_any = False
	for row in doc.reminder_recipients:
		if not row.user:
			continue
		if has_user_completed(doc, row.user):
			logger.info(f"Assignee '{row.user}' already completed task '{doc.name}'. Skipping reminder.")
			continue
		
		logger.info(f"Sending recurring reminder bundle to assignee '{row.user}' for task '{doc.name}'")
		delivery.send_reminder_bundle(doc, row.user)
		sent_any = True

	if sent_any:
		logger.info(f"Updating last reminder sent timestamp for task '{doc.name}' to '{now}'")
		doc.db_set("last_reminder_sent", now, update_modified=False)
