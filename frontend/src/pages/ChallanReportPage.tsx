import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { FileText, Printer, RefreshCw, Search, X } from "lucide-react";
import PartyPicker from "@/components/PartyPicker";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";
import { printChallan, type ChallanPrintData } from "@/utils/challanPrint";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";

/** What an order took in versus what has already gone out on it. */
type Cover = {
  sales_order: string; ordered_weight: number; inwarded_weight: number;
  dispatched_weight: number; balance_weight: number;
};
type Row = {
  name: string; challan_type?: string; challan_no?: string; transaction_date?: string;
  party?: string; party_name?: string; sales_order?: string;
  /** Every colour on the challan. A challan carrying two names both — collapsing it to
   *  the first would make two different dispatches to one party look identical. */
  colours?: string[];
  total_box?: number; total_weight?: number; docstatus?: number; line_count?: number;
  job_work_flag?: number; cover?: Cover | null;
};
type Line = {
  name: string; idx: number; barcode?: string; color_name?: string; cut?: string;
  qty_box?: number; gross_weight?: number; bobbin?: string; bobbin_pcs?: number;
  bobbin_pcs_weight?: number; total_bobbin_weight?: number; box_weight?: number;
  net_weight?: number; weight?: number; r_box?: number; r_bobbin?: number;
};
type Detail = {
  challan: string; challan_no?: string; challan_type?: string; transaction_date?: string;
  party?: string; sales_order?: string; docstatus?: number;
  total_box?: number; total_weight?: number; cover?: Cover | null; items: Line[];
};

const TYPES = ["Sales", "Job Challan", "Challan", "Delivery Challan", "Job Out", "Job In"];
const kg = (n?: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * Sales Challan Voucher report.
 *
 * Every challan issued, and — because a weighing mistake is only ever found after the
 * paper has gone out — the weights on one can be corrected in place. The number stays
 * with the customer either way, so re-issuing was never the answer.
 *
 * Correcting re-checks the order's inward cover exactly as issuing does: a challan can
 * never send out more than the order took in. The balance beside each row is what that
 * check reads from, so it moves the moment a correction is saved.
 */
export default function ChallanReportPage() {
  const [party, setParty] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const key = `chal-rep-${party}-${type}-${from}-${to}`;
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Row[] }>(
    `${API}.challan_report`,
    { party: party || undefined, challan_type: type || undefined, from_date: from || undefined, to_date: to || undefined },
    key,
  );
  const rows = useMemo(() => data?.message ?? [], [data]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.name, r.challan_no, r.party_name, r.party, r.sales_order, r.challan_type, (r.colours ?? []).join(" ")]
        .filter(Boolean).join(" ").toLowerCase().includes(t),
    );
  }, [rows, q]);

  const { call: fetchPrint } = useFrappePostCall<{ message: ChallanPrintData }>(`${API}.challan_for_print`);
  async function print(name: string) {
    try {
      const r = await fetchPrint({ challan: name });
      if (r?.message) printChallan(r.message);
    } catch (e) { toast(extractErrorMessage(e), "error"); }
  }

  const totalWt = shown.reduce((s, r) => s + Number(r.total_weight || 0), 0);

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Sales Challan Voucher report</h1>
          <p className="mm-page-sub">Every challan issued. Open one to correct its weights — the order&apos;s inward cover still applies.</p>
        </div>
        <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void mutate()}><RefreshCw size={14} /></button>
      </header>

      <section className="mm-card mm-card-pad">
        <div className="mm-form-grid">
          <PartyPicker label="Party" value={party} onChange={setParty} />
          <label className="mm-field">
            <span className="mm-field-label">Type</span>
            <SearchSelect value={type} placeholder="— all types —"
              options={TYPES.map((t) => ({ value: t, label: t }))} onChange={setType} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="mm-search-wrap" style={{ marginTop: "0.6rem" }}>
          <Search size={15} className="mm-search-icon" aria-hidden />
          <input className="mm-input mm-search-pill" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search challan no / party / order…" />
        </div>
      </section>

      <section className="mm-card mm-card-pad" style={{ marginTop: "1rem" }}>
        <div className="mm-iw-sec-head">
          <h2 className="mm-panel-title"><FileText size={16} /> Challans</h2>
          <span className="mm-pill mm-pill-muted">{isLoading ? "…" : shown.length}</span>
        </div>
        {isLoading ? (
          <p className="mm-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="mm-empty">No challans for these filters.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense mm-table-hover">
              <thead>
                <tr>
                  <th>Challan</th><th>Date</th><th>Type</th><th>Party</th><th>Item</th><th>Order</th>
                  <th className="mm-num">Box</th><th className="mm-num">Weight</th>
                  {/* The order's own arithmetic, so a correction can be judged before it
                      is made rather than by reading the error afterwards. */}
                  <th className="mm-num" title="Inwarded on the order">In</th>
                  <th className="mm-num" title="Already dispatched on the order">Out</th>
                  <th className="mm-num" title="Still available to dispatch">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name} className="mm-ws-row" onClick={() => setOpen(r.name)}>
                    <td>{r.challan_no || r.name}</td>
                    <td>{r.transaction_date || "—"}</td>
                    <td>{r.challan_type || "—"}</td>
                    <td title={r.party || ""}>{r.party_name || r.party || "—"}</td>
                    <td>
                      {(r.colours ?? []).length
                        ? <span className="mm-colour-name">{(r.colours ?? []).join(", ")}</span>
                        : <span className="mm-muted">—</span>}
                    </td>
                    <td>{r.sales_order || "—"}</td>
                    <td className="mm-num">{Number(r.total_box || 0).toLocaleString()}</td>
                    <td className="mm-num">{kg(r.total_weight)}</td>
                    <td className="mm-num">{r.cover ? kg(r.cover.inwarded_weight) : "—"}</td>
                    <td className="mm-num">{r.cover ? kg(r.cover.dispatched_weight) : "—"}</td>
                    <td className="mm-num">
                      {r.cover
                        ? <span className={r.cover.balance_weight < 0 ? "mm-var-over" : undefined}>{kg(r.cover.balance_weight)}</span>
                        : "—"}
                    </td>
                    <td className="mm-num mm-pv-rowacts">
                      <button className="mm-mini" title="Print" onClick={(e) => { e.stopPropagation(); void print(r.name); }}>
                        <Printer size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  {/* Challan · Date · Type · Party · Item · Order · Box — the Weight total
                      below has to stay under the Weight column. */}
                  <td colSpan={7}><strong>{shown.length} challan{shown.length === 1 ? "" : "s"}</strong></td>
                  <td className="mm-num"><strong>{kg(totalWt)}</strong></td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {open && <EditChallan challan={open} onClose={() => setOpen(null)} onSaved={() => { void mutate(); }} />}
    </div>
  );
}

