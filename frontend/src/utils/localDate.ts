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
