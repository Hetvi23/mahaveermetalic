import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { X } from "lucide-react";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const PROGRAM_API = "mahaveermetalic.mahaveer_metallic.api.program";

/**
 * "How many batches are done?" — the one dialog, used by the Program board and by Program
 * View.
 *
 * There were two of these, and they had drifted into doing DIFFERENT THINGS on the same
 * answer. Entering 2 of 3 on the Program board closed the job out short — the machine
 * freed and the unrun batch's patti went back to the picker — while the same 2 of 3 in
 * Program View recorded progress and kept the job on the machine. Two screens showing one
 * program, disagreeing about what completing it means. One component now, so they cannot
 * disagree again.
 *
 * SHORT MEANS THE JOB IS OVER. Fewer batches than planned finishes the program: the
 * machine frees and the patti of the batches that never ran go straight back on offer,
 * so nobody has to remember to Revert the remainder afterwards.
 *
 * The remark is OPTIONAL, including when the job stops short. It was compulsory, on the
 * reasoning that the next person to meet this material deserves to know why it came back.
 * That is worth asking for and not worth insisting on: a box that will not let you past
 * teaches the floor to type "x", and a sentence nobody meant reads exactly like one that
 * was — which is worse than an empty field, because it can be believed.
 */
export default function ProgramCompleteDialog({
  program,
  label,
  total,
  onClose,
  onDone,
}: {
  /** The MM Program name. */
  program: string;
  /** What the operator calls it — a colour, or the roll. */
  label: string;
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [completed, setCompleted] = useState<number | "">(total);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { call, loading } = useFrappePostCall(`${PROGRAM_API}.complete_batches`);

  const comp = completed === "" ? null : completed;
  const short = comp !== null && comp < total;

  async function submit() {
    if (comp === null) return setErr("Enter how many batches are completed.");
    setErr(null);
    try {
      const res = await call({ program, completed: comp, reason: reason.trim() || undefined });
      const back = Number((res as { message?: { returned_batches?: number } })?.message?.returned_batches || 0);
      const returned = back || total - comp;
      toast(
        comp >= total
          ? "All batches done — sent to Production"
          : `${comp}/${total} done · ${returned} batch${returned === 1 ? "" : "es"} returned to the patty shelf`,
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
          <span className="mm-modal-title">Complete — {label}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <label className="mm-field">
            <span className="mm-field-label">Batches completed</span>
            <input className="mm-input" type="number" min={0} max={total} step={1} value={completed} autoFocus
              onChange={(e) =>
                setCompleted(
                  e.target.value === "" ? "" : Math.max(0, Math.min(total, Math.round(Number(e.target.value) || 0))),
                )
              } />
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
          {/* Always on screen, never conditional. It used to appear only once the count
              went short, which made a field nobody could find until they had already
              changed something — and a full run is still worth a note ("re-dyed", "ran
              slow"). Optional either way. */}
          <label className="mm-field" style={{ marginTop: "0.6rem" }}>
            <span className="mm-field-label">
              Remark <span className="mm-muted">(optional)</span>
            </span>
            <textarea className="mm-input" rows={2} value={reason}
              placeholder={short ? "Thread broke, shade off, machine trouble…" : "Anything worth knowing about this run"}
              onChange={(e) => setReason(e.target.value)} />
            <span className="mm-muted" style={{ fontSize: "0.76rem" }}>
              If you write one it stays on this lot — anyone programming, cutting or receiving it later will see it.
            </span>
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
