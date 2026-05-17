import frappe

def run():
	if not frappe.db.exists("DocType", "MM Task Reminder Log"):
		doc = frappe.get_doc({
			"doctype": "DocType",
			"name": "MM Task Reminder Log",
			"module": "Mahaveer Metallic",
			"custom": 1,
			"autoname": "hash",
			"track_changes": 0,
			"track_views": 0,
			"fields": [
				{
					"fieldname": "title",
					"fieldtype": "Data",
					"label": "Title",
					"in_list_view": 1,
					"reqd": 1
				},
				{
					"fieldname": "level",
					"fieldtype": "Select",
					"label": "Log Level",
					"options": "Info\nWarn\nError",
					"default": "Info",
					"in_list_view": 1,
					"reqd": 1
				},
				{
					"fieldname": "task",
					"fieldtype": "Link",
					"label": "Related Task",
					"options": "MM Task Reminder",
					"in_list_view": 1,
					"in_standard_filter": 1
				},
				{
					"fieldname": "timestamp",
					"fieldtype": "Datetime",
					"label": "Timestamp",
					"in_list_view": 1,
					"in_standard_filter": 1,
					"reqd": 1
				},
				{
					"fieldname": "message",
					"fieldtype": "Text",
					"label": "Message Detail"
				}
			],
			"permissions": [
				{
					"role": "System Manager",
					"read": 1,
					"write": 1,
					"create": 1,
					"delete": 1
				},
				{
					"role": "MM Admin",
					"read": 1
				}
			]
		})
		doc.insert(ignore_permissions=True)
		print("Created MM Task Reminder Log DocType successfully!")
	else:
		print("MM Task Reminder Log DocType already exists.")

if __name__ == "__main__":
	frappe.connect("mahaveermetalic.local")
	run()
	frappe.db.commit()
