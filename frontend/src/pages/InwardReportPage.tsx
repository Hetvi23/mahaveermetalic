import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Check, Pencil, ScrollText, Trash2, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { Filter, ReportFilters } from "@/components/ReportFilters";
import Pager, { pageSlice } from "@/components/Pager";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.inward_report";
const INWARD = "mahaveermetalic.mahaveer_metallic.api.inward";
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
  /** Cutting is the cut-off for correcting or returning a roll. The server decides, and
   *  sends the verdict down with the row so the screen never works it out for itself. */
  cutting?: string;
  cut_status?: string;
  can_edit?: boolean;
  block_reason?: string | null;
};
type Report = {
  rows: Row[];
  totals: { rolls: number; qty: number; weight: number; shown: number };
  items: string[];
  companies: string[];
};
type SOOpt = { sales_order: string; party_name?: string; company_name?: string; open?: number };

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
 *
 * The register is also where a receipt gets CORRECTED. Rolls are keyed at the scale, at
 * speed, and the two things got wrong often enough to matter are the challan number and the
 * order the roll is for. Both are corrections to paper rather than statements about
 * material, so they are edits here rather than a return — and both stop at cutting, because
 * once a roll has been cut its weight is in patti and a program may be planned on it.
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
  const [pending, setPending] = useState("");
  const [applied, setApplied] = useState({
    challan: "", from: "", to: "", company: "", item: "", party: "", lot: "", jobWork: "", pending: "",
  });
  /** Which page of the register is on screen. */
  const [page, setPage] = useState(1);
  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const apply = () => {
    setApplied({ challan, from, to, company, item, party, lot, jobWork, pending });
    // A new filter is a new list, and page 4 of the old one means nothing in it.
    setPage(1);
  };

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
      pending: applied.pending || undefined,
      limit,
    },
    `inward-report-${applied.challan}-${applied.from}-${applied.to}-${applied.company}-${applied.item}-${applied.party}-${applied.lot}-${applied.jobWork}-${applied.pending}-${limit}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;
  const itemOptions = data?.message?.items ?? [];
  const companyOptions = data?.message?.companies ?? [];
  const maybeMore = rows.length >= limit;
  const { pages, current, start, rows: pageRows } = pageSlice(rows, page);

  // Orders offered when re-pointing a roll. Closed ones are included deliberately: a roll
  // is often reallocated precisely because the order it was put against was the wrong one,
  // and that order may since have closed. The server still refuses anything unapproved.
  const orderOpts = useFrappeGetCall<{ message: SOOpt[] }>(
    `${INWARD}.sales_order_options`,
    { limit: 500, include_closed: 1 },
    "inward-report-order-options",
  );

  const { call: grCall, loading: returning } = useFrappePostCall<{ message: { gr: string; rolls: number; returned_weight: number } }>(
    `${INWARD}.post_gr`,
  );
  const { call: setStatusCall } = useFrappePostCall<{ message: { receipt_status: string } }>(
    `${INWARD}.set_inward_status`,
  );
  const { call: correctCall, loading: saving } = useFrappePostCall<{ message: { changed: Record<string, string> } }>(
    `${INWARD}.correct_inward_roll`,
  );
  const { call: cancelCall, loading: cancelling } = useFrappePostCall<{ message: { inward: string } }>(
    `${INWARD}.cancel_inward`,
  );

  // Which roll is being corrected, and what it is being corrected to. One row at a time:
  // the edit is two fields on a line the operator is already looking at, not a form.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ challan_no: "", customer_order: "" });

  function startEdit(r: Row) {
    setEditing(r.row_id);
    setDraft({ challan_no: r.challan_no ?? "", customer_order: r.customer_order ?? "" });
  }

  async function saveEdit(r: Row) {
    try {
      const res = await correctCall({
        row: r.row_id,
        challan_no: draft.challan_no.trim(),
        sales_order: draft.customer_order,
      });
      const changed = Object.keys(res?.message?.changed ?? {});
      setEditing(null);
      await mutate();
      toast(
        changed.length
          ? changed.includes("challan_number")
            ? "Roll corrected — the challan number moved on every roll of this receipt"
            : "Roll corrected"
          : "Nothing changed",
      );
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  /** GR — goods return, for ONE roll. It is posted back out of stock as a negative entry
   *  against this receipt; the rest of the receipt is untouched and the record of the roll
   *  arriving stays. A roll that has gone to cutting can't be returned — the server refuses
   *  it, and the button is not offered. */
  async function onGRRoll(r: Row) {
    const what = r.roll_name || r.item || "this roll";
    const reason = window.prompt(
      `Goods return — ${what}, ${kg(r.weight)} kg, challan ${r.challan_no || "—"}?\n\n` +
        "This roll alone is posted back out of stock as a negative entry. The rest of the " +
        "receipt is untouched, and the record of it arriving stays.\n\n" +
        "Reason (optional):",
      "",
    );
    if (reason === null) return; // cancelled the prompt
    try {
      const res = await grCall({ inward: r.inward, items: [r.row_id], reason });
      const m = res?.message;
      await mutate();
      toast(m ? `GR ${m.gr} posted — ${kg(m.returned_weight)} kg returned` : `GR posted for ${what}`);
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  /** Cancel the whole receipt — the destructive counterpart to a GR, and a different
   *  statement from it.
   *
   *  A GR says the rolls arrived and went back: the receipt stays, and a negative entry
   *  nets it off. CANCEL says the receipt should never have been posted at all — a
   *  duplicate, or the wrong challan keyed — so it is reversed outright: the stock it
   *  added comes off, the ledger gets its reversing entries, and unused lot numbers are
   *  handed back. The document stays on the register, struck through and marked
   *  Cancelled, because a number that was issued stays issued.
   *
   *  Refused once the material has moved: dispatched on a challan, or gone to cutting. In
   *  both cases the stock this would pull back is no longer there to pull.
   *
   *  Whole-receipt, so it sits on the inward's first row beside its status — not on each
   *  roll, where it would read as "delete this roll". Returning ONE roll is what GR is. */
  async function onCancelInward(inward: string, rolls: number) {
    if (!window.confirm(
      `Cancel inward ${inward}?\n\n` +
      `All ${rolls} roll(s) on it come back OUT of stock and the ledger is reversed. ` +
      "The receipt stays on this register, marked Cancelled.\n\n" +
      "If the rolls really did arrive and are going back to the supplier, use GR instead — " +
      "that keeps the receipt true and nets the quantity off.\n\n" +
      "This cannot be undone.",
    )) return;
    try {
      await cancelCall({ inward });
      await mutate();
      toast(`Inward ${inward} cancelled — its stock has been reversed`);
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

  // Raising a GR and correcting a roll are FLOOR actions: whoever finds the bad roll or the
  // wrong challan number fixes it. Only the admin-only control beside them — overriding a
  // challan's Complete/Partial status — stays behind the admin check.
  const admin = isAdmin();
  const cols = 9;
  const soOptions = (orderOpts.data?.message ?? []).map((o) => ({
    value: o.sales_order,
    label: o.sales_order,
    meta: [o.party_name, o.company_name].filter(Boolean).join(" · ") || undefined,
    group: o.open ? "Open" : "Closed",
  }));

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
          setParty(""); setLot(""); setJobWork(""); setPending("");
          setApplied({ challan: "", from: "", to: "", company: "", item: "", party: "", lot: "", jobWork: "", pending: "" });
          setPage(1);
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
        {/* Pending = the challan is still open, i.e. the receipt was posted Partial and the
            shop expects more against it. Cancelled receipts and GR rows are left out by the
            server: neither is waiting on anything. */}
        <Filter label="Pending">
          <SearchSelect value={pending} placeholder="All receipts"
            options={[{ value: "1", label: "Pending only (Partial)" }]}
            onChange={setPending} />
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
              {pageRows.map((r, i) => {
                const cancelled = r.docstatus === 2;
                // Rows of one inward sit together (creation order), so its name and the
                // actions that act on the WHOLE inward are shown once, on its first row.
                // Judged WITHIN the page: an inward split across a page break would
                // otherwise lose its status chip and its Cancel button on the second half.
                const firstOfInward = i === 0 || pageRows[i - 1].inward !== r.inward;
                const rollsHere = rows.filter((x) => x.inward === r.inward).length;
                const editable = !!r.can_edit;
                const onEdit = editing === r.row_id;
                return (
                  <tr key={r.row_id}
                    className={cancelled ? "mm-row-cancelled" : r.is_gr ? "mm-row-gr" : r.gr_returned ? "mm-row-returned" : undefined}>
                    <td>
                      {onEdit ? (
                        // The challan number belongs to the DELIVERY, not to one roll on it,
                        // so this edit lands on every roll of the receipt. Said out loud
                        // here, because the operator is typing it on a single line.
                        <input className="mm-input mm-input-compact" value={draft.challan_no}
                          placeholder="Ch.No" autoFocus
                          title="Applies to every roll on this receipt"
                          onChange={(e) => setDraft((d) => ({ ...d, challan_no: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(r);
                            if (e.key === "Escape") setEditing(null);
                          }} />
                      ) : (
                        r.challan_no || "—"
                      )}
                    </td>
                    <td className="mm-ow-cell-date">{r.chalan_date || "—"}</td>
                    <td>{r.supplier || <span className="mm-muted">—</span>}</td>
                    <td>
                      {onEdit ? (
                        <SearchSelect value={draft.customer_order} placeholder="— no order —" compact
                          options={soOptions}
                          onChange={(v) => setDraft((d) => ({ ...d, customer_order: v }))} />
                      ) : r.customer_order ? (
                        <span className="mm-ow-cell-order">{r.customer_order}</span>
                      ) : (
                        <span className="mm-muted">—</span>
                      )}
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
                        <div className="mm-irep-acts" title={r.inward}>
                          {/* The receipt's own state, and the admin override of it, belong to
                              the INWARD — shown once, on its first row. */}
                          {firstOfInward && (
                            cancelled ? (
                              <span className="mm-state-chip mm-state-open">Cancelled</span>
                            ) : r.is_gr ? (
                              <span className="mm-state-chip mm-state-open" title={r.gr_against ? `Return against ${r.gr_against}` : undefined}>
                                GR entry
                              </span>
                            ) : admin ? (
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
                            )
                          )}
                          {/* Cancel the RECEIPT. Offered once per inward, next to its
                              status, because that is its scope — GR beside it is the
                              per-roll action. Gone once the inward is cancelled or is
                              itself a return. */}
                          {firstOfInward && !cancelled && !r.is_gr && (
                            <button
                              type="button"
                              className="mm-mini mm-mini-danger"
                              disabled={cancelling}
                              aria-label={`Cancel inward ${r.inward}`}
                              title={`Cancel ${r.inward} — take all its rolls back out of stock. Use GR instead if the material really arrived.`}
                              onClick={() => void onCancelInward(r.inward, rollsHere)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}

                          {/* GR and Edit are per ROLL, so they sit on every row that can
                              still take them — not on the receipt's first row. A roll that
                              has gone to cutting offers neither, and says why. */}
                          {onEdit ? (
                            <>
                              <button type="button" className="mm-mini" disabled={saving}
                                aria-label="Save this correction" title="Save"
                                onClick={() => void saveEdit(r)}>
                                <Check size={13} />
                              </button>
                              <button type="button" className="mm-mini" disabled={saving}
                                aria-label="Discard this correction" title="Cancel"
                                onClick={() => setEditing(null)}>
                                <X size={13} />
                              </button>
                            </>
                          ) : editable ? (
                            <>
                              {/* GR, not Cancel: the roll DID arrive. The return posts a
                                  negative entry and the receipt stays on the record. */}
                              <button
                                type="button"
                                className="mm-mini mm-mini-warn"
                                disabled={returning}
                                aria-label={`Goods return for roll ${r.roll_name || r.item || ""}`}
                                title={`Return this roll — ${kg(r.weight)} kg back out of stock`}
                                onClick={() => void onGRRoll(r)}
                              >
                                GR
                              </button>
                              <button
                                type="button"
                                className="mm-mini"
                                aria-label={`Correct roll ${r.roll_name || r.item || ""}`}
                                title="Correct the challan number (whole receipt) or the order this roll is for"
                                onClick={() => startEdit(r)}
                              >
                                <Pencil size={13} />
                              </button>
                            </>
                          ) : r.block_reason && !cancelled && !r.is_gr ? (
                            <span className="mm-muted mm-irep-blocked" title={r.block_reason}>
                              {r.cutting ? "in cutting" : "locked"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Two different "more"s, deliberately kept apart: the page buttons walk what has
            already been fetched, while Load more raises the server's own cap. */}
        <Pager total={rows.length} start={start} pages={pages} current={current}
          onPage={setPage} noun="rolls">
          {maybeMore && (
            <button type="button" className="mm-mini" title="Fetch more rolls from the server"
              onClick={() => setLimit((n) => n + 500)}>
              Load more
            </button>
          )}
        </Pager>
      </section>
    </div>
  );
}
