# Copyright (c) 2026, Mahaveer and contributors
# License: MIT
"""Create the MM Supplier role on existing installs (after_install only runs once)."""

from mahaveermetalic.install import create_roles


def execute():
	create_roles()
