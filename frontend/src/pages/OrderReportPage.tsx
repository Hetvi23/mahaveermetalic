import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { Download, Printer, ScrollText } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.order_report";
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Rate = { lo: number; hi: number; same: boolean } | null;
type Row = {
  order: string; date?: string; delivery_date?: string;
  party?: string; company?: string; items?: string; cuts?: string;
  purchase_rate: Rate; sale_rate: Rate;
  ordered_weight: number; inwarded_weight: number; required_weight: number;
  purchase_status?: string; purchase_count: number; supplier?: string; has_po?: boolean;
  status: string;
};
type Report = { rows: Row[]; totals: { orders: number; ordered: number; inwarded: number; required: number } };

// The Sales column's own values — the report filters on it.
const STATUSES = ["Pending Approval", "Pending", "Completed", "Rejected"];

/** One rate, or the spread when an order's lines disagree. A rate never entered is a
 *  gap, not a zero — 0 would read as "bought for nothing". */
const rate = (r: Rate) => (!r ? "" : r.same ? r.lo.toLocaleString() : `${r.lo.toLocaleString()}–${r.hi.toLocaleString()}`);

const statusCls = (s: string) =>
  s === "Completed" ? "mm-pill-ok"
  : s === "Rejected" ? "mm-pill-muted"
  : s === "Pending" ? "mm-pill-muted"
  : "mm-pill-pending";

const purchaseCls = (s?: string) =>
  s === "Completed" ? "mm-pill-ok" : s === "Partial" ? "mm-pill-pending" : "mm-pill-warn";

/**
 * Order register — one row per order, the same columns the order list shows, plus what a
 * list cannot give: a date range, filters, totals and something printable.
 */
export default function OrderReportPage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [party, setParty] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ from: monthAgo(), to: today(), party: "", status: "" });

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });

  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.orders_report`,
    {
      from_date: applied.from || undefined,
      to_date: applied.to || undefined,
      party: applied.party || undefined,
      status: applied.status || undefined,
    },
    `order-report-${applied.from}-${applied.to}-${applied.party}-${applied.status}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;

  /** CSV of exactly what is on screen, so a printed copy and an exported one agree. */
  function exportCsv() {
    const head = ["Order", "Date", "Party", "Company", "Items", "P.Rate", "S.Rate",
      "Weight (Kg)", "Inwards (Kg)", "Required (Kg)", "Purchase", "Sales"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = rows.map((r) => [
      r.order, r.date ?? "", r.party ?? "", r.company ?? "", r.items ?? "",
      rate(r.purchase_rate), rate(r.sale_rate),
      r.ordered_weight, r.inwarded_weight, r.required_weight,
      r.purchase_status ?? "", r.status,
    ].map(esc).join(","));
    const csv = [head.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${applied.from}-to-${applied.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title"><ScrollText size={18} /> Report — Orders</h1>
          <p className="mm-page-sub">One row per order. Purchase = bought and received against it; Sales = gone out on a challan.</p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters">
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Party</span>
            <SearchSelect value={party} placeholder="All parties"
              options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))}
              onChange={setParty} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Status</span>
            <SearchSelect value={status} placeholder="All statuses"
              options={STATUSES.map((s) => ({ value: s, label: s }))} onChange={setStatus} />
          </label>
          <button className="mm-btn-primary" onClick={() => setApplied({ from, to, party, status })}>Filter</button>
          <button className="mm-btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          <button className="mm-btn-secondary" disabled={rows.length === 0} onClick={exportCsv}>
            <Download size={15} /> CSV
          </button>
        </div>
      </section>

      <section className="mm-card mm-card-pad">
        <div className="mm-orep-head">
          <h2 className="mm-panel-title">Orders {applied.from} — {applied.to}</h2>
          {totals && (
            <div className="mm-orep-totals">
              <span><b>{totals.orders}</b> orders</span>
              <span><b>{kg(totals.ordered)}</b> kg ordered</span>
              <span><b>{kg(totals.inwarded)}</b> kg in</span>
              <span className={totals.required > 0 ? "mm-var-over" : undefined}><b>{kg(totals.required)}</b> kg required</span>
            </div>
          )}
        </div>

        <div className="mm-table-scroll">
          <table className="mm-table mm-table-dense mm-orep-table">
            <thead>
              <tr>
                <th>Order</th><th>Date</th><th>Customer</th><th>Items</th>
                <th className="mm-num">P.Rate / S.Rate</th>
                <th className="mm-num">Weight (Kg)</th>
                <th className="mm-num">Inwards (Kg)</th>
                <th className="mm-num">Required (Kg)</th>
                <th>Purchase</th><th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="mm-muted">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={10} className="mm-empty">No orders in this period.</td></tr>
              )}
              {rows.map((r) => {
                const p = rate(r.purchase_rate);
                const s = rate(r.sale_rate);
                return (
                  <tr key={r.order}>
                    <td className="mm-ow-cell-order">{r.order}</td>
                    <td className="mm-ow-cell-date">{r.date || "—"}</td>
                    <td>
                      <span className="mm-colour-name">{r.party || "—"}</span>
                      {r.company && <span className="mm-suggest-meta">{r.company}</span>}
                    </td>
                    <td>{r.items || "—"}{r.cuts ? <span className="mm-suggest-meta">{r.cuts}</span> : null}</td>
                    <td className="mm-num mm-ow-rates">
                      <span className={p ? undefined : "mm-muted"}>{p || "·"}</span>
                      <span className="mm-ow-rate-sep"> / </span>
                      <span className={s ? undefined : "mm-muted"}>{s || "·"}</span>
                    </td>
                    <td className="mm-num">{kg(r.ordered_weight)}</td>
                    <td className="mm-num">{kg(r.inwarded_weight)}</td>
                    <td className={`mm-num ${r.required_weight > 0 ? "mm-var-over" : ""}`}>{kg(r.required_weight)}</td>
                    <td>
                      <span className={`mm-pill ${purchaseCls(r.purchase_status)}`}
                        title={`${kg(r.inwarded_weight)} of ${kg(r.ordered_weight)} kg received${r.has_po ? (r.supplier ? ` · ${r.supplier}` : "") : " · no purchase order raised"}`}>
                        {r.purchase_status}
                      </span>
                    </td>
                    <td><span className={`mm-pill ${statusCls(r.status)}`}>{r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && totals && (
              <tfoot>
                <tr>
                  <td colSpan={5}><strong>{totals.orders} orders</strong></td>
                  <td className="mm-num"><strong>{kg(totals.ordered)}</strong></td>
                  <td className="mm-num"><strong>{kg(totals.inwarded)}</strong></td>
                  <td className="mm-num"><strong>{kg(totals.required)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
