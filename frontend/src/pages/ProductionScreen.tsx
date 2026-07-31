import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Factory, Plus, Trash2, X, ArrowRight, ShieldAlert, Scale, Package } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";
import { useSerialScale } from "@/utils/serialScale";
import PartyPicker from "@/components/PartyPicker";
import QuickCreateMaster from "@/components/QuickCreateMaster";
import { getMasterByDoctype } from "@/config/registry";

const API = "mahaveermetalic.mahaveer_metallic.api.production";
const today = () => new Date().toISOString().slice(0, 10);
const SHIFTS = ["Day", "Night"] as const;
const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

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
          <p className="mm-page-sub">Wind each program&apos;s threads into boxes. Each box: Net = Gross − Bobbin − Box; large variance needs an Admin PIN.</p>
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
                    <th>V.No</th>
                    <th>Date</th>
                    <th>Roll</th>
                    <th>Operator</th>
                    <th className="mm-num">Net (kg)</th>
                    <th className="mm-num">Var %</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((d) => (
                    <tr key={d.name}>
                      <td>{d.name}</td>
                      <td>{d.posting_date || "—"}</td>
                      <td>{d.roll_no || "—"}</td>
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

/* ── Produce voucher: header + many boxes; each box netted; variance gate ── */
type BoxRow = {
  item?: string; gross: number; qty: number; bobbin: string;
  bobbinPcs: number; perPcsWeight: number; totalBobbin: number; boxWeight: number; net: number;
};
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

  const { call: preview } = useFrappePostCall<{ message: Calc }>(`${API}.preview_variance`);
  const { call: create, loading } = useFrappePostCall(`${API}.create_production`);

  const [operator, setOperator] = useState("");
  const [shift, setShift] = useState<string>(program.shift || "Day");
  const [jobWork, setJobWork] = useState<boolean>(!!program.job_work_flag);
  const [batchNo, setBatchNo] = useState("");
  const [vdate, setVdate] = useState<string>(today());
  const [boxReturn, setBoxReturn] = useState(false);
  const [bobbinReturn, setBobbinReturn] = useState(false);
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [pin, setPin] = useState("");
  const [calc, setCalc] = useState<Calc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [party, setParty] = useState<string>(program.party || "");
  const [order, setOrder] = useState<string>(program.customer_order || "");
  const [size, setSize] = useState<string>(program.cut || "");

  // Select Order = this party's OPEN orders that include this item (colour).
  const openOrdersCall = useFrappeGetCall<{ message: { name: string; required_weight?: number; delivery_date?: string }[] }>(
    `${API}.open_orders_for_item`,
    party ? { color: program.shade || undefined, party } : undefined,
    party ? `prod-oo-${program.shade || ""}-${party}` : null,
  );
  const openOrders = openOrdersCall.data?.message ?? [];

  const totalNet = useMemo(() => r3(boxes.reduce((s, b) => s + b.net, 0)), [boxes]);
  const totalGross = useMemo(() => r3(boxes.reduce((s, b) => s + b.gross, 0)), [boxes]);
  const availableNet = r3(inputWeight - totalNet);

  // Variance of the produced total (Σ box net) vs the program input — server tolerance.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const r = await preview({ input_weight: inputWeight, gross_weight: totalNet, bobbin_weight: 0, box_weight: 0 });
        setCalc(r.message);
      } catch {
        setCalc(null);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [totalNet, inputWeight, preview]);

  const overTol = !!calc?.pin_required && boxes.length > 0;

  async function submit() {
    setErr(null);
    if (boxes.length === 0) return setErr("Add at least one box.");
    if (overTol && !pin.trim()) return setErr("Variance is over tolerance — an Admin Override PIN is required.");
    try {
      await create({
        source_program: program.name,
        boxes: JSON.stringify(
          boxes.map((b) => ({
            item: b.item, gross_weight: b.gross, qty: b.qty, bobbin: b.bobbin || undefined,
            bobbin_pcs: b.bobbinPcs, bobbin_pcs_weight: b.perPcsWeight,
            total_bobbin_weight: b.totalBobbin, box_weight: b.boxWeight,
          })),
        ),
        operator: operator || undefined,
        shift,
        customer_order: order || undefined,
        party: party || undefined,
        cut: size || undefined,
        posting_date: vdate || today(),
        batch_no: batchNo || undefined,
        box_return: boxReturn ? 1 : 0,
        bobbin_return: bobbinReturn ? 1 : 0,
        job_work: jobWork ? 1 : 0,
        pin: pin || undefined,
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
          <span className="mm-modal-title">Production Voucher — {program.roll_no || program.shade || "program"}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {/* Top: Item + Is Job Work (mirrors the legacy voucher header bar) */}
          <div className="mm-pv-top">
            <label className="mm-field" style={{ flex: 1, maxWidth: 360 }}>
              <span className="mm-field-label">Item</span>
              <input className="mm-input" value={program.shade || program.roll_no || "—"} readOnly />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>

          {/* Voucher header — labelled fields in a grid, like the legacy form */}
          <div className="mm-pv-grid">
            <label className="mm-field">
              <span className="mm-field-label">V.No</span>
              <input className="mm-input" value="Auto (MMPROD)" readOnly />
            </label>
            <PartyPicker label="Party" value={party} onChange={(v) => { setParty(v); setOrder(""); }} />
            <label className="mm-field">
              <span className="mm-field-label">Select Order</span>
              <select className="mm-input" value={order} onChange={(e) => setOrder(e.target.value)} disabled={!party}>
                <option value="">{!party ? "Pick a party first" : openOrdersCall.isLoading ? "Loading…" : "— none —"}</option>
                {order && !openOrders.some((o) => o.name === order) && <option value={order}>{order}</option>}
                {openOrders.map((o) => (
                  <option key={o.name} value={o.name}>{o.name}{o.required_weight != null ? ` · req ${o.required_weight}` : ""}</option>
                ))}
              </select>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">V.Date</span>
              <input className="mm-input" type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Batch No</span>
              <input className="mm-input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Optional" />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Size</span>
              <input className="mm-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 50/85" />
            </label>
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
            <label className="mm-field">
              <span className="mm-field-label">Machine</span>
              <input className="mm-input" value={program.machine_no || "—"} readOnly />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Input (Kg)</span>
              <input className="mm-input" value={inputWeight.toLocaleString()} readOnly />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Available Net (Kg)</span>
              <input className={`mm-input ${availableNet < 0 ? "mm-input-warn" : ""}`} value={availableNet.toLocaleString()} readOnly />
            </label>
          </div>

          <div className="mm-pv-checks">
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={boxReturn} onChange={(e) => setBoxReturn(e.target.checked)} /> <span className="mm-field-label">Box Return</span>
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={bobbinReturn} onChange={(e) => setBobbinReturn(e.target.checked)} /> <span className="mm-field-label">Bobbin Return</span>
            </label>
          </div>

          {/* Boxes */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "1.1rem 0 0.5rem" }}>
            <p className="mm-field-label" style={{ margin: 0 }}>Boxes ({boxes.length})</p>
            <button className="mm-mini mm-mini-ok" onClick={() => setAdding(true)}><Plus size={13} /> Box</button>
          </div>
          {boxes.length === 0 ? (
            <p className="mm-empty">No boxes yet. Click “Box” to add one.</p>
          ) : (
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr>
                    <th>#</th><th>Item</th><th className="mm-num">Gr.Wt</th><th className="mm-num">Qty</th>
                    <th>Bobbin</th><th className="mm-num">Pcs</th><th className="mm-num">Bobbin/Pcs Wt</th>
                    <th className="mm-num">Total Bobbin Wt</th><th className="mm-num">Box Wt</th><th className="mm-num">Net Wt</th><th />
                  </tr>
                </thead>
                <tbody>
                  {boxes.map((b, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{b.item || "—"}</td>
                      <td className="mm-num">{b.gross.toLocaleString()}</td>
                      <td className="mm-num">{b.qty || "—"}</td>
                      <td>{b.bobbin || "—"}</td>
                      <td className="mm-num">{b.bobbinPcs || "—"}</td>
                      <td className="mm-num">{b.perPcsWeight || "—"}</td>
                      <td className="mm-num">{b.totalBobbin.toLocaleString()}</td>
                      <td className="mm-num">{b.boxWeight.toLocaleString()}</td>
                      <td className="mm-num"><strong>{b.net.toLocaleString()}</strong></td>
                      <td className="mm-num">
                        <button className="mm-mini mm-mini-danger" onClick={() => setBoxes((p) => p.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals + variance */}
          <div className="mm-banner" style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <span>Total box: <strong>{boxes.length}</strong></span>
            <span>Total gross: <strong>{totalGross.toLocaleString()} kg</strong></span>
            <span>Total net: <strong>{totalNet.toLocaleString()} kg</strong></span>
            <span className={overTol ? "mm-var-over" : undefined}>
              Variance: <strong>{(calc?.variance_percent ?? 0).toFixed(2)}%</strong>
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
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Submit voucher"}</button>
        </div>
      </div>

      {adding && (
        <BoxDialog
          bobbinMasters={bobbinMasters.data ?? []}
          availableNet={availableNet}
          defaultItem={program.shade || program.roll_no || ""}
          onClose={() => setAdding(false)}
          onAdd={(b) => { setBoxes((p) => [...p, b]); setAdding(false); }}
        />
      )}
    </div>
  );
}

/* ── Box Details popup: the per-box calculator (Net = Gross − Bobbin − Box) ── */
function BoxDialog({
  bobbinMasters, availableNet, defaultItem, onClose, onAdd,
}: {
  bobbinMasters: BobbinMaster[]; availableNet: number; defaultItem: string;
  onClose: () => void; onAdd: (b: BoxRow) => void;
}) {
  const [extraBobbins, setExtraBobbins] = useState<BobbinMaster[]>([]);
  const allBobbins = useMemo(() => [...bobbinMasters, ...extraBobbins], [bobbinMasters, extraBobbins]);
  const tareMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of allBobbins) m[b.name] = Number(b.weight || 0);
    return m;
  }, [allBobbins]);
  const bobbinMaster = getMasterByDoctype("MM Bobbin Master");

  const [printer, setPrinter] = useState<string>(
    () => (typeof window !== "undefined" && window.localStorage.getItem("mm-box-printer")) || "TSC TE244",
  );
  const [gross, setGross] = useState<number | "">("");
  const [bobbin, setBobbin] = useState("");
  const [pcs, setPcs] = useState<number | "">("");
  const [perPcs, setPerPcs] = useState<number | "">("");
  const [boxWeight, setBoxWeight] = useState<number | "">("");
  const [quick, setQuick] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Selecting a bobbin fills the per-pcs weight from its master tare (editable after).
  useEffect(() => {
    if (bobbin && perPcs === "" && tareMap[bobbin]) setPerPcs(tareMap[bobbin]);
  }, [bobbin, perPcs, tareMap]);

  const totalBobbin = r3((Number(pcs) || 0) * (Number(perPcs) || 0));
  const net = r3((Number(gross) || 0) - totalBobbin - (Number(boxWeight) || 0));

  function add() {
    setErr(null);
    if (!(Number(gross) > 0)) return setErr("Enter the total (gross) weight.");
    onAdd({
      item: defaultItem,
      gross: Number(gross) || 0,
      qty: Number(pcs) || 0,
      bobbin,
      bobbinPcs: Number(pcs) || 0,
      perPcsWeight: Number(perPcs) || 0,
      totalBobbin,
      boxWeight: Number(boxWeight) || 0,
      net,
    });
  }

  return (
    <div className="mm-modal-scrim" style={{ zIndex: 60 }} onClick={onClose}>
      <div className="mm-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title"><Package size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />Box Details</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <div className="mm-bx">
            <div className="mm-bx-row">
              <span className="mm-bx-label">Box Sticker Printer</span>
              <input className="mm-input mm-bx-hi" value={printer}
                onChange={(e) => { setPrinter(e.target.value); window.localStorage.setItem("mm-box-printer", e.target.value); }} />
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Available Net Weight</span>
              <input className="mm-input mm-bx-hi" value={availableNet.toLocaleString()} readOnly />
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Total Weight</span>
              <div>
                <input className="mm-input" type="number" value={gross} placeholder="0.000"
                  onChange={(e) => setGross(e.target.value === "" ? "" : Number(e.target.value))} />
                <ScaleCapture onCapture={(w) => setGross(Number(w.toFixed(3)))} />
              </div>
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Bobbin</span>
              <div className="mm-bx-bobbin">
                <select className="mm-input" value={bobbin} onChange={(e) => setBobbin(e.target.value)}>
                  <option value="">— none —</option>
                  {allBobbins.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
                {bobbinMaster && (
                  <button type="button" className="mm-link-add mm-bx-add" title="New bobbin" onClick={() => setQuick(true)}><Plus size={15} /></button>
                )}
              </div>
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Bobbin Weight</span>
              <div className="mm-bx-pcs">
                <span className="seg">Pcs</span>
                <input type="number" value={pcs} onChange={(e) => setPcs(e.target.value === "" ? "" : Number(e.target.value))} />
                <span className="seg">×</span>
                <input type="number" value={perPcs} placeholder={bobbin && tareMap[bobbin] ? String(tareMap[bobbin]) : "0.000"}
                  onChange={(e) => setPerPcs(e.target.value === "" ? "" : Number(e.target.value))} />
                <span className="seg">Kg</span>
              </div>
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Total Bobbin Weight</span>
              <input className="mm-input mm-bx-ro" value={totalBobbin.toLocaleString()} readOnly />
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Box Weight</span>
              <input className="mm-input" type="number" value={boxWeight}
                onChange={(e) => setBoxWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div className="mm-bx-row">
              <span className="mm-bx-label">Net Weight</span>
              <input className={`mm-input mm-bx-ro ${net < 0 ? "mm-input-warn" : ""}`} value={net.toLocaleString()} readOnly />
            </div>
          </div>

          {err && <p className="mm-error" style={{ marginTop: "0.7rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" onClick={add}>Submit</button>
        </div>
      </div>

      {quick && bobbinMaster && (
        <QuickCreateMaster
          meta={bobbinMaster}
          seed=""
          onClose={() => setQuick(false)}
          onCreated={(name) => {
            setExtraBobbins((p) => [...p, { name, weight: 0 }]);
            setBobbin(name);
            setQuick(false);
          }}
        />
      )}
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
