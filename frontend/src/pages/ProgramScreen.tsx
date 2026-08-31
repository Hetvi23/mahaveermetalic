import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import {
  Plus, X, Power, RotateCcw, Check, Undo2, Monitor, LayoutGrid, List, Search, Trash2, Scissors,
} from "lucide-react";
import { LotRemarkBadge, useLotRemarks, type LotRemark } from "@/components/LotRemarkBadge";
import { extractErrorMessage } from "@/utils/frappeError";
import { toast } from "@/components/Toaster";
import SearchSelect from "@/components/SearchSelect";
import PattyTile from "@/components/PattyTile";
import { filterPatties, groupPatties } from "@/utils/finishedPatty";
import { todayISO, tomorrowISO } from "@/utils/localDate";

const API = "mahaveermetalic.mahaveer_metallic.api.program";
const today = todayISO;
const tomorrow = tomorrowISO;
const kg = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
// Night first everywhere it is listed — a shift pair is one night plus the NEXT day.
const SHIFTS = ["Night", "Day"] as const;
type ShiftView = "Day" | "Night" | "Combined";

type Machine = { name: string; machine_no: string; machine_name?: string; cut?: string; closed?: number; active_programs?: number };
type Program = {
  name: string; program_date?: string; customer_order?: string; roll_no?: string; shade?: string;
  machine_no?: string; shift?: string; cut?: string; status?: string; is_running?: number; closed?: number;
  released?: number; reverted?: number; total_batches?: number; completed_batches?: number; net_weight?: number;
  /** Per-patty rate, and what actually came off the machine (rate x completed batches). */
  completed_weight?: number; per_patty_weight?: number;
  unfinished?: number; remark?: string; roll_inventory?: string;
  lot?: string | null; lot_id?: string | null; lot_ids?: string[];
};
type Roll = {
  state: string; source_type: string; cutting?: string; inward_item?: string; date?: string;
  customer_order?: string; roll_no?: string; shade?: string; cut?: string; party?: string; batches?: number; weight?: number;
  per_patty?: number;
  /** `batches` is what is still AVAILABLE; these say out of how many it started with.
   *  A patty with none left is not sent at all. */
  total_patti?: number; consumed_patti?: number;
  /** Every cutting behind a lot-merged card — a program can draw across them. */
  merged_from?: string[]; merged_count?: number;
  /** The lot this patty was cut from — its SOURCE — and the challan that lot arrived on. */
  lot?: string | null; lot_id?: string | null; lot_challan?: string | null;
  /** For an INVENTORY row: the MM Roll Inventory record behind it. Sent with a plan so the
   *  program records WHICH roll it booked — the field every picker reads to keep a booked
   *  roll from being offered again. available_rolls has always returned it. */
  roll_inventory?: string;
};
/**
 * One selectable thing to program: a colour in ONE of its forms.
 *
 * A roll and a patty of the same colour are not interchangeable here. The roll is only a
 * form of the colour and can still be cut any way, so it can serve any order wanting that
 * colour; the patty is already cut and can only serve an order wanting that colour at that
 * cut. Folding them into one "colour" row hid that choice — the modal picked the patty and
 * the roll could never be programmed against a wider set of orders.
 */
type Source = {
  key: string; colour: string; kind: "cutting" | "inventory"; cut: string; state: string;
  /** Patty is split by LOT as well as cut — two lots of a colour are two materials, and
   *  the shelf now offers them separately, so the picker has to be able to honour that. */
  lotId: string; challan: string;
  rows: Roll[]; weight: number; perPatty: number; batches: number;
};
type Colour = {
  colour: string; rows: Roll[]; states: string[]; total_weight: number; count: number;
  /** Per source ("Cut" / "In Inventory"): its own total, its per-patty
   *  rate and how many patties still free. A cutting is consumed per patty (one patty =
   *  one batch), an inventory row is a whole roll — shown in their own units. */
  by_state?: Record<string, { weight: number; per_patty: number; batches: number }>;
  programmable_weight?: number;
  programmable_state?: string | null;
};
type OrderOpt = {
  name: string; party?: string; party_name?: string; delivery_date?: string; required_weight?: number;
  /** A line asking for the colour being programmed — and one asking for it at this cut. */
  color_match?: number; color_cut_match?: number;
  /** How much the order wants in that colour (and of it at this cut) — in kg or in boxes,
   *  whichever the line carries — the cuts it wants it in, and every colour on the order. */
  matched_weight?: number; matched_cut_weight?: number;
  matched_box?: number; matched_cut_box?: number;
  matched_cuts?: string[]; colours?: string[];
};
type OnMachine = { name: string; roll_no?: string; shade?: string; cut?: string; shift?: string; status?: string; total_batches?: number; completed_batches?: number };

/** A program's weight: the per-patty rate times the batches it runs. Falls back to the
 *  stored net weight for anything planned before the rate was carried onto the program. */
const programKg = (p: { per_patty_weight?: number; total_batches?: number; net_weight?: number }) => {
  const rate = Number(p.per_patty_weight || 0);
  const batches = Number(p.total_batches || 0);
  return rate > 0 && batches > 0 ? rate * batches : Number(p.net_weight || 0);
};
const perPattyNote = (p: { per_patty_weight?: number; total_batches?: number; net_weight?: number }) =>
  Number(p.per_patty_weight || 0) > 0
    ? `${kg(p.per_patty_weight)} kg per patty x ${p.total_batches ?? 0} batches`
    : "weight planned for this program";

const stateClass = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;
const shiftIcon = (s: string) => (s === "Night" ? "🌙" : "☀");

