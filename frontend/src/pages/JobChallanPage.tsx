import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

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
 * worker, Job In receives them back). Mirrors the legacy layout: pick from the left,
 * build the challan on the right, totals and Submit along the bottom.
 */
export default function JobChallanPage({ type }: { type: "Job Out" | "Job In" }) {
  const [challanDate, setChallanDate] = useState(today());
  const [party, setParty] = useState("");
  const [challanNo, setChallanNo] = useState("");
  const [picked, setPicked] = useState<PickedRoll[]>([]);
  const [bobbins, setBobbins] = useState<PickedBobbin[]>([]);
  const [bobbin, setBobbin] = useState("");
  const [bobbinQty, setBobbinQty] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  // Left list filters + pagination (the legacy screen pages 10 at a time).
  const [fDate, setFDate] = useState("");
  const [fItem, setFItem] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const items = useFrappeGetDocList<{ name: string }>("MM Item Master", { fields: ["name"], limit: 0 });
  const bobbinMasters = useFrappeGetDocList<{ name: string }>("MM Bobbin Master", { fields: ["name"], limit: 0 });

  const stockCall = useFrappeGetCall<{ message: { rows: StockRoll[]; total: number } }>(
    `${API}.in_stock_rolls`,
    { item: fItem || undefined, challan_date: fDate || undefined, start: (page - 1) * pageSize, page_length: pageSize },
    `job-stock-${fItem}-${fDate}-${page}-${pageSize}`,
  );
  const stockRows = stockCall.data?.message?.rows ?? [];
  const total = stockCall.data?.message?.total ?? 0;
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

  const totals = useMemo(() => ({
    qty: picked.reduce((s, r) => s + Number(r.stock_box || 0), 0),
    weight: picked.reduce((s, r) => s + Number(r.weight || 0), 0),
    bobbins: bobbins.reduce((s, b) => s + Number(b.qty || 0), 0),
  }), [picked, bobbins]);

  function addRoll(r: StockRoll) {
    if (picked.some((p) => p.name === r.name)) return;
    setPicked((prev) => [...prev, { ...r, cut: "", weight: Number(r.stock_weight || 0) }]);
  }
  function addBobbin() {
    const q = Number(bobbinQty) || 0;
    if (!bobbin || q <= 0) return setError("Pick a bobbin and a quantity.");
    setError(null);
    setBobbins((prev) => {
      const at = prev.findIndex((b) => b.bobbin === bobbin);
      if (at < 0) return [...prev, { bobbin, qty: q }];
      const next = [...prev];
      next[at] = { ...next[at], qty: next[at].qty + q };
      return next;
    });
    setBobbin("");
    setBobbinQty("");
  }

  async function onSubmit() {
    setError(null);
    if (!party) return setError("Choose the party.");
    if (picked.length === 0 && bobbins.length === 0) return setError("Add at least one roll or bobbin.");
    try {
      const res = await createJobChallan({
        challan_type: type,
        party,
        challan_date: challanDate,
        challan_no: challanNo || undefined,
        rolls: JSON.stringify(picked.map((r) => ({ roll_inventory: r.name, weight: r.weight, cut: r.cut }))),
        bobbins: JSON.stringify(bobbins),
      });
      const name = res?.message?.challan;
      toast(`${type} challan ${name} submitted`);
      setPicked([]);
      setBobbins([]);
      setChallanNo("");
      void stockCall.mutate();
      void nextNo.mutate();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      toast(msg, "error");
    }
  }

  return (
    <div className="mm-page mm-job">
      <header className="mm-page-head">
        <div>
          <h1>{type}</h1>
          <p className="mm-page-sub">
            {type === "Job Out"
              ? "Send rolls and bobbins out to a job worker. Stock leaves inventory on submit."
              : "Receive job work back. Stock returns to inventory on submit."}
          </p>
        </div>
      </header>

      {error && <p className="mm-error">{error}</p>}

      <div className="mm-job-grid">
        {/* ── LEFT: pick bobbins and in-stock rolls ── */}
        <section className="mm-job-col">
          <div className="mm-job-bar">Add Bobbin</div>
          <div className="mm-card mm-card-pad mm-job-addbobbin">
            <label className="mm-field">
              <span className="mm-field-label">Select Bobbin *</span>
              <SearchSelect
                value={bobbin}
                onChange={setBobbin}
                placeholder="Select Bobbin"
                options={(bobbinMasters.data ?? []).map((b) => ({ value: b.name, label: b.name }))}
              />
            </label>
            <label className="mm-field mm-job-qty">
              <span className="mm-field-label">Qty</span>
              <input className="mm-input" type="number" min={0} value={bobbinQty} placeholder="Qty"
                onChange={(e) => setBobbinQty(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <button type="button" className="mm-btn-primary mm-job-add" onClick={addBobbin} aria-label="Add bobbin">
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="mm-job-bar">In Stock Roll</div>
          <div className="mm-card mm-card-pad">
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th>Chalan Date</th><th>Order</th><th>Roll</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                  <tr className="mm-job-filters">
                    <th><input className="mm-input mm-input-compact" type="date" value={fDate}
                      onChange={(e) => { setFDate(e.target.value); setPage(1); }} /></th>
                    <th />
                    <th>
                      <SearchSelect compact value={fItem} placeholder="Item"
                        options={(items.data ?? []).map((i) => ({ value: i.name, label: i.name }))}
                        onChange={(v) => { setFItem(v); setPage(1); }} />
                    </th>
                    <th /><th />
                  </tr>
                </thead>
                <tbody>
                  {stockCall.isLoading && <tr><td colSpan={5} className="mm-muted">Loading…</td></tr>}
                  {!stockCall.isLoading && stockRows.length === 0 && (
                    <tr><td colSpan={5} className="mm-muted">No rolls in stock.</td></tr>
                  )}
                  {stockRows.map((r) => (
                    <tr key={r.name} className={picked.some((p) => p.name === r.name) ? "mm-job-row-picked" : ""}>
                      <td>{r.challan_date || "—"}</td>
                      <td>—</td>
                      <td>{r.color_name || r.roll_no || "—"}</td>
                      <td className="mm-num">{kg(Number(r.stock_weight || 0))}</td>
                      <td className="mm-num">
                        <button type="button" className="mm-mini mm-mini-ok" onClick={() => addRoll(r)}
                          disabled={picked.some((p) => p.name === r.name)} aria-label="Add roll">
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mm-job-pager">
              <select className="mm-input mm-input-compact mm-job-pagesize" value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="mm-muted">
                Showing {total === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} records
              </span>
              <span className="mm-job-pages">
                <button type="button" className="mm-mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                <span className="mm-pill mm-pill-muted">{page} / {pages}</span>
                <button type="button" className="mm-mini" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>›</button>
              </span>
            </div>
          </div>
        </section>

        {/* ── RIGHT: the challan being built ── */}
        <section className="mm-job-col">
          <div className="mm-job-bar">Add Job Work Chalan</div>
          <div className="mm-card mm-card-pad">
            <div className="mm-form-grid">
              <label className="mm-field">
                <span className="mm-field-label">Chalan Date *</span>
                <input className="mm-input" type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
              </label>
              <label className="mm-field">
                <span className="mm-field-label">Party *</span>
                <SearchSelect
                  value={party}
                  onChange={setParty}
                  placeholder="Select Company"
                  options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))}
                />
              </label>
              <label className="mm-field">
                <span className="mm-field-label">Chalan No *</span>
                <input className="mm-input" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="mm-job-bar">Chalan Rolls</div>
          <div className="mm-card mm-card-pad">
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th>Chalan Date</th><th>Order</th><th>Roll</th><th>Cut</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                </thead>
                <tbody>
                  {picked.length === 0 && <tr><td colSpan={6} className="mm-muted">Pick rolls from the left.</td></tr>}
                  {picked.map((r, i) => (
                    <tr key={r.name}>
                      <td>{r.challan_date || "—"}</td>
                      <td>—</td>
                      <td>{r.color_name || r.roll_no || "—"}</td>
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
          </div>

          <div className="mm-job-bar">Bobbins</div>
          <div className="mm-card mm-card-pad">
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead><tr><th>Bobbin</th><th className="mm-num">Qty</th><th /></tr></thead>
                <tbody>
                  {bobbins.length === 0 && <tr><td colSpan={3} className="mm-muted">No bobbins added.</td></tr>}
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
          </div>
        </section>
      </div>

      <div className="mm-job-foot">
        <span className="mm-pill mm-pill-muted">Total Qty: {totals.qty}</span>
        <span className="mm-pill mm-pill-muted">Total Weight: {kg(totals.weight)}</span>
        <span className="mm-pill mm-pill-muted">Total Bobbins: {totals.bobbins}</span>
        <button type="button" className="mm-btn-primary mm-job-submit" disabled={submitting} onClick={() => void onSubmit()}>
          {submitting ? "Submitting…" : "Submit"} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
