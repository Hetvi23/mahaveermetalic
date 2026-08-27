import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { X, Search, PackageSearch, Boxes, Printer } from "lucide-react";
import PartyPicker from "@/components/PartyPicker";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

/** Rupees, two places — the rate is a price, not a weight. */
const money = (v: number) =>
  `\u20B9${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
import { printChallan, type ChallanPrintData } from "@/utils/challanPrint";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.challan";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The papers this screen can issue. The type picked here decides the numbering series —
 * the prefixes are shown so the operator can see which book the number will come from.
 * The server holds the authoritative map (api/challan.py SERIES) and re-derives it from
 * the type, so a stale prefix here can only ever mislabel the hint, never misnumber.
 *
 * Job Challan sends material to a worker, so it does not close the customer's order;
 * the other three do.
 */
const CHALLAN_TYPES = [
  { value: "Sales", label: "Sales Chalan", series: "MM-SC-" },
  { value: "Job Challan", label: "Job Challan", series: "MM-JC-" },
  { value: "Challan", label: "Challan", series: "MM-CH-" },
  { value: "Delivery Challan", label: "Delivery Challan", series: "MM-DC-" },
];

type BoxRow = {
  box: string; production: string; posting_date?: string; item?: string; cut?: string;
  customer_order?: string; barcode?: string; gross_weight?: number; bobbin?: string; bobbin_pcs?: number;
  bobbin_pcs_weight?: number; total_bobbin_weight?: number; box_weight?: number; net_weight?: number;
};
type RollRow = {
  name: string; roll_no?: string; lot_number?: string; location?: string;
  color_name?: string; stock_weight?: number; stock_box?: number;
};
type Line = {
  key: string; kind: "box" | "roll"; ref: string; barcode?: string; item?: string; size?: string;
  gross: number; qty: number; bobbin?: string; bobbinPcs: number; perPcs: number;
  totalBobbin: number; boxWeight: number; net: number; rBox: boolean; rBobbin: boolean;
};

/**
 * Sales Challan voucher: dispatch document built from produced boxes (SELECT BOX) or
 * straight from inventory rolls (SELECT ROLL). Production raises its own challan on
 * submit when it carries an order; this screen covers everything else.
 */
export default function SalesChallanVoucher() {
  const [party, setParty] = useState("");
  const [order, setOrder] = useState("");
  const [challanType, setChallanType] = useState("Sales");
  const [challanNo, setChallanNo] = useState("");
  const [date, setDate] = useState(today());
  const [remark, setRemark] = useState("");
  const [jobWork, setJobWork] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState<"box" | "roll" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { call: createChallan, loading } = useFrappePostCall(`${API}.create_challan`);
  const { call: scanBox } = useFrappePostCall<{ message: BoxRow & { barcode?: string } }>(`${API}.scan_box`);
  const { call: fetchPrint } = useFrappePostCall<{ message: ChallanPrintData }>(`${API}.challan_for_print`);
  // An order fixes which colours may be dispatched against it — the pickers filter to
  // these so the wrong colour can't be picked, and the server rejects it either way.
  const orderColoursCall = useFrappeGetCall<{ message: string[] }>(
    `${API}.order_colour_names`, { sales_order: order || undefined }, order ? `chal-oc-${order}` : null,
  );
  const orderColours = orderColoursCall.data?.message ?? [];
  // What the order prices each colour at. The challan takes its rate from the same place
  // on save; this is read ahead so the screen can foot the dispatch before it is
  // submitted, instead of the value only appearing on the printed paper afterwards.
  const orderRatesCall = useFrappeGetCall<{ message: { color_name?: string; cut?: string; rate?: number }[] }>(
    `${API}.order_rates`, { sales_order: order || undefined }, order ? `chal-rate-${order}` : null,
  );
  const orderRates = useMemo(() => orderRatesCall.data?.message ?? [], [orderRatesCall.data]);
  /** The rate for a line: its colour AND cut when the order prices that pair, else the
   *  colour on its own — the challan does not always record a cut. Mirrors the server. */
  const rateFor = useMemo(() => {
    const key = (c?: string) => (c || "").toLowerCase().split(/\s+/).join("");
    const exact = new Map<string, number>();
    const byColour = new Map<string, number>();
    for (const r of orderRates) {
      const k = key(r.color_name);
      exact.set(`${k}|${(r.cut || "").trim()}`, Number(r.rate || 0));
      if (!byColour.has(k)) byColour.set(k, Number(r.rate || 0));
    }
    return (colour?: string, cut?: string) =>
      exact.get(`${key(colour)}|${(cut || "").trim()}`) ?? byColour.get(key(colour)) ?? 0;
  }, [orderRates]);
  // Last challan made here, so it can be reprinted without leaving the screen.
  const [lastChallan, setLastChallan] = useState<string>("");
  const [scan, setScan] = useState("");

  // Scan gun types the barcode then hits Enter — resolve it and drop the box in.
  async function onScan() {
    const code = scan.trim();
    if (!code) return;
    setErr(null);
    try {
      const r = await scanBox({ barcode: code });
      const b = r?.message;
      if (b) addBoxes([b as BoxRow]);
      setScan("");
    } catch (e) {
      setErr(extractErrorMessage(e));
      setScan("");
    }
  }
  // Orders not yet dispatched. An order that already has a submitted challan is gone from
  // this list — offering it again invites a second challan for the same goods.
  const ordersCall = useFrappeGetCall<{ message: { name: string; colours?: string }[] }>(
    `${API}.orders_for_challan`,
    party ? { party } : undefined,
    party ? `chal-orders-${party}` : null,
  );

  const totals = useMemo(() => {
    const boxes = lines.filter((l) => l.kind === "box").length;
    const rolls = lines.filter((l) => l.kind === "roll").length;
    const net = lines.reduce((s, l) => s + l.net, 0);
    const gross = lines.reduce((s, l) => s + l.gross, 0);
    // Rate is per KG and the line's own weight is its net, so that is what it multiplies.
    const amount = lines.reduce((s, l) => s + rateFor(l.item, l.size) * l.net, 0);
    return {
      boxes, rolls,
      net: Math.round(net * 1000) / 1000,
      gross: Math.round(gross * 1000) / 1000,
      amount: Math.round(amount * 100) / 100,
    };
  }, [lines, rateFor]);

  function addBoxes(rows: BoxRow[]) {
    setLines((p) => [
      ...p,
      ...rows
        .filter((r) => !p.some((l) => l.kind === "box" && l.ref === r.box))
        .map<Line>((r) => ({
          key: `box-${r.box}`, kind: "box", ref: r.box, barcode: r.barcode, item: r.item, size: r.cut,
          gross: Number(r.gross_weight || 0), qty: 1, bobbin: r.bobbin,
          bobbinPcs: Number(r.bobbin_pcs || 0), perPcs: Number(r.bobbin_pcs_weight || 0),
          totalBobbin: Number(r.total_bobbin_weight || 0), boxWeight: Number(r.box_weight || 0),
          net: Number(r.net_weight || 0), rBox: false, rBobbin: false,
        })),
    ]);
    setPicker(null);
  }
  function addRolls(rows: RollRow[]) {
    setLines((p) => [
      ...p,
      ...rows
        .filter((r) => !p.some((l) => l.kind === "roll" && l.ref === r.name))
        .map<Line>((r) => ({
          key: `roll-${r.name}`, kind: "roll", ref: r.name, item: r.color_name,
          size: r.lot_number, gross: Number(r.stock_weight || 0), qty: Number(r.stock_box || 1),
          bobbinPcs: 0, perPcs: 0, totalBobbin: 0, boxWeight: 0,
          net: Number(r.stock_weight || 0), rBox: false, rBobbin: false,
        })),
    ]);
    setPicker(null);
  }

  async function submit() {
    setErr(null);
    if (!party) return setErr("Choose the customer.");
    if (lines.length === 0) return setErr("Add at least one box or roll.");
    try {
      const res = await createChallan({
        party, sales_order: order || undefined, challan_date: date, remark: remark || undefined,
        challan_type: challanType,
        job_work: jobWork ? 1 : 0, challan_no: challanNo || undefined,
        boxes: JSON.stringify(lines.filter((l) => l.kind === "box").map((l) => l.ref)),
        rolls: JSON.stringify(lines.filter((l) => l.kind === "roll").map((l) => l.ref)),
      });
      const name = (res as { message?: { challan?: string } })?.message?.challan;
      const typeLabel = CHALLAN_TYPES.find((t) => t.value === challanType)?.label ?? challanType;
      toast(`${typeLabel} ${name || ""} created`);
      setLines([]); setChallanNo(""); setRemark("");
      if (name) {
        setLastChallan(name);
        await doPrint(name);
      }
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  /** A4, two copies per sheet (Original / Duplicate). */
  async function doPrint(name: string) {
    try {
      const p = await fetchPrint({ challan: name });
      if (p?.message) printChallan(p.message);
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Sales Challan Voucher</h1>
          <p className="mm-page-sub">Dispatch produced boxes or inventory rolls. Production with an order raises its own challan automatically.</p>
        </div>
        {lastChallan && (
          <button type="button" className="mm-btn-secondary" onClick={() => void doPrint(lastChallan)}>
            <Printer size={15} /> Reprint {lastChallan}
          </button>
        )}
      </header>

      <section className="mm-card mm-card-pad">
        <div className="mm-scv-grid">
          <label className="mm-field">
            <span className="mm-field-label">
              Chalan Type *
              <span className="mm-muted"> · series {CHALLAN_TYPES.find((t) => t.value === challanType)?.series}</span>
            </span>
            <SearchSelect
              noClear
              value={challanType}
              onChange={setChallanType}
              options={CHALLAN_TYPES.map((t) => ({ value: t.value, label: t.label, meta: `series ${t.series}` }))}
            />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Manual Chalan No</span>
            <input className="mm-input" value={challanNo} onChange={(e) => setChallanNo(e.target.value)}
              placeholder="Blank — numbered by the series" />
          </label>
          <PartyPicker label="Customer *" value={party} required onChange={(v) => { setParty(v); setOrder(""); }} />
          <label className="mm-field">
            <span className="mm-field-label">Order</span>
            <SearchSelect
              value={order}
              disabled={!party}
              placeholder={!party ? "Pick a customer first" : "— none (from stock) —"}
              options={(ordersCall.data?.message ?? []).map((o) => ({ value: o.name, label: `${o.name}${o.colours ? ` · ${o.colours}` : ""}` }))}
              onChange={setOrder} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Chalan Date *</span>
            <input className="mm-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="mm-field mm-field-inline">
            <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
          </label>
        </div>

        <div className="mm-scv-actions">
          <label className="mm-field" style={{ flex: 1 }}>
            <span className="mm-field-label">Remark</span>
            <input className="mm-input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark" />
          </label>
          <button type="button" className="mm-btn-secondary" onClick={() => setPicker("box")}><Boxes size={15} /> Select box</button>
          <button type="button" className="mm-btn-secondary" onClick={() => setPicker("roll")}><PackageSearch size={15} /> Select roll</button>
          {/* Scan the sticker barcode — the gun types the code then presses Enter. */}
          <label className="mm-field" style={{ maxWidth: 210 }}>
            <span className="mm-field-label">Scan box</span>
            <input className="mm-input" value={scan} placeholder="Scan barcode…"
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onScan(); } }} />
          </label>
        </div>

        <div className="mm-table-scroll" style={{ marginTop: "0.9rem" }}>
          <table className="mm-table mm-table-dense">
            <thead>
              <tr>
                <th>Barcode</th><th>Item</th><th>Size</th><th className="mm-num">Gr.Wt | Qty</th>
                <th className="mm-num">Bobbin | Pcs</th><th className="mm-num">Bobbin/Pcs Wt</th>
                <th className="mm-num">Total Bobbin Wt</th><th className="mm-num">Box Wt</th>
                <th className="mm-num">Net Wt</th><th className="mm-num">Rate</th>
                <th className="mm-num">R.Box</th><th className="mm-num">R.Bobbin</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={13} className="mm-empty">No boxes or rolls added yet.</td></tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>{l.barcode || "—"}</td>
                    <td>{l.item || "—"}</td>
                    <td>{l.size || "—"}</td>
                    <td className="mm-num">{l.gross.toLocaleString()} | {l.qty}</td>
                    <td className="mm-num">{l.bobbin ? `${l.bobbin} | ${l.bobbinPcs}` : "—"}</td>
                    <td className="mm-num">{l.perPcs || "—"}</td>
                    <td className="mm-num">{l.totalBobbin.toLocaleString()}</td>
                    <td className="mm-num">{l.boxWeight.toLocaleString()}</td>
                    <td className="mm-num"><strong>{l.net.toLocaleString()}</strong></td>
                    {/* From the order, read-only: the rate is what was agreed when the
                        order was taken, not something re-decided at the loading bay. */}
                    <td className="mm-num mm-scv-rate" title={order ? "From the sales order" : "Pick an order to price this"}>
                      {rateFor(l.item, l.size) > 0 ? money(rateFor(l.item, l.size)) : "—"}
                    </td>
                    <td className="mm-num"><input type="checkbox" checked={l.rBox} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, rBox: e.target.checked } : x))} /></td>
                    <td className="mm-num"><input type="checkbox" checked={l.rBobbin} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, rBobbin: e.target.checked } : x))} /></td>
                    <td className="mm-num"><button className="mm-icon-btn" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}><X size={14} /></button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}

        <div className="mm-scv-foot">
          <span>Total Box: <strong>{totals.boxes}</strong></span>
          <span>Total Roll: <strong>{totals.rolls}</strong></span>
          <span>Total Net Weight: <strong>{totals.net.toLocaleString()}</strong></span>
          <span>Total Weight: <strong>{totals.gross.toLocaleString()}</strong></span>
          {totals.amount > 0 && (
            <span className="mm-scv-amount">Total Amount: <strong>{money(totals.amount)}</strong></span>
          )}
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>
            {loading ? "Saving…" : "Submit"}
          </button>
        </div>
      </section>

      {picker === "box" && <BoxPicker party={party} order={order} colours={orderColours} onClose={() => setPicker(null)} onAdd={addBoxes} />}
      {picker === "roll" && <RollPicker colours={orderColours} onClose={() => setPicker(null)} onAdd={addRolls} />}
    </div>
  );
}

/* ── SELECT BOX: produced boxes not yet dispatched ── */
function BoxPicker({ party, order, colours, onClose, onAdd }: { party: string; order: string; colours: string[]; onClose: () => void; onAdd: (r: BoxRow[]) => void }) {
  const { data, isLoading } = useFrappeGetCall<{ message: BoxRow[] }>(
    `${API}.available_boxes`,
    { party: party || undefined, sales_order: order || undefined },
    `chal-boxes-${party}-${order}`,
  );
  // Only boxes of a colour this order is for.
  const rows = (data?.message ?? []).filter((r) => colours.length === 0 || !r.item || colours.includes(r.item));
  const [sel, setSel] = useState<Record<string, BoxRow>>({});
  return (
    <PickerSheet title="Select box" isLoading={isLoading} empty={rows.length === 0} emptyText="No produced boxes available."
      onClose={onClose} onAdd={() => onAdd(Object.values(sel))} count={Object.keys(sel).length}>
      <table className="mm-table mm-table-dense">
        <thead><tr><th /><th>Date</th><th>Item</th><th>Cut</th><th>Order</th><th className="mm-num">Net Wt</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.box} className={sel[r.box] ? "mm-ws-row-active" : undefined}
              onClick={() => setSel((p) => { const n = { ...p }; if (n[r.box]) delete n[r.box]; else n[r.box] = r; return n; })}
              style={{ cursor: "pointer" }}>
              <td><input type="checkbox" checked={!!sel[r.box]} readOnly /></td>
              <td>{r.posting_date || "—"}</td>
              <td>{r.item || "—"}</td>
              <td>{r.cut || "—"}</td>
              <td>{r.customer_order || "—"}</td>
              <td className="mm-num">{(r.net_weight ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PickerSheet>
  );
}

/* ── SELECT ROLL: straight from inventory ── */
function RollPicker({ colours, onClose, onAdd }: { colours: string[]; onClose: () => void; onAdd: (r: RollRow[]) => void }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useFrappeGetCall<{ message: RollRow[] }>(
    "mahaveermetalic.mahaveer_metallic.api.program.program_inventory_search", {}, "chal-rolls",
  );
  const rows = (data?.message ?? [])
    // Only rolls of a colour this order is for — dispatching another colour against it
    // is a picking mistake that mis-bills the customer.
    .filter((r) => colours.length === 0 || !r.color_name || colours.includes(r.color_name))
    .filter((r) =>
      !q.trim() || `${r.roll_no || ""} ${r.color_name || ""} ${r.lot_number || ""} ${r.location || ""}`.toLowerCase().includes(q.toLowerCase()),
    );
  const [sel, setSel] = useState<Record<string, RollRow>>({});
  return (
    <PickerSheet title="Select roll" isLoading={isLoading} empty={rows.length === 0} emptyText="No rolls in stock."
      onClose={onClose} onAdd={() => onAdd(Object.values(sel))} count={Object.keys(sel).length}
      search={<div className="mm-search-box"><Search size={15} />
        <input className="mm-input mm-input-compact" placeholder="Search roll / colour / lot…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
      <table className="mm-table mm-table-dense">
        <thead><tr><th /><th>Roll</th><th>Colour</th><th>Lot</th><th>Location</th><th className="mm-num">Weight</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={sel[r.name] ? "mm-ws-row-active" : undefined}
              onClick={() => setSel((p) => { const n = { ...p }; if (n[r.name]) delete n[r.name]; else n[r.name] = r; return n; })}
              style={{ cursor: "pointer" }}>
              <td><input type="checkbox" checked={!!sel[r.name]} readOnly /></td>
              <td>{r.roll_no || r.name}</td>
              <td>{r.color_name || "—"}</td>
              <td>{r.lot_number || "—"}</td>
              <td>{r.location || "—"}</td>
              <td className="mm-num">{(r.stock_weight ?? 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PickerSheet>
  );
}

function PickerSheet({ title, isLoading, empty, emptyText, onClose, onAdd, count, search, children }: {
  title: string; isLoading: boolean; empty: boolean; emptyText: string;
  onClose: () => void; onAdd: () => void; count: number; search?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="mm-modal-scrim mm-scrim-right" onClick={onClose}>
      <div className="mm-modal mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">{title}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {search}
          {isLoading ? <p className="mm-muted">Loading…</p> : empty ? <p className="mm-empty">{emptyText}</p> : (
            <div className="mm-table-scroll" style={{ marginTop: search ? "0.6rem" : 0 }}>{children}</div>
          )}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={count === 0} onClick={onAdd}>Add {count || ""}</button>
        </div>
      </div>
    </div>
  );
}
