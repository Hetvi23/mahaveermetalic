import { useEffect, useState, type CSSProperties } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Check, Monitor, NotebookPen, RefreshCw, Scissors } from "lucide-react";
import { LotRemarkBadge, useLotRemarks, type LotRemark } from "@/components/LotRemarkBadge";
import { extractErrorMessage } from "@/utils/frappeError";
import { toast } from "@/components/Toaster";
import ProgramCompleteDialog from "@/components/ProgramCompleteDialog";
import { todayISO } from "@/utils/localDate";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const today = todayISO;

type Batch = { batch: number; done?: boolean };
type ProgramRow = {
  program: string;
  color: string;
  cut?: string | null;
  lot?: string | null;
  lot_id?: string | null;
  /** The LIST — `lot_id` is a joined display string once a program drew from several
   *  cuttings, and a remark lookup keyed on that string matches nothing. */
  lot_ids?: string[];
  total_batches: number;
  completed_batches: number;
  completed_weight?: number;
  per_patty_weight?: number;
  status?: string;
  unfinished?: boolean;
  reverted?: boolean;
  released?: boolean;
  remark?: string | null;
  batches: Batch[];
};
type MachineGroup = { machine_no: string; machine?: string; programs: ProgramRow[] };
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
type ViewData = { date: string; in_cutting: InCutting[]; notes: string; day: MachineGroup[]; night: MachineGroup[] };

/**
 * Complete a program from the view — the same question the Program board asks: how many
 * batches are done. Fewer than planned closes the job out short (the machine frees and the
 * unrun batches hand their patty back), which is why the count is asked for and not assumed.
 */

/**
 * One shift, machine by machine: each machine is a ROW — its number in the first column,
 * and its programmes running ACROSS that row, one to a column.
 *
 * A box is still a JOB, not a machine, so a machine running two programmes is two boxes;
 * what changed is where they go. Stacked under the machine, a machine with four jobs was
 * four boxes tall and pushed every machine below it off the screen, so "what is the floor
 * running" needed scrolling to answer. Along the row, the whole shift is one screen deep:
 * a machine is a line, and how far its line runs is how loaded it is.
 *
 * The columns are one grid for the entire shift, not a row of boxes per machine — the
 * machine heads line up, and so does every machine's first job, second job and third. That
 * is what makes the board readable across: the eye runs down a column as well as along a row.
 */
