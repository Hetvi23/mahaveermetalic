import frappe

def run():
	reminders = frappe.get_all("MM Task Reminder", fields=["name", "title", "status", "owner"])
	print("REMINDERS:")
	for r in reminders:
		doc = frappe.get_doc("MM Task Reminder", r.name)
		recipients = [row.user for row in doc.reminder_recipients]
		print(f"  Name: {doc.name} - Title: {doc.title} - Status: {doc.status} - Owner: {doc.owner} - Recipients: {recipients}")
