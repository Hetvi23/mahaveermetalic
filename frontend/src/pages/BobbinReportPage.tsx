import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Printer, Disc3 } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import PartyCompanyPicker from "@/components/PartyCompanyPicker";
import { todayISO, fmtDate } from "@/utils/localDate";
import { applyOnEnter } from "@/components/ReportFilters";

const API = "mahaveermetalic.mahaveer_metallic.api.bobbin";
const today = todayISO;
const monthAgo = () => {
  // Calendar month back, read off the LOCAL date — toISOString would push it to UTC and
  // hand back the previous day for the first five and a half hours of every one.
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return todayISO(d);
};

type Row = {
  date?: string | null; voucher_type?: string; voucher_no?: string; bobbin?: string;
  /** What the shop called the movement: Given / Received for a Bobbin In / Out entry,
   *  else the voucher type. Both directions used to read "Bobbin Challan". */
  label?: string;
  note?: string | null;
  /** The operator's own note on a Bobbin In / Out entry; none on a production's line. */
  remark?: string | null;
  /** The challan ID the bobbins moved on: the challan itself, a Bobbin In / Out entry's
   *  paper number, or the challan(s) a not-yet-rebuilt production row's boxes went out on. */
  reference?: string | null;
  in_qty: number; out_qty: number; qty: number; box: number;
  /** How many ledger movements this line stands for — >1 when the bill is grouped. */
  movements?: number;
  balance_qty: number; balance_box: number;
};
type Applied = { party: string; company: string; owner: string; from: string; to: string };

/** Where Enter on a line goes: the challan (any book, Job In included) on its correction
 *  page, or the Bobbin In / Out entry. An Opening or Adjustment line has no paper. */
function docLink(row: Row): string | null {
  if (!row.voucher_no) return null;
  if (["Sales Challan", "Job In", "Job Out"].includes(row.voucher_type || "")) {
    return `/challan-report?challan=${encodeURIComponent(row.voucher_no)}`;
  }
  if (row.voucher_type === "Bobbin Challan") return `/bobbin-tracking/${encodeURIComponent(row.voucher_no)}`;
  return null;
}

/** The report as a query string, so Back from a document lands on the same report. */
function reportParams(a: Applied, billWise: boolean, row?: number) {
  const next = new URLSearchParams();
  (["party", "company", "owner", "from", "to"] as const).forEach((k) => { if (a[k]) next.set(k, a[k]); });
  if (!billWise) next.set("bw", "0");
  if (row != null) next.set("row", String(row));
  return next;
}

type Report = {
  opening_qty: number; opening_box: number; rows: Row[]; closing_qty: number; closing_box: number;
};

/**
 * Bobbin report: per party over a date range — opening stock, every movement (bobbin
 * challan in/out and production usage) with a running balance, and closing totals.
 */
