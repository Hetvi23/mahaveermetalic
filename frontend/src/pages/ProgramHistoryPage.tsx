import { Fragment, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ChevronDown, ChevronRight, History, Printer, Search } from "lucide-react";
import SearchSelect from "@/components/SearchSelect";
import { fmtDate, todayISO } from "@/utils/localDate";

const API = "mahaveermetalic.mahaveer_metallic.api.program";
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return todayISO(d);
};
const kg = (n?: number) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

/** One production raised against the program. */
type Prod = {
  name: string; posting_date?: string | null; box_qty: number; net_weight: number;
  gross_weight: number; operator?: string | null; shift?: string | null;
  batch_no?: string | null; to_inventory: number; cancelled: number;
};
/** A hand-entered event — a short completion or a revert, and the reason given for it. */
type Event = {
  event_type?: string | null; reason?: string | null; on?: string | null;
  resolved: number; source?: string | null;
};
type Row = {
  name: string; program_date?: string | null; shade?: string; cut?: string; lot?: string;
  roll_no?: string; machine_no?: string; shift?: string; customer_order?: string;
  party?: string; company?: string; job_work_flag: number; status?: string; stage: string;
  reverted: number; total_batches: number; completed_batches: number; patti_qty: number;
  per_patty_weight: number; planned_weight: number; completed_weight: number;
  boxed_weight: number; boxed_box: number; pending_weight: number; remark?: string | null;
  productions: Prod[]; events: Event[];
};
type Report = {
  rows: Row[];
  totals: {
    programs: number; planned_weight: number; boxed_weight: number;
    pending_weight: number; patti_qty: number; boxed_box: number;
  };
};

/* Read in the order the floor would ask it, so the filter list reads as a progression
   rather than an alphabetical jumble. */
const STAGES = ["Open", "Running", "Part cut", "Batches done", "Part boxed", "Boxed", "Closed", "Unfinished"];
/* Boxed is the only finished state; Unfinished and Closed are endings of another kind, so
   neither gets the green. */
const STAGE_PILL: Record<string, string> = {
  Boxed: "mm-pill-ok",
  Unfinished: "mm-pill-warn",
  Closed: "mm-pill-muted",
  Open: "mm-pill-muted",
};
/* Amber for anything still in flight — Running, Part cut, Batches done, Part boxed. */
const stagePill = (s: string) => STAGE_PILL[s] || "mm-pill-pending";

/**
 * Program history.
 *
 * A program is the unit the floor works in — one colour, one lot, one machine, one shift
 * — but its story was scattered across three places: the plan on the program, the output
 * on the productions raised against it, and the REASON a short completion or a revert
 * happened on the lot's remarks. Nobody could answer "what happened to this lot" from any
 * one screen, which is the question asked whenever a weight does not tie.
 *
 * So: one line per program with the plan beside what was actually boxed, and the whole
 * trail — every production, every event and the reason given — behind it.
 */
