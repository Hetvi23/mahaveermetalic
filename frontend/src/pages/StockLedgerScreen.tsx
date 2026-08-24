import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { Filter, ReportFilters } from "@/components/ReportFilters";
import { useSearchParams } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw, ScrollText, X } from "lucide-react";
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
  // A date range and a branch. The API has always accepted both; the screen simply never
  // asked for them, so reading "what moved on the 3rd" meant scrolling a 500-row list.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [branch, setBranch] = useState("");

  const colours = useFrappeGetDocList<{ name: string }>("MM Item Master", { fields: ["name"], limit: 0 });
  const locations = useFrappeGetDocList<{ name: string }>("MM Location Master", { fields: ["name"], limit: 0 });
  const branches = useFrappeGetDocList<{ name: string }>("MM Branch", { fields: ["name"], limit: 0 });

  const setCtx = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  };

  const args = useMemo(() => {
    const a: Record<string, string | number> = { limit: 500 };
    if (color) a.color = color;
    if (lot) a.lot = lot;
    if (location) a.location = location;
    if (voucher) a.voucher_type = voucher;
    if (branch) a.branch = branch;
    if (from) a.from_date = from;
    if (to) a.to_date = to;
    return a;
  }, [color, lot, location, voucher, branch, from, to]);

  // The SWR key includes the active filters, so useFrappeGetCall refetches whenever they
  // change — no manual mutate-on-change needed (that risked a render loop).
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Entry[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inventory.ledger",
    args,
    `mm-ledger-${color}-${lot}-${location}-${voucher}-${branch}-${from}-${to}`,
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
  const resetAll = () => {
    setParams({});
    setQ(""); setVoucher(""); setFrom(""); setTo(""); setBranch("");
  };

  /** What is on screen, in the columns it is shown in. */
  function exportCsv() {
    const head = ["Date", "Voucher", "Ref", "Color", "Lot", "Location", "In", "Out", "Balance", "Order"];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = shown.map((r) => [
      r.posting_date ?? "", r.voucher_type ?? "", r.voucher_no ?? "", r.color_name ?? "",
      r.lot_number ?? "", r.location ?? "", r.in_weight ?? "", r.out_weight ?? "",
      r.balance_weight ?? "", r.customer_order ?? r.remarks ?? "",
    ].map(esc).join(","));
    const url = URL.createObjectURL(new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-ledger-${from || "all"}-to-${to || "now"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

      <ReportFilters
        onReset={resetAll}
        onPrint={() => window.print()}
        onExport={exportCsv}
        exportDisabled={shown.length === 0}
        note={<>Newest first, up to 500 movements. Narrow the range to see further back.</>}
      >
        <Filter label="From"><input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Filter>
        <Filter label="To"><input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Filter>
        <Filter label="Color">
          <SearchSelect value={color} placeholder="All colors" onChange={(v) => setCtx("color", v)}
            options={(colours.data ?? []).map((c) => ({ value: c.name, label: c.name }))} />
        </Filter>
        <Filter label="Lot">
          <input className="mm-input" value={lot} placeholder="Lot id"
            onChange={(e) => setCtx("lot", e.target.value)} />
        </Filter>
        <Filter label="Location">
          <SearchSelect value={location} placeholder="All locations" onChange={(v) => setCtx("location", v)}
            options={(locations.data ?? []).map((c) => ({ value: c.name, label: c.name }))} />
        </Filter>
        <Filter label="Branch">
          <SearchSelect value={branch} placeholder="All branches" onChange={setBranch}
            options={(branches.data ?? []).map((c) => ({ value: c.name, label: c.name }))} />
        </Filter>
        <Filter label="Movement">
          <SearchSelect value={voucher} placeholder="All movements"
            options={VOUCHERS.map((v) => ({ value: v, label: v }))} onChange={setVoucher} />
        </Filter>
        <Filter label="Search" wide>
          <input className="mm-input" placeholder="Colour, lot, roll, voucher, order…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </Filter>
      </ReportFilters>

      <section className="mm-card mm-card-pad">
        <div className="mm-inv-toolbar">
          <span className="mm-pill mm-pill-muted">{shown.length} movement{shown.length === 1 ? "" : "s"}</span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={10} />
        ) : shown.length === 0 ? (
          <p className="mm-empty">
            {q || voucher || from || to || branch || hasCtx
              ? "No movement matches these filters."
              : "No movements yet."}
          </p>
        ) : (
          <div className="mm-table-scroll mm-ledger-scroll">
            <table className="mm-table mm-table-dense mm-table-sticky">
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
                      <td className="mm-cell-wrap">{r.customer_order || (r.remarks ? <span className="mm-muted">{r.remarks}</span> : "—")}</td>
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
