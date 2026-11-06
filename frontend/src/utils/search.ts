/**
 * ONE WAY TO SEARCH (Hetvi: "search filter is not working perfectly"). Most boxes matched
 * what was typed as one phrase: "sv anmol" found nothing when the party and the colour sat
 * in different columns, "121 anmol" nothing for ANMOL 121, "mm pink" nothing for M.M. PINK.
 * A row now matches when EVERY word typed appears somewhere in it, in any order — case,
 * spacing and punctuation aside.
 */

/** Letters and digits only: "M.M. PINK" and "mm pink" both read "mmpink". */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Does a row, given as the fields it can be found by, carry every word typed? */
export function matchesSearch(fields: unknown, query: string): boolean {
  const typed = words(query);
  if (!typed.length) return true;
  const hay = (Array.isArray(fields) ? fields : [fields])
    .filter((v) => v != null && v !== "")
    .map(String)
    .join(" ")
    .toLowerCase();
  const flat = squash(hay);
  return typed.every((w) => hay.includes(w) || (squash(w) !== "" && flat.includes(squash(w))));
}

/**
 * How close a name is to what was typed — 0 is the name itself, higher is looser. A list
 * kept in its own order put "ANMOL 10 BS" above "ANMOL 1 BS" for "anmol 1", and Enter
 * takes the top row.
 */
export function matchRank(label: string, query: string): number {
  const l = label.toLowerCase().replace(/\s+/g, " ").trim();
  const t = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (l === t || squash(l) === squash(t)) return 0;
  // Starts with it, ending on a whole word: "anmol 1" is ANMOL 1 BS, not ANMOL 10.
  if (l.startsWith(t) && !/[a-z0-9]/.test(l.charAt(t.length))) return 1;
  if (l.startsWith(t)) return 2;
  const tokens = l.split(/[^a-z0-9]+/).filter(Boolean);
  const typed = words(t).map(squash).filter(Boolean);
  if (squash(l).startsWith(squash(t)) || typed.every((w) => tokens.some((tk) => tk.startsWith(w)))) return 3;
  if (matchesSearch(label, query)) return 4;
  // Found only through its second line (the party under a company, the colour under an order).
  return 5;
}
