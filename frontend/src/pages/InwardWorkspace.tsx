import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, Download, ListChecks, PackageCheck, Pencil, Plus, RefreshCw, SkipForward, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import SalesOrderPicker, { type SOOption } from "@/components/SalesOrderPicker";
import { extractErrorMessage } from "@/utils/frappeError";

const today = () => new Date().toISOString().slice(0, 10);

const F_LOCATION: FieldSchema = { fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true };
const F_BRANCH: FieldSchema = { fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" };

type SODetail = {
  sales_order: string;
  party?: string;
  party_name?: string;
  branch?: string | null;
  location?: string | null;
  delivery_date?: string | null;
  transaction_date?: string | null;
  items: { color?: string; cut?: string; qty_box?: number; qty_weight?: number }[];
};

type ChallanItem = { roll?: string; color?: string; cut?: string; qty?: number; weight?: number };
type MatchOrder = {
  sales_order: string;
  party?: string;
  color_name?: string;
  cut?: string;
  qty_weight?: number;
  required_weight?: number;
};
type ChallanVerify = {
  challan_no: string;
  expected_weight: number;
  expected_box: number;
  expected_rolls: number;
  received_weight: number;
  remaining_weight: number;
  closed: boolean;
  coating?: string;
  sales_order?: string;
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

type RecentInward = {
  name: string;
  posting_date?: string;
  lot_number?: string;
  location?: string;
  branch?: string;
  challan_number?: string;
  sales_order?: string;
  party?: string;
  party_name?: string;
  colours?: string;
  rolls?: number;
  total_box?: number;
  total_weight?: number;
  allocated?: boolean;
  receipt_status?: string;
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
  const [verify, setVerify] = useState<ChallanVerify | null>(null); // VM verification for the loaded challan
  const [isPartial, setIsPartial] = useState(false); // "more rolls to come on this challan"

  const { call: verifyCall, loading: fetching } = useFrappePostCall<{ message: ChallanVerify }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.verify_challan",
  );
  const { call: postInward, loading: posting } = useFrappePostCall<{ message: { name: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.post_inward",
  );
  const { call: fetchSODetail } = useFrappePostCall<{ message: SODetail }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.sales_order_detail",
  );

  // Picking a Sales Order sets it as the header order. In manual entry it also
  // auto-forms the Material Received rows from the order's line items (colour, size and
  // qty/weight) — roll numbers aren't on the order, so those stay blank; qty stays editable.
  async function pickSalesOrder(v: string, opt?: SOOption) {
    setSalesOrder(v);
    if (!v || !manual) return;
    setError(null);
    try {
      const r = await fetchSODetail({ sales_order: v });
      const d = r.message;
      if (d?.branch) setBranch((b) => b || d.branch || "");
      if (d?.location) setLocation((l) => l || d.location || "");
      const seeded: Row[] = (d?.items || []).map((it) => ({
        roll: "",
        color: it.color || "",
        cut: it.cut || "",
        qty: it.qty_box || "",
        weight: it.qty_weight || "",
        customer_order: v,
      }));
      setRows(seeded.length ? seeded : [blankRow()]);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
    void opt;
  }

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

  // Recent posted inwards, shown as a list below the entry form and refreshed after
  // each successful post.
  const { data: recentData, isLoading: recentLoading, mutate: refreshRecent } = useFrappeGetCall<{
    message: RecentInward[];
  }>("mahaveermetalic.mahaveer_metallic.api.inward.recent_inwards", { limit: 30 }, "mm-inward-recent");
  const recent = recentData?.message ?? [];

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
    setIsPartial(false);
    try {
      // verify_challan checks the challan against Veermetlon (throws if it isn't there)
      // and returns its rolls + expected-vs-received figures for the verify panel.
      const r = await verifyCall({ challan_no: no.trim() });
      const m = r.message;
      setVerify(m);
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
      if (m.closed) setError(`Challan ${m.challan_no} is already fully received — no further inward allowed.`);
      else if ((m.items || []).length === 0) setError("Challan found but it has no rolls.");
    } catch (e) {
      setRows([]);
      setOrders([]);
      setVerify(null);
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
    setVerify(null);
    setIsPartial(false);
    setSalesOrder("");
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
    setVerify(null);
    setIsPartial(false);
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

  // Mirror the server's over-receipt allowance: max(0.5 kg, 2% of expected). Using the
  // same tolerance keeps the panel warning consistent with what the server will accept.
  const overTol = verify ? Math.max(0.5, (verify.expected_weight || 0) * 0.02) : 0.5;
  const overReceipt = !!verify && totals.weight > verify.remaining_weight + overTol;

  async function onSubmit() {
    setError(null);
    setFlash(null);
    if (rows.length === 0) return setError(manual ? "Add at least one material row." : "Nothing to post — fetch a challan first.");
    if (verify?.closed) return setError("This challan is already fully received — no further inward allowed.");
    if (!location.trim()) return setError("Choose a location (roll stock is tracked per location).");
    if (!lot.trim() && !challanNo.trim()) return setError("Enter a lot number.");
    for (const r of rows) {
      if (!r.color.trim()) return setError(`Roll ${r.roll || ""} needs a colour.`);
      if (!(Number(r.weight) > 0) && !(Number(r.qty) > 0)) return setError(`Roll ${r.roll || ""} needs a weight or qty.`);
    }
    // Challan-driven inwards are verified against Veermetlon server-side; manual ones aren't.
    const verifyAgainstVm = !manual && !!challanNo.trim();
    const payload = {
      doctype: "MM Inward",
      posting_date: postingDate,
      branch: branch || null,
      location,
      sales_order: salesOrder || null,
      challan_number: challanNo.trim(),
      lot_number: lot || challanNo.trim(),
      verify_against_vm: verifyAgainstVm,
      is_partial: isPartial,
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
      const status = res?.message?.receipt_status;
      const tag = status === "Partial" ? " (Partial — challan still open)" : status === "Complete" ? " (Complete)" : "";
      void refreshRecent();
      if (processing) {
        // Queue mode: keep the rolls on screen and wait for the user to hit "Next".
        setPostedCount((c) => c + 1);
        setAwaitingNext(true);
        setFlash(`Inward ${name} posted${tag}${isLast ? " — last challan in the batch." : " — click Next challan."}`);
      } else {
        // Manual / single: clear the whole form.
        setFlash(`Inward ${name} posted${tag} — roll stock updated.`);
        setRows([]);
        setOrders([]);
        setChallanNo("");
        setLot("");
        setVerify(null);
        setIsPartial(false);
        setSalesOrder("");
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
          <SalesOrderPicker label="Sales order (optional)" value={salesOrder} onChange={(v, opt) => void pickSalesOrder(v, opt)} />
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

            {/* Verify panel — challan expected vs entered, from Veermetlon */}
            {!manual && verify && (
              <div className={`mm-verify ${verify.closed ? "mm-verify-closed" : ""}`}>
                <div className="mm-verify-row">
                  <span className="mm-verify-badge"><PackageCheck size={13} /> Verified from Veermetlon</span>
                  {verify.closed && <span className="mm-badge-low">Challan closed</span>}
                </div>
                <div className="mm-verify-stats">
                  <div><span>Challan expects</span><strong>{verify.expected_weight.toLocaleString()} kg · {verify.expected_rolls} rolls</strong></div>
                  <div><span>Already received</span><strong>{verify.received_weight.toLocaleString()} kg</strong></div>
                  <div><span>Remaining</span><strong>{verify.remaining_weight.toLocaleString()} kg</strong></div>
                  <div className={overReceipt ? "mm-verify-over" : "mm-verify-ok"}>
                    <span>Entering now</span><strong>{totals.weight.toLocaleString()} kg</strong>
                  </div>
                </div>
                {overReceipt && (
                  <p className="mm-verify-warn">Entered weight exceeds the challan's remaining {verify.remaining_weight.toLocaleString()} kg — posting will be blocked.</p>
                )}
              </div>
            )}

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
              {!awaitingNext && (
                <label className="mm-check mm-check-partial" title="Tick if more rolls are still coming on this challan">
                  <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} />
                  Partial — more rolls to come
                </label>
              )}
              {!awaitingNext ? (
                <button type="button" className="mm-btn-primary" disabled={busy || !!verify?.closed} onClick={() => void onSubmit()}>
                  {busy ? "Posting…" : "Verify & post inward"}
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

      {/* Posted inwards list */}
      <section className="mm-card mm-card-pad mm-iw-recent">
        <div className="mm-iw-sec-head">
          <h2 className="mm-panel-title"><ListChecks size={16} /> Posted inwards</h2>
          <div className="mm-iw-recent-head-actions">
            <span className="mm-pill mm-pill-muted">{recent.length}</span>
            <button type="button" className="mm-icon-btn" title="Refresh" onClick={() => void refreshRecent()}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        {recentLoading ? (
          <p className="mm-empty">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="mm-empty">No inwards posted yet.</p>
        ) : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Challan</th>
                  <th>Lot</th>
                  <th>Party</th>
                  <th>Color</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th className="mm-num">Rolls</th>
                  <th className="mm-num">Box</th>
                  <th className="mm-num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.name}>
                    <td>{r.posting_date || "—"}</td>
                    <td>{r.challan_number || "—"}</td>
                    <td>{r.lot_number || "—"}</td>
                    <td>{r.party_name || r.party || "—"}</td>
                    <td>{r.colours || "—"}</td>
                    <td>
                      {r.sales_order ? (
                        <span className="mm-ow-cell-order">{r.sales_order}</span>
                      ) : (
                        <span className="mm-muted">inventory</span>
                      )}
                    </td>
                    <td>
                      {r.receipt_status === "Partial" ? (
                        <span className="mm-state-chip mm-state-inventory">Partial</span>
                      ) : (
                        <span className="mm-state-chip mm-state-cut">Complete</span>
                      )}
                    </td>
                    <td>{r.location || "—"}</td>
                    <td className="mm-num">{r.rolls ?? 0}</td>
                    <td className="mm-num">{(r.total_box ?? 0).toLocaleString()}</td>
                    <td className="mm-num">{(r.total_weight ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