export default function ProgramHistoryPage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayISO());
  const [machine, setMachine] = useState("");
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ from: monthAgo(), to: todayISO(), machine: "", stage: "", q: "" });
  const [open, setOpen] = useState<string | null>(null);

  const machines = useFrappeGetDocList<{ name: string }>("MM Machine", {
    fields: ["name"], limit: 0, orderBy: { field: "name", order: "asc" },
  });

  const { data, isLoading } = useFrappeGetCall<{ message: Report }>(
    `${API}.program_history`,
    {
      from_date: applied.from, to_date: applied.to,
      machine: applied.machine || undefined,
      stage: applied.stage || undefined,
      search: applied.q || undefined,
    },
    `prog-hist-${applied.from}-${applied.to}-${applied.machine}-${applied.stage}-${applied.q}`,
  );
  const r = data?.message;
  const rows = useMemo(() => r?.rows ?? [], [r]);
  const t = r?.totals;

  /* DATE, THEN MACHINE. The register is read as a day's work — "what did machine 4 do on
     the 6th" — not as a flat list of programs, so the two things that were repeating down
     every row become the headings they already were in the reader's head. The server
     returns newest-date-first and a Map keeps that order; only the machines inside a day
     need sorting, numerically, or 10 lands between 1 and 2. */
  const days = useMemo(() => {
    const byDate = new Map<string, Map<string, Row[]>>();
    for (const p of rows) {
      const d = p.program_date || "\u2014";
      const m = p.machine_no || "\u2014";
      if (!byDate.has(d)) byDate.set(d, new Map());
      const machines = byDate.get(d)!;
      if (!machines.has(m)) machines.set(m, []);
      machines.get(m)!.push(p);
    }
    return [...byDate.entries()].map(([date, machines]) => ({
      date,
      machines: [...machines.entries()]
        .sort((a, b) => {
          const na = Number(a[0]), nb = Number(b[0]);
          return !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : a[0].localeCompare(b[0]);
        })
        .map(([machine, rs]) => ({ machine, rows: rs })),
    }));
  }, [rows]);

  /* Each heading carries its own arithmetic, so a day or a machine can be read without
     adding its rows up by eye. */
  const sums = (rs: Row[]) => ({
    planned: rs.reduce((a, x) => a + x.planned_weight, 0),
    boxed: rs.reduce((a, x) => a + x.boxed_weight, 0),
    pending: rs.reduce((a, x) => a + x.pending_weight, 0),
    patty: rs.reduce((a, x) => a + x.patti_qty, 0),
  });
  const COLS = 12;

  function apply() { setApplied({ from, to, machine, stage, q }); }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar mm-no-print">
        <div>
          <h1 className="mm-page-title">Report — Program history</h1>
          <p className="mm-page-sub">
            What each program planned, what was cut, what was boxed — and the reason behind every
            short completion and revert.
          </p>
        </div>
      </header>

      <section className="mm-card mm-card-pad mm-no-print" style={{ marginBottom: "1rem" }}>
        <div className="mm-brp-filters">
          <label className="mm-field" style={{ minWidth: 240 }}>
            <span className="mm-field-label">Search</span>
            <div className="mm-search-wrap">
              <Search size={15} className="mm-search-icon" aria-hidden />
              <input className="mm-input mm-search-pill" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
                placeholder="Colour / lot / roll / cut / order / program" />
            </div>
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Machine</span>
            <SearchSelect value={machine} placeholder="All machines" onChange={setMachine}
              options={(machines.data ?? []).map((m) => ({ value: m.name, label: m.name }))} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Stage</span>
            <SearchSelect value={stage} placeholder="Any stage" onChange={setStage}
              options={STAGES.map((s) => ({ value: s, label: s }))} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">From</span>
            <input className="mm-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">To</span>
            <input className="mm-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="mm-btn-primary" onClick={apply}>Filter</button>
          <button className="mm-btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </section>

      <section className="mm-card mm-card-pad">
        <div className="mm-iw-sec-head mm-no-print">
          <h2 className="mm-panel-title"><History size={16} /> Programs</h2>
          <span className="mm-pill mm-pill-muted">{rows.length}</span>
        </div>
        <div className="mm-print-head">
          <strong>Report — Program history</strong>
          <span>{applied.from} to {applied.to}{applied.machine ? ` · ${applied.machine}` : ""}</span>
        </div>

        {isLoading ? (
          <p className="mm-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mm-empty">No programs in this range.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} aria-label="Expand" />
                  <th>Program</th><th>Colour · Cut</th><th>Lot</th>
                  <th>Shift</th><th>Order</th>
                  <th className="mm-num" title="Batches cut out of the batches planned">Batches</th>
                  <th className="mm-num">Patty</th>
                  <th className="mm-num" title="What the program put on the machine">Planned</th>
                  <th className="mm-num" title="Net weight boxed against this program">Boxed</th>
                  <th className="mm-num" title="Planned less boxed — still on the machine">Pending</th>
                  <th>Stage</th>
                </tr>
              </thead>
              {days.map((day) => {
                const all = day.machines.flatMap((m) => m.rows);
                const dayT = sums(all);
                return (
                  <tbody key={day.date} className="mm-ph-day-block">
                    <tr className="mm-ph-dayrow">
                      <td colSpan={COLS}>
                        <span className="mm-ph-day">{fmtDate(day.date) || day.date}</span>
                        <span className="mm-ph-sum">
                          {all.length} program{all.length === 1 ? "" : "s"} \u00b7 {day.machines.length} machine
                          {day.machines.length === 1 ? "" : "s"} \u00b7 planned <strong>{kg(dayT.planned)}</strong> kg
                          {" \u00b7 boxed "}<strong>{kg(dayT.boxed)}</strong> kg
                          {dayT.pending ? <> \u00b7 pending <strong>{kg(dayT.pending)}</strong> kg</> : null}
                        </span>
                      </td>
                    </tr>

                    {day.machines.map((m) => {
                      const mT = sums(m.rows);
                      return (
                        <Fragment key={m.machine}>
                          <tr className="mm-ph-machrow">
                            <td colSpan={COLS}>
                              <span className="mm-ph-mach">Machine {m.machine}</span>
                              <span className="mm-ph-sum">
                                {m.rows.length} program{m.rows.length === 1 ? "" : "s"} \u00b7 planned{" "}
                                <strong>{kg(mT.planned)}</strong> kg \u00b7 boxed <strong>{kg(mT.boxed)}</strong> kg
                                {mT.pending ? <> \u00b7 pending <strong>{kg(mT.pending)}</strong> kg</> : null}
                              </span>
                            </td>
                          </tr>

                          {m.rows.map((p) => {
                            const isOpen = open === p.name;
                            /* A program with nothing behind it has nothing to open \u2014 don't
                               offer a caret that reveals an empty panel. */
                            const hasTrail = p.productions.length > 0 || p.events.length > 0 || !!p.remark;
                            return (
                              <Fragment key={p.name}>
                                <tr className={hasTrail ? "mm-row-click" : undefined}
                                  onClick={() => hasTrail && setOpen(isOpen ? null : p.name)}>
                                  <td>{hasTrail ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                                  <td title={p.roll_no ? `Roll ${p.roll_no}` : undefined}>{p.name}</td>
                                  <td><strong className="mm-colour-name">{p.shade || "\u2014"}</strong>{p.cut ? ` \u00b7 ${p.cut}` : ""}</td>
                                  <td>{p.lot || "\u2014"}</td>
                                  <td>{p.shift || "\u2014"}</td>
                                  <td title={p.company || p.party || undefined}>{p.customer_order || "\u2014"}</td>
                                  <td className="mm-num">{p.total_batches ? `${p.completed_batches}/${p.total_batches}` : "\u2014"}</td>
                                  <td className="mm-num">{p.patti_qty || "\u2014"}</td>
                                  <td className="mm-num">{kg(p.planned_weight)}</td>
                                  <td className="mm-num">{kg(p.boxed_weight)}</td>
                                  <td className="mm-num">{p.pending_weight ? kg(p.pending_weight) : "\u2014"}</td>
                                  <td>
                                    <span className={`mm-pill ${stagePill(p.stage)}`}>{p.stage}</span>
                                    {p.reverted ? <span className="mm-pill mm-pill-warn" title="This program was reverted at least once">reverted</span> : null}
                                  </td>
                                </tr>
                                {isOpen && (
                                  <tr className="mm-ph-trailrow">
                                    <td colSpan={COLS}>
                                      <div className="mm-ph-trail">
                                        <div>
                                          <h4 className="mm-section-title">Boxed</h4>
                                          {p.productions.length === 0 ? (
                                            <p className="mm-muted">Nothing boxed against this program yet.</p>
                                          ) : (
                                            <ul className="mm-ph-list">
                                              {p.productions.map((x) => (
                                                <li key={x.name} className={x.cancelled ? "mm-ph-dead" : undefined}>
                                                  <strong>{fmtDate(x.posting_date) || "\u2014"}</strong> \u00b7 {x.name} \u00b7{" "}
                                                  {x.box_qty} box \u00b7 <strong>{kg(x.net_weight)}</strong> kg net
                                                  {x.operator ? ` \u00b7 ${x.operator}` : ""}
                                                  {x.shift ? ` \u00b7 ${x.shift}` : ""}
                                                  {x.batch_no ? ` \u00b7 batch ${x.batch_no}` : ""}
                                                  {x.to_inventory ? " \u00b7 to stock" : ""}
                                                  {x.cancelled ? " \u00b7 cancelled" : ""}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                        <div>
                                          <h4 className="mm-section-title">What happened</h4>
                                          {p.events.length === 0 && !p.remark ? (
                                            <p className="mm-muted">No short completion or revert was recorded.</p>
                                          ) : (
                                            <ul className="mm-ph-list">
                                              {p.events.map((e, i) => (
                                                <li key={i}>
                                                  <strong>{e.event_type || "Event"}</strong>
                                                  {e.on ? ` \u00b7 ${e.on}` : ""}
                                                  {e.resolved ? " \u00b7 resolved" : ""}
                                                  {e.reason ? <div className="mm-muted">{e.reason}</div> : null}
                                                </li>
                                              ))}
                                              {p.remark ? <li><strong>Remark</strong><div className="mm-muted">{p.remark}</div></li> : null}
                                            </ul>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                );
              })}
              <tfoot>
                <tr>
                  <td colSpan={7} />
                  <td className="mm-num"><strong>{kg(t?.patti_qty)}</strong></td>
                  <td className="mm-num"><strong>{kg(t?.planned_weight)}</strong></td>
                  <td className="mm-num"><strong>{kg(t?.boxed_weight)}</strong></td>
                  <td className="mm-num"><strong>{kg(t?.pending_weight)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
