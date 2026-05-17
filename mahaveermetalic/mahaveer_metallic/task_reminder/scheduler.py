# Copyright (c) 2026, Mahaveer and contributors

import frappe
from frappe.utils import get_datetime, now_datetime

from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery


def run_reminder_checks():
	tasks = frappe.get_all(
		"MM Task Reminder",
		filters={"status": "Active"},
		pluck="name",
		order_by="modified desc",
	)
	now = now_datetime()

	for name in tasks:
		doc = frappe.get_doc("MM Task Reminder", name)
		try:
			_process(doc, now)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Scheduler {name}")


def _process(doc, now):
	if doc.status != "Active":
		return

	start = get_datetime(doc.from_datetime)
	if now < start:
		return

	end = get_datetime(doc.to_datetime) if doc.to_datetime else None
	if end and now > end:
		return

	interval_minutes = doc.reminder_interval_minutes or 60
	if interval_minutes <= 0:
		return

	if doc.last_reminder_sent:
		next_at = frappe.utils.add_to_date(get_datetime(doc.last_reminder_sent), minutes=interval_minutes)
		if now < next_at:
			return

	delivery = RavenTaskDelivery()
	for row in doc.reminder_recipients:
		if not row.user:
			continue
		delivery.send_reminder_bundle(doc, row.user)

	doc.db_set("last_reminder_sent", now, update_modified=False)
