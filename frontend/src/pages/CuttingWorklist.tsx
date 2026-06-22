import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, Scissors, CheckCircle2, X, LayoutGrid, List } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.cutting";
const today = () => new Date().toISOString().slice(0, 10);

type Group = {
  customer_order: string;
  party?: string;
  party_name?: string;
  rolls?: string[];
  roll_display?: string;
  entry_count: number;
  total_weight: number;
  latest_inward_date?: string;
};
type Entry = {
  inward_item: string;
  inward_date?: string;
  challan_number?: string;
  customer_order?: string;
  roll_name?: string;
  color_name?: string;
  cut?: string;
  qty_box?: number;
  weight?: number;
  job_work?: number;
};
type OrderOpt = { name: string; delivery_date?: string; required_weight?: number };
type BoardCard = {
  name: string;
  posting_date?: string;
  customer_order?: string;
  roll_no?: string;
  shade?: string;
  cut?: string;
  roll_qty?: number;
  total_patti_qty?: number;
  total_net_weight?: number;
  status?: string;
  program?: string;
};

const stateClass = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;
const CUT_STATUSES = ["Draft", "Open", "In Progress", "Completed"];

/**
 * Cutting screen: send order-grouped inward rolls into cutting (worklist), and a flat
 * list view of every cutting. Worklist = left "In Stock" (inward grouped by order) →
 * arrow opens a modal of that order's entries → assign into cutting → right "In Cutting
 * Processing", where a finished cutting becomes a patty for Program.
 */
