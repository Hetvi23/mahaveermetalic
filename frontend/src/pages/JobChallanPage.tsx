import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import {
  ArrowDownFromLine, ArrowRight, ArrowUpFromLine, Check, Disc3, Package, Plus, Search, Trash2, X,
} from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";
import { printChallan, type ChallanPrintData } from "@/utils/challanPrint";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";
const today = () => new Date().toISOString().slice(0, 10);
const kg = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type StockRoll = {
  /** The INVENTORY row this roll belongs to — what the challan actually deducts from.
   *  Several rolls of one lot share it, so it is NOT the row's identity. */
  name: string;
  /** The roll itself (an MM Inward Item row) — the identity, and what the floor sees. */
  inward_item?: string;
  roll_no?: string;
  color_name?: string;
  lot_number?: string;
  cut?: string;
  location?: string;
  branch?: string;
  customer_order?: string;
  stock_weight?: number;
  stock_box?: number;
  /** What the whole lot still holds, so picking can't send more than exists. */
  lot_stock_weight?: number;
  challan_number?: string;
  challan_date?: string;
};
type PickedRoll = StockRoll & { cut: string; weight: number };
type PickedBobbin = { bobbin: string; qty: number };

/**
 * Job Out / Job In — the same screen and the same record as a sales challan, differing
 * only in type, numbering series and view (Job Out sends rolls and bobbins to a job
 * worker, Job In receives them back). Pick from the left, the challan builds on the
 * right, totals and Submit along the bottom.
 */
/** A Job Out still holding material — one row of the Job In picker. */
type JobOutRow = {
  name: string; challan_no?: string; transaction_date?: string;
  party?: string; party_label?: string; rolls?: string;
  total_weight?: number; total_box?: number;
  received_weight?: number; outstanding_weight?: number;
};

