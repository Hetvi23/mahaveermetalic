import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Download, Printer, ScrollText, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.inward_report";
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = {
  row_id: string;
  inward: string;
  chalan_date?: string;
  challan_no?: string;
  customer_order?: string;
  item?: string;
  roll_name?: string;
  cut?: string;
  qty_box?: number;
  weight?: number;
  job_work?: number;
  company_name?: string;
  party?: string;
  lot_number?: string;
  location?: string;
  receipt_status?: string;
  docstatus?: number;
};
type Report = {
  rows: Row[];
  totals: { rolls: number; qty: number; weight: number; shown: number };
  items: string[];
  companies: string[];
};

function isAdmin(): boolean {
  const roles =
    (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot?.user?.roles ?? [];
  return roles.includes("Administrator") || roles.includes("MM Admin");
}

/**
 * Inward register — one row per roll received, newest entered first.
 *
 * Roll-wise, not inward-wise: the floor looks this up to answer "did that roll come in,
 * on which challan, at what weight", which a per-inward summary can't tell them. Sorted
 * by when the line was keyed in, so the last thing entered is always the first thing on
 * screen. Cancelled inwards stay listed, struck through and out of the totals.
 */
export default function InwardReportPage() {
  const [challan, setChallan] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [company, setCompany] = useState("");
  const [item, setItem] = useState("");
  const [limit, setLimit] = useState(500);
  const [applied, setApplied] = useState({ challan: "", from: "", to: "", company: "", item: "" });

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Report }>(
    `${API}.rolls_report`,
    {
      challan: applied.challan || undefined,
      from_date: applied.from || undefined,
      to_date: applied.to || undefined,
      company: applied.company || undefined,
      item: applied.item || undefined,
      limit,
    },
    `inward-report-${applied.challan}-${applied.from}-${applied.to}-${applied.company}-${applied.item}-${limit}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;
  const itemOptions = data?.message?.items ?? [];
  const companyOptions = data?.message?.companies ?? [];
  const maybeMore = rows.length >= limit;

  const { call: cancelInwardCall, loading: cancelling } = useFrappePostCall(
    "mahaveermetalic.mahaveer_metallic.api.inward.cancel_inward",
  );
  const { call: setStatusCall } = useFrappePostCall<{ message: { receipt_status: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.set_inward_status",
  );

  /** Cancelling reverses the whole inward's rolls out of inventory, not just this line —
   *  which is why the action sits on the first row of each inward, labelled with it. */
  async function onCancel(inward: string) {
    if (!window.confirm(`Cancel inward ${inward}? Every roll on it is reversed out of inventory.`)) return;
    try {
      await cancelInwardCall({ inward });
      await mutate();
      toast(`Inward ${inward} cancelled`, "info");
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  async function onToggleStatus(inward: string, current?: string) {
    const next = current === "Partial" ? "Complete" : "Partial";
    if (!window.confirm(
      `Mark inward ${inward} as ${next}?\n\n` +
      (next === "Complete"
        ? "The challan will be treated as fully received — no further inward can be posted against it."
        : "The challan reopens, so more can still be received against it.") +
      "\n\nStock already posted is not changed.",
    )) return;
    try {
      await setStatusCall({ inward, status: next });
      await mutate();
      toast(`${inward} marked ${next}`);
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  /** CSV of exactly what is on screen, so a printed copy and an exported one agree. */
  function exportCsv() {
    const head = ["Chalan No", "Chalan Date", "Order", "Item", "Roll", "Size", "Qty", "Weight (Kg)", "JobWork", "Company", "Lot", "Inward", "Status"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = rows.map((r) => [
      r.challan_no ?? "", r.chalan_date ?? "", r.customer_order ?? "", r.item ?? "", r.roll_name ?? "",
      r.cut ?? "", r.qty_box ?? 0, r.weight ?? 0, r.job_work ? "Yes" : "", r.company_name ?? "",
      r.lot_number ?? "", r.inward, r.docstatus === 2 ? "Cancelled" : r.receipt_status ?? "",
    ].map(esc).join(","));
    const csv = [head.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "inward-rolls.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const admin = isAdmin();
  const cols = admin ? 8 : 7;

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title"><ScrollText size={18} /> Report — Inwards</h1>
          <p className="mm-page-sub">One row per roll received, newest entered first.</p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters">
          <label className="mm-field">
            <span className="mm-field-label">Chalan No</span>
            <input className="mm-input" value={challan} placeholder="Ch.No" onChange={(e) => setChallan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setApplied({ challan, from, to, company, item }); }} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Company</span>
            <SearchSelect value={company} placeholder="All companies"
              options={companyOptions.map((c) => ({ value: c, label: c }))} onChange={setCompany} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Item</span>
            <SearchSelect value={item} placeholder="All items"
              options={itemOptions.map((c) => ({ value: c, label: c }))} onChange={setItem} />
          </label>
          <button className="mm-btn-primary" onClick={() => setApplied({ challan, from, to, company, item })}>Filter</button>
          <button className="mm-btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          <button className="mm-btn-secondary" disabled={rows.length === 0} onClick={exportCsv}>
            <Download size={15} /> CSV
          </button>
        </div>
      </section>

      <section className="mm-card mm-card-pad">
        <div className="mm-orep-head">
          <h2 className="mm-panel-title">Rolls received</h2>
          {totals && (
            <div className="mm-orep-totals">
              <span><b>{totals.rolls}</b> rolls</span>
              <span><b>{totals.qty.toLocaleString()}</b> qty</span>
              <span><b>{kg(totals.weight)}</b> kg</span>
            </div>
          )}
        </div>

        <div className="mm-table-scroll">
          <table className="mm-table mm-table-dense mm-orep-table">
            <thead>
              <tr>
                <th>Chalan No</th>
                <th>Chalan Date</th>
                <th>Order</th>
                <th>Item</th>
                <th>Roll</th>
                <th className="mm-num">Qty</th>
                <th className="mm-num">Weight (Kg)</th>
                {admin && <th className="mm-no-print">Inward</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={cols} className="mm-muted">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={cols} className="mm-empty">No rolls inwarded yet.</td></tr>
              )}
              {rows.map((r, i) => {
                const cancelled = r.docstatus === 2;
                // Rows of one inward sit together (creation order), so its name and the
                // actions that act on the WHOLE inward are shown once, on its first row.
                const firstOfInward = i === 0 || rows[i - 1].inward !== r.inward;
                return (
                  <tr key={r.row_id} className={cancelled ? "mm-row-cancelled" : undefined}>
                    <td>{r.challan_no || "—"}</td>
                    <td className="mm-ow-cell-date">{r.chalan_date || "—"}</td>
                    <td>
                      {r.customer_order
                        ? <span className="mm-ow-cell-order">{r.customer_order}</span>
                        : <span className="mm-muted">—</span>}
                    </td>
                    <td>
                      <span className="mm-colour-name">{r.item || "—"}</span>
                      {r.job_work ? <span className="mm-irep-jw" title="Job work — the customer's own material">JW</span> : null}
                      {r.cut ? <span className="mm-suggest-meta">{r.cut}</span> : null}
                    </td>
                    {/* Lot rides under the roll rather than taking a column of its own —
                        they identify the same physical thing, and the register has to fit. */}
                    <td>
                      {r.roll_name || <span className="mm-muted">—</span>}
                      {r.lot_number ? <span className="mm-suggest-meta">{r.lot_number}</span> : null}
                    </td>
                    <td className="mm-num">{(r.qty_box ?? 0).toLocaleString()}</td>
                    <td className="mm-num">{kg(r.weight)}</td>
                    {admin && (
                      <td className="mm-no-print">
                        {firstOfInward && (
                          // Compact on purpose: the register is read first and acted on
                          // rarely, so the document number is trimmed to its serial (full
                          // name on hover) and Cancel is an icon, to keep the action in
                          // view instead of pushed off the end of a wide table.
                          <div className="mm-irep-acts" title={r.inward}>
                            <span className="mm-muted">{r.inward.split("-").pop()}</span>
                            {cancelled ? (
                              <span className="mm-state-chip mm-state-open">Cancelled</span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={`mm-state-chip mm-state-clickable ${r.receipt_status === "Partial" ? "mm-state-inventory" : "mm-state-cut"}`}
                                  title={`${r.inward} — click to mark ${r.receipt_status === "Partial" ? "Complete" : "Partial"}`}
                                  onClick={() => void onToggleStatus(r.inward, r.receipt_status)}
                                >
                                  {r.receipt_status === "Partial" ? "Partial" : "Complete"}
                                </button>
                                <button
                                  type="button"
                                  className="mm-icon-btn"
                                  disabled={cancelling}
                                  aria-label={`Cancel inward ${r.inward}`}
                                  title={`Cancel ${r.inward} — every roll on it is reversed out of inventory`}
                                  onClick={() => void onCancel(r.inward)}
                                >
                                  <X size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {maybeMore && (
          <button type="button" className="mm-mini mm-no-print" style={{ marginTop: "0.6rem" }}
            onClick={() => setLimit((n) => n + 500)}>
            Show more
          </button>
        )}
      </section>
    </div>
  );
}
