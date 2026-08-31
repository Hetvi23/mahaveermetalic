import { useEffect, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Check, Monitor, NotebookPen, RefreshCw, Scissors, X } from "lucide-react";
import { LotRemarkBadge, useLotRemarks, type LotRemark } from "@/components/LotRemarkBadge";
import { extractErrorMessage } from "@/utils/frappeError";
import { toast } from "@/components/Toaster";
import { todayISO } from "@/utils/localDate";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const PROGRAM_API = "mahaveermetalic.mahaveer_metallic.api.program";
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
function CompleteDialog({ program, onClose, onDone }: { program: ProgramRow; onClose: () => void; onDone: () => void }) {
  const total = program.total_batches ?? 0;
  const already = program.completed_batches ?? 0;
  const [completed, setCompleted] = useState<number | "">(total);
  const [reason, setReason] = useState("");
  const { call, loading } = useFrappePostCall(`${PROGRAM_API}.complete_batches`);
  const [err, setErr] = useState<string | null>(null);
  const comp = completed === "" ? null : completed;
  // Recording FEWER than are already banked is not progress, it is work being taken back
  // — a patty that was reported done is being un-reported, and the next shift will find
  // the count lower than they left it. That is the one case worth making somebody type a
  // reason for; an ordinary 2-of-3 here keeps the machine running and explains itself.
  const takingBack = comp !== null && comp < already;

  async function submit() {
    if (comp === null) return setErr("Enter how many batches are completed.");
    if (takingBack && reason.trim().length < 3) {
      return setErr(`${already} already recorded as done — say why it is coming down to ${comp}.`);
    }
    setErr(null);
    try {
      // partial_keeps_machine: recording 2 of 3 is PROGRESS, not a short close-out. The
      // job stays on the machine and the 2 formed patty show on Production straight away;
      // the third is added when it comes off. Closing a job out short is the machine's
      // own Close action, which is a different decision from "two are done".
      await call({
        program: program.program,
        completed: comp,
        partial_keeps_machine: 1,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast(
        comp >= total
          ? "All batches done — sent to Production"
          : `${comp}/${total} done — ${comp} patty on Production, machine still running`,
      );
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Complete — {program.color}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-page-sub" style={{ marginTop: 0 }}>
            How many of the {total} batches are completed? Whatever is done goes to Production
            straight away — record 2 of 3 and Production shows 2, then come back and make it 3
            when the last one comes off. The machine keeps the job until every batch is done.
          </p>
          <label className="mm-field">
            <span className="mm-field-label">Batches completed</span>
            <input className="mm-input" type="number" min={0} max={total} value={completed} autoFocus
              onChange={(e) => setCompleted(e.target.value === "" ? "" : Math.max(0, Math.min(total, Number(e.target.value) || 0)))} />
          </label>
          {comp !== null && (
            <p className="mm-muted" style={{ marginTop: "0.6rem" }}>
              {comp >= total ? (
                <strong>All done → goes to Production, machine frees up</strong>
              ) : takingBack ? (
                <>
                  <strong>{already - comp} patty comes back off Production</strong> ·{" "}
                  {comp} stays done · machine keeps the job
                </>
              ) : (
                <>
                  <strong>{comp} patty</strong> to Production now ·{" "}
                  {total - comp} still to run · machine keeps the job
                </>
              )}
            </p>
          )}
          {/* Optional on an ordinary partial — 2 of 3 is progress and explains itself. Asked
              for, and insisted on, only when the count goes DOWN: that is work being taken
              back off Production and the next shift deserves the sentence. */}
          <label className="mm-field" style={{ marginTop: "0.6rem" }}>
            <span className="mm-field-label">
              Reason{" "}
              {takingBack
                ? <span className="mm-pvw-need">— needed, this is below the {already} already recorded</span>
                : <span className="mm-muted">(optional)</span>}
            </span>
            <input className="mm-input" value={reason}
              placeholder={takingBack ? "Why is the count coming down?" : "Anything the next shift should know"}
              onChange={(e) => setReason(e.target.value)} />
          </label>
          {err && <p className="mm-error" style={{ marginTop: "0.5rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading || comp === null} onClick={() => void submit()}>
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One shift, machine by machine: each machine is a ROW OF ITS OWN — its number on a header
 * line, and under that line only the programmes running on it.
 *
 * A box is still a JOB, not a machine, so a machine running two programmes is two boxes one
 * under the other. What changed is where the number lives: it used to be repeated inside
 * every box, which made a machine with three jobs read as three machines and left the eye
 * with no line to run down when it wanted "what is Machine 4 doing". The number is stated
 * once, at the top of its own row, and the boxes beneath it carry only the work.
 */
function ShiftColumn({ title, groups, onComplete, remarksFor }: {
  title: string; groups: MachineGroup[]; onComplete: (p: ProgramRow) => void;
  remarksFor: (p: ProgramRow) => LotRemark[];
}) {
  const batches = groups.reduce((s, g) => s + g.programs.reduce((n, p) => n + (p.total_batches || 0), 0), 0);
  const idle = groups.filter((g) => g.programs.length === 0).length;
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
        <div className="mm-pvw-machines">
        {groups.map((g) => (
          // Every machine is listed, running or not.
          <div className="mm-pvw-machine" key={g.machine_no}>
            {/* The machine's own row, present whether or not anything is running: an idle
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
            {/* Under the machine row, only programmes. Nothing under an idle machine is the
                whole reading — the row above already says it is free. */}
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
      ...progs.flatMap((p) => (p.lot_ids?.length ? p.lot_ids : [p.lot_id])),
      ...(v?.in_cutting ?? []).map((c) => c.lot_id),
    ],
  });
  /** Every reason on any lot this program's material came off, deduplicated. */
  const remarksForProgram = (p: ProgramRow): LotRemark[] => {
    const seen = new Set<string>();
    const out: LotRemark[] = [];
    for (const r of [
      ...(p.lot ? maps.by_lot[p.lot] ?? [] : []),
      ...(p.lot_ids?.length ? p.lot_ids : [p.lot_id]).flatMap((id) => (id ? maps.by_lot_id[id] ?? [] : [])),
    ]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(r);
    }
    return out;
  };

  return (
    <div className="mm-screen mm-page-enter">
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
        <section className="mm-card mm-card-pad">
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
                        <LotRemarkBadge remarks={forLotId(c.lot_id)} label={`Lot ${c.lot_id || ""}`} />
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
        <CompleteDialog
          program={completing}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); void mutate(); }}
        />
      )}
    </div>
  );
}
