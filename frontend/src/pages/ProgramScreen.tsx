import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import {
  Plus, X, Power, RotateCcw, Check, Undo2, Monitor, LayoutGrid, List, Search, Trash2, Scissors,
} from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";
import { toast } from "@/components/Toaster";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.program";
const CUT_API = "mahaveermetalic.mahaveer_metallic.api.cutting";
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const SHIFTS = ["Day", "Night"] as const;
type ShiftView = "Day" | "Night" | "Combined";

type Machine = { name: string; machine_no: string; machine_name?: string; cut?: string; closed?: number; active_programs?: number };
type Program = {
  name: string; program_date?: string; customer_order?: string; roll_no?: string; shade?: string;
  machine_no?: string; shift?: string; cut?: string; status?: string; is_running?: number; closed?: number;
  released?: number; reverted?: number; total_batches?: number; completed_batches?: number; net_weight?: number;
  unfinished?: number; remark?: string; roll_inventory?: string;
};
type Roll = {
  state: string; source_type: string; cutting?: string; inward_item?: string; date?: string;
  customer_order?: string; roll_no?: string; shade?: string; cut?: string; party?: string; batches?: number; weight?: number;
};
type Colour = { colour: string; rows: Roll[]; states: string[]; total_weight: number; count: number };
type BoardCard = { name: string; roll_no?: string; shade?: string; cut?: string; status?: string; unfinished?: number; total_net_weight?: number; program_name?: string };
type OrderOpt = { name: string };
type OnMachine = { name: string; roll_no?: string; cut?: string; shift?: string; status?: string; total_batches?: number; completed_batches?: number };

const stateClass = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;
const shiftIcon = (s: string) => (s === "Night" ? "🌙" : "☀");