function ShiftColumn({ title, groups, onComplete, remarksFor }: {
  title: string; groups: MachineGroup[]; onComplete: (p: ProgramRow) => void;
  remarksFor: (p: ProgramRow) => LotRemark[];
}) {
  const batches = groups.reduce((s, g) => s + g.programs.reduce((n, p) => n + (p.total_batches || 0), 0), 0);
  const idle = groups.filter((g) => g.programs.length === 0).length;
  // How many job columns the shift needs: the busiest machine on it. Every row is laid to
  // that width, so a two-job machine leaves two cells empty rather than stretching its
  // boxes across the space a four-job machine uses.
  const cols = Math.max(1, ...groups.map((g) => g.programs.length));
  return (
    <section className="mm-pvw-col">
      <header className="mm-pvw-col-head">
        <h2>{title}</h2>
        <span className="mm-pill mm-pill-muted">
          {batches} batch{batches === 1 ? "" : "es"}{idle ? ` · ${idle} free` : ""}
        </span>
      </header>
      {groups.length === 0 ? (
        <p className="mm-pvw-empty">No machines yet.</p>
      ) : (
        <div className="mm-pvw-machines" style={{ "--mm-pvw-jobs": cols } as CSSProperties}>
        {groups.map((g) => (
          // Every machine is listed, running or not. `display: contents` in the CSS — the
          // wrapper groups the machine with its jobs for reading here, while the head and
          // the boxes are laid out by the ONE grid above, which is what keeps the columns
          // aligned from one machine to the next.
          <div className="mm-pvw-machine" key={g.machine_no}>
            {/* The machine's own cell, present whether or not anything is running: an idle
                machine that simply vanished would make the floor count to notice. Its state
                is stated HERE and only here — the head used to say "Free" over a dashed box
                that also said "Free", one word twice in two type treatments. */}
            <div className="mm-pvw-machine-head">
              <span className="mm-pvw-machine-no"><Monitor size={14} />Machine {g.machine_no}</span>
              <span className={`mm-pvw-machine-tally${g.programs.length ? "" : " mm-pvw-machine-free"}`}>
                {g.programs.length === 0
                  ? "Free"
                  : `${g.programs.length} ${g.programs.length === 1 ? "program" : "programs"}`}
              </span>
            </div>
            {/* Along the row, only programmes. An empty row is the whole reading for an
                idle machine — the cell to its left already says it is free. */}
            {g.programs.map((p) => (
                <div className="mm-pvw-box" key={p.program}>
                  {/* The three lines and the tick share one grid so the tick lands on the
                      patty line whether or not there is a note under it. */}
                  <div className="mm-pvw-box-body">
                    <div className="mm-pvw-box-colour">
                      <span className="mm-colour-name">{p.color}</span>
                      {p.unfinished ? <span className="mm-state mm-state-unfinished">To cut</span> : null}
                      {p.lot_id ? <span className="mm-pvw-box-lot">{p.lot_id}</span> : null}
                      {/* Why an EARLIER program on this lot stopped short. Deliberately not
                          `p.remark` below, which is this program's own planning note — the
                          two have different authors and mean different things. */}
                      <LotRemarkBadge remarks={remarksFor(p)} label={`Lot ${p.lot_id || ""}`} />
                    </div>
                    <div className="mm-pvw-box-patti">
                      <strong>{p.total_batches}</strong> patty
                      {p.completed_batches > 0
                        ? <span className="mm-pvw-box-done"> · {p.completed_batches} done</span>
                        : null}
                    </div>
                    {p.remark ? (
                      // Labelled, not just quoted. A bare quote in this box reads as a message
                      // about the material; this one is the note the PROGRAM was planned with.
                      <div className="mm-pvw-box-note"><span>Program note</span>{p.remark}</div>
                    ) : null}
                    <button className="mm-mini mm-mini-ok mm-pvw-box-tick" disabled={!!p.unfinished}
                      aria-label={`Complete ${p.color}`}
                      title={p.unfinished ? "The roll for this program hasn't been cut yet" : "Record how many batches are completed"}
                      onClick={() => onComplete(p)}>
                      <Check size={16} />
                    </button>
                  </div>
                </div>
            ))}
          </div>
        ))}
        </div>
      )}
    </section>
  );
}

