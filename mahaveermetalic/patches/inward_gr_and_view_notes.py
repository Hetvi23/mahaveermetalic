# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Land the goods-return fields and the Program View notes box.

MM Inward gains `is_gr` / `gr_against` / `gr_returned` / `gr_reason`: a receipt is no longer
cancelled from the register, it is RETURNED — the receipt stays submitted and marked, and the
return posts its own negative rows. MM Settings gains `program_view_notes`, the floor's shared
scratchpad on Program View.

`bench migrate` can skip re-syncing an already-installed doctype, so force the reload rather
than trust the timestamp — a missing column here means the register's GR button 500s.
"""

import frappe


def execute():
	for name in ("mm_inward", "mm_settings"):
		try:
			frappe.reload_doc("mahaveer_metallic", "doctype", name, force=True)
		except Exception:
			frappe.log_error(title=f"reload {name} failed")
