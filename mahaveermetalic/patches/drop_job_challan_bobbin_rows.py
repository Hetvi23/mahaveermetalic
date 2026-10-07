"""Clear the bobbin ledger rows a job challan posted — the same bobbins, counted twice.

A Job Out carries boxes to the worker and lists the bobbins inside them; the production
that packed those boxes had already consumed those very bobbins. Both posted, so
MMUJO-2026-00001 took 1,555 bobbins out and MMPROD-00001 took the same 1,555 out again
the next day. On mm that was 31,309 bobbins double-counted across 19 Job Outs, and every
party's balance that much too low.

api.bobbin.post_job_challan no longer posts, so nothing new arrives. This drops what the
old rule already wrote. Derived rows: re-saving the challan would rebuild them under the
current rule, which is to write nothing.
"""

import frappe


def execute():
	n = frappe.db.count("MM Bobbin Ledger Entry", {"voucher_type": ["in", ["Job Out", "Job In"]]})
	if not n:
		return
	frappe.db.sql(
		"delete from `tabMM Bobbin Ledger Entry` where voucher_type in ('Job Out', 'Job In')"
	)
	frappe.db.commit()
	print(f"bobbin ledger: dropped {n} double-counted job-challan rows")