/** The floor's shared scratchpad. Saved on blur so nobody has to remember a Save click. */
function NotesPanel({ value, onSaved }: { value: string; onSaved: () => void }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const { call, loading } = useFrappePostCall(`${API}.save_program_view_notes`);

  // Someone else's edit (or a date change) should win over an untouched local copy.
  useEffect(() => {
    setText((t) => (t === saved ? value : t));
    setSaved(value);
  }, [value, saved]);

  async function save() {
    if (text === saved) return;
    try {
      await call({ notes: text });
      setSaved(text);
      onSaved();
      toast("Notes saved");
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  return (
    <section className="mm-card mm-card-pad mm-pvw-notes">
      <div className="mm-iw-sec-head">
        <h2 className="mm-panel-title"><NotebookPen size={16} /> Notes</h2>
        {text !== saved && <span className="mm-pill mm-pill-pending">{loading ? "saving…" : "unsaved"}</span>}
      </div>
      <textarea
        className="mm-input mm-pvw-notes-box"
        placeholder="Anything the floor should know — machine trouble, run order, a message for the next shift…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
      />
      <div className="mm-pvw-notes-foot">
        <span className="mm-muted">Shared with everyone · saved when you click away</span>
        <button className="mm-mini mm-mini-ok" disabled={loading || text === saved} onClick={() => void save()}>Save</button>
      </div>
    </section>
  );
}

/**
 * Program view — the day sheet.
 *
 * Top row: what is in cutting on the left, the floor's notes on the right. Below, the Day
 * and Night plans side by side, each a stack of BOXES — one per programme: machine number,
 * colour / patty / note, and a tick to record it done (which asks how many are done, the
 * same question the Program board asks).
 */
export default function ProductionViewPage() {
  const [date, setDate] = useState(today());
  const [completing, setCompleting] = useState<ProgramRow | null>(null);
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: ViewData }>(
    `${API}.production_view`,
    { date },
    `prod-view-${date}`,
  );
  const v = data?.message;

  // Every lot on the page, in one request: the machines' programs and the cutting list all
  // draw on the same lots, and a hook per row would make this page dozens of round trips.
  const progs = [...(v?.day ?? []), ...(v?.night ?? [])].flatMap((g) => g.programs);
  const { maps, forLotId } = useLotRemarks({
    lots: progs.map((p) => p.lot),
    lotIds: [
      ...progs.flatMap((p) =>
        (p.lot_ids?.length ? p.lot_ids : [p.lot_id]).map((id) => ({ id, colour: p.color })),
      ),
      ...(v?.in_cutting ?? []).map((c) => ({ id: c.lot_id, colour: c.color })),
    ],
  });
  /** Every reason on any lot this program's material came off, deduplicated. */
  const remarksForProgram = (p: ProgramRow): LotRemark[] => {
    const seen = new Set<string>();
    const out: LotRemark[] = [];
    for (const r of [
      ...(p.lot ? maps.by_lot[p.lot] ?? [] : []),
      ...(p.lot_ids?.length ? p.lot_ids : [p.lot_id]).flatMap((id) => forLotId(id, p.color)),
    ]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(r);
    }
    return out;
  };

  return (
    // Two halves that between them ARE the screen: what is in cutting above, the shift
    // board below, each scrolling inside its own half. The cutting list runs to dozens of
    // rows on a busy day and used to push the board off the bottom of the page — the one
    // thing the sheet exists to show, reachable only by scrolling past a list of what is
    // not on a machine yet.
    <div className="mm-screen mm-pvw-page mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Program view</h1>
          <p className="mm-page-sub">What&apos;s in cutting, the floor&apos;s notes, and each machine&apos;s programmes by shift.</p>
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

      {/* In cutting (left) · Notes (right) */}
      <div className="mm-pvw-top">
        <section className="mm-card mm-card-pad mm-pvw-cut">
          <div className="mm-iw-sec-head">
            <h2 className="mm-panel-title"><Scissors size={16} /> In cutting</h2>
            <span className="mm-pill mm-pill-muted">{v?.in_cutting.length ?? 0}</span>
          </div>
          {!v || v.in_cutting.length === 0 ? (
            <p className="mm-empty">Nothing in cutting.</p>
          ) : (
            // Colour and the size it is being cut to — that is the whole question this
            // panel answers. How many patty it will yield is not known until it is cut.
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th>Color</th><th>Size</th></tr>
                </thead>
                <tbody>
                  {v.in_cutting.map((c) => (
                    <tr key={c.cutting}>
                      <td>
                        <span className="mm-colour-name">{c.color}</span>
                        {/* The cutter meets the material again here, so the lot's carried-over
                            reason has to be here too. */}
                        <LotRemarkBadge remarks={forLotId(c.lot_id, c.color)} label={`Lot ${c.lot_id || ""}`} />
                      </td>
                      <td>{c.cut || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <NotesPanel value={v?.notes ?? ""} onSaved={() => void mutate()} />
      </div>

      {/* Day | Night — machine by machine */}
      <div className="mm-pvw-grid">
        <ShiftColumn title="Day" groups={v?.day ?? []} onComplete={setCompleting} remarksFor={remarksForProgram} />
        <ShiftColumn title="Night" groups={v?.night ?? []} onComplete={setCompleting} remarksFor={remarksForProgram} />
      </div>
      {completing && (
        <ProgramCompleteDialog
          program={completing.program}
          label={completing.color}
          total={completing.total_batches ?? 0}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); void mutate(); }}
        />
      )}
    </div>
  );
}
