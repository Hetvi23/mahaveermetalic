import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import NumInput from "@/components/NumInput";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, Barcode, FileText, Package, Printer, RefreshCw, Search } from "lucide-react";
import PartyPicker from "@/components/PartyPicker";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";
import { printChallan, type ChallanPrintData } from "@/utils/challanPrint";
import { fmtDate } from "@/utils/localDate";
import { downloadBoxStickers, printBoxStickers, stickersFromChallan } from "@/utils/boxSticker";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";

/** What an order took in versus what has already gone out on it. */
type Cover = {
  sales_order: string; ordered_weight: number; inwarded_weight: number;
  dispatched_weight: number; balance_weight: number;
};
/** Job work, the way the worker's book reads: sent, received back, still with them. On a
 *  Job In it is the balance as it stood once that receipt was booked. */
type Job = { job_out: string; sent: number; received: number; balance: number };
type Row = {
  name: string; challan_type?: string; challan_no?: string; transaction_date?: string;
  party?: string; party_name?: string; sales_order?: string;
  /** Every colour on the challan. A challan carrying two names both — collapsing it to
   *  the first would make two different dispatches to one party look identical. */
  colours?: string[];
  total_box?: number; total_weight?: number; docstatus?: number; line_count?: number;
  job_work_flag?: number; cover?: Cover | null; job?: Job | null;
  /** The company the challan went to — its order's, else the party's first company. */
  company?: string | null;
  /** Boxes ticked R.Box, and the bobbins on rows ticked R.Bobbin — as the print counts them. */
  return_box?: number; return_bobbin?: number;
};
type Line = {
  name: string; idx: number; barcode?: string; color_name?: string; cut?: string;
  qty_box?: number; gross_weight?: number; bobbin?: string; bobbin_pcs?: number;
  bobbin_pcs_weight?: number; total_bobbin_weight?: number; box_weight?: number;
  net_weight?: number; weight?: number; r_box?: number; r_bobbin?: number;
  /** Off the box's production — what its original sticker carried. */
  batch_no?: string | null; operator?: string | null; posting_date?: string | null;
};
type Detail = {
  challan: string; challan_no?: string; challan_type?: string; transaction_date?: string;
  party?: string; sales_order?: string; docstatus?: number;
  total_box?: number; total_weight?: number; cover?: Cover | null; job?: Job | null; items: Line[];
};

/** No type picked shows the sales register — Sales and Job Challan (see api.challan_report).
 *  Job Out / Job In are next in the list rather than last: they are the two types the
 *  default deliberately leaves out, so they are the two most likely to be picked, and the
 *  menu is only 200px tall — at the bottom they were below the fold and read as missing. */
