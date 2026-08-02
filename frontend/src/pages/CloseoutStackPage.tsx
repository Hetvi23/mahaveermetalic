import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Undo2, Archive, RefreshCw } from "lucide-react";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.closeout";

type Closed = {
  doctype: string;
  name: string;
  closed_on?: string | null;
  close_mode?: string | null;
  leftover_weight?: number | null;
  customer_order?: string | null;
  lot_id?: string | null;
  color?: string | null;
  cut?: string | null;
  weight?: number | null;
};

type Filter = "all" | "MM Cutting" | "MM Production";

/**
 * Close-out stack: every cutting/production whose leftover was closed — automatically
 * (within tolerance, nothing more of that lot coming) or by a force close. Each row can
 * be reverted, which puts the record back in play.
 */
export default function CloseoutStackPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading, mutate } = useFrappeGetCall<{ message: Closed[] }>(
    `${API}.closed_stack`,
    filter === "all" ? { limit: 200 } : { doctype: filter, limit: 200 },
    `closeout-${filter}`,
  );
  const { call: reopen, loading: reopening } = useFrappePostCall(`${API}.reopen`);
  const rows = data?.message ?? [];

  async function onRevert(r: Closed) {
    if (!window.confirm(`Revert the close on ${r.name}? It becomes available again.`)) return;
    setErr(null);
    try {
      await reopen({ doctype: r.doctype, name: r.name });
      await mutate();
      toast(`${r.name} reopened`);
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  const label = (dt: string) => (dt === "MM Cutting" ? "Cutting" : "Production");

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Close-out stack</h1>
          <p className="mm-page-sub">Leftovers that were closed — auto (within tolerance) or forced. Revert any of them to put it back in play.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <div className="mm-chips">
            {(["all", "MM Cutting", "MM Production"] as Filter[]).map((f) => (
              <button key={f} type="button" className={`mm-chip ${filter === f ? "mm-chip-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : label(f)}
              </button>
            ))}
          </div>
          <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void mutate()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {err && <p className="mm-error">{err}</p>}

      <section className="mm-card mm-card-pad">
        <div className="mm-iw-sec-head">
          <h2 className="mm-panel-title"><Archive size={16} /> Closed</h2>
          <span className="mm-pill mm-pill-muted">{rows.length}</span>
        </div>
        {isLoading ? (
          <p className="mm-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mm-empty">Nothing closed out.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Type</th><th>Ref</th><th>Color</th><th>Lot ID</th><th>Cut</th>
                  <th className="mm-num">Weight</th><th className="mm-num">Leftover</th>
                  <th>Closed</th><th>Mode</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.doctype}-${r.name}`}>
                    <td>{label(r.doctype)}</td>
                    <td>{r.name}</td>
                    <td><span className="mm-colour-name">{r.color || "—"}</span></td>
                    <td>{r.lot_id || "—"}</td>
                    <td>{r.cut || "—"}</td>
                    <td className="mm-num">{(r.weight ?? 0).toLocaleString()}</td>
                    <td className="mm-num">{(r.leftover_weight ?? 0).toLocaleString()}</td>
                    <td>{r.closed_on ? r.closed_on.slice(0, 16) : "—"}</td>
                    <td>
                      <span className={`mm-state-chip ${r.close_mode === "Force" ? "mm-state-inventory" : "mm-state-cut"}`}>
                        {r.close_mode || "Auto"}
                      </span>
                    </td>
                    <td className="mm-num">
                      <button type="button" className="mm-mini mm-mini-warn" disabled={reopening} onClick={() => void onRevert(r)}>
                        <Undo2 size={13} /> Revert
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
