/**
 * The challan books and the prefix each one numbers under — display only. The series that
 * actually names a document is resolved server-side from the same keys (api.challan.SERIES).
 */
export type ChallanSeries = { value: string; label: string; series: string };

export const JOB_IN_SERIES: ChallanSeries = { value: "Job In", label: "Job In", series: "MMUJI-" };

/** The dispatch books, as the Sales Challan Voucher offers them. */
export const DISPATCH_SERIES: ChallanSeries[] = [
  { value: "Sales", label: "Sales Chalan", series: "MMUSC-" },
  { value: "Job Challan", label: "Job Challan", series: "MMUJC-" },
  { value: "Challan", label: "Challan", series: "MMUCH-" },
  { value: "Delivery Challan", label: "Delivery Challan", series: "MMUDC-" },
  { value: "Roll Challan", label: "Roll Challan", series: "MMURC-" },
];

/** Indian financial year of an ISO date, as the ID writes it: 2026-09-14 → "26/27". */
export function financialYear(iso?: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso || "");
  const d = m ? { y: Number(m[1]), mo: Number(m[2]) } : { y: new Date().getFullYear(), mo: new Date().getMonth() + 1 };
  const start = d.mo >= 4 ? d.y : d.y - 1;
  return `${String(start).slice(2)}/${String(start + 1).slice(2)}`;
}

/** The ID a typed challan number is saved under: ("MMUJI-", "123", date) → MMUJI-123-26/27. */
export function challanIdFor(series: string, typed: string, iso?: string): string {
  return `${series.replace(/-$/, "")}-${typed.trim()}-${financialYear(iso)}`;
}
