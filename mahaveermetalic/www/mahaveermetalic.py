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


# Both halves of the built bundle. The version was read off index.js ALONE, and the asset
# URLs are fixed names — /assets/.../index.css never changes. So a deploy that touched only
# the stylesheet left index.js untouched, git left its mtime alone, the version came back
# identical, and every browser and proxy went on serving the CSS it already had. A
# CSS-only release was invisible on the live site while being correct on disk.
_BUNDLE = ("index.js", "index.css")


def _asset_version() -> str:
	"""A version that changes whenever EITHER built file does.

	Newest mtime across the bundle, with each file's size folded in: a checkout that
	preserves timestamps can leave mtime alone while the contents differ, and size catches
	that far more cheaply than hashing 700 KB on every page load.
	"""
	import os

	stamps = []
	for name in _BUNDLE:
		try:
			path = frappe.get_app_path(
				"mahaveermetalic", "public", "mahaveermetalic", "assets", name
			)
			st = os.stat(path)
			stamps.append(f"{int(st.st_mtime)}-{st.st_size}")
		except Exception:
			continue
	return ".".join(stamps) if stamps else frappe.utils.get_build_version()


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
