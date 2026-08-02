import { useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { Boxes, RefreshCw, Search, ScrollText, TriangleAlert } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";

type Balance = {
  name: string;
  roll_no?: string;
  lot_number?: string;
  location?: string;
  branch?: string;
  color_name?: string;
  item_type?: string;
  stock_weight?: number;
  stock_box?: number;
  available_weight?: number;
  reorder_weight?: number;
  low_stock?: boolean;
};

type Summary = {
  skus: number;
  total_weight: number;
  available_weight: number;
  total_box: number;
  low_stock_count: number;
};

const n = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

/**
 * Live roll-inventory balances (per branch/location/lot/colour), backed by
 * api.inventory.balances. Each row drills into its Stock Ledger movements. Balances
 * and the ledger are written in lock-step server-side, so what shows here always
 * matches the ledger's running balance.
 */
export default function InventoryScreen() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [inStock, setInStock] = useState(true);
  const [lowOnly, setLowOnly] = useState(false);

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Balance[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inventory.balances",
    { limit: 1000 },
    "mm-inventory-balances",
  );
  const { data: sumData, mutate: mutateSum } = useFrappeGetCall<{ message: Summary }>(
    "mahaveermetalic.mahaveer_metallic.api.inventory.summary",
    undefined,
    "mm-inventory-summary",
  );
  const rows = useMemo(() => data?.message ?? [], [data]);
  const summary = sumData?.message;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (inStock && (r.available_weight ?? 0) <= 0) return false;
      if (lowOnly && !r.low_stock) return false;
      if (s) {
        const hay = [r.color_name, r.lot_number, r.roll_no, r.location, r.branch]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, q, inStock, lowOnly]);

  const refresh = () => {
    void mutate();
    void mutateSum();
  };

  const openLedger = (r: Balance) => {
    const p = new URLSearchParams();
    if (r.color_name) p.set("color", r.color_name);
    if (r.lot_number) p.set("lot", r.lot_number);
    if (r.location) p.set("location", r.location);
    nav(`/stock-ledger?${p.toString()}`);
  };

  return (
    <div className="mm-screen">
      <header className="mm-screen-head">
        <div>
          <h1 className="mm-page-title"><Boxes size={20} /> Inventory</h1>
          <p className="mm-page-sub">Live roll stock by colour, lot and location. Click a row for its ledger.</p>
        </div>
        <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {summary && (
        <div className="mm-kpis mm-inv-kpis">
          <div className="mm-kpi mm-kpi-blue"><span className="mm-kpi-value">{summary.skus}</span><span className="mm-kpi-label">Stock lines</span></div>
          <div className="mm-kpi mm-kpi-green"><span className="mm-kpi-value">{n(summary.available_weight)}</span><span className="mm-kpi-label">Available kg</span></div>
          <div className="mm-kpi mm-kpi-amber"><span className="mm-kpi-value">{n(summary.total_box)}</span><span className="mm-kpi-label">Boxes</span></div>
          <div className={`mm-kpi ${summary.low_stock_count ? "mm-kpi-danger" : "mm-kpi-slate"}`}>
            <span className="mm-kpi-value">{summary.low_stock_count}</span><span className="mm-kpi-label">Low stock</span>
          </div>
        </div>
      )}

      <section className="mm-card mm-card-pad">
        <div className="mm-inv-toolbar">
          <div className="mm-search-box">
            <Search size={15} />
            <input className="mm-input" placeholder="Search colour, lot, roll, location…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="mm-check"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock only</label>
          <label className="mm-check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
          <span className="mm-pill mm-pill-muted">{shown.length}</span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : shown.length === 0 ? (
          <p className="mm-empty">No stock matches.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Lot</th>
                  <th>Location</th>
                  <th>Branch</th>
                  <th className="mm-num">Stock (kg)</th>
                  <th className="mm-num">Qty</th>
                  <th className="mm-num">Available (kg)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name} className="mm-row-click" onClick={() => openLedger(r)}>
                    <td>
                      <strong>{r.color_name || "—"}</strong>
                      {r.low_stock && <span className="mm-badge-low"><TriangleAlert size={11} /> low</span>}
                    </td>
                    <td>{r.lot_number || "—"}</td>
                    <td>{r.location || "—"}</td>
                    <td>{r.branch || "—"}</td>
                    <td className="mm-num">{n(r.stock_weight)}</td>
                    <td className="mm-num">{n(r.stock_box)}</td>
                    <td className="mm-num"><strong>{n(r.available_weight)}</strong></td>
                    <td className="mm-num">
                      <button type="button" className="mm-mini" onClick={(e) => { e.stopPropagation(); openLedger(r); }}>
                        <ScrollText size={13} /> Ledger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
