import { useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowDownFromLine, ArrowUpFromLine, Printer } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = {
  challan: string; type: string; date?: string; party?: string; challan_no?: string;
  box: number; out_weight: number; in_weight: number; out_bobbin: number; in_bobbin: number;
  balance_weight: number; balance_bobbin: number;
};
type Report = {
  rows: Row[]; total_out: number; total_in: number; pending_weight: number; pending_bobbin: number;
};

/**
 * Job work report — what went out, what came back, what the worker still holds.
 *
 * The running balance is Job Out minus Job In, so the closing figure is material still
 * with the job worker. Bobbins are carried alongside the weight because they go out with
 * the rolls and have to come back too.
 */
export default function JobReportPage() {
  const [party, setParty] = useState("");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [applied, setApplied] = useState({ party: "", from: monthAgo(), to: today() });

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });

  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.job_report`,
    { party: applied.party || undefined, from_date: applied.from, to_date: applied.to },
    `job-report-${applied.party}-${applied.from}-${applied.to}`,
  );
  const r = data?.message;

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title">Report — Job Work</h1>
          <p className="mm-page-sub">Job Out against Job In per party. The closing balance is what the job worker still holds.</p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters">
          <label className="mm-field">
            <span className="mm-field-label">Party</span>
            <SearchSelect value={party} placeholder="All parties"
              options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))}
              onChange={setParty} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="mm-btn-primary" onClick={() => setApplied({ party, from, to })}>Filter</button>
          <button className="mm-btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </section>

      <section className="mm-card mm-card-pad">
        <div className="mm-job-summary mm-no-print">
          <span className="mm-pill mm-pill-muted"><ArrowUpFromLine size={13} /> Out {kg(r?.total_out)} kg</span>
          <span className="mm-pill mm-pill-muted"><ArrowDownFromLine size={13} /> In {kg(r?.total_in)} kg</span>
          <span className={`mm-pill ${(r?.pending_weight ?? 0) > 0 ? "mm-pill-pending" : "mm-pill-ok"}`}>
            With worker {kg(r?.pending_weight)} kg · {r?.pending_bobbin ?? 0} bobbins
          </span>
        </div>

        <div className="mm-table-scroll">
          <table className="mm-table mm-table-dense">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Challan</th><th>Party</th>
                <th className="mm-num">Out (Kg)</th><th className="mm-num">In (Kg)</th>
                <th className="mm-num">Bobbin ±</th><th className="mm-num">Balance (Kg)</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="mm-muted">Loading…</td></tr>}
              {!isLoading && (r?.rows.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="mm-muted">No job work in this period.</td></tr>
              )}
              {r?.rows.map((x) => (
                <tr key={x.challan}>
                  <td>{x.date || "—"}</td>
                  <td><span className={`mm-state ${x.type === "Job Out" ? "mm-state-unfinished" : "mm-state-incutting"}`}>{x.type}</span></td>
                  <td>{x.challan_no || x.challan}</td>
                  <td>{x.party || "—"}</td>
                  <td className="mm-num">{x.out_weight ? kg(x.out_weight) : "—"}</td>
                  <td className="mm-num">{x.in_weight ? kg(x.in_weight) : "—"}</td>
                  <td className="mm-num">{x.out_bobbin ? `+${x.out_bobbin}` : x.in_bobbin ? `−${x.in_bobbin}` : "—"}</td>
                  <td className="mm-num"><strong>{kg(x.balance_weight)}</strong></td>
                </tr>
              ))}
            </tbody>
            {(r?.rows.length ?? 0) > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>Closing — still with the job worker</strong></td>
                  <td className="mm-num"><strong>{kg(r?.total_out)}</strong></td>
                  <td className="mm-num"><strong>{kg(r?.total_in)}</strong></td>
                  <td className="mm-num"><strong>{r?.pending_bobbin ?? 0}</strong></td>
                  <td className="mm-num"><strong>{kg(r?.pending_weight)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
