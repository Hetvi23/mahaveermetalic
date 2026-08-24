import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Disc3, ScrollText, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { Filter, ReportFilters } from "@/components/ReportFilters";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";
const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 86400000).toISOString().slice(0, 10);
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const qty = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Roll = { color_name?: string; cut?: string; weight?: number; roll_no?: string | null };
type JobIn = { challan: string; challan_no: string; date?: string | null; weight: number; bobbin: number };
type Bob = { bobbin: string; qty: number; weight: number };
type Row = {
  job_out: string; bill_no: string; date?: string | null; party?: string; party_name?: string;
  rolls: Roll[]; bobbins_out: Bob[]; job_ins: JobIn[];
  out_weight: number; in_weight: number; balance_weight: number;
  bobbin_out: number; bobbin_in: number; bobbin_difference: number;
  settled: boolean;
};
type Hisab = {
  rows: Row[];
  totals: {
    out_weight: number; in_weight: number; balance_weight: number;
    bobbin_out: number; bobbin_in: number; bobbin_difference: number;
  };
};

/**
 * Job work hisab — the shop's paper register, computed.
 *
 * The register works bill by bill: what went out down the left, every receipt against it
 * down the right, and what is still owed underneath. This is the same for job work, and
 * it is deliberately NOT the party-level job report beside it: bobbins go out with one
 * challan and drift back over several, so the shortfall only means anything against the
 * Job Out somebody can still act on. Summed over a party, a missing dozen disappears into
 * a year's trading.
 */
