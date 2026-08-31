# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""The supplier catalogue.

Same rule as the colour catalogue, for the same reason: MM Vendor Master autonames
`field:vendor_name`, so the record's id is the name that was typed, and the purchase
orders, inward rows and stock that were raised against this vendor all point at that id.

A vendor with material on the road or stock on the floor cannot be renamed. The
alternative is a purchase order raised on one supplier and a delivery received from a
name that no longer exists — with nothing on any screen saying they were ever the same.
"""

import frappe
from frappe import _
from frappe.model.document import Document

from mahaveermetalic.mahaveer_metallic.doctype.mm_item_master.mm_item_master import where_used

#: Where a vendor's name is written down. All four are Link fields, but they are listed
#: explicitly rather than left to the framework's link check so this reads the same way as
#: the colour rule next door and says WHICH record is in the way.
VENDOR_USES = (
	("MM Purchase Order", "supplier"),
	("MM Inward Item", "supplier"),
	("MM Roll Inventory", "supplier"),
	("MM Sales Order Item", "purchase_party"),
)


class MMVendorMaster(Document):
	def validate(self):
		if self.is_new():
			return
		if self.has_value_changed("vendor_name") and (self.vendor_name or "") != self.name:
			used = where_used(self.name, VENDOR_USES)
			if used:
				frappe.throw(
					_(
						"{0} is already used on {1} ({2} record(s)), so its name cannot be changed — "
						"those records keep the old name and nothing would connect them again. "
						"Create a new vendor instead."
					).format(self.name, used[0], used[1])
				)

	def on_trash(self):
		used = where_used(self.name, VENDOR_USES)
		if used:
			frappe.throw(
				_("{0} is used on {1} ({2} record(s)) and cannot be deleted.").format(
					self.name, used[0], used[1]
				)
			)
