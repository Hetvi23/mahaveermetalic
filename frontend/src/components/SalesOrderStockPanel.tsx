import { useFrappeGetCall } from "frappe-react-sdk";

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
 * SRS 5.1: live stock visibility per order line. Shown on a saved Sales Order.
 * Purchase Orders are raised automatically per order line, so this panel is now
 * read-only (no manual "create PO" action).
 */
export default function SalesOrderStockPanel({ docname }: { docname: string }) {
  const { data, isLoading, error } = useFrappeGetCall<{ message: Status }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.get_so_stock_status",
    { sales_order: docname },
    `so-stock-${docname}`,
  );

  const s = data?.message;

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
              <span className="mm-pill mm-pill-pending">Short stock on some lines</span>
            ) : (
              <span className="mm-pill mm-pill-ok">Enough stock for all lines</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