export default function BobbinReportPage() {
  // THE REPORT LIVES IN THE URL (Hetvi: "when enter is pressed open reference document").
  // Enter leaves for the document; Back has to land on the same party, dates and line,
  // not on a blank report a month back.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [initial] = useState<Applied>(() => ({
    party: params.get("party") || "", company: params.get("company") || "", owner: params.get("owner") || "",
    from: params.get("from") || monthAgo(), to: params.get("to") || today(),
  }));
  const [party, setParty] = useState(initial.party);
  const [company, setCompany] = useState(initial.company);
  // Whose bobbins: MM's own, the party's, or both.
  const [owner, setOwner] = useState(initial.owner);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState<Applied>(initial);

  // Selecting a company here means the party it is filed under, exactly as on the order
  // and production screens — the server resolves company -> party.

  /* ONE LINE PER BILL by default (Hetvi: "bobbin report bill wise"). A production that
     used twenty bobbins wrote twenty identical-looking ledger rows, and the statement ran
     to 925 lines of the same voucher repeating. The movement-by-movement view is still
     one click away — it is the detail behind each line, not a different truth. */
  const [billWise, setBillWise] = useState(params.get("bw") !== "0");
  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.bobbin_report`,
    {
      party: applied.party || undefined,
      company: applied.company || undefined,
      owner: applied.owner || undefined,
      from_date: applied.from,
      to_date: applied.to,
      bill_wise: billWise ? 1 : 0,
    },
    `bobbin-report-${applied.party}-${applied.company}-${applied.owner}-${applied.from}-${applied.to}-${billWise}`,
  );
  const r = data?.message;

  function applyFilter() {
    const next = { party, company, owner, from, to };
    setApplied(next);
    setParams(reportParams(next, billWise), { replace: true });
  }
  function group(v: boolean) {
    setBillWise(v);
    setParams(reportParams(applied, v), { replace: true });
  }

  /* KEYBOARD: click or arrow to a line, Enter opens its paper. One line is in the tab order
     at a time (roving tabindex), so Tab still leaves the table instead of walking 400 rows. */
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [cur, setCur] = useState(() => Number(params.get("row") ?? 0) || 0);
  function openDoc(row: Row, i: number) {
    const to = docLink(row);
    if (!to) return;
    setParams(reportParams(applied, billWise, i), { replace: true });
    // fromReport: the challan page's Close steps back here, as its own list does.
    navigate(to, { state: { fromReport: true } });
  }
  function onRowKey(e: React.KeyboardEvent<HTMLTableRowElement>, row: Row, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      openDoc(row, i);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rowRefs.current[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  }
  // Back from a document: put the cursor on the line it was opened from.
  const backTo = params.get("row");
  useEffect(() => {
    if (backTo != null && r) rowRefs.current[Number(backTo)]?.focus();
  }, [r, backTo]);

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title">Report — Bobbins</h1>
          <p className="mm-page-sub">Opening, every movement and the running balance for a party over a date range.</p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters" onKeyDown={applyOnEnter(applyFilter)}>
          {/* One box for both, searchable by either name (Hetvi: "merge the company/party
              names everywhere"); the report still filters by party and company as before. */}
          <PartyCompanyPicker wholeParty party={party} company={company}
            placeholder="All parties / companies"
            onChange={(p, c) => { setParty(p); setCompany(c); }} />
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
          <button className="mm-btn-primary" onClick={applyFilter}>Filter</button>
          {/* Bill-wise or movement-by-movement. Not a filter — it does not change WHICH
              movements are counted, only whether a bill is shown as one line or as the
              rows behind it, so it applies at once rather than waiting for Filter. */}
          <div className="mm-seg" role="group" aria-label="How to group the ledger">
            <button type="button" className={`mm-seg-btn${billWise ? " mm-seg-btn-active" : ""}`}
              title="One line per bill" onClick={() => group(true)}>Bill-wise</button>
            <button type="button" className={`mm-seg-btn${!billWise ? " mm-seg-btn-active" : ""}`}
              title="Every movement, as it was posted" onClick={() => group(false)}>Every movement</button>
          </div>
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
                  {/* No Type, Note or Vch.No (Hetvi: "remove voucher no, reference should come
                      based on the challan id"). Reference is the challan the bobbins moved on,
                      the sign on the qty which way. Remark is what the operator wrote. */}
                  <th>Date</th><th>Reference</th><th>Bobbin</th><th>Remark</th>
                  <th className="mm-num">Bobbin Qty</th><th className="mm-num">Box Qty</th><th className="mm-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="mm-brp-opening">
                  <td>{applied.from}</td><td /><td><strong>Opening Stock</strong></td><td />
                  <td className="mm-num"><strong>{(r?.opening_qty ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.opening_box ?? 0).toLocaleString()}</strong></td>
                  <td className="mm-num"><strong>{(r?.opening_qty ?? 0).toLocaleString()}</strong></td>
                </tr>
                {(r?.rows ?? []).map((row, i) => (
                  <tr key={i} ref={(el) => { rowRefs.current[i] = el; }}
                    className={`mm-brp-row${docLink(row) ? " mm-brp-row-doc" : ""}`}
                    tabIndex={i === cur ? 0 : -1}
                    onFocus={() => setCur(i)}
                    onKeyDown={(e) => onRowKey(e, row, i)}
                    onDoubleClick={() => openDoc(row, i)}
                    title={docLink(row) ? `Enter or double-click opens ${row.reference || row.voucher_no}` : undefined}>
                    <td>{fmtDate(row.date) || "—"}</td>
                    <td className="mm-cell-wrap">{row.reference || "—"}</td>
                    <td>{row.bobbin || "—"}</td>
                    {/* Free text — let it wrap rather than stretch the register sideways. */}
                    <td className="mm-cell-wrap">{row.remark || "—"}</td>
                    <td className={`mm-num ${row.qty < 0 ? "mm-var-over" : ""}`}>{row.qty > 0 ? `+${row.qty}` : row.qty}</td>
                    <td className="mm-num">{row.box || "—"}</td>
                    <td className="mm-num">{row.balance_qty.toLocaleString()}</td>
                  </tr>
                ))}
                {(r?.rows ?? []).length === 0 && (
                  <tr><td colSpan={7} className="mm-empty">No bobbin movement in this period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>TOTAL</strong></td>
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
