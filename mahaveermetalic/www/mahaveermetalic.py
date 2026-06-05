# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

import json
import re

import frappe
import frappe.sessions

no_cache = 1

SCRIPT_TAG_PATTERN = re.compile(r"\<script[^<]*\</script\>")
CLOSING_SCRIPT_TAG_PATTERN = re.compile(r"</script\>")


def get_context(context):
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()

	context.boot = get_boot()
	context.csrf_token = csrf_token
	context.build_version = frappe.utils.get_build_version()
	context.asset_version = _asset_version()

	return context


def _asset_version() -> str:
	"""Mtime of the built SPA bundle, used to cache-bust the asset URLs so a new
	`yarn build` is picked up without a manual hard refresh."""
	import os

	try:
		path = frappe.get_app_path(
			"mahaveermetalic", "public", "mahaveermetalic", "assets", "index.js"
		)
		return str(int(os.path.getmtime(path)))
	except Exception:
		return frappe.utils.get_build_version()


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	if not frappe.conf.developer_mode:
		frappe.throw("This method is only meant for developer mode")
	return json.loads(get_boot())


def get_boot():
	try:
		boot = frappe.sessions.get()
	except Exception as e:
		raise frappe.SessionBootFailed from e

	boot_json = frappe.as_json(boot, indent=None, separators=(",", ":"))
	boot_json = SCRIPT_TAG_PATTERN.sub("", boot_json)
	boot_json = CLOSING_SCRIPT_TAG_PATTERN.sub("", boot_json)
	return json.dumps(boot_json)
