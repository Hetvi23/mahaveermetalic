# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_datetime, now_datetime
from frappe.utils.data import escape_html


class MMTaskReminder(Document):
	def validate(self):
		if self.to_datetime and self.from_datetime:
			if get_datetime(self.to_datetime) < get_datetime(self.from_datetime):
				frappe.throw(_("Remind-until datetime must be on or after the start datetime."))

		if self.reminder_recipients:
			seen = set()
			for row in self.reminder_recipients:
				if row.user in seen:
					frappe.throw(_("Duplicate user in recurring reminder list."))
				seen.add(row.user)

		if self.completion_recipients:
			seen_c = set()
			for row in self.completion_recipients:
				if row.user in seen_c:
					frappe.throw(_("Duplicate user in completion notification list."))
				seen_c.add(row.user)

	def before_save(self):
		if (
			not self.is_new()
			and self.status == "Active"
			and self.has_value_changed("status")
			and not self.reminder_recipients
		):
			frappe.throw(_("Add at least one user under Recurring reminders before activating."))

	def on_update(self):
		prev = self.get_doc_before_save()
		prev_status = prev.status if prev else None

		self._enforce_close_edit_rules()

		if prev_status not in ("Completed", "Cancelled") and self.status == "Completed":
			frappe.enqueue(
				"mahaveermetalic.mahaveer_metallic.doctype.mm_task_reminder.mm_task_reminder._send_completion_messages",
				queue="short",
				job_name=f"mm-task-reminder-complete-{self.name}",
				reminder_name=self.name,
			)

	def after_insert(self):
		"""Send immediate assignment notification to all recipients."""
		if self.status == "Active" and self.reminder_recipients:
			frappe.enqueue(
				"mahaveermetalic.mahaveer_metallic.doctype.mm_task_reminder.mm_task_reminder._send_assignment_notification",
				queue="short",
				job_name=f"mm-task-reminder-assign-{self.name}",
				reminder_name=self.name,
			)

	def mark_completed_via_raven(self, completed_by_user: str):
		self.status = "Completed"
		self.completed_on = now_datetime()
		self.completed_by = completed_by_user
		self.flags.ignore_permissions = True
		self.save()

	def _enforce_close_edit_rules(self):
		prev = self.get_doc_before_save()
		if not prev:
			return

		if prev.status == "Cancelled" and self.status != "Cancelled":
			frappe.throw(_("Cancelled task reminders cannot be reopened."))

		if prev.status == "Completed" and self.status != "Completed":
			frappe.throw(_("Completed task reminders cannot be reopened."))


def _send_completion_messages(reminder_name: str | None = None):
	if not reminder_name:
		return

	from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery

	doc = frappe.get_doc("MM Task Reminder", reminder_name)
	recipients = [r.user for r in doc.completion_recipients if r.user]
	if not recipients:
		return
	completed_by = doc.completed_by or ""
	title = (frappe.get_value("User", completed_by, "full_name") or completed_by) if completed_by else "Unknown"

	msg = (
		f"<p><strong>Task reminder completed</strong></p>"
		f"<p>{escape_html(doc.title)}</p>"
		f"<p>Marked complete by <em>{escape_html(title)}</em></p>"
	)
	delivery = RavenTaskDelivery()
	for user_id in recipients:
		delivery.send_html_dm(user_id, msg)


def _send_assignment_notification(reminder_name: str | None = None):
	"""Send an immediate 'you have been assigned' DM when a task reminder is created."""
	if not reminder_name:
		return

	from mahaveermetalic.mahaveer_metallic.task_reminder.raven_send import RavenTaskDelivery

	doc = frappe.get_doc("MM Task Reminder", reminder_name)
	recipients = [r.user for r in doc.reminder_recipients if r.user]
	if not recipients:
		return

	created_by = doc.owner or ""
	creator_name = (frappe.get_value("User", created_by, "full_name") or created_by) if created_by else "System"

	interval_h = doc.reminder_interval_hours or 1
	start_time = frappe.utils.format_datetime(doc.from_datetime) if doc.from_datetime else "now"
	end_info = (
		f"until {frappe.utils.format_datetime(doc.to_datetime)}"
		if doc.to_datetime
		else "until completed"
	)

	url = frappe.utils.get_url_to_form("MM Task Reminder", doc.name)

	msg = (
		f"<p><strong>📋 New Task Assigned to You</strong></p>"
		f"<p><strong>{escape_html(doc.title)}</strong></p>"
	)
	if doc.description:
		msg += f"<p>{escape_html(doc.description)}</p>"
	msg += (
		f"<p>Assigned by <em>{escape_html(creator_name)}</em></p>"
		f"<p>Reminders start at <strong>{start_time}</strong>, "
		f"repeating every <strong>{interval_h:g} hour(s)</strong> {end_info}.</p>"
		f"<p>You will receive a completion poll with each reminder — "
		f"vote <strong>Yes</strong> to mark it done.</p>"
		f'<p><a href="{url}">View task details</a></p>'
	)

	delivery = RavenTaskDelivery()
	for user_id in recipients:
		try:
			delivery.send_html_dm(user_id, msg)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"MM Task Reminder Assignment DM {reminder_name}")

