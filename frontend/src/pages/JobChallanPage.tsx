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
  name: string;
  roll_no?: string;
  color_name?: string;
  lot_number?: string;
  location?: string;
  branch?: string;
  stock_weight?: number;
  stock_box?: number;
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

  const isPicked = (name: string) => picked.some((p) => p.name === name);

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
      if (m.party) setParty(m.party);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /** The row button toggles, so a roll added by mistake comes straight back off. */
  function toggleRoll(r: StockRoll) {
    setPicked((prev) =>
      prev.some((p) => p.name === r.name)
        ? prev.filter((p) => p.name !== r.name)
        : [...prev, { ...r, cut: "", weight: Number(r.stock_weight || 0) }],
    );
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
        rolls: JSON.stringify(picked.map((r) => ({ roll_inventory: r.name, weight: r.weight, cut: r.cut }))),
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
                    <th>Date</th><th>Roll</th><th className="mm-num">Weight (Kg)</th><th />
                  </tr>
                </thead>
                <tbody>
                  {stockCall.isLoading && <tr><td colSpan={4} className="mm-muted">Loading…</td></tr>}
                  {!stockCall.isLoading && stockRows.length === 0 && (
                    <tr><td colSpan={4} className="mm-empty">
                      {filtered ? "No roll matches these filters." : "No rolls in stock."}
                    </td></tr>
                  )}
                  {stockRows.map((r) => {
                    const on = isPicked(r.name);
                    return (
                      <tr key={r.name} className={on ? "mm-job-row-picked" : ""}>
                        <td className="mm-job-date">{r.challan_date || "—"}</td>
                        <td>
                          <span className="mm-colour-name">{r.color_name || r.roll_no || "—"}</span>
                          {r.lot_number && <span className="mm-suggest-meta"> {r.lot_number}</span>}
                        </td>
                        <td className="mm-num">{kg(Number(r.stock_weight || 0))}</td>
                        <td className="mm-num">
                          <button type="button" className={`mm-mini ${on ? "" : "mm-mini-ok"}`}
                            onClick={() => toggleRoll(r)} title={on ? "Remove from challan" : "Add to challan"}>
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

        {/* ── RIGHT: the challan being built (stays in view while the list scrolls) ── */}
        <div className="mm-job-col mm-job-col-sticky">
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
        </div>
      </div>

      <div className="mm-job-foot">
        <div className="mm-job-foot-nums">
          <span className="mm-job-stat"><b>{totals.qty}</b> qty</span>
          <span className="mm-job-stat mm-job-stat-hero"><b>{kg(totals.weight)}</b> kg</span>
          <span className="mm-job-stat"><b>{totals.bobbins}</b> bobbins</span>
        </div>
        <button type="button" className="mm-btn-primary mm-job-submit" disabled={submitting} onClick={() => void onSubmit()}>
          {submitting ? "Submitting…" : `Submit ${type}`}
          {outward ? <ArrowUpFromLine size={16} /> : <ArrowDownFromLine size={16} />}
        </button>
      </div>
    </div>
  );
}
