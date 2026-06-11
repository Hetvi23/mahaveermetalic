# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Veermetlon (VM) integration — Inward is driven by a VM Delivery Challan.

VM lives on a separate server in production, so we talk to it over its REST API
(base URL + token credentials in `MM Veermetlon Settings`). Entering a challan no
on the Inward screen pulls the rolls/colour/qty from VM and surfaces the open MM
Sales Orders (across customers) whose colour matches, for allocation.
"""

import json

import frappe
import requests
from frappe import _


def _settings():
	s = frappe.get_single("MM Veermetlon Settings")
	if not s.enabled:
		frappe.throw(_("Veermetlon integration is disabled in MM Veermetlon Settings."))
	if not s.base_url:
		frappe.throw(_("Set the Veermetlon Base URL in MM Veermetlon Settings."))
	return s


def _vm_get(path: str, params=None):
	s = _settings()
	base = s.base_url.rstrip("/")
	headers = {"Accept": "application/json"}
	secret = s.get_password("api_secret", raise_exception=False) if s.api_secret else None
	if s.api_key and secret:
		headers["Authorization"] = f"token {s.api_key}:{secret}"
	url = f"{base}{path}"
	try:
		resp = requests.get(url, headers=headers, params=params, timeout=20)
	except requests.RequestException as e:
		frappe.throw(_("Could not reach Veermetlon at {0}: {1}").format(base, str(e)))
	if resp.status_code >= 400:
		frappe.throw(_("Veermetlon API error ({0}): {1}").format(resp.status_code, resp.text[:300]))
	try:
		return resp.json()
	except ValueError:
		# Reachable, but the body isn't JSON — almost always the Base URL points at a
		# website / login / proxy page instead of the Veermetlon Frappe API.
		snippet = " ".join((resp.text or "").split())[:200] or "(empty response)"
		frappe.throw(
			_(
				"Veermetlon did not return JSON from {0} (HTTP {1}). "
				"Check the Base URL in MM Veermetlon Settings points to the Veermetlon "
				"Frappe site (include https://, no extra path) and that the API key/secret "
				"are set. The server returned: {2}"
			).format(url, resp.status_code, snippet)
		)


def _fetch_vm_challan(challan_no: str) -> dict:
	"""Resolve a VM Delivery Challan by its challan_no and return the full doc."""
	listing = _vm_get(
		"/api/resource/Delivery Challan",
		{
			"filters": json.dumps([["challan_no", "=", challan_no]]),
			"fields": json.dumps(["name"]),
			"limit_page_length": 1,
		},
	)
	rows = listing.get("data") or []
	if not rows:
		frappe.throw(_("Challan {0} not found in Veermetlon.").format(challan_no))
	name = rows[0]["name"]
	doc = _vm_get(f"/api/resource/Delivery Challan/{frappe.utils.quote(name)}").get("data") or {}
	return doc


def _has_local_delivery_challan() -> bool:
	"""True when Veermetlon's Delivery Challan doctype lives on THIS site, i.e. the
	veermetlon app is installed here — then we read it from the DB directly and skip
	the HTTP API, API keys and guest access entirely."""
	return bool(frappe.db.exists("DocType", "Delivery Challan"))


def _local_challan(challan_no: str) -> dict:
	name = frappe.db.get_value("Delivery Challan", {"challan_no": challan_no}, "name")
	if not name:
		frappe.throw(_("Challan {0} not found.").format(challan_no))
	return frappe.get_doc("Delivery Challan", name).as_dict()


def _matching_orders(colors):
	"""Open MM Sales Orders (any customer) whose line colour matches the challan."""
	colors = [c for c in {(c or "").strip() for c in colors} if c]
	if not colors:
		return []
	placeholders = ", ".join(["%s"] * len(colors))
	return frappe.db.sql(
		f"""
		select so.name as sales_order, so.party, so.delivery_date,
			soi.color_name, soi.cut, soi.qty_weight,
			so.required_weight
		from `tabMM Sales Order` so
		join `tabMM Sales Order Item` soi on soi.parent = so.name
		where so.docstatus < 2
			and ifnull(so.production_completed_percent, 0) < 100
			and soi.color_name in ({placeholders})
		order by so.delivery_date asc, so.modified desc
		limit 50
		""",
		tuple(colors),
		as_dict=True,
	)


def _normalize_items(doc: dict):
	out = []
	for it in doc.get("items") or []:
		out.append(
			{
				"roll": it.get("roll_no"),
				"color": it.get("film"),  # colour = the Film link value (per spec)
				"cut": it.get("size"),
				"qty": it.get("no_of_roll_bobbin") or 0,
				"weight": it.get("net_wt") or 0,
			}
		)
	return out


@frappe.whitelist()
def fetch_challan(challan_no: str):
	"""Pull a VM challan + its rolls, and the open MM SOs its colours can fulfil."""
	challan_no = (challan_no or "").strip()
	if not challan_no:
		frappe.throw(_("Enter a challan number."))
	# Same-site Veermetlon → read from the DB; otherwise use the remote HTTP API.
	doc = _local_challan(challan_no) if _has_local_delivery_challan() else _fetch_vm_challan(challan_no)
	items = _normalize_items(doc)
	matching = _matching_orders([i["color"] for i in items])
	return {
		"challan_no": doc.get("challan_no") or challan_no,
		"party_name": doc.get("party_name"),
		"party_address": doc.get("party_address"),
		"dated": doc.get("dated"),
		"items": items,
		"matching_orders": matching,
	}


@frappe.whitelist()
def test_connection():
	"""Quick health-check used from the settings screen."""
	if _has_local_delivery_challan():
		return {"ok": True, "mode": "local", "delivery_challans": frappe.db.count("Delivery Challan")}
	data = _vm_get("/api/method/frappe.ping")
	return {"ok": True, "mode": "remote", "response": data}
