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


@frappe.whitelist()
def companies_for_party(party: str = ""):
	"""The company names filed under a party (its MM Party Company rows) — for the
	'first pick party, then its company' selector on the order."""
	if not party:
		return []
	return frappe.get_all(
		"MM Party Company",
		filters={"parent": party, "parenttype": "MM Party Master"},
		fields=["company_name"],
		order_by="idx asc",
		pluck="company_name",
	)


@frappe.whitelist()
def party_flags(party: str = "", company: str = ""):
	"""Flags the shop-floor screens need about a party — currently whether their work is
	job work, so Production can tick "Is Job Work?" the moment the party is chosen.

	Accepts a company too, since Production selects the company and derives the party.
	"""
	if company and not party:
		party = frappe.db.get_value(
			"MM Party Company", {"company_name": company, "parenttype": "MM Party Master"}, "parent"
		)
	if not party:
		return {"party": None, "is_job_work": 0}
	return {
		"party": party,
		"is_job_work": frappe.utils.cint(frappe.db.get_value("MM Party Master", party, "is_job_work")),
	}
