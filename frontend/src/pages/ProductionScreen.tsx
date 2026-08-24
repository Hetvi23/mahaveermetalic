import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Factory, Pencil, Plus, Printer, Search, Trash2, X, ArrowRight, ShieldAlert, Scale, Package, Download } from "lucide-react";
import { LotRemarkBadge, useLotRemarks, type LotRemark } from "@/components/LotRemarkBadge";
import { extractErrorMessage } from "@/utils/frappeError";
import { useSerialScale } from "@/utils/serialScale";
import QuickCreateMaster from "@/components/QuickCreateMaster";
import { getMasterByDoctype } from "@/config/registry";
import { downloadBoxStickers, printBoxStickers } from "@/utils/boxSticker";
import { printChallan, type ChallanPrintData } from "@/utils/challanPrint";
import SearchSelect from "@/components/SearchSelect";

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
  /** What has actually come off the machine, and what the program planned. A part-done
   *  program lists the formed count — the rest arrives as it is completed. */
  formed_patti?: number;
  planned_patti?: number;
  part_done?: number;
  net_weight?: number;
  input_weight?: number;
  /** Fetched from the patty this program took — the lot its material was inwarded under.
   *  A program drawing patty off two lots carries both. */
  lot?: string | null;
  lot_id?: string | null;
  lot_ids?: string[];
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
  const [q, setQ] = useState("");

  const queue = queueCall.data?.message ?? [];
  // One request for the whole queue. A program that drew patty from several cuttings has
  // several lots, so BOTH keys go in — `lot_id` is a joined display string in that case
  // and would match nothing on its own.
  const { maps } = useLotRemarks({
    lots: queue.map((p) => p.lot),
    lotIds: queue.flatMap((p) => (p.lot_ids?.length ? p.lot_ids : [p.lot_id])),
  });
  /** Every reason standing against any lot this program's material came off. */
  const remarksForProgram = (p: Program): LotRemark[] => {
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
  // Same fields the row prints, so what is searched is what is on screen.
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return queue;
    return queue.filter((p) =>
      [p.shade, p.roll_no, p.cut, p.party, p.customer_order, p.lot_id, p.machine_no, p.shift]
        .filter(Boolean).join(" ").toLowerCase().includes(t),
    );
  }, [queue, q]);
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
          {/* Search — the queue runs to dozens of programs and the one being wound is
              known by its colour, its machine or the party it is for. */}
          <div className="mm-search-wrap" style={{ marginBottom: "0.6rem" }}>
            <Search size={15} className="mm-search-icon" aria-hidden />
            <input className="mm-input mm-search-pill" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search colour / roll / cut / party / machine / order / lot…" />
          </div>
          {queueCall.isLoading ? (
            <p className="mm-muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="mm-empty">{queue.length === 0 ? "No programs waiting to be produced." : `Nothing matches “${q.trim()}”.`}</p>
          ) : (
            <div className="mm-pick-list">
              {shown.map((p) => (
                <div key={p.name} className="mm-pick-row" onClick={() => setProducing(p)}>
                  <div style={{ flex: 1 }}>
                    <div>
                      <strong>{p.roll_no || p.shade || "—"}</strong> · {p.cut || "—"}{p.party ? ` · ${p.party}` : ""}
                      {p.lot_id ? <span className="mm-prod-lot" title={`Lot ${p.lot_id} — from the patty this program took`}>{p.lot_id}</span> : null}
                      {/* Why an earlier program on this lot stopped short — read before winding
                          it, not after. The row is clickable; the badge stops its own clicks. */}
                      <LotRemarkBadge remarks={remarksForProgram(p)} label={`Lot ${p.lot_id || ""}`} />
                    </div>
                    <div className="mm-prog-card-meta">
                      {p.machine_no ? `Machine ${p.machine_no} · ` : ""}{p.shift || "—"} ·{" "}
                      {p.patti_qty ?? 0} patty
                      {p.part_done ? <span className="mm-prod-partdone"> of {p.planned_patti} — rest still running</span> : ""}
                      {" "}· input {(p.input_weight ?? 0).toLocaleString()} kg
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
  /** Returns are per BOX: one voucher can mix boxes whose packaging comes back with ones
   *  whose doesn't. The header pair seeds each new row and toggles them all. */
  boxReturn: boolean; bobbinReturn: boolean;
};
/** `tolerance_kg` is an absolute leeway UNDERNEATH the percentage: a shortfall only
 *  needs the override once it breaks BOTH, so a kilo missing off a 20 kg program is
 *  not a PIN prompt. `short_by` is what is still to be boxed, in the units the floor
 *  is judged in. */
type Calc = {
  net_weight: number; variance_percent: number; tolerance: number;
  tolerance_kg: number; short_by: number; pin_required: boolean;
};

function ProduceModal({ program, onClose, onDone }: { program: Program; onClose: () => void; onDone: () => void }) {
  // The voucher asks about ONE program, so its own small lookup is right here — this is
  // not the queue, where a hook per row would have been dozens of requests.
  const lotRemarks = useLotRemarks({
    lots: [program.lot],
    lotIds: program.lot_ids?.length ? program.lot_ids : [program.lot_id],
  });
  const lotNotes = (program.lot_ids?.length ? program.lot_ids : [program.lot_id])
    .flatMap((id) => lotRemarks.forLotId(id))
    .concat(lotRemarks.forLot(program.lot))
    .filter((r, i, a) => a.findIndex((x) => x.name === r.name) === i);
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
  // Production auto-raises its challan; fetch it back so it can print straight away
  // instead of the operator hunting for it on another screen.
  const { call: fetchChallan } = useFrappePostCall<{ message: ChallanPrintData | null }>(
    "mahaveermetalic.mahaveer_metallic.api.challan.challan_for_production",
  );
  const { call: partyFlags } = useFrappePostCall<{ message: { party: string | null; is_job_work: number } }>(
    "mahaveermetalic.mahaveer_metallic.api.party.party_flags",
  );

  // Choosing a job-work party ticks "Is Job Work?" for you — it was being missed by hand.
  // Only ever ticks it on: an operator who deliberately unticks it isn't overridden until
  // they pick a different party.
  const [jobWorkTouched, setJobWorkTouched] = useState(false);
  const [operator, setOperator] = useState("");
  const [shift, setShift] = useState<string>(program.shift || "Day");
  const [jobWork, setJobWork] = useState<boolean>(!!program.job_work_flag);
  const [batchNo, setBatchNo] = useState("");
  const [vdate, setVdate] = useState<string>(today());
  const [boxReturn, setBoxReturn] = useState(false);
  const [bobbinReturn, setBobbinReturn] = useState(false);
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  // Which box the calculator is editing (null = adding a new one). A mistyped box used to
  // mean deleting it and keying everything again.
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // Bumped each time a box is added, so the dialog remounts blank-but-seeded for the next.
  const [boxSeq, setBoxSeq] = useState(0);
  const [pin, setPin] = useState("");
  // Set on Submit. Half way through a six-box voucher the total is legitimately miles
  // short of the input, and demanding an override PIN then is noise: nothing is wrong
  // yet, the packer simply has boxes left to weigh.
  const [attempted, setAttempted] = useState(false);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [party, setParty] = useState<string>(program.party || "");
  const [company, setCompany] = useState<string>("");

  // Auto-tick "Is Job Work?" when the selected party is flagged as a job-work party.
  // Runs on party/company change, and never fights an operator who unticked it by hand.
  useEffect(() => {
    if (!party && !company) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await partyFlags({ party: party || undefined, company: company || undefined });
        if (cancelled) return;
        if (r?.message?.is_job_work && !jobWorkTouched) setJobWork(true);
      } catch { /* the checkbox stays manual if this fails */ }
    })();
    return () => { cancelled = true; };
    // jobWorkTouched is deliberately out of the deps: re-running on it would re-tick the
    // box the moment the operator unticks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party, company, partyFlags]);
  const [order, setOrder] = useState<string>(program.customer_order || "");
  const [size, setSize] = useState<string>(program.cut || "");
  const [showAll, setShowAll] = useState(false);
  const [allPin, setAllPin] = useState("");
  const [allPinOpen, setAllPinOpen] = useState(false);

  // Party/company list: by default only parties who ORDERED this colour. "See all"
  // (Admin PIN) opens every party for a direct voucher with no order behind it.
  const partiesCall = useFrappeGetCall<{ message: { party: string; party_name: string; company: string }[] }>(
    `${API}.companies_for_item`,
    showAll ? { show_all: 1, pin: allPin } : { color: program.shade || undefined },
    showAll ? `prod-parties-all-${allPin ? "y" : "n"}` : `prod-parties-${program.shade || ""}`,
  );
  const partyRows = partiesCall.data?.message ?? [];

  // Orders for the chosen party: approved, this colour, still with something remaining.
  const openOrdersCall = useFrappeGetCall<{
    message: {
      name: string; colours?: string; ordered_weight?: number; inwarded_weight?: number;
      produced_weight?: number; dispatched_weight?: number; remaining_weight?: number;
      /** The order is job work — the voucher ticks itself from this. */
      job_work?: boolean;
    }[];
  }>(
    `${API}.orders_for_production`,
    party ? { party, color: program.shade || undefined } : undefined,
    party ? `prod-orders-${program.shade || ""}-${party}` : null,
  );
  const openOrders = openOrdersCall.data?.message ?? [];

  // Picking a JOB WORK order ticks the box by itself. Job work is a property of the order
  // the material came in against — it is not something to remember on the voucher, and a
  // production against a job-work order that was not ticked reads as selling the customer
  // their own material back. The server derives it too, so an untouched tick cannot be
  // wrong; this is so the operator SEES it before pressing Submit.
  useEffect(() => {
    if (!order) return;
    const picked = openOrders.find((o) => o.name === order);
    if (picked?.job_work && !jobWork) setJobWork(true);
    // jobWorkTouched is not consulted: the order saying "job work" outranks a stale tick,
    // and the server would override it regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, openOrders]);

  const totalNet = useMemo(() => r3(boxes.reduce((s, b) => s + b.net, 0)), [boxes]);
  // A refused submit ("still 210 kg short…") used to stay on screen while the boxes that
  // answered it were added, contradicting a footer that had already gone neutral. The
  // message belongs to the state that produced it, so changing that state clears it.
  useEffect(() => { setErr(null); }, [boxes.length]);
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
  // Two different things: producing MORE than went in is a wrong voucher (that weight
  // came from somewhere else), while being short of it is a voucher not yet finished.
  const overProduced = inputWeight > 0 && totalNet > inputWeight;
  const shortBy = calc ? calc.short_by : r3(inputWeight - totalNet);

  /** One box as a sticker. Barcodes only exist once the voucher is submitted, so before
   *  that a PREVIEW code stands in — the label is otherwise the one that gets stuck on. */
  const stickerFor = (b: BoxRow, i: number) => ({
    barcode: `PREVIEW-${i + 1}`,
    item: b.item || program.shade,
    size: size || program.cut,
    gross: b.gross,
    boxWeight: b.boxWeight,
    bobbinWeight: b.totalBobbin,
    net: b.net,
    no: b.bobbinPcs,
    batch: batchNo,
    operator,
    date: vdate,
  });

  async function submit() {
    setErr(null);
    setAttempted(true);
    if (boxes.length === 0) return setErr("Add at least one box.");
    // Producing MORE than went in is not a variance to be overridden — the weight came
    // from somewhere else. Refused here and again server-side.
    if (overProduced) {
      return setErr(
        `Total net ${totalNet.toLocaleString()} kg is more than the ${inputWeight.toLocaleString()} kg ` +
        "that went into this program. Correct the box weights.",
      );
    }
    // Spelled out in kilograms as well as percent: "over tolerance" alone left the
    // operator guessing how much was missing and against what.
    if (overTol && !pin.trim()) {
      return setErr(
        `Still ${shortBy.toLocaleString()} kg short of the ${inputWeight.toLocaleString()} kg that went in — ` +
        `more than the ${calc?.tolerance ?? 0}% / ${calc?.tolerance_kg ?? 0} kg allowed. ` +
        "Add the remaining boxes, or enter an Admin Override PIN to accept the shortfall.",
      );
    }
    try {
      const res = await create({
        source_program: program.name,
        boxes: JSON.stringify(
          boxes.map((b) => ({
            item: b.item, gross_weight: b.gross, qty: b.qty, bobbin: b.bobbin || undefined,
            bobbin_pcs: b.bobbinPcs, bobbin_pcs_weight: b.perPcsWeight,
            total_bobbin_weight: b.totalBobbin, box_weight: b.boxWeight,
            box_return: b.boxReturn ? 1 : 0, bobbin_return: b.bobbinReturn ? 1 : 0,
          })),
        ),
        operator: operator || undefined,
        shift,
        customer_order: order || undefined,
        party: party || undefined,
        company_name: company || undefined,
        cut: size || undefined,
        posting_date: vdate || today(),
        batch_no: batchNo || undefined,
        box_return: boxReturn ? 1 : 0,
        bobbin_return: bobbinReturn ? 1 : 0,
        job_work: jobWork ? 1 : 0,
        pin: pin || undefined,
      });
      // Auto challan print: only when the production actually raised one (i.e. it carried
      // a sales order). Without an order the goods went to inventory, so there is nothing
      // to print. A print failure must never look like a failed production.
      const prod = (res as { message?: { production?: string } })?.message?.production;
      if (prod) {
        try {
          const c = await fetchChallan({ production: prod });
          if (c?.message) printChallan(c.message);
        } catch { /* challan print is best-effort */ }
      }
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    /* The box form renders INSIDE this scrim, so a click meant to dismiss it used to
       bubble up here and close the whole voucher — losing every box already weighed.
       While a box is open the backdrop is inert; the voucher closes from its own X. */
    <div className="mm-modal-scrim mm-scrim-right" onClick={() => { if (!adding) onClose(); }}>
      <div className="mm-modal mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Production Voucher — {program.roll_no || program.shade || "program"}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {/* Two ROWS, not two columns: the paperwork across the top — voucher details, and
            the box form beside them while a box is being keyed — and the box table
            underneath, spanning the whole sheet. The table is twelve columns wide and was
            being cropped into a scrollbar inside half a sheet; the header fields are read
            once and can share their row. */}
        <div className="mm-modal-body mm-pv-split">
          {/* Full width until the box form opens beside it. An empty right-hand track next
              to half-width fields is exactly the scattered look this replaced. */}
          <div className={`mm-pv-col-details${adding ? "" : " mm-pv-col-details-full"}`}>
          {/* Top: Item + Is Job Work (mirrors the legacy voucher header bar) */}
          <div className="mm-pv-top">
            <label className="mm-field" style={{ flex: 1, maxWidth: 360 }}>
              <span className="mm-field-label">Item</span>
              <input className="mm-input" value={program.shade || program.roll_no || "—"} readOnly />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => { setJobWork(e.target.checked); setJobWorkTouched(true); }} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>

          {/* Voucher header — labelled fields in a grid, like the legacy form */}
          <div className="mm-pv-grid">
            <label className="mm-field">
              <span className="mm-field-label">V.No</span>
              <input className="mm-input" value="Auto (MMPROD)" readOnly />
            </label>
            {/* Company is what gets saved; search by party, select the company. */}
            <label className="mm-field">
              <span className="mm-field-label">
                Party / Company
                <button type="button" className="mm-mini mm-pv-seeall"
                  onClick={() => { if (showAll) { setShowAll(false); setAllPin(""); } else setAllPinOpen(true); }}>
                  {showAll ? "ordered only" : "See all"}
                </button>
              </span>
              {allPinOpen && !showAll && (
                <span style={{ display: "flex", gap: "0.35rem", marginBottom: "0.35rem" }}>
                  <input className="mm-input mm-input-compact" type="password" placeholder="Admin PIN" value={allPin}
                    onChange={(e) => setAllPin(e.target.value)} />
                  <button type="button" className="mm-mini mm-mini-ok" disabled={!allPin.trim()}
                    onClick={() => { setShowAll(true); setAllPinOpen(false); }}>Show</button>
                </span>
              )}
              <SearchSelect
                value={company}
                placeholder={partiesCall.isLoading ? "Loading…" : "— select company —"}
                options={partyRows.map((p) => ({
                  value: p.company,
                  label: p.company,
                  meta: p.party_name && p.party_name !== p.company ? p.party_name : undefined,
                }))}
                onChange={(v) => {
                  const row = partyRows.find((p) => p.company === v);
                  setCompany(v);
                  setParty(row?.party || "");
                  setOrder("");
                }} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Select Order</span>
              <SearchSelect
                value={order}
                disabled={!party}
                placeholder={!party ? "Pick a company first" : openOrdersCall.isLoading ? "Loading…" : "— no order (direct voucher) —"}
                options={openOrders.map((o) => ({
                  value: o.name,
                  label: `${o.name}${o.colours ? ` · ${o.colours}` : ""}`,
                  meta: `in ${(o.inwarded_weight ?? 0).toLocaleString()} · out ${(o.dispatched_weight ?? 0).toLocaleString()} · rem ${(o.remaining_weight ?? 0).toLocaleString()}`,
                }))}
                onChange={setOrder} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">V.Date</span>
              <input className="mm-input" type="date" value={vdate} onChange={(e) => setVdate(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Batch No</span>
              <input className="mm-input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Optional" />
            </label>
            {/* Fetched, not typed: the lot comes off the patty this program took, and the
                production is stamped with the same one — so it is shown rather than asked
                for, and cannot drift from what is actually being wound. */}
            <label className="mm-field">
              <span className="mm-field-label">
                Lot No
                <LotRemarkBadge remarks={lotNotes} label={`Lot ${program.lot_id || ""}`} />
              </span>
              <input className="mm-input" value={program.lot_id || "—"} readOnly
                title={program.lot_ids && program.lot_ids.length > 1
                  ? `This program's patty came off ${program.lot_ids.length} lots: ${program.lot_ids.join(", ")}`
                  : "Fetched from the patty this program took"} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Size</span>
              <input className="mm-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 50/85" />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Operator</span>
              <SearchSelect
                value={operator}
                placeholder="— none —"
                options={(employees.data ?? []).map((e) => ({ value: e.name, label: e.employee_name || e.name }))}
                onChange={setOperator} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Shift</span>
              <SearchSelect noClear value={shift} options={SHIFTS.map((s) => ({ value: s, label: s }))} onChange={setShift} />
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

          {/* The header pair is now a DEFAULT and a toggle-all — the flags that count are
              the per-row ones, because one voucher can mix boxes whose packaging comes
              back with ones whose doesn't. */}
          <div className="mm-pv-checks">
            <label className="mm-field mm-field-inline" title="Default for new boxes — and ticks/unticks every row">
              <input type="checkbox" checked={boxReturn}
                onChange={(e) => { setBoxReturn(e.target.checked); setBoxes((p) => p.map((b) => ({ ...b, boxReturn: e.target.checked }))); }} />
              <span className="mm-field-label">Box Return (all)</span>
            </label>
            <label className="mm-field mm-field-inline" title="Default for new boxes — and ticks/unticks every row">
              <input type="checkbox" checked={bobbinReturn}
                onChange={(e) => { setBobbinReturn(e.target.checked); setBoxes((p) => p.map((b) => ({ ...b, bobbinReturn: e.target.checked }))); }} />
              <span className="mm-field-label">Bobbin Return (all)</span>
            </label>
          </div>
          </div>

          {/* The box form is a panel BESIDE the voucher details, not a strip above the
              table: keying a box leaves the details it is checked against in view, and
              costs the table below none of its height — which is what crushed it. */}
          {adding && (
            <div className="mm-pv-col-form">
              <BoxDialog
                bobbinMasters={bobbinMasters.data ?? []}
                availableNet={availableNet}
                defaultItem={program.shade || program.roll_no || ""}
                edit={editing != null ? boxes[editing] : undefined}
                // Boxes on one voucher are packed the same way, so the bobbin, its per-piece
                // weight and the box tare carry over from the last one keyed. Only the gross
                // weight is asked for again — it is the only thing that really changes.
                prev={editing == null ? boxes[boxes.length - 1] : undefined}
                defaultReturns={{ box: boxReturn, bobbin: bobbinReturn }}
                onClose={() => { setAdding(false); setEditing(null); }}
                onAdd={(bx) => {
                  const wasEdit = editing != null;
                  setBoxes((p) => (wasEdit ? p.map((x, j) => (j === editing ? bx : x)) : [...p, bx]));
                  setEditing(null);
                  // Packing runs box after box, so adding one opens the next straight away.
                  // Editing does not — that was a correction, not a new box.
                  if (wasEdit) setAdding(false);
                  else setBoxSeq((n) => n + 1);
                }}
                key={editing != null ? `edit-${editing}` : `add-${boxSeq}`}
              />
            </div>
          )}

          {/* Boxes — the main work area, its own full-width row */}
          <div className="mm-pv-boxwrap">
            <div className="mm-pv-boxhead">
              {/* Colour above the table: every row is the same colour, so printing it in
                  each row spent the width the weights need. */}
              <span className="mm-pv-boxcolour">
                <span className="mm-colour-name">{program.shade || program.roll_no || "—"}</span>
                {size ? <span className="mm-suggest-meta">{size}</span> : null}
              </span>
              <span className="mm-field-label" style={{ margin: 0 }}>Boxes ({boxes.length})</span>
              {/* Hidden while the form is open — it would re-key the form and throw away
                  whatever has already been weighed into it. */}
              {!adding && (
                <button className="mm-mini mm-mini-ok" onClick={() => setAdding(true)}><Plus size={13} /> Add box</button>
              )}
            </div>

            {boxes.length === 0 ? (
              adding ? (
                <p className="mm-empty mm-pv-boxempty">Boxes list here as you add them.</p>
              ) : (
                <button type="button" className="mm-box-zone" onClick={() => setAdding(true)}>
                  <span><Package size={22} /></span>
                  <span>No boxes yet — weigh each box as you pack it.</span>
                  <span className="mm-box-zone-cta"><Plus size={14} /> Add box</span>
                </button>
              )
            ) : (
              <div className="mm-table-scroll mm-pv-boxtable">
                <table className="mm-table mm-table-dense">
                  <thead>
                    <tr>
                      <th>#</th><th className="mm-num">Gr.Wt</th><th className="mm-num">Qty</th>
                      <th>Bobbin</th><th className="mm-num">Pcs</th><th className="mm-num">B/Pcs</th>
                      <th className="mm-num">Bobbin Wt</th><th className="mm-num">Box Wt</th><th className="mm-num">Net Wt</th>
                      <th className="mm-pv-check" title="This box's packaging comes back">R.Box</th>
                      <th className="mm-pv-check" title="This box's bobbins come back">R.Bob</th>
                      <th className="mm-pv-actcell" />
                    </tr>
                  </thead>
                  <tbody>
                    {boxes.map((b, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="mm-num">{b.gross.toLocaleString()}</td>
                        <td className="mm-num">{b.qty || "—"}</td>
                        <td>{b.bobbin || "—"}</td>
                        <td className="mm-num">{b.bobbinPcs || "—"}</td>
                        <td className="mm-num">{b.perPcsWeight || "—"}</td>
                        <td className="mm-num">{b.totalBobbin.toLocaleString()}</td>
                        <td className="mm-num">{b.boxWeight.toLocaleString()}</td>
                        <td className="mm-num"><strong>{b.net.toLocaleString()}</strong></td>
                        <td className="mm-pv-check">
                          <input type="checkbox" checked={b.boxReturn} aria-label={`Box ${i + 1} packaging returns`}
                            onChange={(e) => setBoxes((p) => p.map((x, j) => (j === i ? { ...x, boxReturn: e.target.checked } : x)))} />
                        </td>
                        <td className="mm-pv-check">
                          <input type="checkbox" checked={b.bobbinReturn} aria-label={`Box ${i + 1} bobbins return`}
                            onChange={(e) => setBoxes((p) => p.map((x, j) => (j === i ? { ...x, bobbinReturn: e.target.checked } : x)))} />
                        </td>
                        {/* The buttons live in a DIV inside the cell, never on the cell
                            itself: `display:flex` on a <td> takes it out of the table
                            layout, so it stops sizing as a column and shoves the two
                            checkboxes beside it out of their own. */}
                        <td className="mm-pv-actcell">
                          <div className="mm-pv-rowacts">
                            <button className="mm-icon-btn" title="Print this box's sticker"
                              aria-label={`Print sticker for box ${i + 1}`}
                              onClick={() => printBoxStickers([stickerFor(b, i)])}>
                              <Printer size={14} />
                            </button>
                            <button className="mm-icon-btn" title="Save this box's sticker as a file"
                              aria-label={`Download sticker for box ${i + 1}`}
                              onClick={() => downloadBoxStickers([stickerFor(b, i)], `sticker-box-${i + 1}`)}>
                              <Download size={14} />
                            </button>
                            <button className="mm-icon-btn" title="Edit this box"
                              aria-label={`Edit box ${i + 1}`}
                              onClick={() => { setEditing(i); setAdding(true); }}>
                              <Pencil size={14} />
                            </button>
                            <button className="mm-icon-btn mm-icon-btn-danger" title="Remove this box"
                              aria-label={`Remove box ${i + 1}`}
                              onClick={() => setBoxes((p) => p.filter((_, j) => j !== i))}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Gated on `attempted`: mid-entry a short voucher is work in progress, not a
              variance anyone needs to override. */}
          {overTol && attempted && (
            <label className="mm-field mm-pv-span">
              <span className="mm-field-label"><ShieldAlert size={13} style={{ verticalAlign: "middle" }} /> Admin Override PIN (variance over tolerance)</span>
              <input className="mm-input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Required to accept this variance" />
            </label>
          )}

          {err && <p className="mm-error mm-pv-span">{err}</p>}
        </div>
        <div className="mm-modal-foot mm-foot-split">
          {boxes.length > 0 && (
            <button className="mm-btn-secondary mm-btn-compact" title="Print a sticker for each box"
              onClick={() => printBoxStickers(boxes.map(stickerFor))}>
              Print all stickers
            </button>
          )}
          {boxes.length > 0 && (
            <button className="mm-btn-secondary mm-btn-compact"
              title="Save every sticker as one file — for a machine without the label printer attached"
              onClick={() => downloadBoxStickers(boxes.map(stickerFor), `stickers-${batchNo || program.name}`)}>
              <Download size={13} /> Download stickers
            </button>
          )}
          <div className="mm-pv-totals">
            <span>Boxes <strong>{boxes.length}</strong></span>
            <span>Gross <strong>{totalGross.toLocaleString()}</strong></span>
            <span>Net <strong>{totalNet.toLocaleString()} kg</strong></span>
            {/* "-83%" says nothing to a packer with one box of six on the scale; "still
                210 kg to box" is the same fact in the units on the floor. It stays a
                neutral progress figure until Submit turns it into a refusal. */}
            <span className={overProduced || (attempted && overTol) ? "mm-var-over" : "mm-pv-remain"}>
              {overProduced ? (
                <>Over input by <strong>{r3(totalNet - inputWeight).toLocaleString()} kg</strong></>
              ) : shortBy > 0 ? (
                <>Still to box <strong>{shortBy.toLocaleString()} kg</strong>
                  {calc ? <em> {calc.variance_percent.toFixed(2)}% · allowed ±{calc.tolerance}% or {calc.tolerance_kg} kg</em> : null}</>
              ) : (
                <>Var <strong>{(calc?.variance_percent ?? 0).toFixed(2)}%</strong>{calc ? <em> allowed ±{calc.tolerance}%</em> : null}</>
              )}
            </span>
          </div>
          <div className="mm-foot-actions">
            <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
            <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Submit voucher"}</button>
          </div>
        </div>
      </div>

    </div>
  );
}

/* ── Box Details popup: the per-box calculator (Net = Gross − Bobbin − Box) ── */
function BoxDialog({
  bobbinMasters, availableNet, defaultItem, edit, prev, defaultReturns, onClose, onAdd,
}: {
  bobbinMasters: BobbinMaster[]; availableNet: number; defaultItem: string;
  edit?: BoxRow;
  /** The last box keyed, when adding a new one — its packing carries over. */
  prev?: BoxRow;
  defaultReturns: { box: boolean; bobbin: boolean };
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
  // Seeded from the box being edited, so Edit reopens exactly what was entered — and
  // otherwise from the LAST box added, because the next box is packed the same way. The
  // gross weight is never carried: that is the one figure that must be weighed afresh.
  const [gross, setGross] = useState<number | "">(edit?.gross ?? "");
  const [bobbin, setBobbin] = useState(edit?.bobbin ?? prev?.bobbin ?? "");
  const [pcs, setPcs] = useState<number | "">(edit?.bobbinPcs ?? prev?.bobbinPcs ?? "");
  const [perPcs, setPerPcs] = useState<number | "">(edit?.perPcsWeight ?? prev?.perPcsWeight ?? "");
  const [boxWeight, setBoxWeight] = useState<number | "">(edit?.boxWeight ?? prev?.boxWeight ?? "");
  const [boxReturn, setBoxReturn] = useState<boolean>(edit?.boxReturn ?? prev?.boxReturn ?? defaultReturns.box);
  const [bobbinReturn, setBobbinReturn] = useState<boolean>(edit?.bobbinReturn ?? prev?.bobbinReturn ?? defaultReturns.bobbin);
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
      boxReturn,
      bobbinReturn,
    });
  }

  return (
    /* An inline panel, not a popup: it sits beside the voucher details and above the
       full-width box table, so nothing it needs to be read against — the input weight
       and available net on the left, the boxes already weighed below — is covered by
       it, and opening it takes no width off the table. */
    <section className="mm-bx-panel" aria-label={edit ? "Edit box" : "New box"}>
      <div className="mm-bx-panel-head">
        <span className="mm-bx-panel-title"><Package size={15} /> {edit ? "Edit Box" : "Box Details"}</span>
        <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close box details"><X size={16} /></button>
      </div>
      <div className="mm-bx">
        <div className="mm-bx-row mm-bx-row-wide">
          <span className="mm-bx-label">Box Sticker Printer</span>
          <input className="mm-input mm-bx-hi" value={printer}
            onChange={(e) => { setPrinter(e.target.value); window.localStorage.setItem("mm-box-printer", e.target.value); }} />
        </div>
        <div className="mm-bx-row">
          <span className="mm-bx-label">Available Net Weight</span>
          <input className="mm-input mm-bx-hi" value={availableNet.toLocaleString()} readOnly />
        </div>
        <div className="mm-bx-row mm-bx-row-wide">
          <span className="mm-bx-label">Total Weight</span>
          <div className="mm-bx-gross">
            <input className="mm-input" type="number" value={gross} placeholder="0.000"
              onChange={(e) => setGross(e.target.value === "" ? "" : Number(e.target.value))} />
            <ScaleCapture onCapture={(w) => setGross(Number(w.toFixed(3)))} />
          </div>
        </div>
        <div className="mm-bx-row">
          <span className="mm-bx-label">Box Weight</span>
          <input className="mm-input" type="number" value={boxWeight}
            onChange={(e) => setBoxWeight(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div className="mm-bx-row">
          <span className="mm-bx-label">Bobbin</span>
          <div className="mm-bx-bobbin">
            <SearchSelect value={bobbin} placeholder="— none —"
              options={allBobbins.map((b) => ({ value: b.name, label: b.name }))} onChange={setBobbin} />
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
        <div className="mm-bx-row mm-bx-row-net">
          <span className="mm-bx-label">Net Weight</span>
          <input className={`mm-input mm-bx-ro ${net < 0 ? "mm-input-warn" : ""}`} value={net.toLocaleString()} readOnly />
        </div>
        <div className="mm-bx-row mm-bx-row-wide">
          <span className="mm-bx-label">Returns</span>
          <div className="mm-bx-returns">
            <label className="mm-field-inline">
              <input type="checkbox" checked={boxReturn} onChange={(e) => setBoxReturn(e.target.checked)} />
              <span className="mm-field-label">R.Box</span>
            </label>
            <label className="mm-field-inline">
              <input type="checkbox" checked={bobbinReturn} onChange={(e) => setBobbinReturn(e.target.checked)} />
              <span className="mm-field-label">R.Bobbin</span>
            </label>
          </div>
        </div>
      </div>

      {err && <p className="mm-error mm-bx-panel-err">{err}</p>}
      <div className="mm-bx-panel-foot">
        <button className="mm-btn-ghost mm-btn-compact" onClick={onClose}>Cancel</button>
        <button className="mm-btn-primary mm-btn-compact" onClick={add}>{edit ? "Save box" : "Add box"}</button>
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
    </section>
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
