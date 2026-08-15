# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import frappe


@frappe.whitelist()
def search_party_with_company(txt: str = "", limit: int = 20):
	"""Search parties by party name or child company name."""
	limit = int(limit or 20)
	txt = (txt or "").strip()
	like = f"%{txt}%"

	# One row per party. The join used to emit a row per COMPANY with no ordering on the
	# child rows, so a party with several companies appeared several times and whichever
	# company the join happened to return first became the one on screen.
	sql = """
		SELECT DISTINCT p.name AS party, p.party_name, p.modified
		FROM `tabMM Party Master` p
		LEFT JOIN `tabMM Party Company` c ON c.parent = p.name
		WHERE (%(txt)s = '' OR p.party_name LIKE %(like)s OR c.company_name LIKE %(like)s)
		ORDER BY p.modified DESC
		LIMIT %(limit)s
	"""
	rows = frappe.db.sql(sql, {"txt": txt, "like": like, "limit": limit}, as_dict=True)
	if not rows:
		return []

	# The company shown beneath the name is the FIRST one filed under the party — the
	# order they were entered in the master, which is the one the office treats as
	# primary. Ordered by idx, so it is that row and not whichever the database returned.
	# Raw SQL for the same reason as companies_for_party: a child-table get_all is refused
	# for restricted roles, and this keeps the row order the master's own.
	first = {}
	for c in frappe.db.sql(
		"""
		select parent, company_name from `tabMM Party Company`
		where parent in %(parents)s and parenttype = 'MM Party Master'
			and ifnull(company_name, '') != ''
		order by parent asc, idx asc
		""",
		{"parents": tuple([r.party for r in rows])},
		as_dict=True,
	):
		first.setdefault(c.parent, c.company_name)

	for r in rows:
		r["company_name"] = first.get(r.party)
		r.pop("modified", None)
	return rows


@frappe.whitelist()
def companies_for_party(party: str = ""):
	"""The company names filed under a party, in the order they were entered.

	Raw SQL on purpose. get_all on a child table is refused for roles without blanket
	permissions (the list came back empty and the order form's Company silently never
	filled), and this way the `idx` ordering is the table's own row order with nothing in
	between that could reorder it. The FIRST row is what the order form auto-selects.
	"""
	if not party:
		return []
	return [
		r[0]
		for r in frappe.db.sql(
			"""
			select company_name from `tabMM Party Company`
			where parent = %s and parenttype = 'MM Party Master'
				and ifnull(company_name, '') != ''
			order by idx asc
			""",
			(party,),
		)
	]


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


@frappe.whitelist()
def all_companies(txt: str = "", limit: int = 500):
	"""Every company with the party it belongs to.

	Screens that must be filled in company-wise (inward, job work) need to find a company
	by its own name OR by the party it sits under — operators know some sites by the party
	and some by the company.
	"""
	rows = frappe.get_all(
		"MM Party Company",
		filters={"parenttype": "MM Party Master"},
		fields=["company_name", "parent as party"],
		order_by="company_name asc",
		limit_page_length=frappe.utils.cint(limit),
	)
	names = {r.party for r in rows if r.party}
	party_names = {
		p.name: (p.party_name or p.name)
		for p in frappe.get_all("MM Party Master", filters={"name": ["in", list(names)]} if names else {},
			fields=["name", "party_name"])
	}
	out = [
		{"company_name": r.company_name, "party": r.party, "party_name": party_names.get(r.party, r.party)}
		for r in rows
		if r.company_name
	]

	# A customer with no company row would simply be missing from every company picker —
	# and since Inward's Company is mandatory, that customer could not be used at all.
	# Fall back to the customer themselves so the list always covers every customer.
	covered = {o["party"] for o in out}
	for p in frappe.get_all("MM Party Master", fields=["name", "party_name"]):
		if p.name in covered:
			continue
		out.append({
			"company_name": p.party_name or p.name,
			"party": p.name,
			"party_name": p.party_name or p.name,
		})
	out.sort(key=lambda o: (o["company_name"] or "").lower())
	txt = (txt or "").strip().lower()
	if txt:
		out = [o for o in out if txt in o["company_name"].lower() or txt in (o["party_name"] or "").lower()]
	return out
