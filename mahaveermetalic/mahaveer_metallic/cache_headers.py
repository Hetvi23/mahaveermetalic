# Copyright (c) 2026, Mahaveer and contributors
# License: MIT

"""Keep the SPA's HTML page out of browser caches.

The built bundle is referenced as `index.js?v=<asset_version>`, which busts correctly the
moment a deploy changes the file — but ONLY if the browser fetches a fresh HTML page to
read the new query string from. nginx serves the bundle with `max-age=31536000` (a year)
and the page itself with no `Cache-Control` at all, so a browser is free to reuse the page
heuristically, keep its old `?v=`, and go on serving a year-old bundle from disk. The
result on the floor is a deploy that is correct on both servers and invisible on the
screen, reported as "I need the latest code" when the latest code is already there.

Frappe's `no_cache = 1` on a www page governs its own server-side page cache, not the
response header, so the header has to be set here. One `after_request` hook, guarded to
this app's own routes, costs nothing on every other request.
"""

import frappe

_NO_STORE = "no-store, no-cache, must-revalidate, max-age=0"


def no_store_spa_page(response=None, request=None, **kwargs):
	"""Mark the SPA page itself uncacheable. The bundle keeps its long max-age — it is
	content-addressed by `?v=` and a fresh page is all that is needed to pick up a new one."""
	if response is None or request is None:
		return
	try:
		path = (request.path or "").strip("/")
	except Exception:
		return
	if path != "mahaveermetalic" and not path.startswith("mahaveermetalic/"):
		return
	# A route under /mahaveermetalic/ that is NOT the page (an asset, say) keeps its own
	# caching; only the HTML document is at stake here.
	if "text/html" not in (response.headers.get("Content-Type") or ""):
		return
	response.headers["Cache-Control"] = _NO_STORE
	response.headers["Pragma"] = "no-cache"
	response.headers["Expires"] = "0"
