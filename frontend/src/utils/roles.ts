/**
 * Who is signed in, and what that lets them change.
 *
 * The roles come off the Frappe boot payload that main.tsx puts on `window.frappe`, so
 * this is a read of what the server already said — never a decision. Every rule these
 * helpers gate is ALSO enforced on the server: hiding a control is a courtesy to the
 * operator, not a permission, and a screen is not a place to keep anybody honest.
 */

function roles(): string[] {
  return (
    (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot
      ?.user?.roles ?? []
  );
}

/** True for the people who may override what the shop has configured. */
export function isAdmin(): boolean {
  const r = roles();
  return r.includes("Administrator") || r.includes("System Manager") || r.includes("MM Admin");
}

export function hasRole(role: string): boolean {
  return roles().includes(role);
}
