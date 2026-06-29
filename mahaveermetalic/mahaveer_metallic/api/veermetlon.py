# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Veermetlon (VM) integration — Inward is driven by a VM Delivery Challan.

VM lives on a separate server in production, so we talk to it over its REST API
(base URL + token credentials in `MM Veermetlon Settings`). Entering a challan no
on the Inward screen pulls the rolls/colour/qty from VM and surfaces the open MM
Sales Orders (across customers) whose colour matches, for allocation.
"""

import json
import re

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


def _matching_orders(coating):
	"""Open MM Sales Orders whose colour matches the challan's coating.

	VM challans don't carry the customer colour — only the coating (which is the
	colour/quality, e.g. "K BCH BSM"). So we filter open orders by the coating; the
	chosen SO is then the source of truth for the roll's colour on Inward.
	"""
	coating = (coating or "").strip()
	if not coating:
		return []
	# Coating often carries a trailing "(date)" — match on the colour part only.
	base = re.sub(r"\s*\([^)]*\)\s*$", "", coating).strip()
	if not base:
		return []
	like = f"%{base}%"
	return frappe.db.sql(
		"""
		select so.name as sales_order, so.party, so.delivery_date,
			soi.color_name, soi.cut, soi.qty_weight,
			so.required_weight
		from `tabMM Sales Order` so
		join `tabMM Sales Order Item` soi on soi.parent = so.name
		where so.docstatus < 2
			and ifnull(so.production_completed_percent, 0) < 100
			and (soi.color_name like %s or %s like concat('%%', soi.color_name, '%%'))
		order by so.delivery_date asc, so.modified desc
		limit 50
		""",
		(like, base),
		as_dict=True,
	)


def _distinct(values):
	seen, out = set(), []
	for v in values:
		v = (v or "").strip()
		if v and v not in seen:
			seen.add(v)
			out.append(v)
	return out


def _so_colours(sales_order: str, local: bool):
	"""Colour name(s) from the challan's linked VM Sales Order lines. VM challan rolls
	carry no customer colour, but the challan names its VM Sales Order, whose items
	hold the colour (`colour_name`). One colour → applied to every roll."""
	if not sales_order:
		return []
	if local:
		so = frappe.get_doc("VM Sales Order", sales_order)
		return _distinct([getattr(it, "colour_name", "") for it in (so.items or [])])
	data = _vm_get(f"/api/resource/VM Sales Order/{frappe.utils.quote(sales_order)}").get("data") or {}
	return _distinct([it.get("colour_name") for it in (data.get("items") or [])])


def _normalize_items(doc: dict, default_colour: str = ""):
	out = []
	for it in doc.get("items") or []:
		out.append(
			{
				"roll": it.get("roll_no"),
				# Colour comes from the challan's VM Sales Order (editable on Inward).
				"color": default_colour,
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
	local = _has_local_delivery_challan()
	doc = _local_challan(challan_no) if local else _fetch_vm_challan(challan_no)
	# Colour comes from the challan's VM Sales Order; one colour → pre-fill every roll.
	so_colours = _so_colours(doc.get("sales_order"), local)
	default_colour = so_colours[0] if len(so_colours) == 1 else ""
	# Fallback: VM challans without a single SO colour still carry the coating, which
	# IS the colour/quality (e.g. "K BCH BSM (22-12-2025)"). Strip the trailing date
	# and use it so rolls don't land blank and force manual colour entry on every row.
	if not default_colour:
		default_colour = re.sub(r"\s*\([^)]*\)\s*$", "", (doc.get("coating") or "")).strip()
	items = _normalize_items(doc, default_colour)
	matching = _matching_orders(doc.get("coating"))
	return {
		"challan_no": doc.get("challan_no") or challan_no,
		"coating": doc.get("coating"),  # lot id in MM = the coating selected on the VM challan
		"sales_order": doc.get("sales_order"),
		"so_colours": so_colours,
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
