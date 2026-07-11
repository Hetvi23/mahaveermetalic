import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Factory, Plus, Trash2, X, ArrowRight, ShieldAlert, Scale } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";
import { useSerialScale } from "@/utils/serialScale";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const today = () => new Date().toISOString().slice(0, 10);
const SHIFTS = ["Day", "Night"] as const;

type Program = {
  name: string;
  program_date?: string;
  customer_order?: string;
  party?: string;
  roll_no?: string;
  shade?: string;
  cut?: string;
  machine_no?: string;
  shift?: string;
  job_work_flag?: number;
  patti_qty?: number;
  net_weight?: number;
  input_weight?: number;
};
type Produced = {
  name: string;
  posting_date?: string;
  customer_order?: string;
  roll_no?: string;
  machine_no?: string;
  operator?: string;
  gross_weight?: number;
  bobbin_weight?: number;
  box_weight?: number;
  net_weight?: number;
  variance_percent?: number;
  pin_override?: number;
};
type BobbinMaster = { name: string; weight?: number; quality?: string };

export default function ProductionScreen() {
  const queueCall = useFrappeGetCall<{ message: Program[] }>(`${API}.threads_processing`, undefined, "prod-queue");
  const doneCall = useFrappeGetCall<{ message: Produced[] }>(`${API}.production_done`, undefined, "prod-done");
  const [producing, setProducing] = useState<Program | null>(null);

  const queue = queueCall.data?.message ?? [];
  const done = doneCall.data?.message ?? [];

  const refresh = () => { void queueCall.mutate(); void doneCall.mutate(); };

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Production</h1>
          <p className="mm-page-sub">Wind each program&apos;s threads onto bobbins. Net = Gross − Bobbin − Box; large variance needs an Admin PIN.</p>
        </div>
      </header>

      <div className="mm-iw-grid">
        {/* Queue — programs in threads processing */}
        <section className="mm-card mm-card-pad">
          <div className="mm-iw-sec-head">
            <h2 className="mm-panel-title"><Factory size={16} /> In threads processing</h2>
            <span className="mm-pill mm-pill-muted">{queue.length}</span>
          </div>
          {queueCall.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="mm-empty">No programs waiting to be produced.</p>
          ) : (
            <div className="mm-pick-list">
              {queue.map((p) => (
                <div key={p.name} className="mm-pick-row" onClick={() => setProducing(p)}>
                  <div style={{ flex: 1 }}>
                    <div><strong>{p.roll_no || p.shade || "—"}</strong> · {p.cut || "—"}{p.party ? ` · ${p.party}` : ""}</div>
                    <div className="mm-prog-card-meta">
                      {p.machine_no ? `Machine ${p.machine_no} · ` : ""}{p.shift || "—"} · {p.patti_qty ?? 0} patty · input {(p.input_weight ?? 0).toLocaleString()} kg
                      {p.job_work_flag ? " · job work" : ""}
                    </div>
                  </div>
                  <button className="mm-mini mm-mini-ok" onClick={(e) => { e.stopPropagation(); setProducing(p); }}>
                    Produce <ArrowRight size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Finished goods */}
        <section className="mm-card mm-card-pad">
          <div className="mm-iw-sec-head">
            <h2 className="mm-panel-title">Produced (finished goods)</h2>
            <span className="mm-pill mm-pill-muted">{done.length}</span>
          </div>
          {done.length === 0 ? (
            <p className="mm-empty">Nothing produced yet.</p>
          ) : (
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Roll</th>
                    <th>Machine</th>
                    <th>Operator</th>
                    <th className="mm-num">Net (kg)</th>
                    <th className="mm-num">Var %</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((d) => (
                    <tr key={d.name}>
                      <td>{d.posting_date || "—"}</td>
                      <td>{d.roll_no || "—"}</td>
                      <td>{d.machine_no || "—"}</td>
                      <td>{d.operator || "—"}</td>
                      <td className="mm-num">{(d.net_weight ?? 0).toLocaleString()}</td>
                      <td className="mm-num">
                        <span className={Math.abs(d.variance_percent ?? 0) > 0 ? "mm-var" : undefined}>
                          {(d.variance_percent ?? 0).toFixed(2)}
                        </span>
                        {d.pin_override ? <ShieldAlert size={12} style={{ marginLeft: 4, verticalAlign: "middle" }} aria-label="PIN override" /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {producing && (
        <ProduceModal program={producing} onClose={() => setProducing(null)} onDone={() => { setProducing(null); refresh(); }} />
      )}
    </div>
  );
}

/* ── Produce: input weight + gross/bobbin/box → net, variance gate ── */
type BobbinRow = { bobbin: string; qty: number | ""; weight: number | "" };
type Calc = { net_weight: number; variance_percent: number; tolerance: number; pin_required: boolean };

function ProduceModal({ program, onClose, onDone }: { program: Program; onClose: () => void; onDone: () => void }) {
  const inputWeight = program.input_weight ?? program.net_weight ?? 0;

  const employees = useFrappeGetDocList<{ name: string; employee_name?: string }>("MM Employee Master", {
    fields: ["name", "employee_name"],
    limit: 200,
  });
  const bobbinMasters = useFrappeGetDocList<BobbinMaster>("MM Bobbin Master", {
    fields: ["name", "weight", "quality"],
    limit: 500,
  });
  const tareMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of bobbinMasters.data ?? []) m[b.name] = Number(b.weight || 0);
    return m;
  }, [bobbinMasters.data]);

  const { call: preview } = useFrappePostCall<{ message: Calc }>(`${API}.preview_variance`);
  const { call: create, loading } = useFrappePostCall(`${API}.create_production`);

  const [operator, setOperator] = useState("");
  const [shift, setShift] = useState<string>(program.shift || "Day");
  const [gross, setGross] = useState<number | "">("");
  const [bobbins, setBobbins] = useState<BobbinRow[]>([{ bobbin: "", qty: "", weight: "" }]);
  const [boxQty, setBoxQty] = useState<number | "">("");
  const [boxWeight, setBoxWeight] = useState<number | "">("");
  const [jobWork, setJobWork] = useState<boolean>(!!program.job_work_flag);
  const [pin, setPin] = useState("");
  const [calc, setCalc] = useState<Calc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Bobbin total — a blank row weight falls back to qty × master tare (mirrors controller).
  const bobbinTotal = useMemo(
    () =>
      bobbins.reduce((s, r) => {
        const eff = r.weight !== "" ? Number(r.weight) : (Number(r.qty) || 0) * (tareMap[r.bobbin] || 0);
        return s + (Number(eff) || 0);
      }, 0),
    [bobbins, tareMap],
  );

  // Live Net + variance + PIN gate (debounced, authoritative from the server).
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const r = await preview({
          input_weight: inputWeight,
          gross_weight: Number(gross) || 0,
          bobbin_weight: Number(bobbinTotal.toFixed(3)),
          box_weight: Number(boxWeight) || 0,
        });
        setCalc(r.message);
      } catch {
        setCalc(null);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [gross, bobbinTotal, boxWeight, inputWeight, preview]);

  const setRow = (i: number, patch: Partial<BobbinRow>) =>
    setBobbins((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setBobbins((prev) => [...prev, { bobbin: "", qty: "", weight: "" }]);
  const delRow = (i: number) => setBobbins((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));

  async function submit() {
    setErr(null);
    if (!(Number(gross) > 0)) return setErr("Enter the gross weight.");
    if (calc?.pin_required && !pin.trim()) return setErr("Variance is over tolerance — an Admin Override PIN is required.");
    try {
      await create({
        source_program: program.name,
        gross_weight: Number(gross) || 0,
        bobbins: JSON.stringify(
          bobbins
            .filter((r) => r.bobbin)
            .map((r) => ({ bobbin: r.bobbin, qty: Number(r.qty) || 0, weight: r.weight === "" ? 0 : Number(r.weight) })),
        ),
        box_qty: Number(boxQty) || 0,
        box_weight: Number(boxWeight) || 0,
        operator: operator || undefined,
        shift,
        customer_order: program.customer_order,
        posting_date: today(),
        job_work: jobWork ? 1 : 0,
        pin: pin || undefined,
      });
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  const net = calc?.net_weight ?? 0;
  const variance = calc?.variance_percent ?? 0;
  const overTol = !!calc?.pin_required;

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal mm-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Produce — {program.roll_no || program.shade || "program"}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <div className="mm-banner" style={{ marginBottom: "1rem" }}>
            Input weight (from program): <strong>{inputWeight.toLocaleString()} kg</strong>
            {program.cut ? ` · Cut ${program.cut}` : ""}{program.machine_no ? ` · Machine ${program.machine_no}` : ""}
          </div>

          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Operator</span>
              <select className="mm-input" value={operator} onChange={(e) => setOperator(e.target.value)}>
                <option value="">— none —</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.name} value={e.name}>{e.employee_name || e.name}</option>
                ))}
              </select>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Shift</span>
              <select className="mm-input" value={shift} onChange={(e) => setShift(e.target.value)}>
                {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <div className="mm-field mm-span-2">
              <span className="mm-field-label">Gross weight (Kg) *</span>
              <input className="mm-input" type="number" value={gross} placeholder="Capture from scale or type"
                onChange={(e) => setGross(e.target.value === "" ? "" : Number(e.target.value))} />
              <ScaleCapture onCapture={(w) => setGross(Number(w.toFixed(3)))} />
            </div>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>

          {/* Bobbins */}
          <p className="mm-field-label" style={{ margin: "1rem 0 0.4rem" }}>Bobbins (tare auto-fills from master when weight is blank)</p>
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr><th>Bobbin</th><th className="mm-num">Qty</th><th className="mm-num">Weight (Kg)</th><th /></tr>
              </thead>
              <tbody>
                {bobbins.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select className="mm-input mm-input-compact" value={r.bobbin} onChange={(e) => setRow(i, { bobbin: e.target.value })}>
                        <option value="">— choose —</option>
                        {(bobbinMasters.data ?? []).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                      </select>
                    </td>
                    <td className="mm-num">
                      <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.qty}
                        onChange={(e) => setRow(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </td>
                    <td className="mm-num">
                      <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.weight}
                        placeholder={r.bobbin && r.qty !== "" ? ((Number(r.qty) || 0) * (tareMap[r.bobbin] || 0)).toFixed(3) : "auto"}
                        onChange={(e) => setRow(i, { weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </td>
                    <td className="mm-num">
                      <button className="mm-mini mm-mini-danger" onClick={() => delRow(i)} disabled={bobbins.length === 1} aria-label="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="mm-mini" style={{ marginTop: "0.5rem" }} onClick={addRow}><Plus size={13} /> Add bobbin</button>

          {/* Box */}
          <div className="mm-form-grid" style={{ marginTop: "1rem" }}>
            <label className="mm-field">
              <span className="mm-field-label">Box qty</span>
              <input className="mm-input" type="number" value={boxQty} onChange={(e) => setBoxQty(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Box weight (Kg)</span>
              <input className="mm-input" type="number" value={boxWeight} onChange={(e) => setBoxWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
          </div>

          {/* Live result */}
          <div className="mm-banner" style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <span>Bobbin: <strong>{bobbinTotal.toFixed(3)} kg</strong></span>
            <span>Net: <strong>{net.toLocaleString()} kg</strong></span>
            <span className={overTol ? "mm-var-over" : undefined}>
              Variance: <strong>{variance.toFixed(2)}%</strong>
              {calc ? ` (tol ±${calc.tolerance}%)` : ""}
            </span>
          </div>

          {overTol && (
            <label className="mm-field" style={{ marginTop: "0.8rem" }}>
              <span className="mm-field-label"><ShieldAlert size={13} style={{ verticalAlign: "middle" }} /> Admin Override PIN (variance over tolerance)</span>
              <input className="mm-input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Required to accept this variance" />
            </label>
          )}

          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Produce"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Weighing-scale capture (Web Serial) for the gross weight ── */
const BAUDS = [9600, 2400, 4800, 19200, 38400];

function ScaleCapture({ onCapture }: { onCapture: (weight: number) => void }) {
  const { supported, connected, connecting, error, reading, connect, disconnect } = useSerialScale();
  const [baud, setBaud] = useState<number>(() => {
    const saved = typeof window !== "undefined" ? Number(window.localStorage.getItem("mm-scale-baud")) : 0;
    return BAUDS.includes(saved) ? saved : 9600;
  });

  if (!supported) {
    return (
      <p className="mm-muted mm-scale-hint">
        <Scale size={12} /> Scale auto-read needs Chrome/Edge on the PC wired to the scale (HTTPS or localhost). Type the weight here.
      </p>
    );
  }

  const w = reading?.weight ?? null;
  const stable = !!reading?.stable;

  return (
    <div className="mm-scale">
      {!connected ? (
        <div className="mm-scale-row">
          <select
            className="mm-input mm-input-compact mm-scale-baud"
            value={baud}
            title="Scale baud rate (try 9600, switch to 2400 if you see garbage)"
            onChange={(e) => { const b = Number(e.target.value); setBaud(b); window.localStorage.setItem("mm-scale-baud", String(b)); }}
          >
            {BAUDS.map((b) => <option key={b} value={b}>{b} baud</option>)}
          </select>
          <button type="button" className="mm-mini" disabled={connecting} onClick={() => void connect(baud)}>
            <Scale size={13} /> {connecting ? "Connecting…" : "Connect scale"}
          </button>
        </div>
      ) : (
        <div className="mm-scale-row">
          <span className={`mm-scale-reading ${stable ? "is-stable" : "is-moving"}`}>
            {w != null ? `${w.toLocaleString()} kg` : "—"} <em>{reading ? (stable ? "stable" : "moving") : ""}</em>
          </span>
          <button type="button" className="mm-mini mm-mini-ok" disabled={w == null || !stable} onClick={() => w != null && onCapture(w)}>
            Use weight
          </button>
          <button type="button" className="mm-mini" onClick={() => void disconnect()}>Disconnect</button>
        </div>
      )}
      {connected && reading && <div className="mm-scale-raw" title="Raw frame from the scale — share this to lock the parser">{reading.raw}</div>}
      {error && <p className="mm-error mm-scale-hint">{error}</p>}
    </div>
  );
}
