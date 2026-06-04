import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowRight, Scissors } from "lucide-react";

type StockRoll = {
  name: string;
  location?: string;
  color_name?: string;
  cut?: string;
  available_weight?: number;
  stock_box?: number;
};

type CuttingDoc = {
  name: string;
  posting_date?: string;
  customer_order?: string;
  roll_no?: string;
  cut?: string;
  total_patti_qty?: number;
  total_net_weight?: number;
  status?: string;
  docstatus?: number;
};

/**
 * Two-panel cutting floor screen: pick a roll that is in stock (left) and send it
 * into cutting (right). Mirrors the shop-floor "in stock → in processing" flow.
 */
export default function CuttingWorklist() {
  const nav = useNavigate();
  const [filter, setFilter] = useState("");

  const { data: stock, isLoading: stockLoading } = useFrappeGetDocList<StockRoll>("MM Roll Inventory", {
    fields: ["name", "location", "color_name", "cut", "available_weight", "stock_box"],
    filters: [["available_weight", ">", 0]],
    limit: 500,
    orderBy: { field: "modified", order: "desc" },
  });

  const { data: processing, isLoading: procLoading } = useFrappeGetDocList<CuttingDoc>("MM Cutting", {
    fields: [
      "name",
      "posting_date",
      "customer_order",
      "roll_no",
      "cut",
      "total_patti_qty",
      "total_net_weight",
      "status",
      "docstatus",
    ],
    filters: [
      ["docstatus", "<", 2],
      ["status", "!=", "Completed"],
    ],
    limit: 200,
    orderBy: { field: "modified", order: "desc" },
  });

  const rolls = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = stock ?? [];
    if (!q) return list;
    return list.filter((r) =>
      [r.color_name, r.cut, r.location].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [stock, filter]);

  function startCutting(r: StockRoll) {
    const params = new URLSearchParams({
      source_roll: r.name,
      roll_no: r.color_name || r.name,
      shade: r.color_name || "",
      cut: r.cut || "",
    });
    nav(`/cutting/new?${params.toString()}`);
  }

  return (
    <div className="mm-page mm-page-enter">
      <header className="mm-page-head">
        <div>
          <h1 className="mm-page-title">Cutting</h1>
          <p className="mm-page-sub">Send rolls in stock into cutting, and track what is being processed.</p>
        </div>
        <Link className="mm-btn-secondary" to="/cutting/new">
          + New cutting
        </Link>
      </header>

      <div className="mm-cut-grid">
        {/* LEFT: rolls available to cut */}
        <section className="mm-card mm-card-pad">
          <div className="mm-cut-panel-head">
            <h2 className="mm-panel-title">In stock roll</h2>
            <input
              className="mm-input mm-search-pill"
              placeholder="Filter colour / cut…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter rolls"
            />
          </div>

          {stockLoading && <p className="mm-muted">Loading…</p>}
          {!stockLoading && rolls.length === 0 && <p className="mm-empty">No rolls in stock.</p>}

          {!stockLoading && rolls.length > 0 && (
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-hover">
                <thead>
                  <tr>
                    <th>Roll / Colour</th>
                    <th>Cut</th>
                    <th>Location</th>
                    <th className="mm-num">Box</th>
                    <th className="mm-num">Weight (Kg)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rolls.map((r) => (
                    <tr key={r.name}>
                      <td>{r.color_name || "—"}</td>
                      <td>{r.cut || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td className="mm-num">{(r.stock_box ?? 0).toLocaleString()}</td>
                      <td className="mm-num">{(r.available_weight ?? 0).toLocaleString()}</td>
                      <td className="mm-td-actions">
                        <button
                          type="button"
                          className="mm-cut-go"
                          title="Send to cutting"
                          onClick={() => startCutting(r)}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* RIGHT: cutting in progress */}
        <section className="mm-card mm-card-pad">
          <div className="mm-cut-panel-head">
            <h2 className="mm-panel-title">
              <Scissors size={16} /> In cutting processing
            </h2>
          </div>

          {procLoading && <p className="mm-muted">Loading…</p>}
          {!procLoading && (processing?.length ?? 0) === 0 && (
            <p className="mm-empty">Nothing in cutting right now.</p>
          )}

          {!procLoading && (processing?.length ?? 0) > 0 && (
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-hover">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Order</th>
                    <th>Roll</th>
                    <th>Cut</th>
                    <th className="mm-num">Patti</th>
                    <th className="mm-num">Net Wt</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {processing!.map((c) => (
                    <tr key={c.name}>
                      <td>{c.posting_date || "—"}</td>
                      <td>{c.customer_order || "—"}</td>
                      <td>{c.roll_no || "—"}</td>
                      <td>{c.cut || "—"}</td>
                      <td className="mm-num">{(c.total_patti_qty ?? 0).toLocaleString()}</td>
                      <td className="mm-num">{(c.total_net_weight ?? 0).toLocaleString()}</td>
                      <td className="mm-td-actions">
                        <Link className="mm-link mm-link-pill" to={`/cutting/${encodeURIComponent(c.name)}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
