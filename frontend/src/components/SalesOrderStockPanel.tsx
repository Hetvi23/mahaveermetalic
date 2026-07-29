import { useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { extractErrorMessage } from "@/utils/frappeError";

type Line = {
  color_name: string;
  cut?: string;
  required: number;
  available: number;
  short: number;
  purchase_rate: number;
};
type PO = { name: string; status?: string; qty_kg?: number; supplier?: string };
type Status = { sales_order: string; party: string; lines: Line[]; any_short: boolean; pos: PO[]; any_po: boolean };

/**
 * Live stock visibility per order line. Purchase Orders are NOT auto-generated — a PO is
 * raised only on demand, for lines that are short on stock, via the button here.
 */
export default function SalesOrderStockPanel({ docname }: { docname: string }) {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: Status }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.get_so_stock_status",
    { sales_order: docname },
    `so-stock-${docname}`,
  );
  const { call: createPO, loading: creating } = useFrappePostCall<{ message: { created: string[]; updated: string[] } }>(
    "mahaveermetalic.mahaveer_metallic.api.stock.create_purchase_order_from_so",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const s = data?.message;

  async function onCreatePO(full: boolean) {
    setMsg(null);
    setErr(null);
    try {
      const res = await createPO({ sales_order: docname, full: full ? 1 : 0 });
      const created = res?.message?.created ?? [];
      const updated = res?.message?.updated ?? [];
      setMsg(created.length || updated.length
        ? `PO ${[...created, ...updated].join(", ")} ${created.length ? "created" : "updated"}${full ? " for the full order" : " for short stock"}.`
        : full ? "No lines to purchase (box-only or zero-weight)." : "All lines have enough stock — no PO needed.");
      void mutate();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <section className="mm-panel mm-panel-child">
      <header className="mm-panel-head">
        <h2 className="mm-panel-title">Stock &amp; purchase</h2>
        <p className="mm-panel-desc">Available roll stock per line. Create a Purchase Order any time — it covers the full ordered weight; use “shortfall only” to order just what stock can’t cover.</p>
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
            {s.any_po ? (
              <>
                <span className="mm-pill mm-pill-ok">Purchase Order raised</span>
                {s.pos.map((p) => (
                  <Link key={p.name} to={`/purchase-order/${encodeURIComponent(p.name)}`} className="mm-po-chip">
                    {p.name}{p.status ? ` · ${p.status}` : ""}
                  </Link>
                ))}
                <button type="button" className="mm-btn-ghost mm-btn-compact" disabled={creating} onClick={() => void onCreatePO(true)} title="Resync the PO quantity to the current order">
                  {creating ? "Updating…" : "Update PO qty"}
                </button>
              </>
            ) : (
              <>
                <span className={`mm-pill ${s.any_short ? "mm-pill-pending" : "mm-pill-ok"}`}>
                  {s.any_short ? "Short stock on some lines" : "Enough stock for all lines"}
                </span>
                <button type="button" className="mm-btn-primary mm-btn-compact" disabled={creating} onClick={() => void onCreatePO(true)}>
                  {creating ? "Creating…" : "Create Purchase Order"}
                </button>
                {s.any_short && (
                  <button type="button" className="mm-btn-ghost mm-btn-compact" disabled={creating} onClick={() => void onCreatePO(false)}>
                    PO for shortfall only
                  </button>
                )}
              </>
            )}
          </div>
          {msg && <p className="mm-banner mm-banner-ok" style={{ marginTop: "0.5rem" }}>{msg}</p>}
          {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
        </>
      )}
    </section>
  );
}
