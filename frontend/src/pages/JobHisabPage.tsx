import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Disc3, ScrollText, X } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { Filter, ReportFilters } from "@/components/ReportFilters";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";
import { monthsAgoISO, todayISO } from "@/utils/localDate";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";
const today = todayISO;
const monthsAgo = monthsAgoISO;
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const qty = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Roll = { color_name?: string; cut?: string; weight?: number; roll_no?: string | null };
type JobIn = { challan: string; challan_no: string; date?: string | null; weight: number; bobbin: number };
type Bob = { bobbin: string; qty: number; weight: number };
export type HisabStatus = "Draft" | "Accountant Approved" | "Admin Approved" | "Billed" | "Completed";
export type Hisab = {
  name: string; job_out: string; status: HisabStatus;
  rate_out?: number; rate_in?: number;
  out_amount?: number; in_amount?: number; markup_percent?: number; total_amount?: number;
  wastage_weight?: number; wastage_percent?: number; wastage_over_limit?: number;
  bill_no?: string | null; cheque?: number;
};
type Row = {
  job_out: string; bill_no: string; date?: string | null; party?: string; party_name?: string;
  rolls: Roll[]; bobbins_out: Bob[]; job_ins: JobIn[];
  out_weight: number; in_weight: number; balance_weight: number;
  bobbin_out: number; bobbin_in: number; bobbin_difference: number;
  settled: boolean;
  /** C = out - in, and 100 x C / out. The material question, answerable before any rate. */
  wastage_weight: number; wastage_percent: number;
  hisab?: Hisab | null;
};
type HisabReport = {
  rows: Row[];
  totals: {
    out_weight: number; in_weight: number; balance_weight: number;
    bobbin_out: number; bobbin_in: number; bobbin_difference: number;
    wastage_weight: number; wastage_percent: number;
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

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: HisabReport }>(
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
          <span><b>{(totals.wastage_percent ?? 0).toFixed(2)}%</b> wastage</span>
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
              {/* Wastage: what did not come back, as a share of what went. Over the limit
                  it is called out here as well as on the hisab — this is the line the
                  shop argues about, and it should not need a panel opened to be read. */}
              <span className={r.hisab?.wastage_over_limit ? "mm-var-over" : undefined}
                title="Job out weight minus job in weight, as a percentage of what went out">
                Wastage <b>{kg(r.wastage_weight)}</b> kg · <b>{(r.wastage_percent ?? 0).toFixed(2)}%</b>
              </span>
              <span title={r.bobbins_out.map((b) => `${b.bobbin} × ${qty(b.qty)}`).join(", ") || "none sent"}>
                Bobbins <b>{qty(r.bobbin_out)}</b> sent · <b>{qty(r.bobbin_in)}</b> back ·{" "}
                <b className={r.bobbin_difference > 0 ? "mm-var-over" : undefined}>
                  {qty(r.bobbin_difference)}
                </b>{" "}
                {r.bobbin_difference < 0 ? "extra returned" : "owed"}
              </span>
            </div>

            <HisabPanel row={r} onChanged={() => void mutate()} />
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

/* ── The settlement, under each Job Out ──────────────────────────────────────────────
 * The register above says what moved. This is what it is worth and who has signed for it:
 *
 *     A = job out weight x rate out
 *     B = job in weight  x rate in
 *     Total = (A - B) + markup%
 *
 * Four steps, two people alternating — the accountant proposes the money and later records
 * the bill; the admin agrees the money and later releases the cheque. The buttons a user
 * cannot press are hidden, but every step is enforced on the server: hiding a button is a
 * courtesy, not a permission.
 */
const HISAB_API = "mahaveermetalic.mahaveer_metallic.api.job_hisab";
const money = (v?: number) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEPS: { status: HisabStatus; label: string }[] = [
  { status: "Draft", label: "Rates" },
  { status: "Accountant Approved", label: "Accountant" },
  { status: "Admin Approved", label: "Admin" },
  { status: "Billed", label: "Bill no" },
  { status: "Completed", label: "Cheque" },
];

function HisabPanel({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const h = row.hisab || null;
  const [open, setOpen] = useState(false);
  const [rateOut, setRateOut] = useState<string>(h?.rate_out ? String(h.rate_out) : "");
  const [rateIn, setRateIn] = useState<string>(h?.rate_in ? String(h.rate_in) : "");
  const [billNo, setBillNo] = useState<string>(h?.bill_no || "");
  const [busy, setBusy] = useState(false);

  const { call: save } = useFrappePostCall(`${HISAB_API}.save_hisab`);
  const { call: acc } = useFrappePostCall(`${HISAB_API}.accountant_approve`);
  const { call: adm } = useFrappePostCall(`${HISAB_API}.admin_approve`);
  const { call: bill } = useFrappePostCall(`${HISAB_API}.enter_bill`);
  const { call: fin } = useFrappePostCall(`${HISAB_API}.final_approve`);
  const { call: reopen } = useFrappePostCall(`${HISAB_API}.reopen`);

  // What the total WOULD be, before anything is saved — so the rate can be judged against
  // the number it produces rather than typed blind and read back after a round trip.
  const preview = useMemo(() => {
    const a = row.out_weight * Number(rateOut || 0);
    const b = row.in_weight * Number(rateIn || 0);
    const markup = Number(h?.markup_percent ?? 5);
    return { a, b, markup, total: (a - b) * (1 + markup / 100) };
  }, [row.out_weight, row.in_weight, rateOut, rateIn, h]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast(done); onChanged(); }
    catch (e) { toast(extractErrorMessage(e), "error"); }
    finally { setBusy(false); }
  }

  const status = h?.status || "Draft";
  const stepIdx = STEPS.findIndex((s) => s.status === status);
  const over = !!h?.wastage_over_limit;

  if (!open && !h) {
    return (
      <div className="mm-jh-hisab mm-no-print">
        <button type="button" className="mm-mini" onClick={() => setOpen(true)}>
          <ScrollText size={13} /> Form hisab
        </button>
      </div>
    );
  }

  return (
    <div className="mm-jh-hisab">
      <div className="mm-jh-hisab-head">
        <span className="mm-jh-hisab-title">Hisab</span>
        {/* Where it has got to, and what is left. A status word alone made people ask
            "so who has to do something now" on every single row. */}
        <span className="mm-jh-steps">
          {STEPS.map((s, i) => (
            <span key={s.status}
              className={`mm-jh-step${i < stepIdx ? " is-done" : ""}${i === stepIdx ? " is-now" : ""}`}>
              {s.label}
            </span>
          ))}
        </span>
        {over && (
          <span className="mm-pill mm-pill-warn" title="Over the wastage limit in MM Settings — worth a second look before approving">
            Wastage {(h?.wastage_percent ?? row.wastage_percent).toFixed(2)}%
          </span>
        )}
        {h?.bill_no && <span className="mm-jh-billno">Bill {h.bill_no}</span>}
        {!!h?.cheque && <span className="mm-pill mm-pill-ok">Cheque</span>}
      </div>

      <div className="mm-jh-hisab-body">
        {status === "Draft" ? (
          <div className="mm-jh-rates mm-no-print">
            <label>Rate out<input className="mm-input mm-input-compact" type="number" step="0.01"
              value={rateOut} onChange={(e) => setRateOut(e.target.value)} /></label>
            <label>Rate in<input className="mm-input mm-input-compact" type="number" step="0.01"
              value={rateIn} onChange={(e) => setRateIn(e.target.value)} /></label>
            <button type="button" className="mm-mini" disabled={busy}
              onClick={() => void run(() => save({
                job_out: row.job_out, rate_out: Number(rateOut || 0), rate_in: Number(rateIn || 0),
              }), "Hisab saved")}>Save rates</button>
          </div>
        ) : (
          <div className="mm-jh-rates">
            <span>Rate out <b>{money(h?.rate_out)}</b></span>
            <span>Rate in <b>{money(h?.rate_in)}</b></span>
          </div>
        )}

        <div className="mm-jh-money">
          <span>Out {kg(row.out_weight)} × rate = <b>{money(h ? h.out_amount : preview.a)}</b></span>
          <span>In {kg(row.in_weight)} × rate = <b>{money(h ? h.in_amount : preview.b)}</b></span>
          <span>+{(h?.markup_percent ?? preview.markup)}%</span>
          <span className="mm-jh-total">Total <b>{money(h ? h.total_amount : preview.total)}</b></span>
        </div>
      </div>

      <div className="mm-jh-hisab-acts mm-no-print">
        {h && status === "Draft" && (
          <button type="button" className="mm-mini mm-mini-ok" disabled={busy}
            onClick={() => void run(() => acc({ name: h.name }), "Accountant approved")}>
            Accountant approve
          </button>
        )}
        {h && status === "Accountant Approved" && (
          <button type="button" className="mm-mini mm-mini-ok" disabled={busy}
            onClick={() => void run(() => adm({ name: h.name }), "Admin approved")}>
            Admin approve
          </button>
        )}
        {h && status === "Admin Approved" && (
          <>
            <input className="mm-input mm-input-compact" placeholder="Bill no"
              value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            <button type="button" className="mm-mini mm-mini-ok" disabled={busy || !billNo.trim()}
              onClick={() => void run(() => bill({ name: h.name, bill_no: billNo.trim() }), "Bill number recorded")}>
              Save bill no
            </button>
          </>
        )}
        {h && status === "Billed" && (
          <button type="button" className="mm-mini mm-mini-ok" disabled={busy}
            onClick={() => void run(() => fin({ name: h.name, cheque: 1 }), "Cheque recorded, hisab complete")}>
            Cheque given — final approve
          </button>
        )}
        {h && status !== "Draft" && status !== "Completed" && (
          <button type="button" className="mm-mini" disabled={busy}
            title="Send it back to Draft so the rates can be corrected"
            onClick={() => void run(() => reopen({ name: h.name }), "Reopened")}>
            Reopen
          </button>
        )}
      </div>
    </div>
  );
}
