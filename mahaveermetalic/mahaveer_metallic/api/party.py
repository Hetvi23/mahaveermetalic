# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe


@frappe.whitelist()
def search_party_with_company(txt: str = "", limit: int = 20):
	"""Search parties by party name or child company name."""
	limit = int(limit or 20)
	txt = (txt or "").strip()
	like = f"%{txt}%"

	sql = """
		SELECT p.name AS party, p.party_name, c.company_name
		FROM `tabMM Party Master` p
		LEFT JOIN `tabMM Party Company` c ON c.parent = p.name
		WHERE (%(txt)s = '' OR p.party_name LIKE %(like)s OR c.company_name LIKE %(like)s)
		ORDER BY p.modified DESC
		LIMIT %(limit)s
	"""
	rows = frappe.db.sql(sql, {"txt": txt, "like": like, "limit": limit}, as_dict=True)
	return rows
