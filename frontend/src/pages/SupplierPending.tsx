import { useFrappeGetCall } from "frappe-react-sdk";
import { useState } from "react";

const PRIVILEGED = ["Administrator", "System Manager", "MM Admin", "MM Operations", "MM Inventory Manager", "MM Sales Team"];
function isSupplierOnly(): boolean {
  const roles = (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot?.user?.roles ?? [];
  return roles.includes("MM Supplier") && !PRIVILEGED.some((r) => roles.includes(r));
}

type PendingRow = {
  supplier: string;
  color: string;
  cut: string;
  ordered: number;
  received: number;
  pending: number;
  po_count: number;
};

/**
 * Pending purchase per supplier + item, combined across all POs:
 * pending = Σ (PO ordered KG − Inward received KG). Two separate POs for the
 * same item + supplier roll up into one line (e.g. 400 + 300 → 700).
 */
export default function SupplierPending() {
  const supplierOnly = isSupplierOnly();
  const [supplier, setSupplier] = useState("");
  // Supplier logins are auto-scoped server-side (the param is ignored for them).
  const { data, isLoading, error } = useFrappeGetCall<{ message: PendingRow[] }>(
    "mahaveermetalic.api.supplier.get_supplier_pending",
    !supplierOnly && supplier ? { supplier } : undefined,
    `mm-supplier-pending:${supplierOnly ? "self" : supplier || "all"}`,
  );
  const rows = data?.message ?? [];
  const totalPending = rows.reduce((s, r) => s + (r.pending || 0), 0);

  return (
    <div className="mm-page mm-page-enter">
      <header className="mm-page-head">
        <div>
          <h1 className="mm-page-title">Supplier pending</h1>
          <p className="mm-page-sub">
            Outstanding purchase by supplier &amp; item — ordered minus inwarded, combined across orders.
          </p>
        </div>
      </header>

      <div className="mm-card mm-card-pad">
        <div className="mm-list-toolbar">
          {supplierOnly ? (
            <span className="mm-muted mm-list-toolbar-filler">Your pending orders.</span>
          ) : (
            <div className="mm-search-wrap">
              <span className="mm-search-icon" aria-hidden>⌕</span>
              <input
                className="mm-input mm-search mm-search-pill"
                placeholder="Filter by supplier (exact MM Vendor Master name)…"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                aria-label="Filter by supplier"
              />
            </div>
          )}
          <div className="mm-list-toolbar-right">
            <span className="mm-pill mm-pill-muted">
              {isLoading ? "…" : `${totalPending.toLocaleString()} kg pending`}
            </span>
          </div>
        </div>

        {error && <p className="mm-error">{(error as { message?: string }).message || String(error)}</p>}
        {!error && isLoading && <p className="mm-muted">Loading…</p>}
        {!error && !isLoading && rows.length === 0 && <p className="mm-empty">Nothing pending. 🎉</p>}

        {!error && !isLoading && rows.length > 0 && (
          <div className="mm-table-wrap mm-table-wrap-elevated">
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-hover mm-table-rows">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Color</th>
                    <th>Cut</th>
                    <th className="mm-num">Ordered</th>
                    <th className="mm-num">Received</th>
                    <th className="mm-num">Pending</th>
                    <th className="mm-num">POs</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.supplier}-${r.color}-${r.cut}-${i}`}>
                      <td>{r.supplier || "—"}</td>
                      <td>{r.color || "—"}</td>
                      <td>{r.cut || "—"}</td>
                      <td className="mm-num">{r.ordered.toLocaleString()}</td>
                      <td className="mm-num">{r.received.toLocaleString()}</td>
                      <td className="mm-num mm-pending-cell">{r.pending.toLocaleString()}</td>
                      <td className="mm-num">{r.po_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
