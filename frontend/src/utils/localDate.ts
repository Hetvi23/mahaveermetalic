/**
 * Dates as the SHOP sees them, not as UTC sees them.
 *
 * Every screen in this app computed "today" the same way:
 *
 *     new Date().toISOString().slice(0, 10)
 *
 * `toISOString` converts to UTC first. India is UTC+5:30, so from midnight until 5:30 in
 * the morning that expression returns YESTERDAY. An order keyed at 01:37 on the 30th was
 * dated the 29th, and nothing on screen said so — the operator saw a filled-in date and
 * had no reason to doubt it.
 *
 * This shop runs a NIGHT SHIFT. The Program board is built around it: a working day starts
 * with the night and runs into the next calendar day. So the broken window is not an edge
 * case here — it is when half the work happens, every single night.
 *
 * These helpers read the local calendar directly, which is the one the operator and the
 * clock on the wall agree on.
 */

/** Local calendar date as YYYY-MM-DD. */
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A local date shifted by whole DAYS.
 *
 * Adding 86_400_000 milliseconds is not the same thing and was the other half of the bug:
 * it is arithmetic on an instant, so it lands an hour out across a DST change and, once
 * pushed through toISOString, drifts a whole day. Moving the date field moves it by a day
 * whatever the clocks do.
 */
export function shiftDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** Yesterday, a month back, a quarter back — the report ranges, in local days. */
export const tomorrowISO = () => shiftDays(1);
export const daysAgoISO = (n: number) => shiftDays(-n);
export const monthsAgoISO = (n: number) => shiftDays(-30 * n);

/**
 * A date as the shop WRITES it: DD-MM-YY.
 *
 * Every screen rendered the stored value straight out of the record, which is ISO
 * (`2026-09-12`) because that is what Frappe stores and what `<input type="date">`
 * requires. Nobody on this floor reads a date year-first, and on paper going out to a
 * customer it is simply the wrong format.
 *
 * DISPLAY ONLY. The value in a date input, and every date that goes back to the server,
 * stays ISO — the input would refuse anything else and the API would store a date that
 * sorts and compares wrongly. This is the one place the two notations are allowed to
 * differ, so the conversion lives here rather than being spelled out at each site.
 *
 * Anything unparseable comes back untouched: a half-typed value is better shown as it
 * was typed than blanked or turned into a wrong date.
 */
export function fmtDate(value?: string | null): string {
  if (!value) return "";
  // The date part only — a datetime ("2026-09-12 14:03:22") carries a time we don't want.
  const iso = String(value).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return String(value);
  return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
}

/** The same thing with the time kept, for logs and ledgers: DD-MM-YY HH:MM. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return "";
  const s = String(value).trim();
  const date = fmtDate(s);
  const t = /[ T](\d{2}):(\d{2})/.exec(s);
  return t ? `${date} ${t[1]}:${t[2]}` : date;
}
