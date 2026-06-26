# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Inward posting helpers."""

import json

import frappe


@frappe.whitelist()
def post_inward(payload):
	"""Create and submit an MM Inward in one transaction.

	Doing the insert and submit server-side (on a single in-memory document) avoids
	the timestamp-mismatch race the two-call client flow hits — where the doc is
	inserted in one request and submitted in a second, and its `modified` shifts in
	between ("Document has been modified after you have opened it").
	"""
	data = json.loads(payload) if isinstance(payload, str) else payload
	data["doctype"] = "MM Inward"
	doc = frappe.get_doc(data)
	doc.insert()
	doc.submit()
	return {"name": doc.name}
