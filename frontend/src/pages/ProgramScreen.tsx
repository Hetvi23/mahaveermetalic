import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import {
  Plus, X, Power, RotateCcw, Check, CheckCircle2, Undo2, Monitor, LayoutGrid, List,
} from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.program";
const today = () => new Date().toISOString().slice(0, 10);
const SHIFTS = ["Day", "Night"] as const;
const DEFAULT_COLS = 4;

type Machine = { name: string; machine_no: string; machine_name?: string; cut?: string; closed?: number; active_programs?: number };
type Program = {
  name: string; program_date?: string; customer_order?: string; roll_no?: string; shade?: string;
  machine_no?: string; shift?: string; cut?: string; status?: string; is_running?: number; closed?: number;
  released?: number; total_batches?: number; completed_batches?: number; net_weight?: number;
};
type Roll = {
  state: string; source_type: string; cutting?: string; inward_item?: string; date?: string;
  customer_order?: string; roll_no?: string; shade?: string; cut?: string; party?: string; batches?: number; weight?: number;
};
type OrderOpt = { name: string };
type OnMachine = { name: string; roll_no?: string; cut?: string; shift?: string; status?: string; total_batches?: number; completed_batches?: number };

const stateClass = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;

export default function ProgramScreen() {
  const [view, setView] = useState<"grid" | "list">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "grid",
  );
  const [date, setDate] = useState(today());
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [adding, setAdding] = useState<{ machine?: string } | null>(null);
  const [closing, setClosing] = useState<Machine | null>(null);
  const [reverting, setReverting] = useState<Program | null>(null);

  const machinesCall = useFrappeGetCall<{ message: Machine[] }>(`${API}.list_machines`, undefined, "pg-machines");
  const progCall = useFrappeGetCall<{ message: Program[] }>(`${API}.threads_processing`, { program_date: date }, `pg-threads-${date}`);

  const { call: addMachine } = useFrappePostCall(`${API}.add_machine`);
  const { call: reopen } = useFrappePostCall(`${API}.reopen_machine`);
  const { call: complete } = useFrappePostCall(`${API}.complete_batches`);
  const { call: free } = useFrappePostCall(`${API}.free_program`);

  const machines = machinesCall.data?.message ?? [];
  const programs = progCall.data?.message ?? [];

  const refresh = () => { void machinesCall.mutate(); void progCall.mutate(); };
  const guard = (fn: () => Promise<unknown>) => async () => { try { await fn(); refresh(); } catch (e) { alert(extractErrorMessage(e)); } };

  // Programs grouped per machine, in column order.
  const byMachine = useMemo(() => {
    const m: Record<string, Program[]> = {};
    for (const p of programs) (m[p.machine_no || "—"] ||= []).push(p);
    return m;
  }, [programs]);

  const colCount = Math.max(cols, ...machines.map((m) => (byMachine[m.name]?.length ?? 0)), 1);
  const columns = Array.from({ length: colCount }, (_, i) => i);

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Program</h1>
          <p className="mm-page-sub">Machines run down the rows; each column is a program slot. Finished cuttings &amp; inventory rolls feed the picker.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <label className="mm-field-inline">
            <span className="mm-field-label-inline">Date</span>
            <input className="mm-input mm-input-compact" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="mm-seg">
            <button className={`mm-seg-btn ${view === "grid" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("grid")}><LayoutGrid size={15} /> Board</button>
            <button className={`mm-seg-btn ${view === "list" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("list")}><List size={15} /> List</button>
          </div>
          <button className="mm-btn-primary" onClick={() => setAdding({})}><Plus size={15} /> Add program</button>
        </div>
      </header>

      {view === "list" ? (
        <ProgramList />
      ) : (
        <>
          <div className="mm-table-scroll">
            <table className="mm-prog-table">
              <thead>
                <tr>
                  <th className="mm-prog-mcell">Machine</th>
                  {columns.map((c) => <th key={c} className="mm-prog-col">Program {c + 1}</th>)}
                  <th className="mm-prog-addcol">
                    <button className="mm-prog-addcol-btn" title="Add column" onClick={() => setCols((n) => Math.max(colCount, n) + 1)}><Plus size={16} /></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const list = byMachine[m.name] ?? [];
                  return (
                    <tr key={m.name} className={m.closed ? "mm-prog-row-closed" : ""}>
                      <td className="mm-prog-mcell">
                        <div className="mm-prog-mname"><Monitor size={15} /> Machine {m.machine_no}</div>
                        <MachineCutInput machine={m.name} value={m.cut} onSaved={refresh} />
                        {m.closed ? (
                          <>
                            <span className="mm-state mm-state-open">Not working</span>
                            <div style={{ marginTop: "0.5rem" }}>
                              <button className="mm-mini mm-mini-ok" onClick={guard(() => reopen({ machine: m.name }))}><Power size={13} /> Reopen</button>
                            </div>
                          </>
                        ) : (
                          <button className="mm-mini mm-mini-danger" onClick={() => setClosing(m)}><Power size={13} /> Close</button>
                        )}
                      </td>
                      {columns.map((c) => {
                        const p = list[c];
                        return (
                          <td key={c} className="mm-prog-col">
                            {p ? (
                              <div className="mm-prog-card">
                                <div className="mm-prog-card-top">
                                  <span className="mm-prog-card-name">{p.roll_no || p.shade || "—"}</span>
                                  <span className={stateClass(p.status)}>{p.status}</span>
                                </div>
                                <div className="mm-prog-card-meta">
                                  {p.shift || "—"} · {p.cut || "—"} · {p.completed_batches ?? 0}/{p.total_batches ?? 0} batches · {(p.net_weight ?? 0).toLocaleString()} kg
                                </div>
                                <div className="mm-prog-actions">
                                  <button className="mm-mini" disabled={(p.completed_batches ?? 0) >= (p.total_batches ?? 0)} onClick={guard(() => complete({ program: p.name, count: 1 }))}><Check size={13} /> Complete</button>
                                  <button className="mm-mini mm-mini-warn" disabled={p.status === "Open"} onClick={() => setReverting(p)}><Undo2 size={13} /> Revert</button>
                                  {p.status === "Completed" && (
                                    <button className="mm-mini mm-mini-ok" onClick={guard(() => free({ program: p.name }))}><CheckCircle2 size={13} /> Free</button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="mm-prog-cell-empty">
                                {m.closed ? <span className="mm-muted" style={{ fontSize: "0.78rem" }}>—</span> : (
                                  <button className="mm-mini" onClick={() => setAdding({ machine: m.name })}><Plus size={13} /> Add program</button>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mm-add-row">
            <button className="mm-btn-secondary" onClick={guard(() => addMachine({}))}><Plus size={15} /> Add machine</button>
          </div>
        </>
      )}

      {adding && <AddProgramModal date={date} machines={machines} presetMachine={adding.machine} onClose={() => setAdding(null)} onDone={() => { setAdding(null); refresh(); }} />}
      {closing && <CloseMachineModal machine={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} />}
      {reverting && <RevertDialog program={reverting} onClose={() => setReverting(null)} onDone={() => { setReverting(null); refresh(); }} />}
    </div>
  );
}

/* ── Revert: report how many batches completed; the rest return to Open ── */
function RevertDialog({ program, onClose, onDone }: { program: Program; onClose: () => void; onDone: () => void }) {
  const total = program.total_batches ?? 0;
  const [completed, setCompleted] = useState(program.completed_batches ?? 0);
  const { call, loading } = useFrappePostCall(`${API}.revert_batches`);
  const [err, setErr] = useState<string | null>(null);
  const remaining = Math.max(0, total - completed);

  async function submit() {
    setErr(null);
    try { await call({ program: program.name, completed }); onDone(); }
    catch (e) { setErr(extractErrorMessage(e)); }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Revert — {program.roll_no || "program"}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-page-sub" style={{ marginTop: 0 }}>How many of the {total} batches were actually completed? The rest return to Open.</p>
          <label className="mm-field">
            <span className="mm-field-label">Batches completed</span>
            <input className="mm-input" type="number" min={0} max={total} value={completed}
              onChange={(e) => setCompleted(Math.max(0, Math.min(total, Number(e.target.value) || 0)))} />
          </label>
          <p className="mm-muted" style={{ marginTop: "0.6rem" }}>
            {completed} completed · <strong>{remaining} will return to Open</strong>
            {completed >= total ? " (program Completed)" : completed === 0 ? " (program Open)" : " (Partially Done)"}
          </p>
          {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Revert"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Per-machine Cut (editable; every program on the machine inherits it) ── */
function MachineCutInput({ machine, value, onSaved }: { machine: string; value?: string; onSaved: () => void }) {
  const [v, setV] = useState(value ?? "");
  const { call } = useFrappePostCall(`${API}.set_machine_cut`);
  // keep in sync if the machine's saved cut changes elsewhere
  const saved = value ?? "";
  async function save() {
    if (v.trim() === saved.trim()) return;
    try { await call({ machine, cut: v.trim() }); onSaved(); } catch { /* ignore */ }
  }
  return (
    <input
      className="mm-input mm-input-compact mm-mach-cut"
      placeholder="Cut id"
      title="Default cut for this machine — all its programs use this"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === "Enter" && void save()}
    />
  );
}

/* ── Add program (chip picker) ──────────────────────────── */
function AddProgramModal({ date, machines, presetMachine, onClose, onDone }: { date: string; machines: Machine[]; presetMachine?: string; onClose: () => void; onDone: () => void }) {
  const rollsCall = useFrappeGetCall<{ message: Roll[] }>(`${API}.available_rolls`, undefined, "pg-rolls");
  const { call: create, loading } = useFrappePostCall(`${API}.create_program`);
  const rolls = rollsCall.data?.message ?? [];

  const [sel, setSel] = useState<Roll | null>(null);
  const [machine, setMachine] = useState(presetMachine ?? machines.find((m) => !m.closed)?.name ?? "");
  const [shift, setShift] = useState<string>("Day");
  const [order, setOrder] = useState("");
  const [batches, setBatches] = useState(1);
  const [weight, setWeight] = useState<number | "">("");
  const [jobWork, setJobWork] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options_for_party`,
    sel ? { party: sel.party ?? "", customer_order: sel.customer_order ?? "" } : undefined,
    sel ? `pg-orders-${sel.customer_order}` : undefined,
  );
  const orders = orderOpts.data?.message ?? [];

  function pick(r: Roll) {
    setSel(r);
    setOrder(r.customer_order || "");
    setBatches(r.batches || 1);
    setWeight(r.weight ?? "");
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!sel) return setErr("Pick a roll / patty from the list.");
    if (!machine) return setErr("Choose a machine.");
    try {
      await create({
        source_cutting: sel.source_type === "cutting" ? sel.cutting : undefined,
        source_inward_item: sel.source_type === "inward" ? sel.inward_item : undefined,
        machine_no: machine, shift,
        customer_order: order || sel.customer_order,
        total_batches: batches,
        weight: weight === "" ? sel.weight : weight,
        program_date: date,
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
          <span className="mm-modal-title">Add program{presetMachine ? ` — Machine ${machines.find((m) => m.name === presetMachine)?.machine_no ?? ""}` : ""}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-field-label" style={{ marginBottom: "0.4rem" }}>Pick a roll / patty</p>
          {rollsCall.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : rolls.length === 0 ? (
            <p className="mm-empty">Nothing available to program.</p>
          ) : (
            <div style={{ maxHeight: "230px", overflow: "auto", marginBottom: "1rem" }}>
              {rolls.map((r, i) => {
                const id = r.cutting || r.inward_item || String(i);
                const isSel = sel && (sel.cutting || sel.inward_item) === (r.cutting || r.inward_item);
                return (
                  <div key={id} className={`mm-pick-row ${isSel ? "mm-pick-row-active" : ""}`} onClick={() => pick(r)}>
                    <span className={stateClass(r.state)}>{r.state}</span>
                    <span>{(r.roll_no || r.shade || "—")} · {r.cut || "—"}{r.party ? ` · ${r.party}` : ""}</span>
                    <span className="mm-prog-card-meta">{r.batches ?? 0} btch · {(r.weight ?? 0).toLocaleString()} kg</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Machine *</span>
              <select className="mm-input" value={machine} onChange={(e) => setMachine(e.target.value)}>
                <option value="">— choose —</option>
                {machines.map((m) => <option key={m.name} value={m.name} disabled={!!m.closed}>Machine {m.machine_no}{m.closed ? " (closed)" : ""}</option>)}
              </select>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Shift</span>
              <select className="mm-input" value={shift} onChange={(e) => setShift(e.target.value)}>
                {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Customer Order</span>
              <select className="mm-input" value={order} onChange={(e) => setOrder(e.target.value)}>
                <option value="">{sel?.customer_order || "—"}</option>
                {orders.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Total Batches *</span>
              <input className="mm-input" type="number" min={1} value={batches} onChange={(e) => setBatches(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Weight (Kg) *</span>
              <input className="mm-input" type="number" value={weight} onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Submit"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Close machine (faulty) — revert by batches per program ─ */
function CloseMachineModal({ machine, onClose, onDone }: { machine: Machine; onClose: () => void; onDone: () => void }) {
  const onMach = useFrappeGetCall<{ message: OnMachine[] }>(`${API}.programs_on_machine`, { machine: machine.name }, `pg-onmach-${machine.name}`);
  const { call: close, loading } = useFrappePostCall(`${API}.close_machine`);
  const rows = onMach.data?.message ?? [];
  const [reverts, setReverts] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      await close({
        machine: machine.name,
        reverts: rows.filter((r) => (reverts[r.name] || 0) > 0).map((r) => ({ program: r.name, batches: reverts[r.name] })),
      });
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Close Machine {machine.machine_no} (not working)</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {onMach.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="mm-empty">No programs on this machine — it will just be marked closed.</p>
          ) : (
            <>
              <p className="mm-page-sub" style={{ marginTop: 0 }}>For each program, how many batches to revert?</p>
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-dense">
                  <thead><tr><th>Program</th><th>Cut</th><th className="mm-num">Done / Total</th><th className="mm-num">Revert</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name}>
                        <td>{r.roll_no || r.name}</td>
                        <td>{r.cut || "—"}</td>
                        <td className="mm-num">{r.completed_batches ?? 0} / {r.total_batches ?? 0}</td>
                        <td className="mm-num">
                          <input className="mm-input mm-input-compact mm-iw-num" type="number" min={0} max={r.completed_batches ?? 0}
                            value={reverts[r.name] ?? 0}
                            onChange={(e) => setReverts((p) => ({ ...p, [r.name]: Math.max(0, Math.min(r.completed_batches ?? 0, Number(e.target.value) || 0)) }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-danger" disabled={loading} onClick={() => void submit()}><RotateCcw size={14} /> {loading ? "Closing…" : "Close machine"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── List view ──────────────────────────────────────────── */
type ListRow = {
  key: string; date?: string; order?: string; roll?: string; cut?: string;
  source: string; machine?: string; shift?: string; batches: string; weight?: number; status: string;
};

function ProgramList() {
  // Available pool: finished cuttings + inventory rolls not yet programmed = "Open".
  const rollsCall = useFrappeGetCall<{ message: Roll[] }>(`${API}.available_rolls`, undefined, "pg-rolls-list");
  // Actual programs (assigned to a machine).
  const progsCall = useFrappeGetDocList<Program>("MM Program", {
    fields: ["name", "program_date", "customer_order", "roll_no", "machine_no", "shift", "cut", "status", "total_batches", "completed_batches", "net_weight"],
    filters: [["docstatus", "<", 2]],
    orderBy: { field: "modified", order: "desc" },
    limit: 200,
  });

  const isLoading = rollsCall.isLoading || progsCall.isLoading;
  const available: ListRow[] = (rollsCall.data?.message ?? [])
    .filter((r) => r.state !== "In Cutting") // still being cut → not yet open
    .map((r, i) => ({
      key: `a-${r.cutting || r.inward_item || i}`,
      date: r.date, order: r.customer_order, roll: r.roll_no || r.shade, cut: r.cut,
      source: r.state === "In Inventory" ? "Inventory" : "Cut",
      machine: "—", shift: "—", batches: String(r.batches ?? "—"), weight: r.weight, status: "Open",
    }));
  const programs: ListRow[] = (progsCall.data ?? []).map((p) => ({
    key: `p-${p.name}`, date: p.program_date, order: p.customer_order, roll: p.roll_no, cut: p.cut,
    source: "Program", machine: p.machine_no || "—", shift: p.shift || "—",
    batches: `${p.completed_batches ?? 0}/${p.total_batches ?? 0}`, weight: p.net_weight, status: p.status || "—",
  }));
  const rows = [...available, ...programs];

  return (
    <section className="mm-card mm-card-pad">
      {isLoading && <p className="mm-muted">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="mm-empty">Nothing at the program stage yet.</p>}
      {rows.length > 0 && (
        <div className="mm-table-scroll">
          <table className="mm-table mm-table-hover">
            <thead><tr><th>Date</th><th>Order</th><th>Roll</th><th>Cut</th><th>Source</th><th>Machine</th><th>Shift</th><th className="mm-num">Batches</th><th className="mm-num">Wt</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.date || "—"}</td>
                  <td>{r.order || "—"}</td>
                  <td>{r.roll || "—"}</td>
                  <td>{r.cut || "—"}</td>
                  <td><span className={`mm-state mm-state-${r.source.toLowerCase()}`}>{r.source}</span></td>
                  <td>{r.machine}</td>
                  <td>{r.shift}</td>
                  <td className="mm-num">{r.batches}</td>
                  <td className="mm-num">{(r.weight ?? 0).toLocaleString()}</td>
                  <td><span className={stateClass(r.status)}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
