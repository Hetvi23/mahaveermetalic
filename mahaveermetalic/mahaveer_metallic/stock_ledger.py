# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Stock ledger posting.

One helper, `post_movement`, writes a single `MM Stock Ledger Entry` for a stock
movement. It is called from the exact points that mutate `MM Roll Inventory` — Inward
(IN) and Cutting (OUT) — and is handed the *post-movement* balance straight off the
inventory row, so the ledger and the live balance can never drift apart.

The ledger is append-only: a cancellation is recorded as its own reversing entry
(swapped in/out) rather than by deleting the original, keeping a full audit trail.
"""

import frappe


def post_movement(
	*,
	voucher_type,
	voucher_no,
	location,
	color_name,
	lot_number=None,
	branch=None,
	roll_no=None,
	item_type=None,
	in_weight=0.0,
	out_weight=0.0,
	in_box=0.0,
	out_box=0.0,
	balance_weight=0.0,
	balance_box=0.0,
	customer_order=None,
	challan_number=None,
	remarks=None,
):
	"""Insert one MM Stock Ledger Entry. Returns the created doc name.

	`balance_weight`/`balance_box` are the inventory balance for this key *after* the
	movement (read from the MM Roll Inventory row by the caller).
	"""
	entry = frappe.get_doc(
		{
			"doctype": "MM Stock Ledger Entry",
			"posting_date": frappe.utils.today(),
			"posting_datetime": frappe.utils.now_datetime(),
			"voucher_type": voucher_type,
			"voucher_no": voucher_no,
			"branch": branch,
			"location": location,
			"lot_number": lot_number,
			"color_name": color_name,
			"roll_no": roll_no,
			"item_type": item_type,
			"in_weight": round(float(in_weight or 0), 3),
			"out_weight": round(float(out_weight or 0), 3),
			"in_box": round(float(in_box or 0), 3),
			"out_box": round(float(out_box or 0), 3),
			"balance_weight": round(float(balance_weight or 0), 3),
			"balance_box": round(float(balance_box or 0), 3),
			"customer_order": customer_order,
			"challan_number": challan_number,
			"remarks": remarks,
		}
	)
	entry.insert(ignore_permissions=True)
	return entry.name