export default function JobChallanPage({ type }: { type: "Job Out" | "Job In" }) {
  const outward = type === "Job Out";
  const [challanDate, setChallanDate] = useState(today());
  const [party, setParty] = useState("");
  const [company, setCompany] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [picked, setPicked] = useState<PickedRoll[]>([]);
  const [bobbins, setBobbins] = useState<PickedBobbin[]>([]);
  const [bobbin, setBobbin] = useState("");
  const [bobbinQty, setBobbinQty] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  // Left list filters + pagination (the legacy screen pages 10 at a time).
  const [fDate, setFDate] = useState("");
  const [fItem, setFItem] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Job In picks a Job Out to answer, and records which one — see againstJobOut below.
  const [fCompany, setFCompany] = useState("");
  const [againstJobOut, setAgainstJobOut] = useState<string | null>(null);
  /** The Job Out being received, for the production voucher's header. */
  const [jobOutMeta, setJobOutMeta] = useState<JobOutRow | null>(null);

  // Job selection is company-first, and the company is findable by its own name OR by the
  // party it sits under — picking one fills in the party it belongs to.
  const companiesCall = useFrappeGetCall<{ message: { company_name: string; party: string; party_name: string }[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.all_companies",
    undefined,
    "mm-all-companies",
  );
  const companies = companiesCall.data?.message ?? [];
  const items = useFrappeGetDocList<{ name: string }>("MM Item Master", { fields: ["name"], limit: 0 });
  const bobbinMasters = useFrappeGetDocList<{ name: string }>("MM Bobbin Master", { fields: ["name"], limit: 0 });

  const stockCall = useFrappeGetCall<{ message: { rows: StockRoll[]; total: number } }>(
    `${API}.in_stock_rolls`,
    {
      item: fItem || undefined, challan_date: fDate || undefined, search: q.trim() || undefined,
      start: (page - 1) * pageSize, page_length: pageSize,
    },
    outward ? `job-stock-${fItem}-${fDate}-${q.trim()}-${page}-${pageSize}` : null,
  );
  const stockRows = stockCall.data?.message?.rows ?? [];

  /**
   * Job In picks from the Job Outs still with a worker, not from stock.
   *
   * Stock is what a Job Out SENT — offering it again on the way back would have the
   * receiving screen list the very rolls that already left. What Job In answers is an
   * outstanding Job Out, so that is what it lists.
   */
  const jobOutsCall = useFrappeGetCall<{ message: { rows: JobOutRow[]; total: number } }>(
    `${API}.in_progress_job_outs`,
    {
      challan_date: fDate || undefined, challan_no: q.trim() || undefined,
      company: fCompany || undefined, item: fItem || undefined,
      start: (page - 1) * pageSize, page_length: pageSize,
    },
    outward ? null : `job-outs-${fDate}-${q.trim()}-${fCompany}-${fItem}-${page}-${pageSize}`,
  );
  const jobOutRows = jobOutsCall.data?.message?.rows ?? [];

  const total = outward ? (stockCall.data?.message?.total ?? 0) : (jobOutsCall.data?.message?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const nextNo = useFrappeGetCall<{ message: string }>(
    `${API}.next_job_challan_no`, { challan_type: type }, `job-no-${type}`,
  );
  useEffect(() => {
    if (!challanNo && nextNo.data?.message) setChallanNo(String(nextNo.data.message));
  }, [nextNo.data, challanNo]);

  const { call: createJobChallan, loading: submitting } = useFrappePostCall<{
    message: { challan: string; rolls: number; bobbins: number; total_weight: number };
  }>(`${API}.create_job_challan`);
  const { call: fetchPrint } = useFrappePostCall<{ message: ChallanPrintData }>(`${API}.challan_for_print`);

  const totals = useMemo(() => ({
    qty: picked.reduce((s, r) => s + Number(r.stock_box || 0), 0),
    weight: picked.reduce((s, r) => s + Number(r.weight || 0), 0),
    bobbins: bobbins.reduce((s, b) => s + Number(b.qty || 0), 0),
  }), [picked, bobbins]);

  const rollKey = (r: { inward_item?: string; name: string }) => r.inward_item || r.name;
  const isPicked = (key: string) => picked.some((p) => rollKey(p) === key);

  /**
   * A Job Out carries ONE colour.
   *
   * The worker is sent one shade and sends it back as one shade; two on a single challan
   * cannot be told apart coming in, because a Job In reconciles against the Job Out's
   * total weight and nothing on it records which part was which. So the first roll picked
   * fixes the challan's colour and the rest of the list stops being selectable — refused
   * here and again server-side.
   */
  const lockedColour = outward ? (picked.find((p) => p.color_name)?.color_name ?? "") : "";
  const blockedByColour = (r: StockRoll) =>
    outward && !!lockedColour && !isPicked(rollKey(r)) && (r.color_name || "") !== lockedColour;

  const { call: fetchJobOut } = useFrappePostCall<{
    message: { challan: string; party: string; rows: { roll_inventory: string; color_name?: string; cut?: string; qty_box?: number; weight?: number }[] };
  }>(`${API}.job_out_rolls`);

  /**
   * Bring one Job Out back in: its rolls become the Job In's lines and the challan
   * records which Job Out it answers.
   *
   * One at a time on purpose. A Job In is a receipt against a Job Out, so mixing two
   * would leave neither properly accounted for — picking a second replaces the first
   * rather than adding to it.
   */
  async function pullJobOut(r: JobOutRow) {
    setError(null);
    try {
      const res = await fetchJobOut({ challan: r.name });
      const m = res?.message;
      if (!m) return;
      setPicked(m.rows.filter((x) => x.roll_inventory).map((x) => ({
        name: x.roll_inventory,
        roll_no: x.color_name || "",
        color_name: x.color_name,
        cut: x.cut || "",
        stock_box: Number(x.qty_box || 0),
        stock_weight: Number(x.weight || 0),
        weight: Number(x.weight || 0),
      } as PickedRoll)));
      setAgainstJobOut(m.challan);
      setJobOutMeta(r);
      if (m.party) setParty(m.party);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /** The row button toggles, so a roll added by mistake comes straight back off. */
  function toggleRoll(r: StockRoll) {
    if (blockedByColour(r)) {
      setError(
        `This challan is for ${lockedColour}. ${r.color_name || "That roll"} needs its own Job Out — ` +
        "one colour per challan, or a Job In can't be reconciled against it.",
      );
      return;
    }
    setError(null);
    setPicked((prev) => {
      const key = rollKey(r);
      if (prev.some((p) => rollKey(p) === key)) return prev.filter((p) => rollKey(p) !== key);
      // A lot cannot send out more than it holds: several rolls share one inventory row,
      // and the challan deducts from that row, so the picks are checked against it together.
      const already = prev
        .filter((p) => p.name === r.name)
        .reduce((sum, p) => sum + Number(p.weight || 0), 0);
      const lot = Number(r.lot_stock_weight ?? r.stock_weight ?? 0);
      const want = Number(r.stock_weight || 0);
      if (lot > 0 && already + want > lot + 0.001) {
        setError(
          `Lot ${r.lot_number || ""} holds ${kg(lot)} kg and ${kg(already)} kg of it is already on this challan — ` +
          `${r.roll_no || "this roll"} would take it past that.`,
        );
        return prev;
      }
      return [...prev, { ...r, cut: r.cut || "", weight: want }];
    });
  }
  function addBobbin() {
    const n = Number(bobbinQty) || 0;
    if (!bobbin || n <= 0) return setError("Pick a bobbin and a quantity.");
    setError(null);
    setBobbins((prev) => {
      const at = prev.findIndex((b) => b.bobbin === bobbin);
      if (at < 0) return [...prev, { bobbin, qty: n }];
      const next = [...prev];
      next[at] = { ...next[at], qty: next[at].qty + n };
      return next;
    });
    setBobbin("");
    setBobbinQty("");
  }
  function clearChallan() {
    setAgainstJobOut(null);
    setJobOutMeta(null);
    setPicked([]);
    setBobbins([]);
    setError(null);
  }

  async function onSubmit() {
    setError(null);
    if (!company) return setError("Choose the company — job work is selected company-wise.");
    if (!party) return setError("That company has no party on file.");
    if (picked.length === 0 && bobbins.length === 0) return setError("Add at least one roll or bobbin.");
    try {
      const res = await createJobChallan({
        challan_type: type,
        party,
        challan_date: challanDate,
        challan_no: challanNo || undefined,
        rolls: JSON.stringify(picked.map((r) => ({
          roll_inventory: r.name, weight: r.weight, cut: r.cut,
          sales_order: r.customer_order || undefined,
        }))),
        bobbins: JSON.stringify(bobbins),
        // Which Job Out this receipt answers — the server ignores it on a Job Out.
        against_job_out: againstJobOut || undefined,
      });
      const name = res?.message?.challan;
      toast(`${type} challan ${name} submitted`);
      // The goods leave with the paperwork — print A4 (Original / Duplicate) immediately.
      if (name) {
        try {
          const p = await fetchPrint({ challan: name });
          if (p?.message) printChallan(p.message);
        } catch { /* print is best-effort; the challan is already submitted */ }
      }
      clearChallan();
      setChallanNo("");
      void stockCall.mutate();
      // The Job Out just received is no longer outstanding — refresh so it drops off.
      void jobOutsCall.mutate();
      void nextNo.mutate();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      toast(msg, "error");
    }
  }

  const filtered = !!(q.trim() || fItem || fDate);

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">
            {outward ? <ArrowUpFromLine size={18} /> : <ArrowDownFromLine size={18} />} {type}
          </h1>
          <p className="mm-page-sub">
            {outward
              ? "Send rolls and bobbins out to a job worker. Stock leaves inventory on submit."
              : "Receive job work back. Stock returns to inventory on submit."}
          </p>
        </div>
        <div className="mm-ws-toolbar-right">
          <span className={`mm-pill ${outward ? "mm-pill-pending" : "mm-pill-ok"}`}>
            {outward ? "Stock goes out" : "Stock comes back"}
          </span>
        </div>
      </header>

      {error && <p className="mm-error">{error}</p>}

      <div className="mm-job-grid">
        {/* ── LEFT: pick bobbins and in-stock rolls ── */}
        <div className="mm-job-col">
          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title"><Disc3 size={15} /> Add bobbin</h2>
            </div>
            <div className="mm-job-addbobbin">
              <label className="mm-field">
                <span className="mm-field-label">Bobbin</span>
                <SearchSelect
                  value={bobbin}
                  onChange={setBobbin}
                  placeholder="Select bobbin"
                  options={(bobbinMasters.data ?? []).map((b) => ({ value: b.name, label: b.name }))}
                />
              </label>
              <label className="mm-field">
                <span className="mm-field-label">Qty</span>
                <input className="mm-input" type="number" min={0} value={bobbinQty} placeholder="0"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBobbin(); } }}
                  onChange={(e) => setBobbinQty(e.target.value === "" ? "" : Number(e.target.value))} />
              </label>
              <button type="button" className="mm-btn-secondary mm-job-add" onClick={addBobbin}>
                <Plus size={15} /> Add
              </button>
            </div>
          </section>

          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title">
                <Package size={15} /> {outward ? "In stock roll" : "In progress job outs"}
                {lockedColour && (
                  <span className="mm-pill mm-pill-pending mm-job-lock"
                    title="A Job Out carries one colour — clear the challan to start another">
                    {lockedColour} only
                  </span>
                )}
              </h2>
              <span className="mm-pill mm-pill-muted">{total}</span>
            </div>

            {!outward ? (
              <>
                {/* Filters sit in the table head, one under each column it filters —
                    the way the book the floor already works from lays them out. */}
                <div className="mm-table-scroll">
                  <table className="mm-table mm-table-dense mm-table-hover mm-job-outs">
                    <thead>
                      <tr><th>C.Date</th><th>C.No</th><th>Party</th><th>Roll</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                      <tr className="mm-job-filterrow">
                        <th>
                          <input className="mm-input mm-input-compact" type="date" value={fDate}
                            onChange={(e) => { setFDate(e.target.value); setPage(1); }} />
                        </th>
                        <th>
                          <input className="mm-input mm-input-compact" placeholder="Ch.No" value={q}
                            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
                        </th>
                        <th>
                          <SearchSelect compact value={fCompany} placeholder="Company"
                            options={companies.map((c) => ({ value: c.company_name, label: c.company_name, meta: c.party_name }))}
                            onChange={(v) => { setFCompany(v); setPage(1); }} />
                        </th>
                        <th>
                          <SearchSelect compact value={fItem} placeholder="Item"
                            options={(items.data ?? []).map((i) => ({ value: i.name, label: i.name }))}
                            onChange={(v) => { setFItem(v); setPage(1); }} />
                        </th>
                        <th /><th />
                      </tr>
                    </thead>
                    <tbody>
                      {jobOutsCall.isLoading && <tr><td colSpan={6} className="mm-muted">Loading…</td></tr>}
                      {!jobOutsCall.isLoading && jobOutRows.length === 0 && (
                        <tr><td colSpan={6} className="mm-empty">Nothing is out with a worker.</td></tr>
                      )}
                      {jobOutRows.map((r) => (
                        <tr key={r.name} className={againstJobOut === r.name ? "mm-job-row-picked" : ""}>
                          <td className="mm-job-date">{r.transaction_date || "—"}</td>
                          <td>{r.challan_no || r.name}</td>
                          <td>{r.party_label || r.party || "—"}</td>
                          <td><span className="mm-colour-name">{r.rolls || "—"}</span></td>
                          <td className="mm-num">
                            {kg(Number(r.outstanding_weight || 0))}
                            {/* A part-received Job Out says so, or the smaller figure
                                reads as the challan having been raised light. */}
                            {Number(r.received_weight || 0) > 0 && (
                              <span className="mm-suggest-meta"> of {kg(Number(r.total_weight || 0))}</span>
                            )}
                          </td>
                          <td className="mm-num">
                            <button type="button"
                              className={`mm-btn-icon ${againstJobOut === r.name ? "" : "mm-btn-icon-danger"}`}
                              title={againstJobOut === r.name ? "Already loaded into this Job In" : "Bring this Job Out back in"}
                              aria-label={`Receive job out ${r.challan_no || r.name}`}
                              onClick={() => void pullJobOut(r)}>
                              {againstJobOut === r.name ? <Check size={15} /> : <ArrowRight size={15} />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
            <>
            <div className="mm-job-filters-row">
              <div className="mm-search-wrap mm-job-search">
                <Search size={15} className="mm-search-icon" aria-hidden />
                <input className="mm-input mm-search-pill" placeholder="Search roll, colour or lot…"
                  value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </div>
              <SearchSelect compact value={fItem} placeholder="All items"
                options={(items.data ?? []).map((i) => ({ value: i.name, label: i.name }))}
                onChange={(v) => { setFItem(v); setPage(1); }} />
              <input className="mm-input mm-input-compact mm-job-datefilter" type="date" value={fDate}
                onChange={(e) => { setFDate(e.target.value); setPage(1); }} />
              {filtered && (
                <button type="button" className="mm-mini"
                  onClick={() => { setQ(""); setFItem(""); setFDate(""); setPage(1); }}>Clear</button>
              )}
            </div>

            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense mm-table-hover">
                <thead>
                  <tr>
                    {/* Order can be filled now the list is roll-wise: a roll knows the
                        order it came in against; an inventory row never did. */}
                    <th>Date</th><th>Order</th><th>Roll</th><th className="mm-num">Weight (Kg)</th><th />
                  </tr>
                </thead>
                <tbody>
                  {stockCall.isLoading && <tr><td colSpan={5} className="mm-muted">Loading…</td></tr>}
                  {!stockCall.isLoading && stockRows.length === 0 && (
                    <tr><td colSpan={5} className="mm-empty">
                      {filtered ? "No roll matches these filters." : "No rolls in stock."}
                    </td></tr>
                  )}
                  {stockRows.map((r) => {
                    const on = isPicked(rollKey(r));
                    // Another colour, once this challan has one: shown but not selectable,
                    // so the rule is visible rather than a refusal after the click.
                    const off = blockedByColour(r);
                    return (
                      <tr key={rollKey(r)} className={`${on ? "mm-job-row-picked" : ""} ${off ? "mm-job-row-offcolour" : ""}`}>
                        <td className="mm-job-date">{r.challan_date || "—"}</td>
                        <td className="mm-job-order">{r.customer_order || "—"}</td>
                        <td title={`${r.roll_no || ""}${r.lot_number ? ` · lot ${r.lot_number}` : ""}${r.challan_number ? ` · challan ${r.challan_number}` : ""}`}>
                          <span className="mm-colour-name">{r.color_name || "—"}</span>
                          {r.roll_no && <span className="mm-suggest-meta"> {r.roll_no}</span>}
                          {r.lot_number && <span className="mm-suggest-meta"> {r.lot_number}</span>}
                        </td>
                        <td className="mm-num">{kg(Number(r.stock_weight || 0))}</td>
                        <td className="mm-num">
                          <button type="button" className={`mm-mini ${on ? "" : off ? "" : "mm-mini-ok"}`}
                            disabled={off}
                            onClick={() => toggleRoll(r)}
                            title={off
                              ? `This challan is for ${lockedColour} — ${r.color_name || "this roll"} needs its own Job Out`
                              : on ? "Remove from challan" : "Add to challan"}>
                            {on ? <><Check size={13} /> Added</> : <>Add</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            </>
            )}

            <div className="mm-job-pager">
              <select className="mm-input mm-input-compact mm-job-pagesize" value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="mm-muted">
                {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} of {total}
              </span>
              <span className="mm-job-pages">
                <button type="button" className="mm-mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                <span className="mm-pill mm-pill-muted">{page} / {pages}</span>
                <button type="button" className="mm-mini" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>›</button>
              </span>
            </div>
          </section>
        </div>

        {/* ── RIGHT: what is being built.
             Job Out builds a CHALLAN of rolls. Job In builds a PRODUCTION VOUCHER: material
             sent to a worker does not come back as rolls, it comes back wound into boxes
             with barcodes and bobbins, exactly like something made in-house. ── */}
        <div className="mm-job-col mm-job-col-sticky">
          {!outward ? (
            <JobInVoucher
              jobOut={againstJobOut}
              meta={jobOutMeta}
              party={party}
              onDone={() => {
                clearChallan();
                void jobOutsCall.mutate();
                void nextNo.mutate();
              }}
            />
          ) : (<>
          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title">Job work challan</h2>
              {(picked.length > 0 || bobbins.length > 0) && (
                <button type="button" className="mm-mini" onClick={clearChallan}><Trash2 size={13} /> Clear</button>
              )}
            </div>
            <div className="mm-job-head-grid">
              <label className="mm-field">
                <span className="mm-field-label">Chalan date *</span>
                <input className="mm-input" type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
              </label>
              <label className="mm-field">
                <span className="mm-field-label">Chalan no *</span>
                <input className="mm-input" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
              </label>
              <label className="mm-field mm-job-company">
                <span className="mm-field-label">Company *</span>
                <SearchSelect
                  value={company}
                  onChange={(v) => {
                    setCompany(v);
                    setParty(companies.find((c) => c.company_name === v)?.party || "");
                  }}
                  required
                  placeholder="Search company or party…"
                  options={companies.map((c) => ({ value: c.company_name, label: c.company_name, meta: c.party_name }))}
                />
                {party && <span className="mm-job-partyhint">Party: <strong>{party}</strong></span>}
              </label>
            </div>
          </section>

          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title">Chalan rolls</h2>
              <span className="mm-pill mm-pill-muted">{picked.length}</span>
            </div>
            {picked.length === 0 ? (
              <p className="mm-empty">Add rolls from the stock list on the left.</p>
            ) : (
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense mm-ow-items-table">
                  <thead>
                    <tr><th>Roll</th><th>Cut</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                  </thead>
                  <tbody>
                    {picked.map((r, i) => (
                      <tr key={r.name}>
                        <td>
                          <span className="mm-colour-name">{r.color_name || r.roll_no || "—"}</span>
                          <span className="mm-suggest-meta">{r.challan_date || ""}</span>
                        </td>
                        <td>
                          <input className="mm-input mm-input-compact" value={r.cut} placeholder="50/85"
                            onChange={(e) => setPicked((p) => p.map((x, j) => (j === i ? { ...x, cut: e.target.value } : x)))} />
                        </td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.weight}
                            onChange={(e) => setPicked((p) => p.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 0 } : x)))} />
                        </td>
                        <td className="mm-num">
                          <button type="button" className="mm-icon-btn" title="Remove"
                            onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title">Bobbins</h2>
              <span className="mm-pill mm-pill-muted">{bobbins.length}</span>
            </div>
            {bobbins.length === 0 ? (
              <p className="mm-empty">No bobbins added.</p>
            ) : (
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead><tr><th>Bobbin</th><th className="mm-num">Qty</th><th /></tr></thead>
                  <tbody>
                    {bobbins.map((b, i) => (
                      <tr key={b.bobbin}>
                        <td>{b.bobbin}</td>
                        <td className="mm-num">{b.qty}</td>
                        <td className="mm-num">
                          <button type="button" className="mm-icon-btn" title="Remove"
                            onClick={() => setBobbins((p) => p.filter((_, j) => j !== i))}><X size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </>)}
        </div>
      </div>

      {/* Job In carries its own totals and Submit inside the voucher — the rolls that
          would have footed this bar are not what it is recording. */}
      {outward && (
        <div className="mm-job-foot">
          <div className="mm-job-foot-nums">
            <span className="mm-job-stat"><b>{totals.qty}</b> qty</span>
            <span className="mm-job-stat mm-job-stat-hero"><b>{kg(totals.weight)}</b> kg</span>
            <span className="mm-job-stat"><b>{totals.bobbins}</b> bobbins</span>
          </div>
          <button type="button" className="mm-btn-primary mm-job-submit" disabled={submitting} onClick={() => void onSubmit()}>
            {submitting ? "Submitting…" : `Submit ${type}`}
            <ArrowUpFromLine size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Job In voucher (production) ───────────────────────────────────────────────────
   Material sent to a worker comes back WOUND — boxes, barcodes, bobbins — so receiving
   it is a production voucher, not a list of rolls.

   One thing is inverted, and it is the whole reason this is its own screen. In-house the
   box is weighed on the way out and the net is what survives the deductions:
       Net = Gross − Bobbin − Box
   Coming back from a worker the NET is the figure that is measured and matters, and the
   box tare is what falls out of it:
       Box = Gross − Bobbin − Net
   Same four numbers, solved for the other unknown. The server solves it again on submit,
   so what is stored can never be whatever this screen happened to compute. */
type JobInBox = {
  gross: number; qty: number; bobbin: string; bobbinPcs: number; perPcsWeight: number;
  totalBobbin: number; net: number; boxWeight: number;
  boxReturn: boolean; bobbinReturn: boolean;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function JobInVoucher({ jobOut, meta, party, onDone }: {
  jobOut: string | null;
  meta: JobOutRow | null;
  party: string;
  onDone: () => void;
}) {
  const [vDate, setVDate] = useState(today());
  const [cNo, setCNo] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [size, setSize] = useState("");
  const [order, setOrder] = useState("");
  const [boxReturn, setBoxReturn] = useState(false);
  const [bobbinReturn, setBobbinReturn] = useState(false);
  const [boxes, setBoxes] = useState<JobInBox[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { call: create, loading } = useFrappePostCall<{ message: { production: string; job_in: string; net_weight: number; variance_percent: number } }>(
    `${API}.create_job_in_production`,
  );
  const bobbinMasters = useFrappeGetDocList<{ name: string }>("MM Bobbin Master", { fields: ["name"], limit: 0 });

  const totals = useMemo(() => ({
    boxes: boxes.length,
    net: r3(boxes.reduce((s, b) => s + b.net, 0)),
    gross: r3(boxes.reduce((s, b) => s + b.gross, 0)),
  }), [boxes]);
  const sent = Number(meta?.total_weight || 0);

  useEffect(() => { setBoxes([]); setErr(null); setAdding(false); }, [jobOut]);

  async function submit() {
    setErr(null);
    if (!jobOut) return setErr("Pick the Job Out this receipt answers, on the left.");
    if (boxes.length === 0) return setErr("Add at least one box.");
    try {
      const res = await create({
        against_job_out: jobOut,
        customer_order: order || undefined,
        party: party || undefined,
        posting_date: vDate,
        batch_no: batchNo || undefined,
        cut: size || undefined,
        challan_no: cNo || undefined,
        box_return: boxReturn ? 1 : 0,
        bobbin_return: bobbinReturn ? 1 : 0,
        boxes: JSON.stringify(boxes.map((b) => ({
          gross_weight: b.gross, net_weight: b.net, qty: b.qty,
          bobbin: b.bobbin || undefined, bobbin_pcs: b.bobbinPcs, bobbin_pcs_weight: b.perPcsWeight,
          total_bobbin_weight: b.totalBobbin,
          box_return: b.boxReturn ? 1 : 0, bobbin_return: b.bobbinReturn ? 1 : 0,
        }))),
      });
      const m = res?.message;
      toast(`Received — production ${m?.production}, Job In ${m?.job_in}`);
      setBoxes([]); setCNo(""); setBatchNo("");
      onDone();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setErr(msg);
      toast(msg, "error");
    }
  }

  if (!jobOut) {
    return (
      <section className="mm-card mm-card-pad">
        <h2 className="mm-panel-title">Job in voucher (production)</h2>
        <p className="mm-empty" style={{ marginTop: "0.8rem" }}>
          Pick a Job Out on the left. What comes back is entered as boxes — the same voucher
          production uses, with the box weight worked out from the net instead of the other
          way round.
        </p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-card-pad">
      <div className="mm-iw-sec-head">
        <h2 className="mm-panel-title">Job in voucher (production)</h2>
        <span className="mm-pill mm-pill-muted" title={`Job Out ${jobOut}`}>
          {meta?.challan_no || jobOut} · sent {kg(sent)} kg
        </span>
      </div>

      <div className="mm-job-head-grid">
        <label className="mm-field">
          <span className="mm-field-label">V.Date *</span>
          <input className="mm-input" type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} />
        </label>
        <label className="mm-field">
          <span className="mm-field-label">C.No *</span>
          <input className="mm-input" value={cNo} onChange={(e) => setCNo(e.target.value)} placeholder="Challan no" />
        </label>
        <label className="mm-field">
          <span className="mm-field-label">B.No</span>
          <input className="mm-input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Batch no" />
        </label>
        <label className="mm-field">
          <span className="mm-field-label">Size</span>
          <input className="mm-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="50/85" />
        </label>
        <label className="mm-field">
          <span className="mm-field-label">Order</span>
          <input className="mm-input" value={order} onChange={(e) => setOrder(e.target.value)}
            placeholder="Optional — taken from the Job Out when blank" />
        </label>
        <div className="mm-bx-returns" style={{ alignSelf: "end" }}>
          <label className="mm-field-inline">
            <input type="checkbox" checked={boxReturn} onChange={(e) => setBoxReturn(e.target.checked)} />
            <span className="mm-field-label">Box Return</span>
          </label>
          <label className="mm-field-inline">
            <input type="checkbox" checked={bobbinReturn} onChange={(e) => setBobbinReturn(e.target.checked)} />
            <span className="mm-field-label">Bobbin Return</span>
          </label>
        </div>
      </div>

      <div className="mm-pv-boxhead" style={{ marginTop: "0.8rem" }}>
        <span className="mm-field-label" style={{ margin: 0 }}>Boxes ({boxes.length})</span>
        {!adding && (
          <button type="button" className="mm-mini mm-mini-ok" onClick={() => setAdding(true)}>
            <Plus size={13} /> Box
          </button>
        )}
      </div>

      {adding && (
        <JobInBoxForm
          bobbins={(bobbinMasters.data ?? []).map((b) => b.name)}
          defaults={{ box: boxReturn, bobbin: bobbinReturn }}
          prev={boxes[boxes.length - 1]}
          onCancel={() => setAdding(false)}
          onAdd={(b) => setBoxes((p) => [...p, b])}
        />
      )}

      {boxes.length > 0 && (
        <div className="mm-table-scroll" style={{ marginTop: "0.6rem" }}>
          <table className="mm-table mm-table-dense">
            <thead>
              <tr>
                <th>#</th><th className="mm-num">Gr.Wt</th><th className="mm-num">Qty</th>
                <th>Bobbin</th><th className="mm-num">Pcs</th><th className="mm-num">B/Pcs</th>
                <th className="mm-num">Bobbin Wt</th>
                {/* Derived, not typed — the reason this voucher exists. */}
                <th className="mm-num" title="Worked out: Gross − Bobbin − Net">Box Wt</th>
                <th className="mm-num">Net Wt</th><th />
              </tr>
            </thead>
            <tbody>
              {boxes.map((b, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="mm-num">{kg(b.gross)}</td>
                  <td className="mm-num">{b.qty || "—"}</td>
                  <td>{b.bobbin || "—"}</td>
                  <td className="mm-num">{b.bobbinPcs || "—"}</td>
                  <td className="mm-num">{b.perPcsWeight || "—"}</td>
                  <td className="mm-num">{kg(b.totalBobbin)}</td>
                  <td className="mm-num"><strong>{kg(b.boxWeight)}</strong></td>
                  <td className="mm-num">{kg(b.net)}</td>
                  <td className="mm-num">
                    <button type="button" className="mm-mini mm-mini-danger" aria-label={`Remove box ${i + 1}`}
                      onClick={() => setBoxes((p) => p.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}

      <div className="mm-job-foot" style={{ marginTop: "0.8rem" }}>
        <div className="mm-job-foot-nums">
          <span className="mm-job-stat"><b>{totals.boxes}</b> box</span>
          <span className="mm-job-stat mm-job-stat-hero"><b>{kg(totals.net)}</b> kg net</span>
          <span className="mm-job-stat"><b>{kg(totals.gross)}</b> kg gross</span>
          {/* What came back against what went out — the question a job receipt asks. */}
          {sent > 0 && (
            <span className={`mm-job-stat ${totals.net > sent ? "mm-var-over" : ""}`}>
              of <b>{kg(sent)}</b> kg sent
            </span>
          )}
        </div>
        <button type="button" className="mm-btn-primary mm-job-submit" disabled={loading} onClick={() => void submit()}>
          {loading ? "Receiving…" : "Submit Job In"}
          <ArrowDownFromLine size={16} />
        </button>
      </div>
    </section>
  );
}

/** One box, keyed the way it comes back: gross and net measured, tare derived. */
function JobInBoxForm({ bobbins, defaults, prev, onCancel, onAdd }: {
  bobbins: string[];
  defaults: { box: boolean; bobbin: boolean };
  prev?: JobInBox;
  onCancel: () => void;
  onAdd: (b: JobInBox) => void;
}) {
  // Packing repeats box after box, so the bobbin and its per-piece weight carry over from
  // the last one keyed. Only the weights are asked for again — they are what really change.
  const [gross, setGross] = useState<number | "">("");
  const [net, setNet] = useState<number | "">("");
  const [qty, setQty] = useState<number | "">(prev?.qty ?? "");
  const [bobbin, setBobbin] = useState(prev?.bobbin ?? "");
  const [pcs, setPcs] = useState<number | "">(prev?.bobbinPcs ?? "");
  const [perPcs, setPerPcs] = useState<number | "">(prev?.perPcsWeight ?? "");
  const [err, setErr] = useState<string | null>(null);

  const totalBobbin = r3((Number(pcs) || 0) * (Number(perPcs) || 0));
  const boxWeight = r3((Number(gross) || 0) - totalBobbin - (Number(net) || 0));
  const impossible = (Number(gross) || 0) > 0 && boxWeight < 0;

  function add() {
    if (!(Number(gross) > 0)) return setErr("Enter the gross weight.");
    if (!(Number(net) > 0)) return setErr("Enter the net weight — it is what came back.");
    if (impossible) {
      return setErr("Net plus bobbins is more than gross — one of the three is keyed wrong.");
    }
    setErr(null);
    onAdd({
      gross: Number(gross), qty: Number(qty) || 0, bobbin, bobbinPcs: Number(pcs) || 0,
      perPcsWeight: Number(perPcs) || 0, totalBobbin, net: Number(net), boxWeight,
      boxReturn: defaults.box, bobbinReturn: defaults.bobbin,
    });
    setGross(""); setNet("");
  }

  return (
    <div className="mm-bx-panel" style={{ marginTop: "0.6rem" }}>
      <div className="mm-bx">
        <label className="mm-bx-row">
          <span className="mm-bx-label">Total (gross) weight</span>
          <input className="mm-input mm-bx-hi" type="number" value={gross} autoFocus
            onChange={(e) => setGross(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Net weight</span>
          <input className="mm-input mm-bx-hi" type="number" value={net}
            onChange={(e) => setNet(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Qty</span>
          <input className="mm-input" type="number" value={qty}
            onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Bobbin</span>
          <SearchSelect compact value={bobbin} onChange={setBobbin} placeholder="— bobbin —"
            options={bobbins.map((b) => ({ value: b, label: b }))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Pcs</span>
          <input className="mm-input" type="number" value={pcs}
            onChange={(e) => setPcs(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Wt / pc</span>
          <input className="mm-input" type="number" value={perPcs}
            onChange={(e) => setPerPcs(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="mm-bx-row">
          <span className="mm-bx-label">Total bobbin wt</span>
          <input className="mm-input" value={kg(totalBobbin)} readOnly />
        </label>
        {/* The answer, not a field: this is what the voucher is for. */}
        <label className="mm-bx-row mm-bx-row-net">
          <span className="mm-bx-label">Box weight (worked out)</span>
          <input className={`mm-input ${impossible ? "mm-input-warn" : ""}`} value={kg(boxWeight)} readOnly />
        </label>
      </div>
      {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
        <button type="button" className="mm-btn-primary mm-btn-compact" onClick={add}>Add box</button>
        <button type="button" className="mm-btn-ghost mm-btn-compact" onClick={onCancel}>Done</button>
      </div>
    </div>
  );
}
