import frappe
import random
import string

def create_test_inward():
	# Connect to the DB (if not already connected by bench execute)
	if not frappe.local.flags.in_test:
		frappe.db.begin()

	# Create a random unique lot number and challan number
	rand_id = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
	lot_number = f"TEST-LOT-{rand_id}"
	challan_number = f"CH-{rand_id}"

	print(f"Creating testing MM Inward entry with Lot: {lot_number}, Challan: {challan_number}...")

	# Construct the document
	inward_doc = frappe.get_doc({
		"doctype": "MM Inward",
		"location": "DEMO Plant",
		"posting_date": frappe.utils.today(),
		"party": "DEMO Jari (Show)",
		"challan_number": challan_number,
		"lot_number": lot_number,
		"items": [
			{
				"job_work": 0,
				"challan_number": challan_number,
				"customer_order": "MM2",
				"item_type": "Cut",
				"roll_name": "TEST ROLL A",
				"color_name": "TEST COLOR RED",
				"cut": "50/85",
				"qty_box": 1.0,
				"weight": 100.0,
			},
			{
				"job_work": 0,
				"challan_number": challan_number,
				"customer_order": "MM2",
				"item_type": "Cut",
				"roll_name": "TEST ROLL B",
				"color_name": "TEST COLOR BLUE",
				"cut": "50/85",
				"qty_box": 2.0,
				"weight": 200.0,
			}
		]
	})

	# Insert the draft document
	inward_doc.insert()
	print(f"Draft Inward created successfully. Name: {inward_doc.name}")

	# Submit the document
	inward_doc.submit()
	print(f"Inward submitted successfully. Doc Status: {inward_doc.docstatus}")

	# Commit changes to database
	frappe.db.commit()
	print("Database commit successful.")

	# Verify MM Roll Inventory was updated/created
	for item in inward_doc.items:
		roll = frappe.db.get_value(
			"MM Roll Inventory",
			{
				"location": inward_doc.location,
				"color_name": item.color_name,
				"lot_number": inward_doc.lot_number
			},
			["name", "stock_weight", "stock_box"],
			as_dict=True
		)
		if roll:
			print(f"Verified Roll Inventory: Name: {roll.name}, Weight: {roll.stock_weight} Kg, Box: {roll.stock_box}")
		else:
			print(f"WARNING: Roll inventory entry not found for color: {item.color_name}")

	return inward_doc.name

if __name__ == "__main__":
	import os
	import sys
	# Change working dir to frappe-bench
	os.chdir("/Users/hetvi/frappe-bench")
	sys.path.insert(0, ".")
	frappe.init(site="dev.localhost", sites_path="sites")
	frappe.connect()
	try:
		create_test_inward()
	finally:
		frappe.destroy()
