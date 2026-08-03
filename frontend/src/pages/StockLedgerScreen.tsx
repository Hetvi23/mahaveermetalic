import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useSearchParams } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw, ScrollText, Search, X } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";
import SearchSelect from "@/components/SearchSelect";

type Entry = {
  name: string;
  posting_date?: string;
  posting_datetime?: string;
  voucher_type?: string;
  voucher_no?: string;
  branch?: string;
  location?: string;
  lot_number?: string;
  color_name?: string;
  roll_no?: string;
  in_weight?: number;
  out_weight?: number;
  in_box?: number;
  out_box?: number;
  balance_weight?: number;
  balance_box?: number;
  customer_order?: string;
  challan_number?: string;
  remarks?: string;
};

const n = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

const VOUCHERS = ["Inward", "Cutting", "Dispatch", "Adjustment"];

/**
 * Append-only stock ledger — every IN (inward) and OUT (cutting/…) movement with the
 * running balance. Opened standalone or pre-filtered from an Inventory row
 * (?color=&lot=&location=). Backed by api.inventory.ledger.
 */
export default function StockLedgerScreen() {
  const [params, setParams] = useSearchParams();
  const color = params.get("color") || "";
  const lot = params.get("lot") || "";
  const location = params.get("location") || "";

  const [q, setQ] = useState("");
  const [voucher, setVoucher] = useState("");

  const args = useMemo(() => {
    const a: Record<string, string | number> = { limit: 500 };
    if (color) a.color = color;
    if (lot) a.lot = lot;
    if (location) a.location = location;
    if (voucher) a.voucher_type = voucher;
    return a;
  }, [color, lot, location, voucher]);

  // The SWR key includes the active filters, so useFrappeGetCall refetches whenever they
  // change — no manual mutate-on-change needed (that risked a render loop).
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Entry[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inventory.ledger",
    args,
    `mm-ledger-${color}-${lot}-${location}-${voucher}`,
  );
  const rows = useMemo(() => data?.message ?? [], [data]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.color_name, r.lot_number, r.roll_no, r.location, r.voucher_no, r.voucher_type, r.customer_order]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s),
    );
  }, [rows, q]);

  const hasCtx = color || lot || location;
  const clearCtx = () => setParams({});

  return (
    <div className="mm-screen">
      <header className="mm-screen-head">
        <div>
          <h1 className="mm-page-title"><ScrollText size={20} /> Stock Ledger</h1>
          <p className="mm-page-sub">Every inward (in) and outward (out) movement, with the running balance.</p>
        </div>
        <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={() => void mutate()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {hasCtx && (
        <div className="mm-ctx-bar">
          <span>Filtered to:</span>
          {color && <span className="mm-pill">{color}</span>}
          {lot && <span className="mm-pill mm-pill-muted">Lot {lot}</span>}
          {location && <span className="mm-pill mm-pill-muted">{location}</span>}
          <button type="button" className="mm-mini" onClick={clearCtx}><X size={13} /> Clear</button>
        </div>
      )}

      <section className="mm-card mm-card-pad">
        <div className="mm-inv-toolbar">
          <div className="mm-search-box">
            <Search size={15} />
            <input className="mm-input" placeholder="Search colour, lot, voucher, order…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <SearchSelect compact value={voucher} placeholder="All movements"
            options={VOUCHERS.map((v) => ({ value: v, label: v }))} onChange={setVoucher} />
          <span className="mm-pill mm-pill-muted">{shown.length}</span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={10} />
        ) : shown.length === 0 ? (
          <p className="mm-empty">No movements.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Ref</th>
                  <th>Color</th>
                  <th>Lot</th>
                  <th>Location</th>
                  <th className="mm-num">In</th>
                  <th className="mm-num">Out</th>
                  <th className="mm-num">Balance</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isIn = (r.in_weight ?? 0) > 0;
                  return (
                    <tr key={r.name}>
                      <td>{r.posting_date || "—"}</td>
                      <td>
                        <span className={`mm-vtag ${isIn ? "mm-vtag-in" : "mm-vtag-out"}`}>
                          {isIn ? <ArrowDownToLine size={11} /> : <ArrowUpFromLine size={11} />} {r.voucher_type}
                        </span>
                      </td>
                      <td className="mm-ow-cell-order">{r.voucher_no || "—"}</td>
                      <td>{r.color_name || "—"}</td>
                      <td>{r.lot_number || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td className="mm-num mm-in">{r.in_weight ? n(r.in_weight) : ""}</td>
                      <td className="mm-num mm-out">{r.out_weight ? n(r.out_weight) : ""}</td>
                      <td className="mm-num"><strong>{n(r.balance_weight)}</strong></td>
                      <td>{r.customer_order || (r.remarks ? <span className="mm-muted">{r.remarks}</span> : "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
