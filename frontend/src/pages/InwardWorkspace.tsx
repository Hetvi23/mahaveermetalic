import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, Download, PackageCheck, Pencil, Plus, SkipForward, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import LinkField from "@/components/LinkField";
import { extractErrorMessage } from "@/utils/frappeError";

const today = () => new Date().toISOString().slice(0, 10);

const F_LOCATION: FieldSchema = { fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true };
const F_BRANCH: FieldSchema = { fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" };
const F_SALES_ORDER: FieldSchema = { fieldname: "sales_order", label: "Sales order (optional)", fieldtype: "Link", options: "MM Sales Order" };

type ChallanItem = { roll?: string; color?: string; cut?: string; qty?: number; weight?: number };
type MatchOrder = {
  sales_order: string;
  party?: string;
  color_name?: string;
  cut?: string;
  qty_weight?: number;
  required_weight?: number;
};
type FetchResult = {
  challan_no: string;
  coating?: string;
  sales_order?: string;
  so_colours?: string[];
  party_name?: string;
  dated?: string;
  items: ChallanItem[];
  matching_orders: MatchOrder[];
};

type Row = {
  roll: string;
  color: string;
  cut: string;
  qty: number | "";
  weight: number | "";
  customer_order: string;
};

const blankRow = (): Row => ({ roll: "", color: "", cut: "", qty: "", weight: "", customer_order: "" });

/**
 * Inward driven by Veermetlon challans. Queue one or more challan numbers (one per
 * line), then step through them: fetch rolls/colour/qty from VM, allocate to open
 * SOs, post, and move to the next challan — each becomes its own MM Inward. A manual
 * path (no challan) is also available. Branch/location come from the logged-in user.
 */
export default function InwardWorkspace() {
  const [postingDate, setPostingDate] = useState(today());
  const [branch, setBranch] = useState("");
  const [location, setLocation] = useState("");
  const [salesOrder, setSalesOrder] = useState(""); // optional order to allocate this inward to
  const [queue, setQueue] = useState<string[]>([""]); // challan numbers to process, one per line
  const [qIndex, setQIndex] = useState(-1); // -1 = still composing the queue / manual; >=0 = processing queue[qIndex]
  const [challanNo, setChallanNo] = useState(""); // the challan currently loaded
  const [lot, setLot] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<MatchOrder[]>([]);
  const [fetched, setFetched] = useState(false);
  const [manual, setManual] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false); // current challan posted; waiting for "Next"
  const [postedCount, setPostedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { call: fetchCall, loading: fetching } = useFrappePostCall<{ message: FetchResult }>(
    "mahaveermetalic.mahaveer_metallic.api.veermetlon.fetch_challan",
  );
  const { call: postInward, loading: posting } = useFrappePostCall<{ message: { name: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.post_inward",
  );

  // Branch/Location default from the logged-in user's employee profile; editable here
  // so users without a profile (e.g. Administrator) can still pick a location.
  const { data: defaults } = useFrappeGetCall<{ message: { branch: string | null; location: string | null } }>(
    "mahaveermetalic.api.session.get_branch_location",
    undefined,
    "mm-session-branch-location",
  );
  useEffect(() => {
    const d = defaults?.message;
    if (!d) return;
    setBranch((b) => b || d.branch || "");
    setLocation((l) => l || d.location || "");
  }, [defaults]);

  const processing = qIndex >= 0; // stepping through the challan queue
  const isLast = qIndex >= queue.length - 1;

  // --- challan queue composition ---
  function setChallanLine(i: number, val: string) {
    setQueue((prev) => prev.map((c, j) => (j === i ? val : c)));
  }
  function addChallanLine() {
    setQueue((prev) => [...prev, ""]);
  }
  function removeChallanLine(i: number) {
    setQueue((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  }

  async function loadChallan(no: string) {
    setError(null);
    setFlash(null);
    setAwaitingNext(false);
    try {
      const r = await fetchCall({ challan_no: no.trim() });
      const m = r.message;
      setRows(
        (m.items || []).map((it) => ({
          roll: it.roll || "",
          color: it.color || "",
          cut: it.cut || "",
          qty: it.qty ?? "",
          weight: it.weight ?? "",
          customer_order: "",
        })),
      );
      setOrders(m.matching_orders || []);
      // Lot id = the coating selected on the VM challan; fall back to the challan no.
      setLot(m.coating || m.challan_no || no.trim());
      setChallanNo(no.trim());
      setManual(false);
      setFetched(true);
      if ((m.items || []).length === 0) setError("Challan found but it has no rolls.");
    } catch (e) {
      setRows([]);
      setOrders([]);
      setFetched(false);
      setChallanNo(no.trim());
      setError(extractErrorMessage(e));
    }
  }

  // Begin processing the queued challan numbers, starting at the first.
  async function startQueue() {
    setError(null);
    setFlash(null);
    const cleaned = queue.map((s) => s.trim()).filter(Boolean);
    if (!cleaned.length) return setError("Enter at least one Veermetlon challan number.");
    setQueue(cleaned);
    setPostedCount(0);
    setQIndex(0);
    await loadChallan(cleaned[0]);
  }

  // Advance to the next queued challan (or finish the batch).
  async function gotoNext() {
    const ni = qIndex + 1;
    if (ni >= queue.length) return finishBatch();
    setQIndex(ni);
    await loadChallan(queue[ni]);
  }

  function finishBatch() {
    const done = postedCount;
    setFetched(false);
    setRows([]);
    setOrders([]);
    setChallanNo("");
    setLot("");
    setQIndex(-1);
    setQueue([""]);
    setAwaitingNext(false);
    setManual(false);
    setError(null);
    setFlash(done ? `Batch done — ${done} inward(s) posted.` : "Batch closed.");
  }

  // Manual path: skip the Veermetlon fetch and enter received material by hand.
  function startManual() {
    setError(null);
    setFlash(null);
    setOrders([]);
    setRows([blankRow()]);
    setChallanNo("");
    setLot("");
    setQIndex(-1);
    setAwaitingNext(false);
    setManual(true);
    setFetched(true);
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow()]);
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  // Allocating a roll to an order also seeds its colour, but never overwrites a colour
  // already fetched from the Veermetlon Sales Order (that one is authoritative).
  function allocate(i: number, sales_order: string) {
    const ord = orders.find((o) => o.sales_order === sales_order);
    setRows((prev) =>
      prev.map((r, j) => (j === i ? { ...r, customer_order: sales_order, color: r.color || ord?.color_name || "" } : r)),
    );
  }

  const totals = useMemo(
    () => ({
      qty: rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
      weight: rows.reduce((s, r) => s + (Number(r.weight) || 0), 0),
    }),
    [rows],
  );

  async function onSubmit() {
    setError(null);
    setFlash(null);
    if (rows.length === 0) return setError(manual ? "Add at least one material row." : "Nothing to post — fetch a challan first.");
    if (!location.trim()) return setError("Choose a location (roll stock is tracked per location).");
    if (!lot.trim() && !challanNo.trim()) return setError("Enter a lot number.");
    for (const r of rows) {
      if (!r.color.trim()) return setError(`Roll ${r.roll || ""} needs a colour.`);
      if (!(Number(r.weight) > 0) && !(Number(r.qty) > 0)) return setError(`Roll ${r.roll || ""} needs a weight or qty.`);
    }
    const payload = {
      doctype: "MM Inward",
      posting_date: postingDate,
      branch: branch || null,
      location,
      sales_order: salesOrder || null,
      challan_number: challanNo.trim(),
      lot_number: lot || challanNo.trim(),
      items: rows.map((r, i) => ({
        idx: i + 1,
        roll_name: r.roll,
        color_name: r.color,
        cut: r.cut,
        qty_box: Number(r.qty) || 0,
        weight: Number(r.weight) || 0,
        // Per-roll allocation wins; otherwise fall back to the header order.
        customer_order: r.customer_order || salesOrder || null,
        challan_number: challanNo.trim(),
      })),
    };
    try {
      const res = await postInward({ payload });
      const name = res?.message?.name;
      if (processing) {
        // Queue mode: keep the rolls on screen and wait for the user to hit "Next".
        setPostedCount((c) => c + 1);
        setAwaitingNext(true);
        setFlash(`Inward ${name} posted${isLast ? " — last challan in the batch." : " — click Next challan."}`);
      } else {
        // Manual / single: clear the whole form.
        setFlash(`Inward ${name} posted — roll stock updated.`);
        setRows([]);
        setOrders([]);
        setChallanNo("");
        setLot("");
        setFetched(false);
        setManual(false);
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  const busy = posting;

  return (
    <div className="mm-iw">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">Inward</h1>
          <p className="mm-page-sub">Receive rolls against Veermetlon challans. Branch &amp; location are taken from your profile.</p>
        </div>
      </header>

      {/* Challan entry */}
      <section className="mm-card mm-card-pad mm-iw-entry">
        <div className="mm-iw-entry-grid">
          <label className="mm-field">
            <span className="mm-field-label">Chalan date</span>
            <input className="mm-input" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </label>
          <FieldInput field={F_LOCATION} value={location} onChange={(v) => setLocation(String(v ?? ""))} />
          <FieldInput field={F_BRANCH} value={branch} onChange={(v) => setBranch(String(v ?? ""))} />
          <FieldInput field={F_SALES_ORDER} value={salesOrder} onChange={(v) => setSalesOrder(String(v ?? ""))} />
          {fetched && (
            <label className="mm-field">
              <span className="mm-field-label">Lot number</span>
              <input className="mm-input" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Auto from challan coating" />
            </label>
          )}
        </div>

        {processing ? (
          <div className="mm-iw-progress">
            <span className="mm-pill mm-pill-muted">Challan {qIndex + 1} / {queue.length}</span>
            <strong>{challanNo || "—"}</strong>
            {!fetched && (
              <button type="button" className="mm-btn-secondary mm-btn-compact" disabled={fetching} onClick={() => void loadChallan(queue[qIndex])}>
                {fetching ? "Fetching…" : "Retry fetch"}
              </button>
            )}
            <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={() => void gotoNext()} title="Skip this challan without posting">
              <SkipForward size={14} /> Skip
            </button>
            <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={finishBatch} title="End the batch">
              Cancel batch
            </button>
          </div>
        ) : !manual ? (
          <div className="mm-iw-challan-block">
            <span className="mm-field-label">Veermetlon challan no(s) *</span>
            <div className="mm-iw-challan-list">
              {queue.map((c, i) => (
                <div className="mm-iw-challan-line" key={i}>
                  <input
                    className="mm-input"
                    value={c}
                    placeholder={`Challan ${i + 1}`}
                    onChange={(e) => setChallanLine(i, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void startQueue()}
                  />
                  <button type="button" className="mm-icon-btn" disabled={queue.length === 1} title="Remove" onClick={() => removeChallanLine(i)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mm-iw-challan-actions">
              <button type="button" className="mm-btn-secondary" onClick={addChallanLine}>
                <Plus size={15} /> Add challan no
              </button>
              <button type="button" className="mm-btn-primary" disabled={fetching} onClick={() => void startQueue()}>
                {fetching ? "Fetching…" : (<><Download size={15} /> Fetch</>)}
              </button>
              <button type="button" className="mm-btn-secondary" onClick={startManual} title="Skip Veermetlon and enter material by hand">
                <Pencil size={15} /> Enter manually
              </button>
            </div>
          </div>
        ) : null}

        {error && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{error}</p>}
        {flash && <p className="mm-banner mm-banner-ok" style={{ marginTop: "0.6rem" }}>{flash}</p>}
      </section>

      {fetched && (
        <div className={`mm-iw-grid${manual ? " mm-iw-grid-single" : ""}`}>
          {/* Rolls to receive */}
          <section className="mm-card mm-card-pad">
            <div className="mm-iw-sec-head">
              <h2 className="mm-panel-title"><PackageCheck size={16} /> {manual ? "Material received" : "Rolls on this challan"}</h2>
              <span className="mm-muted">Total: {totals.qty} box · {totals.weight.toLocaleString()} kg</span>
            </div>
            <div className="mm-table-scroll">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Color</th>
                    <th>Size</th>
                    <th className="mm-num">Qty</th>
                    <th className="mm-num">Weight</th>
                    {!manual && <th>Allocate to order</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input className="mm-input mm-input-compact" value={r.roll} placeholder="Roll" disabled={awaitingNext} onChange={(e) => setRow(i, { roll: e.target.value })} />
                      </td>
                      <td>
                        <input className="mm-input mm-input-compact" value={r.color} placeholder="Colour" disabled={awaitingNext} onChange={(e) => setRow(i, { color: e.target.value })} />
                      </td>
                      <td>
                        <input className="mm-input mm-input-compact" value={r.cut} placeholder="Size" disabled={awaitingNext} onChange={(e) => setRow(i, { cut: e.target.value })} />
                      </td>
                      <td className="mm-num">
                        <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.qty} disabled={awaitingNext} onChange={(e) => setRow(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                      </td>
                      <td className="mm-num">
                        <input className="mm-input mm-input-compact mm-iw-num" type="number" value={r.weight} disabled={awaitingNext} onChange={(e) => setRow(i, { weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                      </td>
                      {!manual && (
                        <td>
                          <select className="mm-input mm-input-compact" value={r.customer_order} disabled={awaitingNext} onChange={(e) => allocate(i, e.target.value)}>
                            <option value="">— none —</option>
                            {orders.map((o, oi) => (
                              <option key={`${o.sales_order}-${oi}`} value={o.sales_order}>
                                {o.sales_order} · {o.party} · {o.color_name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="mm-num">
                        <button type="button" className="mm-icon-btn" title="Remove row" disabled={awaitingNext} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mm-ws-form-actions">
              {!awaitingNext && (
                <button type="button" className="mm-btn-secondary" onClick={addRow}>
                  <Plus size={15} /> Add row
                </button>
              )}
              {!awaitingNext ? (
                <button type="button" className="mm-btn-primary" disabled={busy} onClick={() => void onSubmit()}>
                  {busy ? "Posting…" : "Post inward"}
                </button>
              ) : processing ? (
                <button type="button" className="mm-btn-primary" disabled={fetching} onClick={() => (isLast ? finishBatch() : void gotoNext())}>
                  {isLast ? "Finish batch" : (<>Next challan <ArrowRight size={15} /></>)}
                </button>
              ) : null}
            </div>
          </section>

          {/* Matching orders reference */}
          {!manual && (
            <section className="mm-card mm-card-pad">
              <div className="mm-iw-sec-head">
                <h2 className="mm-panel-title">Open orders for this coating</h2>
                <span className="mm-pill mm-pill-muted">{orders.length}</span>
              </div>
              {orders.length === 0 ? (
                <p className="mm-empty">No open orders match this coating.</p>
              ) : (
                <div className="mm-table-scroll">
                  <table className="mm-table mm-table-dense">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Party</th>
                        <th>Color</th>
                        <th>Size</th>
                        <th className="mm-num">Req</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={`${o.sales_order}-${i}`} className={rows.some((r) => r.customer_order === o.sales_order) ? "mm-ws-row-active" : undefined}>
                          <td className="mm-ow-cell-order">{o.sales_order}</td>
                          <td>{o.party || "—"}</td>
                          <td>{o.color_name || "—"}</td>
                          <td>{o.cut || "—"}</td>
                          <td className="mm-num">{(o.required_weight ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                One challan can serve several customers — allocate each roll on the left.
              </p>
            </section>
          )}
        </div>
      )}

      <RecentInwardsMatcher />
    </div>
  );
}

type RecentInward = {
  name: string;
  posting_date?: string;
  lot_number?: string;
  location?: string;
  sales_order?: string | null;
  colours?: string;
  total_weight?: number;
  allocated?: boolean;
};

/**
 * Match an already-posted inward to a Sales Order after the fact — for rolls received
 * without an order, which can later be tied to one (updates SO fulfilment).
 */
function RecentInwardsMatcher() {
  const { data, isLoading, mutate } = useFrappeGetCall<{ message: RecentInward[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.recent_inwards",
    undefined,
    "mm-recent-inwards",
  );
  const { call: allocate, loading } = useFrappePostCall<{ message: unknown }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.allocate_inward_to_order",
  );
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const list = data?.message ?? [];

  async function match(name: string) {
    const so = (picks[name] || "").trim();
    if (!so) return;
    setMsg(null);
    try {
      await allocate({ inward: name, sales_order: so });
      setMsg(`Matched ${name} → ${so}.`);
      setPicks((p) => ({ ...p, [name]: "" }));
      void mutate();
    } catch (e) {
      setMsg((e as { message?: string })?.message || String(e));
    }
  }

  return (
    <section className="mm-card mm-card-pad" style={{ marginTop: "1.25rem" }}>
      <div className="mm-iw-sec-head">
        <h2 className="mm-panel-title">Match a posted inward to an order</h2>
        <span className="mm-pill mm-pill-muted">{isLoading ? "…" : list.length}</span>
      </div>
      {msg && <p className="mm-banner mm-banner-ok" style={{ marginBottom: "0.6rem" }}>{msg}</p>}
      {list.length === 0 ? (
        <p className="mm-empty">No posted inwards yet.</p>
      ) : (
        <div className="mm-table-scroll">
          <table className="mm-table mm-table-dense">
            <thead>
              <tr>
                <th>Inward</th>
                <th>Lot</th>
                <th>Colour</th>
                <th className="mm-num">Weight</th>
                <th>Order</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((iw) => (
                <tr key={iw.name}>
                  <td>{iw.name}</td>
                  <td>{iw.lot_number || "—"}</td>
                  <td>{iw.colours || "—"}</td>
                  <td className="mm-num">{(iw.total_weight ?? 0).toLocaleString()}</td>
                  <td style={{ minWidth: 200 }}>
                    {iw.allocated && iw.sales_order ? (
                      <span className="mm-pill mm-pill-ok">{iw.sales_order}</span>
                    ) : (
                      <LinkField
                        label=""
                        linkDoctype="MM Sales Order"
                        value={picks[iw.name] || ""}
                        onChange={(v) => setPicks((p) => ({ ...p, [iw.name]: v }))}
                      />
                    )}
                  </td>
                  <td className="mm-num">
                    {!(iw.allocated && iw.sales_order) && (
                      <button type="button" className="mm-btn-secondary mm-btn-compact" disabled={loading || !(picks[iw.name] || "").trim()} onClick={() => void match(iw.name)}>
                        Match
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
        Tie rolls received without an order to a Sales Order — its inwarded weight updates immediately.
      </p>
    </section>
  );
}