/* ── Correct one challan's weights ─────────────────────────── */
function EditChallan({ challan, onClose, onSaved }: { challan: string; onClose: () => void; onSaved: () => void }) {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Detail }>(
    `${API}.challan_lines`, { challan }, `chal-lines-${challan}`,
  );
  const d = data?.message;
  const { call: save, loading } = useFrappePostCall(`${API}.update_challan_weights`);
  const [edits, setEdits] = useState<Record<string, Partial<Line>>>({});
  const [err, setErr] = useState<string | null>(null);

  const items = d?.items ?? [];
  const valueOf = (it: Line, f: keyof Line) => {
    const e = edits[it.name]?.[f];
    return e === undefined ? it[f] : e;
  };
  const netOf = (it: Line) => Number(valueOf(it, "net_weight") ?? it.weight ?? 0) || 0;
  const total = items.reduce((s, it) => s + netOf(it), 0);

  // What the order can still take, this challan's own rows excluded — the same ceiling
  // the server checks, shown before the save rather than after it fails.
  const cover = d?.cover ?? null;
  const available = cover ? cover.inwarded_weight - cover.dispatched_weight : null;
  const over = available !== null && cover!.inwarded_weight > 0 && total > available + 1e-6;

  function setField(it: Line, f: keyof Line, v: number | boolean) {
    setEdits((p) => ({ ...p, [it.name]: { ...p[it.name], [f]: v as never } }));
  }

  async function submit() {
    setErr(null);
    try {
      const r = await save({
        challan,
        lines: JSON.stringify(items.map((it) => ({
          name: it.name,
          net_weight: netOf(it),
          gross_weight: Number(valueOf(it, "gross_weight") ?? 0) || 0,
          box_weight: Number(valueOf(it, "box_weight") ?? 0) || 0,
          r_box: valueOf(it, "r_box") ? 1 : 0,
          r_bobbin: valueOf(it, "r_bobbin") ? 1 : 0,
        }))),
      });
      const t = (r as { message?: { total_weight?: number } })?.message?.total_weight;
      toast(`Challan updated — ${kg(t)} kg`);
      setEdits({});
      await mutate();
      onSaved();
    } catch (e) {
      const m = extractErrorMessage(e);
      setErr(m);
      toast(m, "error");
    }
  }

  return (
    <div className="mm-modal-scrim mm-scrim-right" onClick={onClose}>
      <div className="mm-modal mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Update Sales Challan Voucher — {d?.challan_no || challan}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {isLoading && <p className="mm-muted">Loading…</p>}
          {d && (
            <>
              <div className="mm-pv-grid">
                <label className="mm-field"><span className="mm-field-label">Sale Chalan</span>
                  <input className="mm-input" value={d.challan_no || d.challan} readOnly /></label>
                <label className="mm-field"><span className="mm-field-label">Customer</span>
                  <input className="mm-input" value={d.party || "—"} readOnly /></label>
                <label className="mm-field"><span className="mm-field-label">Order</span>
                  <input className="mm-input" value={d.sales_order || "—"} readOnly /></label>
                <label className="mm-field"><span className="mm-field-label">Chalan Date</span>
                  <input className="mm-input" value={d.transaction_date || "—"} readOnly /></label>
              </div>

              {/* The order's arithmetic, stated before anything is typed. */}
              {cover && (
                <div className={`mm-banner ${over ? "mm-banner-warn" : ""}`} style={{ marginBottom: "0.7rem" }}>
                  Order {cover.sales_order}: took in <strong>{kg(cover.inwarded_weight)}</strong> kg ·
                  {" "}<strong>{kg(cover.dispatched_weight)}</strong> kg gone on other challans ·
                  {" "}<strong>{kg(available ?? 0)}</strong> kg available to this one.
                  {over ? " This challan is over that — reduce the weights." : ""}
                </div>
              )}

              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead>
                    <tr>
                      <th>Barcode</th><th>Item</th><th>Size</th>
                      <th className="mm-num">Gr.Wt</th><th className="mm-num">Bobbin | Pcs</th>
                      <th className="mm-num">Box Wt</th><th className="mm-num">Net Wt</th>
                      <th className="mm-num">R.Box</th><th className="mm-num">R.Bobbin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.name}>
                        <td title={it.barcode || ""}>{it.barcode || "—"}</td>
                        <td>{it.color_name || "—"}</td>
                        <td>{it.cut || "—"}</td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number"
                            value={String(valueOf(it, "gross_weight") ?? "")}
                            onChange={(e) => setField(it, "gross_weight", Number(e.target.value))} />
                        </td>
                        <td className="mm-num">{it.bobbin || "—"} | {Number(it.bobbin_pcs || 0)}</td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number"
                            value={String(valueOf(it, "box_weight") ?? "")}
                            onChange={(e) => setField(it, "box_weight", Number(e.target.value))} />
                        </td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number"
                            value={String(netOf(it))}
                            onChange={(e) => setField(it, "net_weight", Number(e.target.value))} />
                        </td>
                        <td className="mm-num">
                          <input type="checkbox" checked={!!valueOf(it, "r_box")}
                            onChange={(e) => setField(it, "r_box", e.target.checked)} />
                        </td>
                        <td className="mm-num">
                          <input type="checkbox" checked={!!valueOf(it, "r_bobbin")}
                            onChange={(e) => setField(it, "r_bobbin", e.target.checked)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
            </>
          )}
        </div>
        <div className="mm-modal-foot mm-foot-split">
          <div className="mm-pv-totals">
            <span>Rows <strong>{items.length}</strong></span>
            <span>Total Net <strong className={over ? "mm-var-over" : undefined}>{kg(total)} kg</strong></span>
            {available !== null && <span>Available <strong>{kg(available)} kg</strong></span>}
          </div>
          <div className="mm-foot-actions">
            <button className="mm-btn-ghost" onClick={onClose}>Close</button>
            <button className="mm-btn-primary" disabled={loading || items.length === 0 || Object.keys(edits).length === 0}
              onClick={() => void submit()}>
              {loading ? "Saving…" : "Update weights"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
