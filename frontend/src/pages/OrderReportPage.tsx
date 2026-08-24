import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { Eye, ScrollText, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { Filter, ReportFilters } from "@/components/ReportFilters";

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
  /** What has physically left on challans, and what of the order still has to. The status
   *  is read off these two, so they travel with it. */
  dispatched_weight: number; pending_weight: number;
  status: string;
};
type Report = {
  rows: Row[];
  totals: { orders: number; ordered: number; inwarded: number; required: number; dispatched: number; pending: number };
};

/* ── The drill-down behind one row ─────────────────────────────────────────────
   An order is not one receipt and one delivery: material arrives over several
   inwards, is wound over several productions, and goes out over several challans.
   The register can only carry the totals, so these are the rows behind them. */
type LogLine = { date?: string | null; weight?: number; qty_box?: number };
type InwardLine = LogLine & { doc: string; challan_number?: string; lot_number?: string; color_name?: string; is_gr?: boolean };
type ProdLine = { name: string; date?: string | null; machine_no?: string; batch_no?: string; shade?: string; cut?: string; box_qty?: number; net_weight?: number };
type SaleLine = LogLine & { doc: string; challan_no?: string; color_name?: string; cut?: string };
type Summary = {
  order: string; date?: string | null; delivery_date?: string | null;
  party_name?: string; company?: string; approval: string; status: string; completion_mode?: string | null;
  items: { color_name?: string; cut?: string; qty_weight?: number; qty_box?: number; sale_rate?: number }[];
  inwards: InwardLine[]; productions: ProdLine[]; sales: SaleLine[];
  totals: {
    ordered: number; inwarded: number; produced: number; dispatched: number;
    remaining: number; in_hand: number; tolerance_percent: number; complete_at: number;
  };
};

/* The order's status has exactly two values, and both are read off what has GONE OUT:
   Complete once challans covering the ordered weight have been raised, Incomplete while
   any of it is still to go — 800 kg dispatched against a 1,200 kg order is Incomplete.
   Approval (pending / accepted / rejected) is a different question and lives on the order
   list; this register carries APPROVED orders only, so it never has to ask it. */
const STATUSES = ["Complete", "Incomplete"];

/** One rate, or the spread when an order's lines disagree. A rate never entered is a
 *  gap, not a zero — 0 would read as "bought for nothing". */
const rate = (r: Rate) => (!r ? "" : r.same ? r.lo.toLocaleString() : `${r.lo.toLocaleString()}–${r.hi.toLocaleString()}`);

