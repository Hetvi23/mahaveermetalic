# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""How one production voucher's boxes divide across the runs they came off.

A pile is one colour and one lot, and the floor boxes it as one thing — one voucher, one
challan, because that is what physically left. Underneath, that lot is often several
programs: different rolls, different machines, each with its own remaining weight. This
row is the join: which run this part of the voucher came off, and how much of it.

Without it the weight could only be hung on a single `source_program`, so boxing a pile
either overstated one run and left the others showing material that was already in a
carton, or had to be split into a voucher per run — which is how one dispatch came to
carry three challan numbers.
"""

from frappe.model.document import Document


class MMProductionProgram(Document):
	pass
