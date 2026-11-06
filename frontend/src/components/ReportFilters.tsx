import { type KeyboardEvent, type ReactNode } from "react";
import { Download, Printer, RotateCcw, Search } from "lucide-react";

/**
 * The filter bar every report shares.
 *
 * Each report used to build its own — same fields, seven slightly different markups, and
 * the differences were the problem: some applied on change and some on a button, the
 * Print and CSV buttons landed in a different place on each one, and two reports had no
 * way to clear what you had typed. Reading a report should not mean relearning its
 * controls. This owns the layout, the actions and the Reset; the report supplies its own
 * fields, because only it knows what it can be filtered by.
 */
/**
 * ENTER APPLIES THE FILTER (Hetvi: "filter on enter on all the pages"), from any field in
 * the bar. A field that used the key itself is left alone: Enter in a dropdown picks its
 * option, and the next Enter, with the list closed, filters.
 */
export function applyOnEnter(onApply?: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || !onApply) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    onApply();
  };
}

export function ReportFilters({ children, onApply, onReset, onPrint, onExport, exportDisabled, applyLabel, note }: {
  children: ReactNode;
  onApply?: () => void;
  onReset?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  exportDisabled?: boolean;
  applyLabel?: string;
  /** A line under the controls — what the report counts, or what it deliberately leaves out. */
  note?: ReactNode;
}) {
  return (
    <section className="mm-card mm-card-pad mm-no-print mm-rf">
      <div className="mm-rf-fields" onKeyDown={applyOnEnter(onApply)}>{children}</div>
      <div className="mm-rf-actions">
        {onApply && (
          <button type="button" className="mm-btn-primary" onClick={onApply}>
            <Search size={15} /> {applyLabel || "Filter"}
          </button>
        )}
        {onReset && (
          <button type="button" className="mm-btn-ghost" onClick={onReset} title="Clear every filter">
            <RotateCcw size={15} /> Reset
          </button>
        )}
        <span className="mm-rf-spacer" />
        {onPrint && (
          <button type="button" className="mm-btn-secondary" onClick={onPrint}><Printer size={15} /> Print</button>
        )}
        {onExport && (
          <button type="button" className="mm-btn-secondary" disabled={exportDisabled} onClick={onExport}>
            <Download size={15} /> CSV
          </button>
        )}
      </div>
      {note ? <p className="mm-rf-note">{note}</p> : null}
    </section>
  );
}

/** One labelled control. Kept here so every report's fields line up to the same grid. */
export function Filter({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`mm-field mm-rf-field ${wide ? "mm-rf-field-wide" : ""}`}>
      <span className="mm-field-label">{label}</span>
      {children}
    </label>
  );
}