export default function ProgramScreen() {
  const [view, setView] = useState<"grid" | "list">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "grid",
  );
  const [shiftView, setShiftView] = useState<ShiftView>("Combined");
  const [dayDate, setDayDate] = useState(tomorrow());
  const [nightDate, setNightDate] = useState(today());
  const [adding, setAdding] = useState<{ machine?: string; shift?: string; colour?: string; lotId?: string } | null>(null);
  const [pattyColourFilter, setPattyColourFilter] = useState("");
  /** The machine the shelf is answering for. A patty count summed over every cut answers
   *  nobody's question — 9 patty of a colour is 6 this machine can run and 3 it cannot — so
   *  refreshing from a machine scopes the shelf to that machine's cut. */
  const [pattyScope, setPattyScope] = useState<{ machine: string; machineNo: string; cut: string } | null>(null);
  const [closing, setClosing] = useState<Machine | null>(null);
  const [completing, setCompleting] = useState<Program | null>(null);

  const nav = useNavigate();
  const machinesCall = useFrappeGetCall<{ message: Machine[] }>(`${API}.list_machines`, undefined, "pg-machines");
  const progCall = useFrappeGetCall<{ message: Program[] }>(
    `${API}.threads_processing`, undefined, "pg-threads",
    { refreshInterval: 20000, revalidateOnFocus: true, keepPreviousData: true },
  );
  // Finished patty loads WITH the screen and keeps itself current. It used to wait for
  // Add-program to be pressed, which meant the one number the shelf exists to show was
  // blank until you asked for it by hand. Patti are consumed and handed back by things
  // that happen elsewhere — a cutting finished on the Cutting screen, a program completed
  // or reverted by someone else — so it re-pulls on a timer, whenever the tab comes back
  // into focus, and after anything on this screen moves. SWR keeps the current rows on
  // screen while it refetches, so nothing blinks.
  const pattyCall = useFrappeGetCall<{ message: Roll[] }>(
    `${API}.available_rolls`, { finished_only: 1 }, "pg-patties",
    { refreshInterval: 20000, revalidateOnFocus: true, keepPreviousData: true },
  );

  const { call: addMachine } = useFrappePostCall(`${API}.add_machine`);
  const { call: removeMachine } = useFrappePostCall(`${API}.remove_machine`);
  const { call: reopen } = useFrappePostCall(`${API}.reopen_machine`);
  const { call: revert } = useFrappePostCall(`${API}.revert_batches`);

  const machines = machinesCall.data?.message ?? [];
  const programs = useMemo(() => progCall.data?.message ?? [], [progCall.data]);
  const patties = pattyCall.data?.message ?? [];
  // Every lot on this board in ONE request — the shelf, the machine cards and the picker
  // all draw on the same lots, and the board already polls every twenty seconds.
  const { maps } = useLotRemarks({
    lots: [...patties.map((p) => p.lot), ...programs.map((p) => p.lot)],
    lotIds: [
      ...patties.map((p) => p.lot_id),
      ...programs.flatMap((p) => (p.lot_ids?.length ? p.lot_ids : [p.lot_id])),
    ],
  });
  /** Every unresolved reason across a set of lots, deduplicated — a shelf tile is a
   *  COLOUR and a colour can be several lots, so the tile speaks for all of them. */
  const remarksFor = (lots: (string | null | undefined)[], lotIds: (string | null | undefined)[]): LotRemark[] => {
    const seen = new Set<string>();
    const out: LotRemark[] = [];
    for (const r of [
      ...lots.flatMap((l) => (l ? maps.by_lot[l] ?? [] : [])),
      ...lotIds.flatMap((l) => (l ? maps.by_lot_id[l] ?? [] : [])),
    ]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(r);
    }
    return out;
  };

  const refresh = () => { void machinesCall.mutate(); void progCall.mutate(); void pattyCall.mutate(); };
  const openAdd = (preset: { machine?: string; shift?: string; colour?: string; lotId?: string }) => setAdding(preset);
  /** "What can THIS machine run, right now." Scopes the shelf to the machine's cut and
   *  re-pulls — the patty count moves as programs take patti. */
  const refreshPattyFor = (m: Machine) => {
    setPattyScope({ machine: m.name, machineNo: m.machine_no, cut: (m.cut || "").trim() });
    setPattyColourFilter("");
    void pattyCall.mutate();
  };
  const guard = (fn: () => Promise<unknown>) => async () => { try { await fn(); refresh(); } catch (e) { const m = extractErrorMessage(e); toast(m, "error"); } };
  /** Reverting hands patty back and can cancel the program outright, so it asks why first.
   *  Cancelling the prompt cancels the revert — an empty reason is not an answer. */
  const revertWithReason = (program: string, what: string) => async () => {
    const r = window.prompt(`${what}\n\nWhy? This stays on the lot, so whoever picks it up next can see it.`, "");
    if (r === null) return;
    if (r.trim().length < 3) { toast("A reason is needed — nothing was reverted.", "error"); return; }
    try { await revert({ program, reason: r.trim() }); refresh(); }
    catch (e) { toast(extractErrorMessage(e), "error"); }
  };

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

  // Feeder: finished patty — colour and how many patti it has, nothing else. A patty whose
  // patti are all programmed is not on the shelf at all: the shelf is what can go on a
  // machine, and a spent one cannot.
  // Feeder: finished patty — colour and how many patti it has, nothing else. A patty whose
  // patti are all programmed is not on the shelf at all: the shelf is what can go on a
  // machine, and a spent one cannot. Grouping and search live in utils/finishedPatty so the
  // full Finished Patty page shows the same shelf under the same filter, by construction.
  const pattyColours = useMemo(
    () => groupPatties(patties, pattyScope?.cut),
    [patties, pattyScope],
  );
  const shownPatties = useMemo(
    () => filterPatties(pattyColours, pattyColourFilter),
    [pattyColours, pattyColourFilter],
  );

  /** What the Finished Patty page needs to reproduce this exact shelf. */
  const pattyQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (pattyColourFilter.trim()) q.set("q", pattyColourFilter.trim());
    if (pattyScope?.cut) q.set("cut", pattyScope.cut);
    if (pattyScope?.machineNo) q.set("machine", pattyScope.machineNo);
    return q.toString();
  }, [pattyColourFilter, pattyScope]);

  // A tile picked on the Finished Patty page comes back here as ?colour=&lot=, because the
  // Add-program dialog and everything it validates against live on this screen. The params
  // are cleared as they are read so a refresh does not re-open the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const colour = searchParams.get("colour");
    if (!colour) return;
    const lotId = searchParams.get("lot") || undefined;
    const rest = new URLSearchParams(searchParams);
    rest.delete("colour");
    rest.delete("lot");
    setSearchParams(rest, { replace: true });
    setAdding({ colour, lotId });
  }, [searchParams, setSearchParams]);

  // Night first: the working day starts with the night shift and runs into the NEXT
  // calendar day's day shift, so reading the board left to right is reading it in order.
  const shiftCols: string[] = shiftView === "Combined" ? ["Night", "Day"] : [shiftView];
  const shiftDate = (s: string) => (s === "Night" ? nightDate : dayDate);

  function ProgCard({ p }: { p: Program }) {
    return (
      <div className={`mm-prog-card ${p.unfinished ? "mm-prog-card-unfinished" : ""}`}>
        <div className="mm-prog-card-top">
          <span className="mm-prog-card-name">
            {p.shade || p.roll_no || "—"}
            {/* The reason an earlier run on this lot stopped — distinct from the card's own
                remark below, which is this program's planning note. */}
            <LotRemarkBadge
              remarks={remarksFor([p.lot], p.lot_ids?.length ? p.lot_ids : [p.lot_id])}
              label={p.shade || p.roll_no || "Lot"} />
          </span>
          {p.unfinished ? <span className="mm-state mm-state-unfinished">To cut</span> : <span className={stateClass(p.status)}>{p.status}</span>}
        </div>
        <div className="mm-prog-card-meta">
          {p.cut || "—"} · {p.completed_batches ?? 0}/{p.total_batches ?? 0} batches ·{" "}
          {p.unfinished ? (
            "roll not yet picked"
          ) : (
            /* Once the cut is done its per-patty weight is known, and the program's weight
               is that rate times its batches — 50 kg a patty over 4 batches is 200 kg. That
               total is the headline; what has actually run follows it once any has. */
            <>
              <span title={perPattyNote(p)}>{kg(programKg(p))} kg</span>
              {(p.completed_batches ?? 0) > 0 ? ` · ${kg(p.completed_weight)} kg done` : ""}
            </>
          )}
        </div>
        {p.remark && <div className="mm-prog-card-remark">“{p.remark}”</div>}
        <div className="mm-prog-actions">
          {p.unfinished ? (
            <>
              <button className="mm-mini mm-mini-ok" title="Cut this on the Cutting screen (pick the roll there)" onClick={() => nav("/cutting")}><Scissors size={13} /> Finish in Cutting</button>
              <button className="mm-mini mm-mini-warn" onClick={revertWithReason(p.name, `Cancel the plan for ${p.shade || p.roll_no || p.name}?`)}><Undo2 size={13} /> Cancel plan</button>
            </>
          ) : (
            <>
              <button className="mm-mini" disabled={!!p.reverted} onClick={() => setCompleting(p)}><Check size={13} /> Complete</button>
              <button className="mm-mini mm-mini-warn" disabled={p.status === "Open" || !!p.reverted} onClick={revertWithReason(p.name, `Revert ${p.shade || p.roll_no || p.name}?`)}><Undo2 size={13} /> Revert</button>
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
          <p className="mm-page-sub">Finished patty feeds the machines — a patty can serve several programs until its patti run out. The night shift leads; the day shift beside it is the next day.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <label className="mm-field-inline"><span className="mm-field-label-inline">🌙 Night</span>
            <input className="mm-input mm-input-compact" type="date" value={nightDate} onChange={(e) => setNightDate(e.target.value)} /></label>
          <label className="mm-field-inline"><span className="mm-field-label-inline">☀ Day</span>
            <input className="mm-input mm-input-compact" type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} /></label>
          <div className="mm-seg">
            {(["Combined", "Night", "Day"] as ShiftView[]).map((s) => (
              <button key={s} className={`mm-seg-btn ${shiftView === s ? "mm-seg-btn-active" : ""}`} onClick={() => setShiftView(s)}>{s}</button>
            ))}
          </div>
          <div className="mm-seg">
            <button className={`mm-seg-btn ${view === "grid" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("grid")}><LayoutGrid size={15} /> Board</button>
            <button className={`mm-seg-btn ${view === "list" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("list")}><List size={15} /> List</button>
          </div>
          <button className="mm-btn-primary" onClick={() => openAdd({})}><Plus size={15} /> Add program</button>
        </div>
      </header>

      {view === "list" ? (
        <ProgramList />
      ) : (
        <>
          {/* ── Finished patty: colour and how many patti, nothing else ──────────────
              What is in cutting is not shown here any more — this screen is about what can
              go on a machine, and a colour still under the blade cannot. It reads on
              Program View instead. */}
          <section className="mm-card mm-card-pad mm-patty-shelf">
            <div className="mm-flow-shelf-head" style={{ margin: 0, marginBottom: "0.7rem" }}>
              <span className="mm-flow-num">✓</span><h2>Finished patty</h2>
              <span className="mm-flow-count">{shownPatties.length}</span>
              {pattyScope && (
                <span className="mm-patty-scope">
                  Machine {pattyScope.machineNo}
                  {pattyScope.cut ? ` · cut ${pattyScope.cut}` : " · any cut"}
                  <button type="button" className="mm-icon-btn" aria-label="Show every cut again"
                    title="Show patty of every cut" onClick={() => setPattyScope(null)}>
                    <X size={13} />
                  </button>
                </span>
              )}
              <input className="mm-input mm-input-compact mm-patty-filter" placeholder="Filter colour or lot…"
                value={pattyColourFilter} onChange={(e) => setPattyColourFilter(e.target.value)} />
              {/* The rail shows what fits across; this is the same shelf with room for all
                  of it. The filter and the machine scope travel in the URL, so the page
                  opens on exactly what the shelf was showing. */}
              <button type="button" className="mm-mini mm-patty-viewall"
                title="Every finished patty, column-wise, on its own page"
                onClick={() => nav(pattyQuery ? `/finished-patty?${pattyQuery}` : "/finished-patty")}>
                <LayoutGrid size={13} /> View all{shownPatties.length ? ` (${shownPatties.length})` : ""}
              </button>
            </div>
            {pattyCall.isLoading && shownPatties.length === 0 ? (
              <p className="mm-flow-empty-state">Loading…</p>
            ) : shownPatties.length === 0 ? (
              <p className="mm-flow-empty-state">
                {pattyColours.length > 0
                  ? "No patty of that colour."
                  : pattyScope?.cut
                    ? `No finished patty cut to ${pattyScope.cut} — that is what Machine ${pattyScope.machineNo} runs.`
                    : "No finished patty available — finish a cutting first."}
              </p>
            ) : (
              /* ONE ROW that scrolls sideways. Wrapping into more columns inside a card of
                 fixed height meant the last row was sliced through the middle: a tile that
                 is half a tile reads as a rendering fault, and the count it exists to show
                 was the part cut off. A row cannot be clipped vertically, and everything
                 that does not fit across is on the full page a click away. */
              <div className="mm-patty-rail">
                {shownPatties.map((c) => (
                  <PattyTile
                    key={c.key}
                    tile={c}
                    remarks={remarksFor(c.lots, c.lotIds)}
                    onPick={(t) => openAdd({ colour: t.colour, lotId: t.lotId || undefined })}
                  />
                ))}
              </div>
            )}
          </section>

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
                          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                            <button className="mm-mini mm-mini-ok" onClick={guard(() => reopen({ machine: m.name }))}><Power size={13} /> Reopen</button>
                            <button className="mm-mini" title={`Show only the patty Machine ${m.machine_no} can run`}
                              aria-label={`Filter the patty shelf to machine ${m.machine_no}`}
                              onClick={() => refreshPattyFor(m)}>
                              <Search size={13} /> Patty
                            </button>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          {/* Narrows the shelf to THIS machine's cut. The shelf keeps itself
                              current on its own — this is a filter, not a refresh. */}
                          <button className="mm-mini" title={`Show only the patty Machine ${m.machine_no} can run${m.cut ? ` (cut ${m.cut})` : ""}`}
                            aria-label={`Filter the patty shelf to machine ${m.machine_no}`}
                            onClick={() => refreshPattyFor(m)}>
                            <Search size={13} /> Patty
                          </button>
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
                              <button className="mm-mini mm-prog-add" onClick={() => openAdd({ machine: m.name, shift: s })}><Plus size={13} /> Add program</button>
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
          presetLotId={adding.lotId}
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

/* ── Complete: report how many batches are done. All of them → straight to Production;
      fewer → the program is done SHORT, so it leaves the machine and the batches it never
      ran go back to the patty shelf on their own. ── */
function CompleteDialog({ program, onClose, onDone }: { program: Program; onClose: () => void; onDone: () => void }) {
  const total = program.total_batches ?? 0;
  const [completed, setCompleted] = useState<number | "">(total);
  const { call, loading } = useFrappePostCall(`${API}.complete_batches`);
  const [err, setErr] = useState<string | null>(null);
  // Why a job stopped short is the one thing the paperwork could never say afterwards, and
  // the next person to touch this lot is the one who needs it. Required here, and carried
  // onto the lot so it surfaces wherever that lot turns up again.
  const [reason, setReason] = useState("");
  const comp = completed === "" ? null : completed;
  const short = comp !== null && comp < total;

  async function submit() {
    if (comp === null) return setErr("Enter how many batches are completed.");
    if (short && reason.trim().length < 3) {
      return setErr("Say why this job is stopping short — it stays with the lot.");
    }
    setErr(null);
    try {
      const res = await call({ program: program.name, completed: comp, reason: reason.trim() || undefined });
      const back = Number((res as { message?: { returned_batches?: number } })?.message?.returned_batches || 0);
      toast(
        comp >= total
          ? "All batches done — sent to Production"
          : `${comp}/${total} done · ${back || total - comp} batch${(back || total - comp) === 1 ? "" : "es"} returned to the patty shelf`,
      );
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
          <label className="mm-field">
            <span className="mm-field-label">Batches completed</span>
            <input className="mm-input" type="number" min={0} max={total} value={completed}
              onChange={(e) => setCompleted(e.target.value === "" ? "" : Math.max(0, Math.min(total, Number(e.target.value) || 0)))} />
          </label>
          {comp !== null && (
            <p className="mm-muted" style={{ marginTop: "0.6rem" }}>
              {comp >= total ? (
                <strong>All done → goes to Production</strong>
              ) : (
                <>
                  {comp}/{total} done · machine frees up ·{" "}
                  <strong>{total - comp} batch{total - comp === 1 ? "" : "es"}</strong> of patty returned
                </>
              )}
            </p>
          )}
          {/* Always on screen, never conditional. It appeared only once the count was
              short, which made a field nobody could find until they had already changed
              something — and a full run is still worth a note ("re-dyed", "ran slow").
              Required only when the job is stopping short; optional otherwise. */}
          <label className="mm-field" style={{ marginTop: "0.6rem" }}>
            <span className="mm-field-label">
              Remark {short
                ? <span className="mm-pvw-need">(required — it is stopping short)</span>
                : <span className="mm-muted">(optional)</span>}
            </span>
            <textarea className="mm-input" rows={2} value={reason}
              placeholder={short
                ? "Thread broke, shade off, machine trouble…"
                : "Anything worth knowing about this run"}
              onChange={(e) => setReason(e.target.value)} />
            <span className="mm-muted" style={{ fontSize: "0.76rem" }}>
              Stays on this lot — anyone programming, cutting or receiving it later will see it.
            </span>
          </label>
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
function AddProgramModal({ machines, presetMachine, presetShift, presetColour, presetLotId, dayDate, nightDate, onClose, onAdded }: {
  machines: Machine[]; presetMachine?: string; presetShift?: string; presetColour?: string;
  presetLotId?: string;
  dayDate: string; nightDate: string; onClose: () => void; onAdded: () => void;
}) {
  const coloursCall = useFrappeGetCall<{ message: Colour[] }>(`${API}.available_colours`, undefined, "pg-colours");
  const { call: create, loading: creating } = useFrappePostCall(`${API}.create_program`);
  const { call: createUnfinished, loading: creatingU } = useFrappePostCall(`${API}.create_unfinished_program`);
  const colours = coloursCall.data?.message ?? [];

  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Source | null>(null);
  const [machine, setMachine] = useState(presetMachine ?? machines.find((m) => !m.closed)?.name ?? "");
  // Adding from the toolbar (no cell clicked) starts on the shift that comes first.
  const [shift, setShift] = useState<string>(presetShift ?? "Night");
  const [batches, setBatches] = useState<number | "">(1);
  const [remark, setRemark] = useState("");
  const [jobWork, setJobWork] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Raised when a roll is programmed while patty of the same colour and cut is already
  // sitting free — answered before anything is created.
  const [askPatty, setAskPatty] = useState(false);

  // One row per FORM of a colour, not one per colour: the 1,200 kg LGDT BSM roll and the
  // LGDT BSM already cut to 50/1.5 are two different things to program, and which one is
  // picked decides which orders can take it. Cuttings split by cut as well, since a colour
  // cut two ways is two different patties.
  const sources = useMemo(() => {
    const rank = (s: string) => (s === "Cut" ? 0 : 1);
    const out: Source[] = [];
    // Built colour by colour so the server's colour ordering is preserved as-is, and only
    // the forms WITHIN a colour are ranked — readiest to program first.
    for (const c of colours) {
      const forms = new Map<string, Source>();
      for (const r of c.rows) {
        const kind = r.source_type === "cutting" ? "cutting" : "inventory";
        const cut = kind === "cutting" ? (r.cut || "").trim() : "";
        // Patty splits by LOT as well: the shelf offers one tile per colour per lot, and a
        // pick that quietly drew from a different lot of the same colour would make that
        // offer a lie. Inventory rolls are not split — they are not cut yet.
        const lotId = kind === "cutting" ? (r.lot_id || "").trim() : "";
        const key = `${c.colour}|${r.state}|${cut}|${lotId}`;
        let s = forms.get(key);
        if (!s) {
          s = {
            key, colour: c.colour, kind, cut, state: r.state, lotId,
            challan: (r.lot_challan || "").trim(),
            rows: [], weight: 0, perPatty: 0, batches: 0,
          };
          forms.set(key, s);
        }
        s.rows.push(r);
        s.weight += Number(r.weight || 0);
        s.batches += Number(r.batches || 0);
        // Per-patty is a rate, not a total — carry the largest, the way the server does.
        s.perPatty = Math.max(s.perPatty, Number(r.per_patty || 0));
      }
      out.push(...[...forms.values()].sort((a, b) => rank(a.state) - rank(b.state)));
    }
    return out;
  }, [colours]);

  // Pre-select what the shelf tile named — its colour AND its lot, so clicking "TEST
  // SILVER · LT13/26-27" lands on that lot and not on whichever form of the colour
  // happened to rank first. Falls back to the readiest form when no lot was passed.
  useEffect(() => {
    if (presetColour && !sel) {
      const s =
        (presetLotId && sources.find((x) => x.colour === presetColour && x.lotId === presetLotId)) ||
        sources.find((x) => x.colour === presetColour);
      if (s) setSel(s);
    }
  }, [presetColour, presetLotId, sources, sel]);

  const q = search.trim().toLowerCase();
  // Searchable by lot and challan too, matching the shelf's own filter.
  const searched = q
    ? sources.filter((s) => [s.colour, s.lotId, s.challan].some((v) => (v || "").toLowerCase().includes(q)))
    : sources;

  // A machine runs one cut. Offering it a patty cut to something else is offering a job it
  // cannot physically run, so the list narrows to what this machine can take:
  //
  //   a patty is already cut — it must match the machine's cut exactly;
  //   a roll is not cut yet — it can be cut to the machine's size, so it always qualifies
  //   (create_unfinished_program stamps the planned cutting with the machine's cut).
  //
  // A machine with no cut set filters nothing. "Show all cuts" is there because the rule
  // is strict enough to hide a patty whose cut was never recorded, and a list that can
  // hide the thing you need with no way back is worse than a noisy one.
  const machineCut = (machines.find((m) => m.name === machine)?.cut || "").trim();
  const [allCuts, setAllCuts] = useState(false);
  const fitsMachine = useCallback(
    (s: Source) => !machineCut || allCuts || s.kind === "inventory" || s.cut === machineCut,
    [machineCut, allCuts],
  );
  const shown = searched.filter(fitsMachine);
  const hiddenByCut = searched.length - shown.length;
  // The list starts EMPTY and appears on search. Every colour on the floor is a long
  // scroll to land on one known name in, and this dialog is opened knowing that name.
  // Nothing about the filtering changes — searching still runs through the same machine-cut
  // rule, so what a search returns is exactly what the list would have shown.
  const browsing = q !== "";

  // The picker's own lookup, scoped to the sources it is offering. A Source is one colour
  // in one form and can span several cuttings — hence several lots — so every lot behind
  // it speaks, and the eye on a row means "something about this material needs reading".
  const { maps: pickMaps } = useLotRemarks({
    lots: sources.flatMap((s) => s.rows.map((r) => r.lot)),
    lotIds: sources.flatMap((s) => s.rows.map((r) => r.lot_id)),
  });
  const pickRemarks = (src: Source): LotRemark[] => {
    const seen = new Set<string>();
    const out: LotRemark[] = [];
    for (const r of src.rows) {
      for (const rem of [
        ...(r.lot ? pickMaps.by_lot[r.lot] ?? [] : []),
        ...(r.lot_id ? pickMaps.by_lot_id[r.lot_id] ?? [] : []),
      ]) {
        if (seen.has(rem.name)) continue;
        seen.add(rem.name);
        out.push(rem);
      }
    }
    return out;
  };
  const available = sources.filter(fitsMachine).length;

  /**
   * Patty of the picked colour, already cut to the cut this program will run.
   *
   * A roll is programmed as "to cut": it goes to the Cutting board and is cut to the
   * machine's cut. If patty of that colour is ALREADY cut to that size and free, cutting
   * a fresh roll makes a second pile of the same thing and leaves the first on the shelf.
   * That is a real decision — sometimes the roll is wanted anyway — so it is asked, not
   * blocked. Searched across the whole source list, not just what the search box is
   * showing, or hiding the patty behind a search term would hide the question with it.
   */
  const pattyOnShelf = useMemo(() => {
    if (!sel || sel.kind !== "inventory") return null;
    const same = sources.filter(
      (s) => s.kind === "cutting" && s.colour === sel.colour && s.batches > 0 && (!machineCut || s.cut === machineCut),
    );
    if (same.length === 0) return null;
    return {
      source: same[0],
      batches: same.reduce((n, x) => n + x.batches, 0),
      cut: same[0].cut,
    };
  }, [sel, sources, machineCut]);

  // Changing the machine can invalidate what is already picked — drop it rather than let
  // a 50/85 patty be submitted to a machine running 50/1.5.
  useEffect(() => {
    if (sel && !fitsMachine(sel)) setSel(null);
  }, [sel, fitsMachine]);
  // A question about THIS pick dies with it — re-picking has to ask again.
  useEffect(() => { setAskPatty(false); }, [sel, machine]);
  const orderCtx = sel?.rows[0]?.customer_order || "";
  const [order, setOrder] = useState("");

  // Within the chosen form, the row actually programmed: one that has weight. A cutting
  // saved with 0 kg used to win and the program was then refused for having no weight,
  // while the same colour sat in inventory with stock on it — which is now a row of its
  // own that the operator can pick instead.
  const bestRow = useMemo(
    () => (sel ? sel.rows.find((r) => Number(r.weight || 0) > 0) ?? sel.rows[0] ?? null : null),
    [sel],
  );

  // Which orders can take this program depends on WHICH FORM was picked above.
  //
  //   A roll is only a form of its colour — it has no cut until it is cut — so any order
  //   asking for that colour can take it, whatever cut that order wants. Colour alone.
  //
  //   A patty is already cut: it is a colour AT a cut, so only an order asking for that
  //   colour IN that cut can take it. Colour and cut, on the same order line.
  //
  // Sending `cut` only for a patty is what draws that line — the server matches on what
  // it is given, and returns ONLY the orders that can take it. An order that cannot is
  // not an option, so it is never listed: the dropdown is the answer, not a haystack.
  const pattyCut = sel?.kind === "cutting" ? sel.cut : "";
  const colour = sel?.colour ?? "";
  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options`,
    { customer_order: orderCtx || undefined, cut: pattyCut || undefined, color: colour || undefined },
    `pg-orders-${orderCtx}-${pattyCut}-${colour}`,
  );
  const orders = orderOpts.data?.message ?? [];

  // An order line is quantified in kg or in boxes — say whichever it actually carries,
  // so a box-only line never advertises itself as "0 kg".
  const qty = (weight?: number, box?: number) =>
    (weight ?? 0) > 0 ? `${kg(weight)} kg` : (box ?? 0) > 0 ? `${kg(box)} box` : "";
  const orderChoices = orders.map((o) => ({
    value: o.name,
    label: `${o.name}${o.party_name || o.party ? ` · ${o.party_name || o.party}` : ""}`,
    meta: (pattyCut
      ? [[qty(o.matched_cut_weight, o.matched_cut_box), colour].filter(Boolean).join(" "), `cut ${pattyCut}`]
      : [[qty(o.matched_weight, o.matched_box), colour].filter(Boolean).join(" "),
         o.matched_cuts?.length ? `cut ${o.matched_cuts.join(", ")}` : ""]
    ).concat(o.delivery_date ? `due ${o.delivery_date}` : "").filter(Boolean).join(" · "),
  }));
  // Empty means something specific here, and saying which saves a trip to the Orders
  // screen to find out.
  const noneText = orderOpts.isLoading
    ? "Loading orders…"
    : orderOpts.error
      ? "Could not load orders — check the connection and try again."
      : pattyCut
        ? `No pending order wants ${colour} at cut ${pattyCut}.`
        : colour
          ? `No pending order wants ${colour}.`
          : "No approved order is open — approve one on the Orders screen first.";

  const date = shift === "Night" ? nightDate : dayDate;

  async function submit(confirmedOverPatty = false) {
    setErr(null);
    setAskPatty(false);
    if (!sel || !bestRow) return setErr("Pick what to program.");
    if (Number(bestRow.weight || 0) <= 0 && bestRow.source_type === "cutting") {
      return setErr(
        `${sel.colour} has no weight recorded on its cutting, so there is nothing to ` +
        `program. Open Cutting and set the net weight for it first.`,
      );
    }
    if (!machine) return setErr("Choose a machine.");
    if (batches === "" || batches < 1) return setErr("Enter the total batches.");
    if (sel.kind === "cutting" && batches > sel.batches) {
      return setErr(`Only ${sel.batches} patty of ${sel.colour} ${sel.cut ? `at cut ${sel.cut} ` : ""}are still available.`);
    }
    // Last thing before creating anything: cutting a roll when the same patty is already
    // on the shelf is worth one question. Everything else has already validated, so
    // answering it goes straight through rather than re-running the gauntlet.
    if (pattyOnShelf && !confirmedOverPatty) return setAskPatty(true);
    try {
      if (bestRow.source_type === "cutting" && bestRow.cutting) {
        // A finished patty → program it directly. No explicit weight: the server derives it
        // as per-patty weight × batches (one patty = one batch), which is what Production
        // then consumes. Every cutting behind the picked form is offered, because the patti
        // of one lot can sit across several cuts and a big batch draws through them.
        await create({
          source_cutting: bestRow.cutting, machine_no: machine, shift,
          source_cuttings: sel.rows.flatMap((r) => r.merged_from ?? (r.cutting ? [r.cutting] : [])),
          customer_order: order || bestRow.customer_order, total_batches: batches,
          program_date: date, job_work: jobWork ? 1 : 0,
        });
      } else {
        // An inventory roll not yet cut → plan it as a "to cut" program. It shows up RED
        // on the Cutting board and is finished (roll picked) from the Cutting page.
        await createUnfinished({
          machine_no: machine, color: sel.colour, total_batches: batches,
          // WHICH ROLL, not just which colour. The operator picks a specific roll here and
          // only its colour was sent, so MM Program.roll_inventory stayed empty — and the
          // reservation that keeps a booked roll out of the other pickers reads exactly
          // that field. The roll went on being offered to the next program, to Cutting and
          // to the Sales Voucher, because as far as the record went nobody had taken it.
          roll_inventory: bestRow.roll_inventory || undefined,
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

  const stateWord = (s: string) => (s === "Cut" ? "patty" : "roll");
  // What this form is, in the operator's words — and, for a roll, WHY it will offer more
  // orders than the patty sitting right under it.
  const formLabel = (s: Source) =>
    (s.kind === "inventory"
      ? ["roll · any cut", `${kg(s.weight)} kg`]
      : [`${stateWord(s.state)} · ${s.cut ? `cut ${s.cut}` : "no cut recorded"}`,
         // The lot, because the rows are split by it: two otherwise identical lines of the
         // same colour and cut differ only in the material they draw from, and picking
         // blind between them is picking blind between two lots.
         s.lotId || "no lot",
         s.perPatty > 0
           ? `${s.batches} patty free · ${kg(s.perPatty)} kg each`
           : `${s.batches} patty free · ${kg(s.weight)} kg`]
    ).join(" · ");

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal mm-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Add program{presetMachine ? ` — Machine ${machines.find((m) => m.name === presetMachine)?.machine_no ?? ""}` : ""}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <div className="mm-prog-picklabel">
            <span className="mm-field-label" style={{ margin: 0 }}>Pick what to program</span>
            {machineCut && (
              allCuts ? (
                <button type="button" className="mm-mini" onClick={() => setAllCuts(false)}>
                  Show only cut {machineCut}
                </button>
              ) : hiddenByCut > 0 ? (
                <span className="mm-prog-cuthint">
                  cut {machineCut} on this machine
                  <button type="button" className="mm-mini" onClick={() => setAllCuts(true)}>
                    Show all cuts ({hiddenByCut} hidden)
                  </button>
                </span>
              ) : (
                <span className="mm-prog-cuthint">cut {machineCut} on this machine</span>
              )
            )}
          </div>
          <div className="mm-search-box" style={{ marginBottom: "0.55rem" }}>
            <Search size={15} />
            <input className="mm-input mm-input-compact" placeholder="Search colour…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {coloursCall.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : !browsing ? (
            // Nothing until something is typed. What is already picked still shows, so
            // clearing the box never leaves the choice invisible.
            <div className="mm-prog-pickidle">
              {sel ? (
                <div className="mm-pick-row mm-pick-row-active" onClick={() => setSearch(sel.colour)}>
                  <span className="mm-colour-name">
                    {sel.colour}
                    <LotRemarkBadge remarks={pickRemarks(sel)} label={sel.colour} />
                  </span>
                  <span className="mm-prog-card-meta">{formLabel(sel)}</span>
                </div>
              ) : null}
              <p className="mm-muted" style={{ margin: sel ? "0.5rem 0 0" : 0 }}>
                {available === 0
                  ? machineCut && !allCuts && hiddenByCut > 0
                    ? `Nothing cut to ${machineCut} is available — that is the cut set on this machine.`
                    : "No colours available to program."
                  : `Search a colour to pick it — ${available} available${
                      machineCut && !allCuts ? ` for cut ${machineCut}` : ""
                    }.`}
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="mm-empty">
              {machineCut && !allCuts && hiddenByCut > 0
                ? `Nothing matching “${search.trim()}” is cut to ${machineCut} — that is the cut set on this machine.`
                : `No colour matches “${search.trim()}”.`}
            </p>
          ) : (
            <div style={{ maxHeight: "230px", overflow: "auto", marginBottom: "1rem" }}>
              {shown.map((s) => (
                <div key={s.key} className={`mm-pick-row ${sel?.key === s.key ? "mm-pick-row-active" : ""}`}
                  onClick={() => { setSel(s); setOrder(""); }}>
                  {/* Every row names its colour. It used to be printed once per group and
                      blanked on the rows beneath — which reads fine from the top, and not
                      at all once the list is scrolled, searched or you land mid-group:
                      "patty · cut 50/120 · 50 kg/patty × 1" of WHAT. */}
                  <span className="mm-colour-name">
                    {s.colour}
                    {/* Picking this is the decision the reason exists to inform, so it is
                        shown at the moment of choosing rather than after. */}
                    <LotRemarkBadge remarks={pickRemarks(s)} label={s.colour} />
                  </span>
                  <span className="mm-prog-card-meta">{formLabel(s)}</span>
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
              <span className="mm-field-label">
                Customer Order
                {colour ? (
                  <span className="mm-muted">
                    {" · "}
                    {/* "none" is a fact about a list that has arrived. While the call is in
                        flight the honest word is that we are still looking. */}
                    {orderOpts.isLoading
                      ? "checking orders…"
                      : `${orders.length || "none"} for ${colour}${pattyCut ? ` at cut ${pattyCut}` : ""}`}
                  </span>
                ) : null}
              </span>
              {/* Id AND party on the closed field — the floor picks an order by who it is
                  for, not by its number. The placeholder names the order submit would fall
                  back to, which is bestRow's — not the form's first row. */}
              <SearchSelect value={order} placeholder={bestRow?.customer_order || "—"}
                options={orderChoices}
                emptyText={noneText}
                onChange={setOrder} />
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
          {sel && bestRow && (
            <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}>
              Programming <strong>{sel.colour}</strong> · {formLabel(sel)}
              {sel.kind === "inventory"
                ? " — still to be cut, so any order wanting this colour can take it"
                : sel.cut
                  ? ` — already cut, so only orders wanting ${sel.colour} at ${sel.cut}`
                  : ""}
            </p>
          )}
          {/* Standing note the moment a roll is picked over available patty — the question
              on Add program is then a confirmation, not a surprise. */}
          {sel?.kind === "inventory" && pattyOnShelf && !askPatty && (
            <p className="mm-prog-pattynote">
              {pattyOnShelf.batches} patty of {sel.colour}
              {pattyOnShelf.cut ? ` at cut ${pattyOnShelf.cut}` : ""} is already cut and free.
            </p>
          )}
          {askPatty && sel && pattyOnShelf && (
            <div className="mm-banner mm-banner-warn mm-prog-pattyask">
              <span>
                <strong>{pattyOnShelf.batches} patty</strong> of {sel.colour}
                {pattyOnShelf.cut ? ` at cut ${pattyOnShelf.cut}` : ""} is already cut and free.
                Programming this roll cuts more and leaves that patty on the shelf. Proceed?
              </span>
              <span className="mm-prog-pattyask-acts">
                <button type="button" className="mm-mini mm-mini-ok"
                  title="Program the patty that is already cut instead of cutting this roll"
                  onClick={() => { setSel(pattyOnShelf.source); setOrder(""); setAskPatty(false); }}>
                  Use the patty
                </button>
                <button type="button" className="mm-mini" disabled={creating || creatingU}
                  onClick={() => void submit(true)}>
                  Program the roll anyway
                </button>
                <button type="button" className="mm-mini" onClick={() => setAskPatty(false)}>Cancel</button>
              </span>
            </div>
          )}
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
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reverting = rows.some((r) => (reverts[r.name] || 0) > 0);

  async function submit() {
    setErr(null);
    if (reverting && reason.trim().length < 3) {
      return setErr("Say why these batches are being reverted — it stays with their lots.");
    }
    try {
      await close({
        machine: machine.name,
        reason: reason.trim() || undefined,
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
                  <thead><tr><th>Color</th><th>Cut</th><th>Shift</th><th className="mm-num">Done / Total</th><th className="mm-num">Revert</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name}>
                        {/* The colour is how the floor knows which job this is. The row
                            named the roll number, or fell back to the document id, which
                            tells an operator being asked to revert batches nothing. */}
                        <td title={r.name}>
                          <span className="mm-colour-name">{r.shade || r.roll_no || r.name}</span>
                        </td>
                        <td>{r.cut || "—"}</td>
                        <td>{r.shift ? `${shiftIcon(r.shift)} ${r.shift}` : "—"}</td>
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
          {reverting && (
            <label className="mm-field" style={{ marginTop: "0.6rem" }}>
              <span className="mm-field-label">Why are these being reverted? (required)</span>
              <textarea className="mm-input" rows={2} value={reason}
                placeholder="Machine down, shade rejected, shift cut short…"
                onChange={(e) => setReason(e.target.value)} />
              <span className="mm-muted" style={{ fontSize: "0.76rem" }}>
                Recorded against each affected lot, so it follows the patty back to the shelf.
              </span>
            </label>
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
