import { useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { Printer, Disc3 } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.bobbin";
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

type Row = {
  date?: string | null; voucher_type?: string; voucher_no?: string; bobbin?: string;
  note?: string | null; in_qty: number; out_qty: number; qty: number; box: number;
  balance_qty: number; balance_box: number;
};
type Report = {
  opening_qty: number; opening_box: number; rows: Row[]; closing_qty: number; closing_box: number;
};

/**
 * Bobbin report: per party over a date range — opening stock, every movement (bobbin
 * challan in/out and production usage) with a running balance, and closing totals.
 */
export default function BobbinReportPage() {
  const [party, setParty] = useState("");
  const [company, setCompany] = useState("");
  // Whose bobbins: MM's own, the party's, or both.
  const [owner, setOwner] = useState("");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [applied, setApplied] = useState({ party: "", company: "", owner: "", from: monthAgo(), to: today() });

  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  // Selecting a company here means the party it is filed under, exactly as on the order
  // and production screens — the server resolves company -> party.
  const companies = useFrappeGetDocList<{ name: string; company_name?: string; parent?: string }>("MM Party Company", {
    fields: ["name", "company_name", "parent"], limit: 0, orderBy: { field: "company_name", order: "asc" },
  });

  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.bobbin_report`,
    {
      party: applied.party || undefined,
      company: applied.company || undefined,
      owner: applied.owner || undefined,
      from_date: applied.from,
      to_date: applied.to,
    },
    `bobbin-report-${applied.party}-${applied.company}-${applied.owner}-${applied.from}-${applied.to}`,
  );
  const r = data?.message;

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title">Report — Bobbins</h1>
          <p className="mm-page-sub">Opening, every movement and the running balance for a party over a date range.</p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters">
          <label className="mm-field">
            <span className="mm-field-label">Party</span>
            <SearchSelect value={party} placeholder="All parties"
              options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))} onChange={setParty} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Company</span>
            <SearchSelect value={company} placeholder="All companies"
              options={(companies.data ?? []).map((c) => ({ value: c.company_name || c.name, label: c.company_name || c.name, meta: c.parent }))}
              onChange={setCompany} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Bobbins of</span>
            <SearchSelect value={owner} placeholder="Both"
              options={[{ value: "MM", label: "MM" }, { value: "Party", label: "Party" }]}
              onChange={setOwner} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="mm-btn-primary" onClick={() => setApplied({ party, company, owner, from, to })}>Filter</button>
          <button className="mm-btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </section>

      <section className="mm-card mm-card-pad">
        <div className="mm-iw-sec-head mm-no-print">
          <h2 className="mm-panel-title"><Disc3 size={16} /> Bobbin ledger</h2>
          <span className="mm-pill mm-pill-muted">{r?.rows.length ?? 0}</span>
        </div>
        <div className="mm-print-head">
          <strong>Report — Bobbins</strong>
          <span>{applied.party || "All parties"} · {applied.from} to {applied.to}</span>
        </div>

        {isLoading ? (
          <p className="mm-muted">Loading…</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Date</th><th>Vch.No</th><th>Type</th><th>Bobbin</th><th>Note</th>
                  <th className="mm-num">Bobbin Qty</th><th className="mm-num">Box Qty</th><th className="mm-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="mm-brp-opening">
                  <td>{applied.from}</td><td /><td /><td><strong>Opening Stock</strong></td><td />
                  <td className="mm-num"><strong>{(r?.opening_qty ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.opening_box ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.opening_qty ?? 0).toLocaleString()}</strong></td>
                </tr>
                {(r?.rows ?? []).map((row, i) => (
                  <tr key={i}>
                    <td>{row.date || "—"}</td>
                    <td>{row.voucher_no || "—"}</td>
                    <td>{row.voucher_type || "—"}</td>
                    <td>{row.bobbin || "—"}</td>
                    <td>{row.note || "—"}</td>
                    <td className={`mm-num ${row.qty < 0 ? "mm-var-over" : ""}`}>{row.qty > 0 ? `+${row.qty}` : row.qty}</td>
                    <td className="mm-num">{row.box || "—"}</td>
                    <td className="mm-num">{row.balance_qty.toLocaleString()}</td>
                  </tr>
                ))}
                {(r?.rows ?? []).length === 0 && (
                  <tr><td colSpan={8} className="mm-empty">No bobbin movement in this period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}><strong>TOTAL</strong></td>
                  <td className="mm-num"><strong>{(r?.closing_qty ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.closing_box ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.closing_qty ?? 0).toLocaleString()}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mm-brp-foot">
          <span>Total Bobbin: <strong>{(r?.closing_qty ?? 0).toLocaleString()}</strong></span>
          <span>Total Box: <strong>{(r?.closing_box ?? 0).toLocaleString()}</strong></span>
        </div>
      </section>
    </div>
  );
}
