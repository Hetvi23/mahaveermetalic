# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Staff, and what each of them may do.

The Staff record already named a Login User but said nothing about permissions, so there
was no way to grant anyone anything without opening the Frappe desk — which is exactly the
place these operators are not meant to go. The Role field closes that: it is the shop's
own answer to "what is this person allowed to do", and saving the record grants it.

Only the MM roles are managed here. Anything else on the user — System Manager, or roles
another app gave them — is left exactly as it was found: this screen speaks for the shop
floor, not for the whole site.
"""

import frappe
from frappe import _
from frappe.model.document import Document

#: The roles this screen owns. Kept in step with install.py's MM_ROLES.
MM_ROLES = (
	"MM Admin",
	"MM Operations",
	"MM Production",
	"MM Inventory Manager",
	"MM Sales Team",
	"MM Accounts",
	"MM Supplier",
)


class MMEmployeeMaster(Document):
	def validate(self):
		if self.role and self.role not in MM_ROLES:
			frappe.throw(_("{0} is not a Mahaveer role.").format(self.role))
		if self.role and not self.user:
			frappe.throw(_("Pick the Login User this role belongs to."))

	def on_update(self):
		self._sync_user_role()

	def _sync_user_role(self):
		"""Make the login user's MM role match this record. One role, not a pile.

		Administrator is skipped: it holds every role by definition, and rewriting its role
		table from a staff form is a good way to lock everyone out of a live site.
		"""
		if not self.user or self.user in ("Administrator", "Guest"):
			return
		if not frappe.db.exists("User", self.user):
			return

		user = frappe.get_doc("User", self.user)
		current = {r.role for r in (user.roles or [])}
		# Everything that is not ours stays untouched; ours becomes exactly what was picked.
		wanted = {r for r in current if r not in MM_ROLES} | ({self.role} if self.role else set())
		if wanted == current:
			return
		user.set("roles", [])
		for role in sorted(wanted):
			# A role that has not been created on this site yet would fail the whole save,
			# and losing the staff record over a missing role helps nobody.
			if frappe.db.exists("Role", role):
				user.append("roles", {"role": role})
		user.save(ignore_permissions=True)