const TYPES = ["Sales", "Job Challan", "Job Out", "Job In", "Challan", "Delivery Challan", "Roll Challan"];
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
  // The challan being corrected lives in the URL, so it opens as a page of its own: the
  // browser's Back returns to the report, and a refresh or a shared link reopens it.
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = params.get("challan");
  function openChallan(name: string) {
    const next = new URLSearchParams(params);
    next.set("challan", name);
    setParams(next, { state: { fromReport: true } });
  }
  function closeChallan() {
    // Opened from the list: step back, so Back and the button agree. Opened from a link:
    // there is no list behind it, so swap the URL instead of leaving the app.
    if ((location.state as { fromReport?: boolean } | null)?.fromReport) return navigate(-1);
    const next = new URLSearchParams(params);
    next.delete("challan");
    setParams(next, { replace: true });
  }

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
      [r.name, r.challan_no, r.company, r.party_name, r.party, r.sales_order, r.challan_type, (r.colours ?? []).join(" ")]
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
  const totalRetBox = shown.reduce((s, r) => s + Number(r.return_box || 0), 0);
  const totalRetBobbin = shown.reduce((s, r) => s + Number(r.return_bobbin || 0), 0);

  // The filters above stay in this component's state, so closing the challan comes back
  // to the list exactly as it was left.
  if (open) {
    return <EditChallan challan={open} onClose={closeChallan} onSaved={() => { void mutate(); }} />;
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Sales Challan Voucher report</h1>
          <p className="mm-page-sub">Sales and Job Challans — pick a Type to see the others. Open one to correct its weights; the order&apos;s inward cover still applies.</p>
        </div>
        <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void mutate()}><RefreshCw size={14} /></button>
      </header>

      <section className="mm-card mm-card-pad">
        <div className="mm-form-grid">
          <PartyPicker label="Party" value={party} onChange={setParty} />
          <label className="mm-field">
            <span className="mm-field-label">Type</span>
            <SearchSelect value={type} placeholder="Sales + Job Challan"
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
            placeholder="Search challan no / company / party / order…" />
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
                  {/* COMPANY, not party (Hetvi: "instead of party company name will come") — the
                      firm the paper went to. The party is still on the cell's hover. */}
                  <th>Challan</th><th>Date</th><th>Type</th><th>Company</th><th>Item</th><th>Order</th>
                  <th className="mm-num">Box</th><th className="mm-num">Weight</th>
                  {/* What comes BACK on it, in place of the order's In / Out figures (Hetvi:
                      "remove in and out data, add returnable bobbin and return box"). */}
                  <th className="mm-num" title="Boxes to come back — rows ticked R.Box">R.Box</th>
                  <th className="mm-num" title="Returnable bobbins — the bobbins on rows ticked R.Bobbin">R.Bobbin</th>
                  <th className="mm-num" title="Order: still available to dispatch · Job work: still with the worker">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name} className="mm-ws-row" onClick={() => openChallan(r.name)}>
                    <td>{r.challan_no || r.name}</td>
                    <td>{fmtDate(r.transaction_date) || "—"}</td>
                    <td>{r.challan_type || "—"}</td>
                    <td title={r.party_name || r.party ? `Party: ${r.party_name || r.party}` : undefined}>
                      {r.company || r.party_name || r.party || "—"}
                    </td>
                    <td>
                      {(r.colours ?? []).length
                        ? <span className="mm-colour-name">{(r.colours ?? []).join(", ")}</span>
                        : <span className="mm-muted">—</span>}
                    </td>
                    <td>{r.sales_order || "—"}</td>
                    <td className="mm-num">{Number(r.total_box || 0).toLocaleString()}</td>
                    <td className="mm-num">{kg(r.total_weight)}</td>
                    <td className="mm-num">{Number(r.return_box || 0) ? Number(r.return_box).toLocaleString() : "—"}</td>
                    <td className="mm-num">{Number(r.return_bobbin || 0) ? Number(r.return_bobbin).toLocaleString() : "—"}</td>
                    {/* A dispatch reads against its order; a Job Out / Job In against its own
                        Job Out — what is still with the worker. */}
                    {r.job ? (
                      <td className="mm-num" title={`Still with the worker — sent ${kg(r.job.sent)}, back ${kg(r.job.received)} on ${r.job.job_out}`}>
                        <span className={r.job.balance < 0 ? "mm-var-over" : undefined}>{kg(r.job.balance)}</span>
                      </td>
                    ) : (
                      <td className="mm-num">
                        {r.cover
                          ? <span className={r.cover.balance_weight < 0 ? "mm-var-over" : undefined}>{kg(r.cover.balance_weight)}</span>
                          : "—"}
                      </td>
                    )}
                    {/* The flex row sits INSIDE the cell. On the cell itself it stopped being a
                        table cell and the print button slid over the Balance figure. */}
                    <td className="mm-num">
                      <div className="mm-pv-rowacts">
                        <button className="mm-mini" title="Print" onClick={(e) => { e.stopPropagation(); void print(r.name); }}>
                          <Printer size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  {/* Challan · Date · Type · Company · Item · Order · Box — the totals below
                      have to stay under Weight, R.Box and R.Bobbin. */}
                  <td colSpan={7}><strong>{shown.length} challan{shown.length === 1 ? "" : "s"}</strong></td>
                  <td className="mm-num"><strong>{kg(totalWt)}</strong></td>
                  <td className="mm-num"><strong>{totalRetBox.toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{totalRetBobbin.toLocaleString()}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
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

  // Every box on the challan, labelled in one print job. Read off the SAVED lines: a label
  // is stuck on a box and has to agree with the paper, so unsaved corrections hold it back.
  const labels = d ? stickersFromChallan(d) : [];
  const unsaved = Object.keys(edits).length > 0;
  function printLabels() {
    if (!labels.length || unsaved) return;
    // Straight from the click, so the pop-up is allowed; if the browser blocks it anyway
    // the same labels are saved as a file rather than lost.
    if (!printBoxStickers(labels)) {
      downloadBoxStickers(labels, `barcodes-${d?.challan_no || challan}`);
      toast("The print pop-up was blocked — the barcodes have been saved as a file instead.");
    }
  }

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

  // The list was scrolled to wherever the row was clicked; the page starts at its top.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: "start" }); }, [challan]);

  return (
    <div className="mm-screen mm-page-enter" ref={top}>
      <header className="mm-ws-toolbar">
        <div className="mm-cr-head">
          <button type="button" className="mm-icon-btn" onClick={onClose}
            title="Back to the report" aria-label="Back to the report">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="mm-page-title">Update Sales Challan Voucher — {d?.challan_no || challan}</h1>
            <p className="mm-page-sub">Correct the weights on an issued challan. The order&apos;s inward cover still applies.</p>
          </div>
        </div>
        <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void mutate()}><RefreshCw size={14} /></button>
      </header>

      {isLoading && <p className="mm-muted">Loading…</p>}
      {d && (
        <>
          <section className="mm-card mm-card-pad">
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

            {/* A job challan answers to its Job Out, not to the order. */}
            {d.job && (
              <div className="mm-banner" style={{ marginBottom: "0.7rem" }}>
                Job Out {d.job.job_out}: sent <strong>{kg(d.job.sent)}</strong> kg ·
                {" "}received back <strong>{kg(d.job.received)}</strong> kg ·
                {" "}<strong className={d.job.balance < 0 ? "mm-var-over" : undefined}>{kg(d.job.balance)}</strong> kg still with the worker.
              </div>
            )}
            {/* The order's arithmetic, stated before anything is typed. */}
            {cover && (
              <div className={`mm-banner ${over ? "mm-banner-warn" : ""}`} style={{ marginBottom: "0.7rem" }}>
                Order {cover.sales_order}: took in <strong>{kg(cover.inwarded_weight)}</strong> kg ·
                {" "}<strong>{kg(cover.dispatched_weight)}</strong> kg gone on other challans ·
                {" "}<strong>{kg(available ?? 0)}</strong> kg available to this one.
                {over ? " This challan is over that — reduce the weights." : ""}
              </div>
            )}
          </section>

          <section className="mm-card mm-card-pad" style={{ marginTop: "1rem" }}>
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title"><Package size={16} /> Boxes</h2>
              <span className="mm-pill mm-pill-muted">{items.length}</span>
            </div>
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
                        <NumInput className="mm-input mm-input-compact mm-iw-num"
                          value={String(valueOf(it, "gross_weight") ?? "")}
                          onChange={(v) => setField(it, "gross_weight", Number(v))} />
                      </td>
                      <td className="mm-num">{it.bobbin || "—"} | {Number(it.bobbin_pcs || 0)}</td>
                      <td className="mm-num">
                        <NumInput className="mm-input mm-input-compact mm-iw-num"
                          value={String(valueOf(it, "box_weight") ?? "")}
                          onChange={(v) => setField(it, "box_weight", Number(v))} />
                      </td>
                      <td className="mm-num">
                        <NumInput className="mm-input mm-input-compact mm-iw-num"
                          value={String(netOf(it))}
                          onChange={(v) => setField(it, "net_weight", Number(v))} />
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
          </section>

          {/* Pinned to the bottom of the page: on a fifty-box challan the totals and the
              save button stay in reach while the weights above are being corrected. */}
          <div className="mm-job-foot">
            <div className="mm-pv-totals">
              <span>Rows <strong>{items.length}</strong></span>
              <span>Total Net <strong className={over ? "mm-var-over" : undefined}>{kg(total)} kg</strong></span>
              {available !== null && <span>Available <strong>{kg(available)} kg</strong></span>}
            </div>
            <div className="mm-foot-actions mm-cr-actions">
              <button className="mm-btn-secondary" disabled={!labels.length || unsaved} onClick={printLabels}
                title={!labels.length
                  ? "No boxes with a barcode on this challan"
                  : unsaved ? "Save the weight changes first — the labels print what is saved"
                  : `Print the barcode label of all ${labels.length} box${labels.length === 1 ? "" : "es"}`}>
                <Barcode size={15} /> Print barcodes{labels.length ? ` (${labels.length})` : ""}
              </button>
              <button className="mm-btn-ghost" onClick={onClose}>Back</button>
              <button className="mm-btn-primary" disabled={loading || items.length === 0 || Object.keys(edits).length === 0}
                onClick={() => void submit()}>
                {loading ? "Saving…" : "Update weights"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
