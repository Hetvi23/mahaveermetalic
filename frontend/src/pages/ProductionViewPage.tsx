import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Scissors, RefreshCw } from "lucide-react";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const today = () => new Date().toISOString().slice(0, 10);

type Row = {
  batch: number;
  lot_id?: string | null;
  cut?: string | null;
  machine_no?: string | null;
  program?: string;
  status?: string;
  done?: boolean;
  unfinished?: boolean;
};
type ColourGroup = { color: string; rows: Row[] };
type InCutting = {
  cutting: string;
  color: string;
  cut?: string | null;
  lot_id?: string | null;
  patty?: number;
  weight?: number;
  status?: string;
  customer_order?: string | null;
};
type ViewData = { date: string; in_cutting: InCutting[]; day: ColourGroup[]; night: ColourGroup[] };

/** Colour block: the colour name, then one line per batch — batch no, lot id, cut. */
function ShiftColumn({ title, groups }: { title: string; groups: ColourGroup[] }) {
  const batches = groups.reduce((s, g) => s + g.rows.length, 0);
  return (
    <section className="mm-pvw-col">
      <header className="mm-pvw-col-head">
        <h2>{title}</h2>
        <span className="mm-pill mm-pill-muted">{batches} batch{batches === 1 ? "" : "es"}</span>
      </header>
      {groups.length === 0 ? (
        <p className="mm-pvw-empty">Nothing planned.</p>
      ) : (
        groups.map((g) => (
          <div className="mm-pvw-colour" key={g.color}>
            <div className="mm-pvw-colour-name">{g.color}</div>
            <table className="mm-table mm-table-dense mm-pvw-table">
              <thead>
                <tr><th className="mm-num">Batch</th><th>Lot ID</th><th>Cut</th><th>Machine</th></tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={`${r.program}-${r.batch}-${i}`} className={r.done ? "mm-pvw-done" : undefined}>
                    <td className="mm-num">{r.batch}</td>
                    <td>{r.lot_id || "—"}</td>
                    <td>{r.cut || "—"}</td>
                    <td>{r.machine_no || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * Read-only production day sheet: pick a date, see what's in cutting, then the Day and
 * Night plan side by side — grouped by colour, one line per batch (batch · lot · cut).
 */
export default function ProductionViewPage() {
  const [date, setDate] = useState(today());
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: ViewData }>(
    `${API}.production_view`,
    { date },
    `prod-view-${date}`,
  );
  const v = data?.message;

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Production view</h1>
          <p className="mm-page-sub">What&apos;s in cutting, and the day&apos;s plan by shift — view only.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <label className="mm-field mm-field-inline">
            <span className="mm-field-label">Date</span>
            <input className="mm-input mm-input-compact" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void mutate()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {isLoading && <p className="mm-muted">Loading…</p>}

      {/* In cutting */}
      <section className="mm-card mm-card-pad" style={{ marginBottom: "1.25rem" }}>
        <div className="mm-iw-sec-head">
          <h2 className="mm-panel-title"><Scissors size={16} /> In cutting data</h2>
          <span className="mm-pill mm-pill-muted">{v?.in_cutting.length ?? 0}</span>
        </div>
        {!v || v.in_cutting.length === 0 ? (
          <p className="mm-empty">Nothing in cutting.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Color</th><th>Lot ID</th><th>Cut</th>
                  <th className="mm-num">Patty</th><th className="mm-num">Weight (Kg)</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {v.in_cutting.map((c) => (
                  <tr key={c.cutting}>
                    <td><span className="mm-colour-name">{c.color}</span></td>
                    <td>{c.lot_id || "—"}</td>
                    <td>{c.cut || "—"}</td>
                    <td className="mm-num">{c.patty ?? 0}</td>
                    <td className="mm-num">{(c.weight ?? 0).toLocaleString()}</td>
                    <td><span className="mm-state-chip mm-state-inventory">{c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Day | Night */}
      <div className="mm-pvw-grid">
        <ShiftColumn title="Day" groups={v?.day ?? []} />
        <ShiftColumn title="Night" groups={v?.night ?? []} />
      </div>
    </div>
  );
}