export default function JobHisabPage() {
  const [party, setParty] = useState("");
  const [from, setFrom] = useState(monthsAgo(3));
  const [to, setTo] = useState(today());
  const [company, setCompany] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [applied, setApplied] = useState({
    party: "", company: "", from: monthsAgo(3), to: today(), openOnly: true,
  });
  const [addingTo, setAddingTo] = useState<Row | null>(null);

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const companies = useFrappeGetCall<{ message: { company_name: string }[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.all_companies", undefined, "mm-all-companies",
  );

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Hisab }>(
    `${API}.job_work_hisab`,
    {
      party: applied.party || undefined,
      company: applied.company || undefined,
      from_date: applied.from || undefined,
      to_date: applied.to || undefined,
      open_only: applied.openOnly ? 1 : 0,
    },
    `job-hisab-${applied.party}-${applied.company}-${applied.from}-${applied.to}-${applied.openOnly}`,
  );
  const rows = useMemo(() => data?.message?.rows ?? [], [data]);
  const totals = data?.message?.totals;

  /** CSV of exactly what is on screen, in the register's own eight columns. */
  function exportCsv() {
    const head = ["Date", "Color Name", "Bill No", "Weight", "In Date", "Challan No", "In Weight", "Bobbin"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body: string[] = [];
    for (const r of rows) {
      const n = Math.max(r.rolls.length, r.job_ins.length, 1);
      for (let i = 0; i < n; i++) {
        const roll = r.rolls[i];
        const ji = r.job_ins[i];
        body.push([
          i === 0 ? r.date ?? "" : "", roll?.color_name ?? "", i === 0 ? r.bill_no : "",
          roll ? roll.weight ?? "" : "",
          ji?.date ?? "", ji?.challan_no ?? "", ji?.weight ?? "", ji?.bobbin ?? "",
        ].map(esc).join(","));
      }
      body.push([`${r.bill_no} balance`, "", "", r.balance_weight, "bobbin sent", r.bobbin_out,
        "back", r.bobbin_in].map(esc).join(","));
    }
    const csv = [head.join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-hisab-${applied.from}-to-${applied.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title"><ScrollText size={18} /> Job work hisab</h1>
          <p className="mm-page-sub">
            One Job Out at a time: the rolls sent on the left, what came back on the right, and
            the bobbins still owed underneath.
          </p>
        </div>
      </header>

      <ReportFilters
        onApply={() => setApplied({ party, company, from, to, openOnly })}
        onReset={() => {
          setParty(""); setCompany(""); setFrom(monthsAgo(3)); setTo(today()); setOpenOnly(true);
          setApplied({ party: "", company: "", from: monthsAgo(3), to: today(), openOnly: true });
        }}
        onPrint={() => window.print()}
        onExport={exportCsv}
        exportDisabled={rows.length === 0}
        note={<>Bobbins are stated per Job Out, where somebody can still act on the shortfall.</>}
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
        <Filter label="Show">
          <SearchSelect value={openOnly ? "open" : "all"}
            options={[{ value: "open", label: "Still outstanding" }, { value: "all", label: "All, settled included" }]}
            onChange={(v) => setOpenOnly(v === "open")} />
        </Filter>
      </ReportFilters>

      {totals && (
        <div className="mm-orep-totals mm-jh-totals">
          <span><b>{rows.length}</b> job outs</span>
          <span><b>{kg(totals.out_weight)}</b> kg sent</span>
          <span><b>{kg(totals.in_weight)}</b> kg back</span>
          <span className={totals.balance_weight > 0 ? "mm-var-over" : undefined}>
            <b>{kg(totals.balance_weight)}</b> kg with the worker
          </span>
          <span className={totals.bobbin_difference > 0 ? "mm-var-over" : undefined}>
            <b>{qty(totals.bobbin_difference)}</b> bobbins owed
          </span>
        </div>
      )}

      {isLoading && <p className="mm-muted">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="mm-empty">Nothing outstanding in this period.</p>
      )}

      {rows.map((r) => {
        const lines = Math.max(r.rolls.length, r.job_ins.length, 1);
        return (
          <section className="mm-card mm-card-pad mm-jh-block" key={r.job_out}>
            <div className="mm-jh-head">
              <span className="mm-jh-bill">Bill {r.bill_no}</span>
              <span className="mm-jh-party">{r.party_name || r.party}</span>
              <span className="mm-jh-date">{r.date || "—"}</span>
              <span className={`mm-pill ${r.settled ? "mm-pill-ok" : "mm-pill-pending"}`}>
                {r.settled ? "Settled" : "Outstanding"}
              </span>
              <button type="button" className="mm-mini mm-no-print" onClick={() => setAddingTo(r)}
                title="Send more bobbins against this Job Out — they join it rather than needing a second challan">
                <Disc3 size={13} /> Add bobbin
              </button>
            </div>

            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense mm-jh-table">
                <thead>
                  <tr>
                    <th colSpan={4} className="mm-jh-side">Sent — Job Out</th>
                    <th colSpan={4} className="mm-jh-side">Back — Job In</th>
                  </tr>
                  <tr>
                    <th>Date</th><th>Color Name</th><th>Bill No</th><th className="mm-num">Weight</th>
                    <th>Date</th><th>Challan No</th><th className="mm-num">Weight</th><th className="mm-num">Bobbin</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: lines }).map((_, i) => {
                    const roll = r.rolls[i];
                    const ji = r.job_ins[i];
                    return (
                      <tr key={i}>
                        {/* The bill's own date and number are stated once, the way the
                            register writes them — repeating them down every roll would
                            read as several bills. */}
                        <td className="mm-jh-date-cell">{i === 0 ? r.date || "—" : ""}</td>
                        <td title={roll?.roll_no || ""}>
                          {roll ? (
                            <>
                              <span className="mm-colour-name">{roll.color_name || "—"}</span>
                              {roll.roll_no ? <span className="mm-suggest-meta"> {roll.roll_no}</span> : null}
                            </>
                          ) : ""}
                        </td>
                        <td>{i === 0 ? r.bill_no : ""}</td>
                        <td className="mm-num">{roll ? kg(roll.weight) : ""}</td>
                        <td className="mm-jh-date-cell mm-jh-in">{ji?.date || (i === 0 && !ji ? "—" : "")}</td>
                        <td className="mm-jh-in">{ji?.challan_no || ""}</td>
                        <td className="mm-num mm-jh-in">{ji ? kg(ji.weight) : ""}</td>
                        <td className="mm-num mm-jh-in">{ji ? qty(ji.bobbin) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><strong>Total</strong></td>
                    <td className="mm-num"><strong>{kg(r.out_weight)}</strong></td>
                    <td colSpan={2} />
                    <td className="mm-num"><strong>{kg(r.in_weight)}</strong></td>
                    <td className="mm-num"><strong>{qty(r.bobbin_in)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* The two things the register exists to answer. */}
            <div className="mm-jh-foot">
              <span className={r.balance_weight > 0 ? "mm-var-over" : undefined}>
                Still with the worker <b>{kg(r.balance_weight)}</b> kg
              </span>
              <span title={r.bobbins_out.map((b) => `${b.bobbin} × ${qty(b.qty)}`).join(", ") || "none sent"}>
                Bobbins <b>{qty(r.bobbin_out)}</b> sent · <b>{qty(r.bobbin_in)}</b> back ·{" "}
                <b className={r.bobbin_difference > 0 ? "mm-var-over" : undefined}>
                  {qty(r.bobbin_difference)}
                </b>{" "}
                {r.bobbin_difference < 0 ? "extra returned" : "owed"}
              </span>
            </div>
          </section>
        );
      })}

      {addingTo && (
        <AddBobbinModal row={addingTo} onClose={() => setAddingTo(null)}
          onDone={() => { setAddingTo(null); void mutate(); }} />
      )}
    </div>
  );
}

/** Send more bobbins against a Job Out that has already gone out. */
function AddBobbinModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [bobbin, setBobbin] = useState("");
  const [n, setN] = useState<number | "">("");
  const [err, setErr] = useState<string | null>(null);
  const { call, loading } = useFrappePostCall(`${API}.add_job_out_bobbins`);
  const masters = useFrappeGetDocList<{ name: string }>("MM Bobbin Master", { fields: ["name"], limit: 0 });

  async function save() {
    if (!bobbin || !(Number(n) > 0)) return setErr("Pick a bobbin and a quantity.");
    setErr(null);
    try {
      await call({ challan: row.job_out, bobbins: JSON.stringify([{ bobbin, qty: Number(n) }]) });
      toast(`${n} × ${bobbin} added to bill ${row.bill_no}`);
      onDone();
    } catch (e) { setErr(extractErrorMessage(e)); }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Add bobbin — bill {row.bill_no}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-page-sub" style={{ marginTop: 0 }}>
            Bobbins follow the material, not the paperwork — these join {row.party_name || row.party}&apos;s
            existing Job Out instead of needing a second challan with no rolls on it.
            Currently sent: <strong>{qty(row.bobbin_out)}</strong>, back <strong>{qty(row.bobbin_in)}</strong>.
          </p>
          <label className="mm-field">
            <span className="mm-field-label">Bobbin</span>
            <SearchSelect value={bobbin} onChange={setBobbin} placeholder="— bobbin —"
              options={(masters.data ?? []).map((b) => ({ value: b.name, label: b.name }))} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Quantity</span>
            <input className="mm-input" type="number" min={0} value={n} autoFocus
              onChange={(e) => setN(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void save()}>
            {loading ? "Adding…" : "Add bobbin"}
          </button>
        </div>
      </div>
    </div>
  );
}
