import { useMemo, useState } from "react";
import { useFrappeCreateDoc, useFrappePostCall } from "frappe-react-sdk";
import { Download, PackageCheck } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";

const today = () => new Date().toISOString().slice(0, 10);

type ChallanItem = { roll?: string; color?: string; cut?: string; qty?: number; weight?: number };
type MatchOrder = {
  sales_order: string;
  party?: string;
  color_name?: string;
  cut?: string;
  qty_weight?: number;
  required_weight?: number;
};
type FetchResult = {
  challan_no: string;
  coating?: string;
  party_name?: string;
  dated?: string;
  items: ChallanItem[];
  matching_orders: MatchOrder[];
};

type Row = {
  roll: string;
  color: string;
  cut: string;
  qty: number | "";
  weight: number | "";
  customer_order: string;
};

/**
 * Inward driven by a Veermetlon challan: enter the challan no → pull rolls/colour/qty
 * from VM, see the open SOs (any customer) the colours can fulfil, allocate each roll
 * to an order, and post. Branch/location come from the logged-in employee (hidden).
 */
export default function InwardWorkspace() {
  const [postingDate, setPostingDate] = useState(today());
  const [challanNo, setChallanNo] = useState("");
  const [lot, setLot] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<MatchOrder[]>([]);
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { call: fetchCall, loading: fetching } = useFrappePostCall<{ message: FetchResult }>(
    "mahaveermetalic.mahaveer_metallic.api.veermetlon.fetch_challan",
  );
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { call: submitDoc, loading: submitting } = useFrappePostCall("frappe.client.submit");

  async function onFetch() {
    setError(null);
    setFlash(null);
    if (!challanNo.trim()) return setError("Enter the Veermetlon challan number.");
    try {
      const r = await fetchCall({ challan_no: challanNo.trim() });
      const m = r.message;
      setRows(
        (m.items || []).map((it) => ({
          roll: it.roll || "",
          color: it.color || "",
          cut: it.cut || "",
          qty: it.qty ?? "",
          weight: it.weight ?? "",
          customer_order: "",
        })),
      );
      setOrders(m.matching_orders || []);
      // Lot id = the coating selected on the VM challan; fall back to the challan no.
      setLot(m.coating || m.challan_no || challanNo.trim());
      setFetched(true);
      if ((m.items || []).length === 0) setError("Challan found but it has no rolls.");
    } catch (e) {
      setError(extractErrorMessage(e));
      setFetched(false);
    }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const ordersForColor = (color: string) => {
    const c = (color || "").trim().toLowerCase();
    return orders.filter((o) => (o.color_name || "").trim().toLowerCase() === c);
  };

  const totals = useMemo(
    () => ({
      qty: rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
      weight: rows.reduce((s, r) => s + (Number(r.weight) || 0), 0),
    }),
    [rows],
  );

  async function onSubmit() {
    setError(null);
    setFlash(null);
    if (rows.length === 0) return setError("Nothing to post — fetch a challan first.");
    for (const r of rows) {
      if (!r.color.trim()) return setError("Every roll needs a colour.");
      if (!(Number(r.weight) > 0) && !(Number(r.qty) > 0)) return setError(`Roll ${r.roll || ""} needs a weight or qty.`);
    }
    const payload = {
      doctype: "MM Inward",
      posting_date: postingDate,
      challan_number: challanNo.trim(),
      lot_number: lot || challanNo.trim(),
      items: rows.map((r, i) => ({
        idx: i + 1,
        roll_name: r.roll,
        color_name: r.color,
        cut: r.cut,
        qty_box: Number(r.qty) || 0,
        weight: Number(r.weight) || 0,
        customer_order: r.customer_order || null,
        challan_number: challanNo.trim(),
      })),
    };
    try {
      const res = await createDoc("MM Inward", payload);
      const name = (res as { name?: string }).name;
      await submitDoc({ doc: { doctype: "MM Inward", name } });
      setFlash(`Inward ${name} posted — roll stock updated.`);
      setRows([]);
      setOrders([]);
      setChallanNo("");
      setLot("");
      setFetched(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  const busy = creating || submitting;

  return (
    <div className="mm-iw">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">Inward</h1>
          <p className="mm-page-sub">Receive rolls against a Veermetlon challan. Branch &amp; location are taken from your profile.</p>
        </div>
      </header>

      {/* Challan entry */}
      <section className="mm-card mm-card-pad mm-iw-entry">
        <div className="mm-iw-entry-grid">
          <label className="mm-field">
            <span className="mm-field-label">Chalan date</span>
            <input className="mm-input" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </label>
          <label className="mm-field mm-iw-challan">
            <span className="mm-field-label">Veermetlon challan no *</span>
            <div className="mm-iw-challan-row">
              <input
                className="mm-input"
                value={challanNo}
                placeholder="Enter challan number"
                onChange={(e) => setChallanNo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onFetch()}
              />
              <button type="button" className="mm-btn-primary" disabled={fetching} onClick={() => void onFetch()}>
                {fetching ? "Fetching…" : (<><Download size={15} /> Fetch</>)}
              </button>
            </div>
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Lot number</span>
            <input className="mm-input" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Auto from challan coating" />
          </label>
        </div>
        {error && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{error}</p>}
        {flash && <p className="mm-banner mm-banner-ok" style={{ marginTop: "0.6rem" }}>{flash}</p>}
      </section>

      {fetched && (
        <div className="mm-iw-grid">
          {/* Rolls to receive */}
          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title"><PackageCheck size={16} /> Rolls on this challan</h2>
              <span className="mm-muted">Total: {totals.qty} box · {totals.weight.toLocaleString()} kg</span>
            </div>
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Color</th>
                    <th>Size</th>
                    <th className="mm-num">Qty</th>
                    <th className="mm-num">Weight</th>
                    <th>Allocate to order</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const opts = ordersForColor(r.color);
                    return (
                      <tr key={i}>
                        <td>{r.roll || "—"}</td>
                        <td>{r.color || "—"}</td>
                        <td>{r.cut || "—"}</td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                        </td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                        </td>
                        <td>
                          <select className="mm-input mm-input-compact" value={r.customer_order} onChange={(e) => setRow(i, { customer_order: e.target.value })}>
                            <option value="">— none —</option>
                            {opts.map((o) => (
                              <option key={o.sales_order} value={o.sales_order}>
                                {o.sales_order} · {o.party}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mm-ws-form-actions">
              <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSubmit()}>
                {busy ? "Posting…" : "Post inward"}
              </button>
            </div>
          </section>

          {/* Matching orders reference */}
          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title">Open orders for these colours</h2>
              <span className="mm-pill mm-pill-muted">{orders.length}</span>
            </div>
            {orders.length === 0 ? (
              <p className="mm-empty">No open orders match these colours.</p>
            ) : (
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Party</th>
                      <th>Color</th>
                      <th>Size</th>
                      <th className="mm-num">Req</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={`${o.sales_order}-${i}`} className={rows.some((r) => r.customer_order === o.sales_order) ? "mm-ws-row-active" : undefined}>
                        <td className="mm-ow-cell-order">{o.sales_order}</td>
                        <td>{o.party || "—"}</td>
                        <td>{o.color_name || "—"}</td>
                        <td>{o.cut || "—"}</td>
                        <td className="mm-num">{(o.required_weight ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
              One challan can serve several customers — allocate each roll on the left.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
