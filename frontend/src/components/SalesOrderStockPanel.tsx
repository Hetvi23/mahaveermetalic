import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Link } from "react-router-dom";

type Line = {
  color_name: string;
  cut?: string;
  required: number;
  available: number;
  short: number;
  purchase_rate: number;
};
type Status = { sales_order: string; party: string; lines: Line[]; any_short: boolean };

/**
 * SRS 5.1: live stock visibility per order line + one-click Purchase Order for any
 * shortfall. Shown on a saved Sales Order.
 */
export default function SalesOrderStockPanel({ docname }: { docname: string }) {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: Status }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.get_so_stock_status",
    { sales_order: docname },
    `so-stock-${docname}`,
  );
  const { call, loading } = useFrappePostCall<{ message: { created: string[] } }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.create_purchase_order_from_so",
  );
  const [created, setCreated] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const s = data?.message;

  async function makePO() {
    setMsg(null);
    try {
      const r = await call({ sales_order: docname });
      const names = r?.message?.created ?? [];
      setCreated(names);
      setMsg(names.length ? `Created ${names.length} Purchase Order(s).` : "All lines have enough stock — no PO needed.");
      void mutate();
    } catch (e) {
      setMsg((e as { message?: string })?.message || String(e));
    }
  }

  return (
    <section className="mm-panel mm-panel-child">
      <header className="mm-panel-head">
        <h2 className="mm-panel-title">Stock & purchase</h2>
        <p className="mm-panel-desc">Available roll stock per line. Create a Purchase Order for any shortfall.</p>
      </header>

      {isLoading && <p className="mm-muted">Checking stock…</p>}
      {error && <p className="mm-error">{(error as { message?: string }).message || String(error)}</p>}

      {s && (
        <>
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Size</th>
                  <th className="mm-num">Required</th>
                  <th className="mm-num">Available</th>
                  <th className="mm-num">Short</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={i} className={l.short > 0 ? "mm-row-short" : undefined}>
                    <td>{l.color_name}</td>
                    <td>{l.cut || "—"}</td>
                    <td className="mm-num">{l.required.toLocaleString()}</td>
                    <td className="mm-num">{l.available.toLocaleString()}</td>
                    <td className="mm-num">{l.short > 0 ? l.short.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mm-so-stock-actions">
            {s.any_short ? (
              <button type="button" className="mm-btn-primary" disabled={loading} onClick={() => void makePO()}>
                {loading ? "Creating…" : "Create Purchase Order for shortfall"}
              </button>
            ) : (
              <span className="mm-pill mm-pill-ok">Enough stock for all lines</span>
            )}
          </div>

          {msg && <p className="mm-muted" style={{ marginTop: "0.5rem" }}>{msg}</p>}
          {created.length > 0 && (
            <p style={{ marginTop: "0.25rem" }}>
              {created.map((n) => (
                <Link key={n} className="mm-link mm-link-pill" to={`/purchase-order/${encodeURIComponent(n)}`} style={{ marginRight: 6 }}>
                  {n}
                </Link>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}
