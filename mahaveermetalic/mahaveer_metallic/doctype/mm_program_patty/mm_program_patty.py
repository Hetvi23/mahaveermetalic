# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Which patti a program took, and from which cutting.

A cut can yield more patti than the program that ordered it planned for — cut 6 against a
4-batch program and 2 patti are left over, available to any other program. Tracking the
take per cutting is what makes that possible: the cutting's `consumed_patti` says how much
of it is gone, and these rows say who took it, so reverting a program can hand exactly its
own patti back.
"""

from frappe.model.document import Document


class MMProgramPatty(Document):
	pass
