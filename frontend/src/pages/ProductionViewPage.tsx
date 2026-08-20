import { useEffect, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Check, Monitor, NotebookPen, RefreshCw, Scissors, X } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";
import { toast } from "@/components/Toaster";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const PROGRAM_API = "mahaveermetalic.mahaveer_metallic.api.program";
const today = () => new Date().toISOString().slice(0, 10);

type Batch = { batch: number; done?: boolean };
type ProgramRow = {
  program: string;
  color: string;
  cut?: string | null;
  lot_id?: string | null;
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
  const [completed, setCompleted] = useState<number | "">(total);
  const { call, loading } = useFrappePostCall(`${PROGRAM_API}.complete_batches`);
  const [err, setErr] = useState<string | null>(null);
  const comp = completed === "" ? null : completed;

  async function submit() {
    if (comp === null) return setErr("Enter how many batches are completed.");
    setErr(null);
    try {
      // partial_keeps_machine: recording 2 of 3 is PROGRESS, not a short close-out. The
      // job stays on the machine and the 2 formed patty show on Production straight away;
      // the third is added when it comes off. Closing a job out short is the machine's
      // own Close action, which is a different decision from "two are done".
      await call({ program: program.program, completed: comp, partial_keeps_machine: 1 });
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
              ) : (
                <>
                  <strong>{comp} patty</strong> to Production now ·{" "}
                  {total - comp} still to run · machine keeps the job
                </>
              )}
            </p>
          )}
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

/** One shift: a block per MACHINE, each listing its programs — colour, batches, Complete. */
function ShiftColumn({ title, groups, onComplete }: {
  title: string; groups: MachineGroup[]; onComplete: (p: ProgramRow) => void;
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
        groups.map((g) => (
          // Every machine is listed. An idle one keeps its heading and shows nothing under
          // it — blank IS the reading: that machine is free.
          <div className="mm-pvw-machine" key={g.machine_no}>
            <div className="mm-pvw-machine-name"><Monitor size={14} /> Machine {g.machine_no}</div>
            {g.programs.length === 0 ? (
              <div className="mm-pvw-machine-idle" />
            ) : (
              g.programs.map((p) => (
                // Colour and the one thing to do about it on the top line; how many patty
                // reads underneath it — the same two facts, in the order they're asked for.
                <div className="mm-pvw-prog" key={p.program}>
                  <div className="mm-pvw-prog-top">
                    <span className="mm-colour-name">{p.color}</span>
                    {p.unfinished ? <span className="mm-state mm-state-unfinished">To cut</span> : null}
                    <button className="mm-mini mm-pvw-prog-act" disabled={!!p.unfinished}
                      title={p.unfinished ? "The roll for this program hasn't been cut yet" : "Record how many batches are completed"}
                      onClick={() => onComplete(p)}>
                      <Check size={13} /> Complete
                    </button>
                  </div>
                  <div className="mm-pvw-prog-batch">
                    {p.total_batches} patty
                    {p.completed_batches > 0 ? ` · ${p.completed_batches} done` : ""}
                  </div>
                  {p.remark ? <div className="mm-prog-card-remark">“{p.remark}”</div> : null}
                </div>
              ))
            )}
          </div>
        ))
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
 * and Night plans side by side, each a block per MACHINE: the colour it is running, how far
 * through its batches it is, and Complete to record that (which asks how many are done, the
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
                      <td><span className="mm-colour-name">{c.color}</span></td>
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
        <ShiftColumn title="Day" groups={v?.day ?? []} onComplete={setCompleting} />
        <ShiftColumn title="Night" groups={v?.night ?? []} onComplete={setCompleting} />
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
