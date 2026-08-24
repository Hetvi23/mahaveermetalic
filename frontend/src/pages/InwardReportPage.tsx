import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { ScrollText } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { Filter, ReportFilters } from "@/components/ReportFilters";
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
  supplier?: string;
  company_name?: string;
  party?: string;
  lot_number?: string;
  location?: string;
  receipt_status?: string;
  docstatus?: number;
  /** A return's rows are negative; `gr_returned` marks the receipt one was raised against. */
  is_gr?: number;
  gr_returned?: number;
  gr_against?: string;
  gr_reason?: string;
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
 *
 * A receipt is never cancelled from here — it is RETURNED (GR). The rolls did arrive, so the
 * receipt keeps its place in the register, marked, and the return posts its own negative rows
 * beneath it: the totals net down to what is really still in, and the history stays honest.
 */
export default function InwardReportPage() {
  const [challan, setChallan] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [company, setCompany] = useState("");
  const [item, setItem] = useState("");
  const [limit, setLimit] = useState(500);
  const [party, setParty] = useState("");
  const [lot, setLot] = useState("");
  const [jobWork, setJobWork] = useState("");
  const [applied, setApplied] = useState({
    challan: "", from: "", to: "", company: "", item: "", party: "", lot: "", jobWork: "",
  });
  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const apply = () => setApplied({ challan, from, to, company, item, party, lot, jobWork });

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Report }>(
    `${API}.rolls_report`,
    {
      challan: applied.challan || undefined,
      from_date: applied.from || undefined,
      to_date: applied.to || undefined,
      company: applied.company || undefined,
      item: applied.item || undefined,
      party: applied.party || undefined,
      lot: applied.lot.trim() || undefined,
      job_work: applied.jobWork || undefined,
      limit,
    },
    `inward-report-${applied.challan}-${applied.from}-${applied.to}-${applied.company}-${applied.item}-${applied.party}-${applied.lot}-${applied.jobWork}-${limit}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;
  const itemOptions = data?.message?.items ?? [];
  const companyOptions = data?.message?.companies ?? [];
  const maybeMore = rows.length >= limit;

  const { call: grCall, loading: returning } = useFrappePostCall<{ message: { gr: string; rolls: number; returned_weight: number } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.post_gr",
  );
  const { call: setStatusCall } = useFrappePostCall<{ message: { receipt_status: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.set_inward_status",
  );

  /** GR — goods return. Posts a NEGATIVE entry for the whole inward and marks the original
   *  returned; the receipt stays on the record, its quantity netted off. Acts on the whole
   *  inward, not just this line, which is why it sits on the inward's first row. */
  async function onGR(inward: string) {
    const reason = window.prompt(
      `Goods return for inward ${inward}?\n\n` +
        "Its rolls are posted back out of stock as a negative entry, and this inward is marked GR — " +
        "so it stops counting as inward quantity, while the record of it arriving stays.\n\n" +
        "Reason (optional):",
      "",
    );
    if (reason === null) return; // cancelled the prompt
    try {
      const res = await grCall({ inward, reason });
      const m = res?.message;
      await mutate();
      toast(m ? `GR ${m.gr} posted — ${m.rolls} roll(s), ${kg(m.returned_weight)} kg returned` : `GR posted for ${inward}`);
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
    const head = ["Chalan No", "Chalan Date", "Supplier", "Order", "Item", "Roll", "Size", "Qty", "Weight (Kg)", "JobWork", "Company", "Lot", "Inward", "Status", "GR"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = rows.map((r) => [
      r.challan_no ?? "", r.chalan_date ?? "", r.supplier ?? "", r.customer_order ?? "", r.item ?? "", r.roll_name ?? "",
      r.cut ?? "", r.qty_box ?? 0, r.weight ?? 0, r.job_work ? "Yes" : "", r.company_name ?? "",
      r.lot_number ?? "", r.inward, r.docstatus === 2 ? "Cancelled" : r.receipt_status ?? "",
      r.is_gr ? "GR entry" : r.gr_returned ? "Returned" : "",
    ].map(esc).join(","));
    const csv = [head.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "inward-rolls.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Raising a GR is a FLOOR action: whoever finds the bad rolls records the return. Only
  // the admin-only controls beside it — overriding a challan's Complete/Partial status —
  // stay behind the admin check.
  const admin = isAdmin();
  const cols = 9;

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title"><ScrollText size={18} /> Report — Inwards</h1>
          <p className="mm-page-sub">One row per roll received, newest entered first.</p>
        </div>
      </header>

      <ReportFilters
        onApply={apply}
        onReset={() => {
          setChallan(""); setFrom(""); setTo(""); setCompany(""); setItem("");
          setParty(""); setLot(""); setJobWork("");
          setApplied({ challan: "", from: "", to: "", company: "", item: "", party: "", lot: "", jobWork: "" });
        }}
        onPrint={() => window.print()}
        onExport={exportCsv}
        exportDisabled={rows.length === 0}
        note={<>One row per roll received, newest entered first.</>}
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
            options={companyOptions.map((c) => ({ value: c, label: c }))} onChange={setCompany} />
        </Filter>
        <Filter label="Item">
          <SearchSelect value={item} placeholder="All items"
            options={itemOptions.map((c) => ({ value: c, label: c }))} onChange={setItem} />
        </Filter>
        <Filter label="Chalan No">
          <input className="mm-input" value={challan} placeholder="Ch.No"
            onChange={(e) => setChallan(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
        </Filter>
        <Filter label="Lot">
          <input className="mm-input" value={lot} placeholder="Lot id"
            onChange={(e) => setLot(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
        </Filter>
        <Filter label="Job work">
          <SearchSelect value={jobWork} placeholder="All receipts"
            options={[{ value: "1", label: "Job work only" }, { value: "0", label: "Own material only" }]}
            onChange={setJobWork} />
        </Filter>
      </ReportFilters>

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
                <th>Supplier</th>
                <th>Order</th>
                <th>Item</th>
                <th>Roll</th>
                <th className="mm-num">Qty</th>
                <th className="mm-num">Weight (Kg)</th>
                <th className="mm-no-print">Inward</th>
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
                  <tr key={r.row_id}
                    className={cancelled ? "mm-row-cancelled" : r.is_gr ? "mm-row-gr" : r.gr_returned ? "mm-row-returned" : undefined}>
                    <td>{r.challan_no || "—"}</td>
                    <td className="mm-ow-cell-date">{r.chalan_date || "—"}</td>
                    <td>{r.supplier || <span className="mm-muted">—</span>}</td>
                    <td>
                      {r.customer_order
                        ? <span className="mm-ow-cell-order">{r.customer_order}</span>
                        : <span className="mm-muted">—</span>}
                    </td>
                    <td>
                      <span className="mm-colour-name">{r.item || "—"}</span>
                      {r.is_gr ? (
                        <span className="mm-irep-gr" title={r.gr_reason || "Goods return — posted back out of stock"}>GR</span>
                      ) : r.gr_returned ? (
                        <span className="mm-irep-gr mm-irep-gr-src" title="A goods return was raised against this receipt">returned</span>
                      ) : null}
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
                    <td className="mm-no-print">
                        {firstOfInward && (
                          // The inward's document id is machinery — a hash nobody quotes —
                          // so it stays off the register and only rides along as a tooltip
                          // for when someone does need to name the document.
                          <div className="mm-irep-acts" title={r.inward}>
                            {cancelled ? (
                              <span className="mm-state-chip mm-state-open">Cancelled</span>
                            ) : r.is_gr ? (
                              <span className="mm-state-chip mm-state-open" title={r.gr_against ? `Return against ${r.gr_against}` : undefined}>
                                GR entry
                              </span>
                            ) : (
                              <>
                                {admin ? (
                                  <button
                                    type="button"
                                    className={`mm-state-chip mm-state-clickable ${r.receipt_status === "Partial" ? "mm-state-inventory" : "mm-state-cut"}`}
                                    title={`${r.inward} — click to mark ${r.receipt_status === "Partial" ? "Complete" : "Partial"}`}
                                    onClick={() => void onToggleStatus(r.inward, r.receipt_status)}
                                  >
                                    {r.receipt_status === "Partial" ? "Partial" : "Complete"}
                                  </button>
                                ) : (
                                  <span className={`mm-state-chip ${r.receipt_status === "Partial" ? "mm-state-inventory" : "mm-state-cut"}`}>
                                    {r.receipt_status === "Partial" ? "Partial" : "Complete"}
                                  </span>
                                )}
                                {/* GR, not Cancel: the rolls DID arrive. The return posts a
                                    negative entry and this inward stays on the record. */}
                                <button
                                  type="button"
                                  className="mm-mini mm-mini-warn"
                                  disabled={returning || !!r.gr_returned}
                                  aria-label={`Goods return for inward ${r.inward}`}
                                  title={r.gr_returned
                                    ? `${r.inward} has already been returned`
                                    : `GR ${r.inward} — post its rolls back out of stock as a negative entry`}
                                  onClick={() => void onGR(r.inward)}
                                >
                                  GR
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
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