export default function CuttingWorklist() {
  const [view, setView] = useState<"worklist" | "list">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "worklist",
  );
  const [active, setActive] = useState<Group | null>(null);

  const stock = useFrappeGetCall<{ message: Group[] }>(`${API}.inward_stock_by_order`, undefined, "cut-stock");
  const board = useFrappeGetCall<{ message: BoardCard[] }>(`${API}.cutting_board`, undefined, "cut-board");
  const { call: finish } = useFrappePostCall(`${API}.complete_cutting`);

  const groups = stock.data?.message ?? [];
  const cards = board.data?.message ?? [];

  // group cutting cards by Cut → columns
  const byCut = useMemo(() => {
    const m: Record<string, BoardCard[]> = {};
    for (const c of cards) (m[c.cut || "—"] ||= []).push(c);
    return m;
  }, [cards]);
  const cuts = Object.keys(byCut);

  const refreshAll = () => {
    void stock.mutate();
    void board.mutate();
  };

  async function onFinish(name: string) {
    try {
      await finish({ cutting: name });
      refreshAll();
    } catch (e) {
      alert(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Cutting</h1>
          <p className="mm-page-sub">Send in-stock rolls (grouped by order) into cutting; finished cuttings become patties.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <div className="mm-seg" role="tablist">
            <button className={`mm-seg-btn ${view === "worklist" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("worklist")}>
              <LayoutGrid size={15} /> Worklist
            </button>
            <button className={`mm-seg-btn ${view === "list" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("list")}>
              <List size={15} /> List
            </button>
          </div>
        </div>
      </header>

      {view === "worklist" ? (
        <>
          {/* In stock rolls — send into cutting */}
          <section className="mm-card mm-card-pad" style={{ marginBottom: "1.25rem" }}>
            <div className="mm-cut-panel-head"><h2 className="mm-panel-title">In stock roll</h2></div>
            {stock.isLoading && <p className="mm-muted">Loading…</p>}
            {!stock.isLoading && groups.length === 0 && <p className="mm-empty">No in-stock inward against any order.</p>}
            {groups.length > 0 && (
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-hover">
                  <thead>
                    <tr><th>Chalan Date</th><th>Order</th><th>Roll</th><th className="mm-num">Qty</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.customer_order}>
                        <td>{g.latest_inward_date || "—"}</td>
                        <td>{g.party_name || g.customer_order}</td>
                        <td>{g.roll_display || "—"}</td>
                        <td className="mm-num">{g.entry_count}</td>
                        <td className="mm-num">{(g.total_weight ?? 0).toLocaleString()}</td>
                        <td className="mm-td-actions">
                          <button type="button" className="mm-cut-go" title="Send to cutting" onClick={() => setActive(g)}>
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

          {/* In cutting — grouped by Cut (cut = column, each cutting = a card) */}
          <div className="mm-cut-panel-head"><h2 className="mm-panel-title"><Scissors size={16} /> In cutting — by cut</h2></div>
          {board.isLoading && <p className="mm-muted">Loading…</p>}
          {!board.isLoading && cards.length === 0 && <p className="mm-empty">Nothing in cutting right now.</p>}
          {cards.length > 0 && (
            <div className="mm-cutboard">
              {cuts.map((cut) => (
                <div className="mm-cutcol" key={cut}>
                  <div className="mm-cutcol-head">Cut {cut}</div>
                  <div className="mm-cutcol-body">
                    {byCut[cut].map((c) => (
                      <div className="mm-prog-card" key={c.name}>
                        <div className="mm-prog-card-top">
                          <span className="mm-prog-card-name">{c.roll_no || c.shade || "—"}</span>
                          <span className={stateClass(c.status)}>{c.status}</span>
                        </div>
                        <div className="mm-prog-card-meta">
                          {c.customer_order || "—"} · {(c.total_patti_qty ?? 0)} patty · {(c.total_net_weight ?? 0).toLocaleString()} kg{c.program ? " · planned" : ""}
                        </div>
                        <div className="mm-prog-actions">
                          {c.status !== "Completed" && (
                            <button className="mm-mini mm-mini-ok" onClick={() => void onFinish(c.name)} title="Mark finished (becomes a patty)">
                              <CheckCircle2 size={13} /> Finish
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <CuttingList />
      )}

      {active && (
        <CuttingModal group={active} onClose={() => setActive(null)} onDone={() => { setActive(null); refreshAll(); }} />
      )}
    </div>
  );
}

/* ── Assign modal ───────────────────────────────────────── */
function CuttingModal({ group, onClose, onDone }: { group: Group; onClose: () => void; onDone: () => void }) {
  const entries = useFrappeGetCall<{ message: Entry[] }>(
    `${API}.inward_entries_for_order`, { customer_order: group.customer_order }, `cut-entries-${group.customer_order}`,
  );
  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options_for_party`, { party: group.party ?? "", customer_order: group.customer_order }, `cut-orders-${group.customer_order}`,
  );
  const { call: create, loading } = useFrappePostCall(`${API}.create_cutting`);

  const rows = entries.data?.message ?? [];
  const orders = orderOpts.data?.message ?? [];

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState(group.customer_order);
  const [jobWork, setJobWork] = useState(false);
  const [cuttingDate, setCuttingDate] = useState(today());
  const [weight, setWeight] = useState<number | "">("");
  const [noPatty, setNoPatty] = useState(1);
  const [cut, setCut] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(() => rows.filter((r) => picked[r.inward_item]), [rows, picked]);
  const selWeight = selected.reduce((s, r) => s + (r.weight || 0), 0);

  function toggle(r: Entry) {
    setPicked((p) => ({ ...p, [r.inward_item]: !p[r.inward_item] }));
    if (!cut && r.cut) setCut(r.cut);
  }

  async function submit() {
    setErr(null);
    if (selected.length === 0) return setErr("Select at least one inward entry.");
    try {
      await create({
        inward_items: selected.map((r) => r.inward_item),
        customer_order: order,
        cut: cut || selected[0].cut,
        weight: weight === "" ? selWeight : weight,
        no_of_patty: noPatty,
        cutting_date: cuttingDate,
        job_work: jobWork ? 1 : 0,
      });
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal mm-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Cutting — {group.party_name || group.customer_order}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {entries.isLoading ? (
            <p className="mm-muted">Loading entries…</p>
          ) : rows.length === 0 ? (
            <p className="mm-empty">No in-stock entries for this order.</p>
          ) : (
            <div className="mm-table-scroll" style={{ marginBottom: "1rem" }}>
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th /><th>Inward Date</th><th>Chalan No</th><th>Roll</th><th>Cut</th><th className="mm-num">Weight (Kg)</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.inward_item} className={picked[r.inward_item] ? "mm-ws-row-active" : undefined} onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
                      <td><input type="checkbox" checked={!!picked[r.inward_item]} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /></td>
                      <td>{r.inward_date || "—"}</td>
                      <td>{r.challan_number || "—"}</td>
                      <td>{r.roll_name || "—"}</td>
                      <td>{r.cut || "—"}</td>
                      <td className="mm-num">{(r.weight ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Customer Order</span>
              <select className="mm-input" value={order} onChange={(e) => setOrder(e.target.value)}>
                {orders.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cutting Date *</span>
              <input className="mm-input" type="date" value={cuttingDate} onChange={(e) => setCuttingDate(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Weight (Kg) *</span>
              <input className="mm-input" type="number" placeholder={String(selWeight || "")} value={weight} onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">No of Patty *</span>
              <input className="mm-input" type="number" min={1} value={noPatty} onChange={(e) => setNoPatty(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cut</span>
              <input className="mm-input" value={cut} onChange={(e) => setCut(e.target.value)} placeholder="Cut" />
            </label>
          </div>
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <span className="mm-muted" style={{ marginRight: "auto" }}>{selected.length} selected · {selWeight.toLocaleString()} kg</span>
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Submit"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Flat list view (status editable inline) ────────────── */
function CuttingList() {
  const { data, isLoading, mutate } = useFrappeGetDocList<BoardCard & { docstatus?: number }>("MM Cutting", {
    fields: ["name", "posting_date", "customer_order", "roll_no", "cut", "roll_qty", "total_patti_qty", "total_net_weight", "status"],
    filters: [["docstatus", "<", 2]],
    orderBy: { field: "modified", order: "desc" },
    limit: 200,
  });
  const { call: setStatus } = useFrappePostCall(`${API}.set_cutting_status`);
  const rows = data ?? [];

  async function onStatus(name: string, status: string) {
    try {
      await setStatus({ cutting: name, status });
      void mutate();
    } catch (e) {
      alert(extractErrorMessage(e));
    }
  }

  return (
    <section className="mm-card mm-card-pad">
      {isLoading && <p className="mm-muted">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="mm-empty">No cuttings yet.</p>}
      {rows.length > 0 && (
        <div className="mm-table-scroll">
          <table className="mm-table mm-table-hover">
            <thead>
              <tr><th>Date</th><th>Order</th><th>Roll</th><th>Cut</th><th className="mm-num">Roll | Patty</th><th className="mm-num">Net Wt</th><th>Status (editable)</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>{c.posting_date || "—"}</td>
                  <td>{c.customer_order || "—"}</td>
                  <td>{c.roll_no || "—"}</td>
                  <td>{c.cut || "—"}</td>
                  <td className="mm-num">{c.roll_qty ?? 0} | {(c.total_patti_qty ?? 0).toLocaleString()}</td>
                  <td className="mm-num">{(c.total_net_weight ?? 0).toLocaleString()}</td>
                  <td>
                    <select
                      className={`mm-input mm-input-compact mm-status-select ${stateClass(c.status)}`}
                      value={c.status || "Draft"}
                      onChange={(e) => void onStatus(c.name, e.target.value)}
                    >
                      {CUT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
