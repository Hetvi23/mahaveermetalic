# Copyright (c) 2026, Mahaveer and contributors

import frappe
from frappe.utils.data import escape_html


def raven_integration_available() -> bool:
	return bool(frappe.db.exists("DocType", "Raven Bot"))


class RavenTaskDelivery:
	def __init__(self):
		self.bot_name = self._resolved_bot()

	def _resolved_bot(self) -> str | None:
		settings = frappe.get_single("MM Raven Task Notification Settings")
		name = (settings.default_raven_bot or "").strip()
		if name and frappe.db.exists("Raven Bot", name):
			return name
		return None

	def get_bot_doc(self):
		if not self.bot_name:
			return None
		return frappe.get_doc("Raven Bot", self.bot_name)

	def send_html_dm(self, user_id: str, html_body: str) -> str | None:
		if not raven_integration_available() or not self.bot_name:
			return None
		from raven.utils import get_raven_user

		if not get_raven_user(user_id):
			return None

		bot = self.get_bot_doc()
		return bot.send_direct_message(user_id, text=html_body, markdown=False)

	def send_reminder_bundle(self, reminder, user_id: str) -> tuple[str | None, str | None]:
		message_id = None
		poll_id = None

		url = frappe.utils.get_url_to_form("MM Task Reminder", reminder.name)
		interval_min = reminder.reminder_interval_minutes or 60
		# Format interval for display
		if interval_min < 60:
			interval_str = f"{interval_min} min"
		elif interval_min % 60 == 0:
			hrs = interval_min // 60
			interval_str = f"{hrs} hr"
		else:
			hrs = interval_min / 60
			interval_str = f"{hrs:g} hr"

		window_end = (
			frappe.utils.format_datetime(reminder.to_datetime)
			if reminder.to_datetime
			else "until you mark Complete (or vote Yes)"
		)

		user_polls = [row for row in reminder.poll_links if row.for_user == user_id]
		reminder_count = len(user_polls) + 1

		intro_html = f"<p><strong>Reminder {reminder_count}</strong>: {escape_html(reminder.title)}</p>"
		if reminder.description:
			intro_html += f"<p>{escape_html(reminder.description)}</p>"
		intro_html += (
			f"<p>Repeats every <strong>{interval_str}</strong>. "
			f"Runs until <em>{window_end}</em>.</p>"
			f'<p><a href="{url}">Open reminder</a></p>'
		)

		message_id = self.send_html_dm(user_id, intro_html)

		if getattr(reminder, "include_yes_no_poll", 0):
			try:
				poll_id = self._send_completion_poll(reminder.name, reminder.title, user_id, reminder.to_datetime, reminder_count)
			except Exception:
				frappe.log_error(frappe.get_traceback(), "MM Task Reminder Raven Poll")

		return message_id, poll_id

	def _send_completion_poll(self, reminder_name: str, title: str, user_id: str, poll_end_dt, reminder_count: int) -> str | None:
		if not self.bot_name:
			return None
		from raven.utils import get_raven_user

		if not get_raven_user(user_id):
			return None

		bot = self.get_bot_doc()
		channel_id = bot.create_direct_message_channel(user_id)

		poll = frappe.get_doc(
			{
				"doctype": "Raven Poll",
				"question": f'Have you completed (Reminder {reminder_count}): "{title}"?',
				"options": [{"option": "Yes"}, {"option": "No"}],
				"end_date": poll_end_dt,
			}
		).insert(ignore_permissions=True)

		msg = frappe.get_doc(
			{
				"doctype": "Raven Message",
				"channel_id": channel_id,
				"message_type": "Poll",
				"poll_id": poll.name,
				"text": poll.question,
				"content": poll.question,
				"is_bot_message": 1,
				"bot": bot.name,
			}
		)
		msg.flags.ignore_permissions = True
		msg.insert(ignore_permissions=True)
		parent_doc = frappe.get_doc("MM Task Reminder", reminder_name)
		parent_doc.append(
			"poll_links",
			{"for_user": user_id, "poll_id": poll.name},
		)
		parent_doc.save(ignore_permissions=True)

		return poll.name