export default function ProgramScreen() {
  const [view, setView] = useState<"grid" | "list">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "grid",
  );
  const [shiftView, setShiftView] = useState<ShiftView>("Combined");
  const [dayDate, setDayDate] = useState(tomorrow());
  const [nightDate, setNightDate] = useState(today());
  const [adding, setAdding] = useState<{ machine?: string; shift?: string; colour?: string } | null>(null);
  const [pattyCutFilter, setPattyCutFilter] = useState("");
  const [pattyColourFilter, setPattyColourFilter] = useState("");
  const [closing, setClosing] = useState<Machine | null>(null);
  const [completing, setCompleting] = useState<Program | null>(null);

  const nav = useNavigate();
  const machinesCall = useFrappeGetCall<{ message: Machine[] }>(`${API}.list_machines`, undefined, "pg-machines");
  const progCall = useFrappeGetCall<{ message: Program[] }>(`${API}.threads_processing`, undefined, "pg-threads");
  const pattyCall = useFrappeGetCall<{ message: Roll[] }>(`${API}.available_rolls`, { finished_only: 1 }, "pg-patties");
  const cutCall = useFrappeGetCall<{ message: BoardCard[] }>(`${CUT_API}.cutting_board`, undefined, "pg-cutboard");

  const { call: addMachine } = useFrappePostCall(`${API}.add_machine`);
  const { call: removeMachine } = useFrappePostCall(`${API}.remove_machine`);
  const { call: reopen } = useFrappePostCall(`${API}.reopen_machine`);
  const { call: revert } = useFrappePostCall(`${API}.revert_batches`);

  const machines = machinesCall.data?.message ?? [];
  const programs = useMemo(() => progCall.data?.message ?? [], [progCall.data]);
  const patties = pattyCall.data?.message ?? [];
  const cuttings = cutCall.data?.message ?? [];

  const refresh = () => { void machinesCall.mutate(); void progCall.mutate(); void pattyCall.mutate(); void cutCall.mutate(); };
  const guard = (fn: () => Promise<unknown>) => async () => { try { await fn(); refresh(); } catch (e) { const m = extractErrorMessage(e); toast(m, "error"); } };

  // programs[machine][shift]
  // Group by machine + shift, but ONLY for the date each shift column is showing —
  // changing a date empties that column; programs planned for other dates stay on
  // their own date and are untouched.
  const byMachineShift = useMemo(() => {
    const m: Record<string, Record<string, Program[]>> = {};
    for (const p of programs) {
      const sk = p.shift || "Day";
      const wantDate = sk === "Night" ? nightDate : dayDate;
      if (wantDate && String(p.program_date || "") !== wantDate) continue;
      const mk = p.machine_no || "—";
      ((m[mk] ||= {})[sk] ||= []).push(p);
    }
    return m;
  }, [programs, dayDate, nightDate]);

  // Feeder: colours by state (in-cutting / to-cut) from the cutting board.
  const inCuttingColours = useMemo(() => {
    const g: Record<string, { colour: string; toCut: boolean; inCutting: boolean; weight: number }> = {};
    for (const c of cuttings) {
      const k = (c.shade || c.roll_no || "—");
      const e = (g[k] ||= { colour: k, toCut: false, inCutting: false, weight: 0 });
      if (c.unfinished) e.toCut = true; else e.inCutting = true;
      e.weight += Number(c.total_net_weight || 0);
    }
    return Object.values(g);
  }, [cuttings]);

  // Feeder: finished patties grouped by colour + cut + party, with Cut/Colour filters.
  const pattyColours = useMemo(() => {
    const g: Record<string, { colour: string; cut: string; party: string; weight: number; count: number }> = {};
    for (const p of patties) {
      const colour = p.shade || p.roll_no || "—";
      const cut = p.cut || "—";
      const party = p.party || "—";
      const k = `${colour}||${cut}||${party}`;
      const e = (g[k] ||= { colour, cut, party, weight: 0, count: 0 });
      e.weight += Number(p.weight || 0);
      // "No of patty" = the batches (patties) this cutting yielded.
      e.count += Number(p.batches || 0) || 1;
    }
    return Object.values(g);
  }, [patties]);

  const pattyCuts = useMemo(
    () => Array.from(new Set(pattyColours.map((p) => p.cut).filter((c) => c && c !== "—"))).sort(),
    [pattyColours],
  );
  const shownPatties = useMemo(
    () =>
      pattyColours.filter(
        (p) =>
          (!pattyCutFilter || p.cut === pattyCutFilter) &&
          (!pattyColourFilter || p.colour.toLowerCase().includes(pattyColourFilter.trim().toLowerCase())),
      ),
    [pattyColours, pattyCutFilter, pattyColourFilter],
  );

  const shiftCols: string[] = shiftView === "Combined" ? ["Day", "Night"] : [shiftView];
  const shiftDate = (s: string) => (s === "Night" ? nightDate : dayDate);

  function ProgCard({ p }: { p: Program }) {
    return (
      <div className={`mm-prog-card ${p.unfinished ? "mm-prog-card-unfinished" : ""}`}>
        <div className="mm-prog-card-top">
          <span className="mm-prog-card-name">{p.shade || p.roll_no || "—"}</span>
          {p.unfinished ? <span className="mm-state mm-state-unfinished">To cut</span> : <span className={stateClass(p.status)}>{p.status}</span>}
        </div>
        <div className="mm-prog-card-meta">
          {p.cut || "—"} · {p.completed_batches ?? 0}/{p.total_batches ?? 0} batches · {p.unfinished ? "roll not yet picked" : `${kg(p.net_weight)} kg`}
        </div>
        {p.remark && <div className="mm-prog-card-remark">“{p.remark}”</div>}
        <div className="mm-prog-actions">
          {p.unfinished ? (
            <>
              <button className="mm-mini mm-mini-ok" title="Cut this on the Cutting screen (pick the roll there)" onClick={() => nav("/cutting")}><Scissors size={13} /> Finish in Cutting</button>
              <button className="mm-mini mm-mini-warn" onClick={guard(() => revert({ program: p.name }))}><Undo2 size={13} /> Cancel plan</button>
            </>
          ) : (
            <>
              <button className="mm-mini" disabled={!!p.reverted} onClick={() => setCompleting(p)}><Check size={13} /> Complete</button>
              <button className="mm-mini mm-mini-warn" disabled={p.status === "Open" || !!p.reverted} onClick={guard(() => revert({ program: p.name }))}><Undo2 size={13} /> Revert</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Program</h1>
          <p className="mm-page-sub">Colours in cutting &amp; finished patties feed the machines. Plan Day and Night side by side.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <label className="mm-field-inline"><span className="mm-field-label-inline">☀ Day</span>
            <input className="mm-input mm-input-compact" type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} /></label>
          <label className="mm-field-inline"><span className="mm-field-label-inline">🌙 Night</span>
            <input className="mm-input mm-input-compact" type="date" value={nightDate} onChange={(e) => setNightDate(e.target.value)} /></label>
          <div className="mm-seg">
            {(["Combined", "Day", "Night"] as ShiftView[]).map((s) => (
              <button key={s} className={`mm-seg-btn ${shiftView === s ? "mm-seg-btn-active" : ""}`} onClick={() => setShiftView(s)}>{s}</button>
            ))}
          </div>
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
          {/* ── Feeders: in-cutting + finished patties, side by side (colour-first) ── */}
          <div className="mm-feeders">
            <section className="mm-card mm-card-pad">
              <div className="mm-flow-shelf-head" style={{ margin: 0, marginBottom: "0.7rem" }}>
                <span className="mm-flow-num"><Scissors size={12} /></span><h2>In cutting</h2>
                <span className="mm-flow-count">{inCuttingColours.length}</span>
              </div>
              {inCuttingColours.length === 0 ? (
                <p className="mm-flow-empty-state">Nothing in cutting.</p>
              ) : (
                <div className="mm-colour-list">
                  {inCuttingColours.map((c) => (
                    <div key={c.colour} className={`mm-colour-row ${c.toCut ? "mm-colour-row-red" : ""}`}>
                      <span className="mm-colour-name">{c.colour}</span>
                      {c.toCut && <span className="mm-state mm-state-unfinished">to cut</span>}
                      {c.inCutting && <span className="mm-state mm-state-incutting">in cutting</span>}
                      <span className="mm-colour-wt">{kg(c.weight)} kg</span>
                      <button className="mm-mini" onClick={() => nav("/cutting")}>Open Cutting →</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mm-card mm-card-pad">
              <div className="mm-flow-shelf-head" style={{ margin: 0, marginBottom: "0.7rem" }}>
                <span className="mm-flow-num">✓</span><h2>Finished patty</h2>
                <span className="mm-flow-count">{shownPatties.length}</span>
              </div>
              <div className="mm-patty-filters">
                <SearchSelect compact value={pattyCutFilter} placeholder="All cuts"
                  options={pattyCuts.map((c) => ({ value: c, label: c }))} onChange={setPattyCutFilter} />
                <input className="mm-input mm-input-compact" placeholder="Filter colour…" value={pattyColourFilter}
                  onChange={(e) => setPattyColourFilter(e.target.value)} />
              </div>
              {shownPatties.length === 0 ? (
                <p className="mm-flow-empty-state">{pattyColours.length === 0 ? "No finished patties yet." : "No patty matches these filters."}</p>
              ) : (
                <div className="mm-table-scroll">
                  <table className="mm-table mm-table-dense mm-patty-table">
                    <thead>
                      <tr><th>Color</th><th className="mm-num">No of patty</th><th>Cut</th><th>Party</th><th /></tr>
                    </thead>
                    <tbody>
                      {shownPatties.map((c) => (
                        <tr key={`${c.colour}|${c.cut}|${c.party}`}>
                          <td><span className="mm-colour-name">{c.colour}</span></td>
                          <td className="mm-num">{c.count}</td>
                          <td>{c.cut}</td>
                          <td>{c.party}</td>
                          <td className="mm-num">
                            <button className="mm-mini mm-mini-ok" onClick={() => setAdding({ colour: c.colour })}>→ Program</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* ── Machine board (Day / Night / Combined) ── */}
          <div className="mm-table-scroll">
            <table className="mm-prog-table">
              <thead>
                <tr>
                  <th className="mm-prog-mcell">Machine</th>
                  {shiftCols.map((s) => <th key={s} className="mm-prog-col">{shiftIcon(s)} {s} · {shiftDate(s)}</th>)}
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
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
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <button className="mm-mini mm-mini-danger" onClick={() => setClosing(m)}><Power size={13} /> Close</button>
                          {Object.values(byMachineShift[m.name] || {}).flat().length === 0 && (
                            <button className="mm-mini" title="Remove this machine" onClick={guard(() => removeMachine({ machine: m.name }))}><Trash2 size={13} /></button>
                          )}
                        </div>
                      )}
                    </td>
                    {shiftCols.map((s) => {
                      const list = byMachineShift[m.name]?.[s] ?? [];
                      return (
                        <td key={s} className="mm-prog-col">
                          <div className="mm-prog-shiftcell">
                            {list.map((p) => <ProgCard key={p.name} p={p} />)}
                            {!m.closed && (
                              <button className="mm-mini mm-prog-add" onClick={() => setAdding({ machine: m.name, shift: s })}><Plus size={13} /> Add program</button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mm-add-row">
            <button className="mm-btn-secondary" onClick={guard(() => addMachine({}))}><Plus size={15} /> Add machine</button>
          </div>
        </>
      )}

      {adding && (
        <AddProgramModal
          machines={machines}
          presetMachine={adding.machine}
          presetShift={adding.shift}
          presetColour={adding.colour}
          dayDate={dayDate}
          nightDate={nightDate}
          onClose={() => { setAdding(null); refresh(); }}
          onAdded={refresh}
        />
      )}
      {closing && <CloseMachineModal machine={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} />}
      {completing && <CompleteDialog program={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); refresh(); }} />}
    </div>
  );
}

/* ── Complete: report how many batches are done; full → auto-frees to Production ── */
function CompleteDialog({ program, onClose, onDone }: { program: Program; onClose: () => void; onDone: () => void }) {
  const total = program.total_batches ?? 0;
  const [completed, setCompleted] = useState<number | "">(total);
  const { call, loading } = useFrappePostCall(`${API}.complete_batches`);
  const [err, setErr] = useState<string | null>(null);
  const comp = completed === "" ? null : completed;

  async function submit() {
    if (comp === null) return setErr("Enter how many batches are completed.");
    setErr(null);
    try {
      const res = await call({ program: program.name, completed: comp });
      toast(comp >= total ? "All batches done — sent to Production" : `${comp}/${total} batches completed`);
      void res;
      onDone();
    } catch (e) { setErr(extractErrorMessage(e)); }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Complete — {program.shade || program.roll_no || "program"}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-page-sub" style={{ marginTop: 0 }}>
            How many of the {total} batches are completed? When all are done the program is sent to
            Production automatically.
          </p>
          <label className="mm-field">
            <span className="mm-field-label">Batches completed</span>
            <input className="mm-input" type="number" min={0} max={total} value={completed}
              onChange={(e) => setCompleted(e.target.value === "" ? "" : Math.max(0, Math.min(total, Number(e.target.value) || 0)))} />
          </label>
          {comp !== null && (
            <p className="mm-muted" style={{ marginTop: "0.6rem" }}>
              {comp >= total ? <strong>All done → goes to Production</strong> : `${comp}/${total} done · stays running`}
            </p>
          )}
          {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading || comp === null} onClick={() => void submit()}>{loading ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Per-machine Cut (editable; every program on the machine inherits it) ── */
function MachineCutInput({ machine, value, onSaved }: { machine: string; value?: string; onSaved: () => void }) {
  const [v, setV] = useState(value ?? "");
  const { call } = useFrappePostCall(`${API}.set_machine_cut`);
  const saved = value ?? "";
  async function save() {
    if (v.trim() === saved.trim()) return;
    try { await call({ machine, cut: v.trim() }); onSaved(); } catch { /* ignore */ }
  }
  return (
    <input className="mm-input mm-input-compact mm-mach-cut" placeholder="Cut id"
      title="Default cut for this machine — all its programs use this"
      value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void save()}
      onKeyDown={(e) => e.key === "Enter" && void save()} />
  );
}

/* ── Add program — colour-first picker ──────────────────────────── */
function AddProgramModal({ machines, presetMachine, presetShift, presetColour, dayDate, nightDate, onClose, onAdded }: {
  machines: Machine[]; presetMachine?: string; presetShift?: string; presetColour?: string;
  dayDate: string; nightDate: string; onClose: () => void; onAdded: () => void;
}) {
  const coloursCall = useFrappeGetCall<{ message: Colour[] }>(`${API}.available_colours`, undefined, "pg-colours");
  const { call: create, loading: creating } = useFrappePostCall(`${API}.create_program`);
  const { call: createUnfinished, loading: creatingU } = useFrappePostCall(`${API}.create_unfinished_program`);
  const colours = coloursCall.data?.message ?? [];

  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Colour | null>(null);
  const [machine, setMachine] = useState(presetMachine ?? machines.find((m) => !m.closed)?.name ?? "");
  const [shift, setShift] = useState<string>(presetShift ?? "Day");
  const [batches, setBatches] = useState<number | "">(1);
  const [remark, setRemark] = useState("");
  const [jobWork, setJobWork] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pre-select a colour passed in from a feeder card
  useEffect(() => {
    if (presetColour && !sel) {
      const g = colours.find((c) => c.colour === presetColour);
      if (g) setSel(g);
    }
  }, [presetColour, colours, sel]);

  const q = search.trim().toLowerCase();
  const shown = q ? colours.filter((c) => c.colour.toLowerCase().includes(q)) : colours;
  const orderCtx = sel?.rows[0]?.customer_order || "";
  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options_for_party`,
    sel ? { customer_order: orderCtx } : undefined,
    sel ? `pg-orders-${orderCtx}` : undefined,
  );
  const orders = orderOpts.data?.message ?? [];
  const [order, setOrder] = useState("");

  // Best available source for the chosen colour: patty > in-cutting > inventory, but a
  // source with NO weight is never preferred over one that has weight. A cutting saved
  // with 0 kg used to win on rank alone and the program was then refused for having no
  // weight, while the same colour sat in inventory with stock on it.
  const bestRow = useMemo(() => {
    if (!sel) return null;
    const rank = (s: string) => (s === "Cut" ? 0 : s === "In Cutting" ? 1 : 2);
    const sorted = [...sel.rows].sort((a, b) => rank(a.state) - rank(b.state));
    return sorted.find((r) => Number(r.weight || 0) > 0) ?? sorted[0] ?? null;
  }, [sel]);

  const date = shift === "Night" ? nightDate : dayDate;

  async function submit() {
    setErr(null);
    if (!sel || !bestRow) return setErr("Pick a colour to program.");
    if (Number(bestRow.weight || 0) <= 0 && bestRow.source_type === "cutting") {
      return setErr(
        `${sel.colour} has no weight recorded on its cutting, so there is nothing to ` +
        `program. Open Cutting and set the net weight for it first.`,
      );
    }
    if (!machine) return setErr("Choose a machine.");
    if (batches === "" || batches < 1) return setErr("Enter the total batches.");
    try {
      if (bestRow.source_type === "cutting" && bestRow.cutting) {
        // A finished patty / in-progress cutting → program it directly.
        // No explicit weight — the server derives it as per-patty weight × batches
        // (one patty = one batch), which is what Production then consumes.
        await create({
          source_cutting: bestRow.cutting, machine_no: machine, shift,
          customer_order: order || bestRow.customer_order, total_batches: batches,
          program_date: date, job_work: jobWork ? 1 : 0,
        });
      } else {
        // An inventory roll not yet cut → plan it as a "to cut" program. It shows up RED
        // on the Cutting board and is finished (roll picked) from the Cutting page.
        await createUnfinished({
          machine_no: machine, color: sel.colour, total_batches: batches,
          remark: remark || undefined, customer_order: order || bestRow.customer_order || undefined,
          program_date: date, shift, job_work: jobWork ? 1 : 0,
        });
      }
      toast("Program added");
      onAdded();
      // Keep the modal open so several programs can be added in a row.
      setSel(null); setSearch(""); setBatches(1); setRemark(""); setOrder("");
      void coloursCall.mutate();
    } catch (e) { setErr(extractErrorMessage(e)); }
  }

  const sourceLabel = (states: string[]) =>
    states.map((s) => (s === "Cut" ? "patty" : s === "In Cutting" ? "in cutting" : "inventory")).join(" · ");

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal mm-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Add program{presetMachine ? ` — Machine ${machines.find((m) => m.name === presetMachine)?.machine_no ?? ""}` : ""}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-field-label" style={{ margin: "0 0 0.4rem" }}>Pick a colour</p>
          <div className="mm-search-box" style={{ marginBottom: "0.55rem" }}>
            <Search size={15} />
            <input className="mm-input mm-input-compact" placeholder="Search colour…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {coloursCall.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="mm-empty">No colours available to program.</p>
          ) : (
            <div style={{ maxHeight: "230px", overflow: "auto", marginBottom: "1rem" }}>
              {shown.map((c) => (
                <div key={c.colour} className={`mm-pick-row ${sel?.colour === c.colour ? "mm-pick-row-active" : ""}`} onClick={() => { setSel(c); setOrder(""); }}>
                  <span className="mm-colour-name">{c.colour}</span>
                  <span className="mm-prog-card-meta">{sourceLabel(c.states)} · {kg(c.total_weight)} kg</span>
                </div>
              ))}
            </div>
          )}

          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Machine *</span>
              <SearchSelect value={machine} placeholder="— choose —"
                options={machines.filter((m) => !m.closed).map((m) => ({ value: m.name, label: `Machine ${m.machine_no}${m.cut ? ` · ${m.cut}` : ""}` }))}
                onChange={setMachine} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Shift</span>
              <SearchSelect noClear value={shift}
                options={SHIFTS.map((s) => ({ value: s, label: `${s} · ${s === "Night" ? nightDate : dayDate}` }))} onChange={setShift} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Customer Order</span>
              <SearchSelect value={order} placeholder={sel?.rows[0]?.customer_order || "—"}
                options={orders.map((o) => ({ value: o.name, label: o.name }))} onChange={setOrder} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Total Batches *</span>
              <input className="mm-input" type="number" min={1} value={batches}
                onChange={(e) => setBatches(e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Remark</span>
              <input className="mm-input" value={remark} placeholder="Optional note" onChange={(e) => setRemark(e.target.value)} />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>
          {sel && bestRow && <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}>Programming <strong>{sel.colour}</strong> from {sourceLabel(bestRow.state ? [bestRow.state] : [])} · {kg(bestRow.weight)} kg</p>}
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Done</button>
          <button className="mm-btn-primary" disabled={creating || creatingU} onClick={() => void submit()}>{(creating || creatingU) ? "Saving…" : "Add program"}</button>
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
    } catch (e) { setErr(extractErrorMessage(e)); }
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
  const progsCall = useFrappeGetDocList<Program>("MM Program", {
    fields: ["name", "program_date", "customer_order", "roll_no", "shade", "machine_no", "shift", "cut", "status", "total_batches", "completed_batches", "net_weight"],
    filters: [["docstatus", "=", 1], ["released", "=", 0]],
    orderBy: { field: "modified", order: "desc" },
    limit: 200,
  });

  const isLoading = progsCall.isLoading;
  const rows: ListRow[] = (progsCall.data ?? []).map((p) => ({
    key: `p-${p.name}`, date: p.program_date, order: p.customer_order, roll: p.shade || p.roll_no, cut: p.cut,
    source: "Program", machine: p.machine_no || "—", shift: p.shift || "—",
    batches: `${p.completed_batches ?? 0}/${p.total_batches ?? 0}`, weight: p.net_weight, status: p.status || "—",
  }));

  return (
    <section className="mm-card mm-card-pad">
      {isLoading && <p className="mm-muted">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="mm-empty">No programs added yet.</p>}
      {rows.length > 0 && (
        <div className="mm-table-scroll">
          <table className="mm-table mm-table-hover">
            <thead><tr><th>Date</th><th>Order</th><th>Colour</th><th>Cut</th><th>Machine</th><th>Shift</th><th className="mm-num">Batches</th><th className="mm-num">Wt</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.date || "—"}</td>
                  <td>{r.order || "—"}</td>
                  <td>{r.roll || "—"}</td>
                  <td>{r.cut || "—"}</td>
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