const statusCls = (s: string) => (s === "Complete" ? "mm-pill-ok" : "mm-pill-pending");

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
  const [company, setCompany] = useState("");
  const [item, setItem] = useState("");
  const [order, setOrder] = useState("");
  const [applied, setApplied] = useState({
    from: monthAgo(), to: today(), party: "", status: "", company: "", item: "", order: "",
  });
  /** The order whose drill-down is open. */
  const [viewing, setViewing] = useState<string | null>(null);

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const items = useFrappeGetDocList<{ name: string }>("MM Item Master", { fields: ["name"], limit: 0 });
  const companies = useFrappeGetCall<{ message: { company_name: string }[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.all_companies", undefined, "mm-all-companies",
  );

  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.orders_report`,
    {
      from_date: applied.from || undefined,
      to_date: applied.to || undefined,
      party: applied.party || undefined,
      status: applied.status || undefined,
      company: applied.company || undefined,
      item: applied.item || undefined,
      order: applied.order.trim() || undefined,
    },
    `order-report-${applied.from}-${applied.to}-${applied.party}-${applied.status}-${applied.company}-${applied.item}-${applied.order}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;

  /** CSV of exactly what is on screen, so a printed copy and an exported one agree. */
  function exportCsv() {
    const head = ["Order", "Date", "Party", "Company", "Items", "P.Rate", "S.Rate",
      "Weight (Kg)", "Inwards (Kg)", "Required (Kg)", "Dispatched (Kg)", "Pending (Kg)",
      "Purchase", "Status"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = rows.map((r) => [
      r.order, r.date ?? "", r.party ?? "", r.company ?? "", r.items ?? "",
      rate(r.purchase_rate), rate(r.sale_rate),
      r.ordered_weight, r.inwarded_weight, r.required_weight,
      r.dispatched_weight, r.pending_weight,
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
          <p className="mm-page-sub">
            Approved orders only. Status is <strong>Complete</strong> once challans covering the
            whole ordered weight have gone out — anything still owed is <strong>Incomplete</strong>.
          </p>
        </div>
      </header>

      <ReportFilters
        onApply={() => setApplied({ from, to, party, status, company, item, order })}
        onReset={() => {
          setFrom(monthAgo()); setTo(today()); setParty(""); setStatus(""); setCompany(""); setItem(""); setOrder("");
          setApplied({ from: monthAgo(), to: today(), party: "", status: "", company: "", item: "", order: "" });
        }}
        onPrint={() => window.print()}
        onExport={exportCsv}
        exportDisabled={rows.length === 0}
        note={<>Approved orders only — a pending, rejected or cancelled order is not owed to anybody.</>}
      >
        <Filter label="From"><input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Filter>
        <Filter label="To"><input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Filter>
        <Filter label="Party">
          <SearchSelect value={party} placeholder="All parties"
            options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))}
            onChange={setParty} />
        </Filter>
        <Filter label="Company">
          <SearchSelect value={company} placeholder="All companies"
            options={(companies.data?.message ?? []).map((c) => ({ value: c.company_name, label: c.company_name }))}
            onChange={setCompany} />
        </Filter>
        <Filter label="Item / Color">
          <SearchSelect value={item} placeholder="All items"
            options={(items.data ?? []).map((i) => ({ value: i.name, label: i.name }))} onChange={setItem} />
        </Filter>
        <Filter label="Status">
          <SearchSelect value={status} placeholder="All statuses"
            options={STATUSES.map((x) => ({ value: x, label: x }))} onChange={setStatus} />
        </Filter>
        <Filter label="Order no">
          <input className="mm-input" value={order} placeholder="e.g. 37"
            onChange={(e) => setOrder(e.target.value)} />
        </Filter>
      </ReportFilters>

      <section className="mm-card mm-card-pad">
        <div className="mm-orep-head">
          <h2 className="mm-panel-title">Orders {applied.from} — {applied.to}</h2>
          {totals && (
            <div className="mm-orep-totals">
              <span><b>{totals.orders}</b> orders</span>
              <span><b>{kg(totals.ordered)}</b> kg ordered</span>
              <span><b>{kg(totals.inwarded)}</b> kg in</span>
              <span><b>{kg(totals.dispatched)}</b> kg out</span>
              <span className={totals.pending > 0 ? "mm-var-over" : undefined}><b>{kg(totals.pending)}</b> kg pending</span>
              <span className={totals.required > 0 ? "mm-var-over" : undefined}><b>{kg(totals.required)}</b> kg required</span>
            </div>
          )}
        </div>

        <div className="mm-table-scroll">
          <table className="mm-table mm-table-dense mm-orep-table mm-table-sticky">
            <thead>
              <tr>
                <th>Order</th><th>Date</th><th>Customer</th><th>Items</th>
                <th className="mm-num">P.Rate / S.Rate</th>
                <th className="mm-num">Weight (Kg)</th>
                <th className="mm-num">Inwards (Kg)</th>
                <th className="mm-num">Required (Kg)</th>
                {/* The two figures the status is read off — a status nobody can check is a
                    status nobody trusts. */}
                <th className="mm-num" title="Gone out on challans">Dispatched (Kg)</th>
                <th className="mm-num" title="Still to go out">Pending (Kg)</th>
                <th>Purchase</th><th>Status</th>
                <th className="mm-no-print" />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={13} className="mm-muted">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={13} className="mm-empty">No orders in this period.</td></tr>
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
                    <td className="mm-num">{kg(r.dispatched_weight)}</td>
                    <td className={`mm-num ${r.pending_weight > 0 ? "mm-var-over" : ""}`}>{kg(r.pending_weight)}</td>
                    <td>
                      {/* No purchase order raised and nothing received — there is no purchase
                          to have a state, so the cell stays empty rather than saying Pending. */}
                      {r.purchase_status ? (
                        <span className={`mm-pill ${purchaseCls(r.purchase_status)}`}
                          title={`${kg(r.inwarded_weight)} of ${kg(r.ordered_weight)} kg received${r.has_po ? (r.supplier ? ` · ${r.supplier}` : "") : " · no purchase order raised"}`}>
                          {r.purchase_status}
                        </span>
                      ) : (
                        <span className="mm-muted" title="No purchase order raised">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`mm-pill ${statusCls(r.status)}`}
                        title={`${kg(r.dispatched_weight)} of ${kg(r.ordered_weight)} kg dispatched${r.pending_weight > 0 ? ` · ${kg(r.pending_weight)} kg still to go` : ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="mm-num mm-no-print">
                      <button type="button" className="mm-mini" onClick={() => setViewing(r.order)}
                        title={`Every inward, production and challan against order ${r.order}`}
                        aria-label={`View the full log for order ${r.order}`}>
                        <Eye size={13} /> View
                      </button>
                    </td>
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
                  <td className="mm-num"><strong>{kg(totals.dispatched)}</strong></td>
                  <td className="mm-num"><strong>{kg(totals.pending)}</strong></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {viewing && <OrderSummaryModal order={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * One order, opened up: what came in, what was wound, what went out — each as a dated
 * log rather than a single total, because the totals are what the register already
 * shows and they are exactly what nobody could account for.
 */
function OrderSummaryModal({ order, onClose }: { order: string; onClose: () => void }) {
  const { data, isLoading, error } = useFrappeGetCall<{ message: Summary }>(
    `${API}.order_summary`, { order }, `order-summary-${order}`,
  );
  const d = data?.message;
  const t = d?.totals;

  /** One log column: its rows, its total, and nothing it cannot account for. */
  const Log = ({ title, count, children, foot }: {
    title: string; count: number; children: React.ReactNode; foot: React.ReactNode;
  }) => (
    <div className="mm-osum-log">
      <div className="mm-osum-log-head">
        <span>{title}</span>
        <span className="mm-pill mm-pill-muted">{count}</span>
      </div>
      {count === 0 ? <p className="mm-osum-none">Nothing yet.</p> : <div className="mm-osum-rows">{children}</div>}
      <div className="mm-osum-foot">{foot}</div>
    </div>
  );

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal mm-modal-wide mm-osum" onClick={(e) => e.stopPropagation()} role="dialog"
        aria-label={`Order ${order} summary`}>
        <div className="mm-modal-head">
          <span className="mm-modal-title">Order summary — {order}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {isLoading && <p className="mm-muted">Loading…</p>}
          {error && <p className="mm-error">Could not load this order.</p>}
          {d && t && (
            <>
              <div className="mm-osum-top">
                <div className="mm-osum-party">
                  <strong>{d.party_name || "—"}</strong>
                  {d.company ? <span className="mm-suggest-meta">{d.company}</span> : null}
                </div>
                <div className="mm-osum-badges">
                  <span className={`mm-pill ${d.status === "Complete" ? "mm-pill-ok" : "mm-pill-pending"}`}>{d.status}</span>
                  <span className="mm-pill mm-pill-muted">{d.approval}</span>
                </div>
              </div>

              <div className="mm-osum-bar">
                <span><strong>Order No: {d.order}</strong></span>
                <span>{d.date || "—"}</span>
              </div>

              {d.items.map((it, i) => (
                <div className="mm-osum-item" key={i}>
                  <span>{it.color_name || "—"}{it.cut ? ` · ${it.cut}` : ""}</span>
                  <span><strong>{kg(it.qty_weight)}</strong> kg</span>
                </div>
              ))}

              <div className="mm-osum-grid mm-osum-grid-2">
                <Log title="INWARDS" count={d.inwards.length}
                  foot={<><span>TOTAL</span><span><strong>{kg(t.inwarded)}</strong> kg</span></>}>
                  {d.inwards.map((r, i) => (
                    <div className={`mm-osum-row ${r.is_gr ? "mm-osum-row-gr" : ""}`} key={i}
                      title={`${r.doc}${r.challan_number ? ` · challan ${r.challan_number}` : ""}${r.lot_number ? ` · lot ${r.lot_number}` : ""}`}>
                      <span className="mm-osum-when">{r.date || "—"}{r.is_gr ? " · GR" : ""}</span>
                      <span className="mm-osum-what">{r.lot_number || r.color_name || ""}</span>
                      <span className="mm-osum-kg">{kg(r.weight)}kg</span>
                    </div>
                  ))}
                </Log>

                <Log title="SALES" count={d.sales.length}
                  foot={<>
                    <span>TOTAL{d.productions.length > 0 ? ` · from ${d.productions.length} production${d.productions.length === 1 ? "" : "s"}` : ""}</span>
                    <span><strong>{kg(t.dispatched)}</strong> kg</span>
                  </>}>
                  {d.sales.map((r, i) => (
                    <div className="mm-osum-row" key={`${r.doc}-${i}`} title={r.doc}>
                      <span className="mm-osum-when">
                        {r.challan_no ? <span className="mm-osum-ref">({r.challan_no})</span> : null} {r.date || "—"}
                      </span>
                      <span className="mm-osum-what">{r.color_name || ""}</span>
                      <span className="mm-osum-kg">{kg(r.weight)}kg</span>
                    </div>
                  ))}
                </Log>
              </div>

              {/* The arithmetic the status is decided on, spelled out — so Complete is
                  something the reader can check rather than something they are told. */}
              <div className="mm-osum-verdict">
                <div className={`mm-osum-remaining ${t.remaining > 0 ? "mm-var-over" : ""}`}>
                  <span>REMAINING TO DISPATCH</span>
                  <span><strong>{kg(t.remaining)}</strong> kg</span>
                </div>
                <p className="mm-osum-explain">
                  {kg(t.dispatched)} of {kg(t.ordered)} kg has gone out.{" "}
                  {d.completion_mode === "Force"
                    ? "An admin closed this order by hand, so it counts as Complete whatever the figures say."
                    : t.ordered > 0
                      ? <>It reads <strong>Complete</strong> at {kg(t.complete_at)} kg — the ordered weight less the {t.tolerance_percent}% variance allowance.</>
                      : "This order carries no weight target, so anything dispatched closes it."}
                  {" "}In hand (received but not yet sent): <strong>{kg(t.in_hand)}</strong> kg.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
