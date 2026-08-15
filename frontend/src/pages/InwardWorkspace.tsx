import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Download, PackageCheck, Plus, ShoppingCart, X } from "lucide-react";
import type { FieldSchema } from "@/config/registry";
import { FieldInput } from "@/components/FieldInputs";
import LinkField from "@/components/LinkField";
import SearchSelect from "@/components/SearchSelect";
import SalesOrderPicker, { type SOOption } from "@/components/SalesOrderPicker";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const today = () => new Date().toISOString().slice(0, 10);

const F_LOCATION: FieldSchema = { fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true };
const F_BRANCH: FieldSchema = { fieldname: "branch", label: "Branch", fieldtype: "Link", options: "MM Branch", linkFilters: [{ field: "location", fromField: "location" }] };

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

/** One line of the entry grid = one MM Inward Item. */
type Row = {
  job_work: boolean;
  challan_no: string;
  customer_order: string;
  roll: string;
  color: string;
  /** Not a column — carried through from a challan/order so cutting still gets the size. */
  cut: string;
  qty: number | "";
  weight: number | "";
};

const blankRow = (challan = ""): Row => ({
  job_work: false,
  challan_no: challan,
  customer_order: "",
  roll: "",
  color: "",
  cut: "",
  qty: "",
  weight: "",
});

/**
 * Inward entry, one full-width grid.
 *
 * The floor keys rolls in a line at a time — jobwork flag, challan, order, roll, colour,
 * qty and weight all on one row — so the screen is that grid and nothing else: header
 * fields on top, running totals and Submit pinned at the bottom.
 *
 * Veermetlon stays optional rather than being the way in: type a challan number and hit
 * Fetch and the rolls come back from VM (and the post is verified against it, so
 * over-receipt and a closed challan are still blocked server-side). Leave it alone and
 * the inward is a plain manual one.
 */
export default function InwardWorkspace() {
  const [postingDate, setPostingDate] = useState(today());
  const [branch, setBranch] = useState("");
  const [location, setLocation] = useState("");
  const [company, setCompany] = useState("");
  const [salesOrder, setSalesOrder] = useState(""); // optional order for the whole inward
  const [challanNo, setChallanNo] = useState("");
  const [lot, setLot] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [orders, setOrders] = useState<MatchOrder[]>([]); // matching orders from a fetched challan
  const [verify, setVerify] = useState<ChallanVerify | null>(null);
  const [isPartial, setIsPartial] = useState(false); // "more rolls to come on this challan"
  const [forceOpen, setForceOpen] = useState(false);
  const [forcePin, setForcePin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The bulk "Qty | Weight" dialog: which row it is filling, and the count/weight lines.
  const [bulkRow, setBulkRow] = useState<number | null>(null);
  const [bulkLines, setBulkLines] = useState<{ count: number | ""; weight: number | "" }[]>([]);

  const { call: verifyCall, loading: fetching } = useFrappePostCall<{ message: ChallanVerify }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.verify_challan",
  );
  const { call: postInward, loading: posting } = useFrappePostCall<{ message: { name: string; receipt_status?: string } }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.post_inward",
  );
  const { call: forceComplete, loading: forcing } = useFrappePostCall(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order.force_complete_order",
  );

  // Rolls are received COMPANY-wise. Searchable by the company's own name or by the party
  // it sits under, because operators know sites by either.
  const companiesCall = useFrappeGetCall<{ message: { company_name: string; party: string; party_name: string }[] }>(
    "mahaveermetalic.mahaveer_metallic.api.party.all_companies",
    undefined,
    "mm-all-companies",
  );
  const companies = companiesCall.data?.message ?? [];

  // Open orders for the per-row Customer Order picker. Same cache key as SalesOrderPicker,
  // so the header picker and every row share ONE fetch — and the option carries the
  // order's colours, which is what lets picking an order fill the row's colour with no
  // extra round trip.
  const { data: soData } = useFrappeGetCall<{ message: SOOption[] }>(
    "mahaveermetalic.mahaveer_metallic.api.inward.sales_order_options",
    undefined,
    "mm-inward-so-options",
  );
  const soOptions = useMemo(() => soData?.message ?? [], [soData]);
  const soByName = useMemo(() => new Map(soOptions.map((o) => [o.sales_order, o])), [soOptions]);

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

  // Show which lot this inward will land in — the challan's existing lot, or the next
  // colour-wise LT id. Preview only: the authoritative lot is assigned on post.
  const { call: previewLot } = useFrappePostCall<{ message: { lot_id?: string } }>(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_lot.mm_lot.preview_lot",
  );
  const [lotPreview, setLotPreview] = useState("");
  const firstColour = rows.find((r) => r.color)?.color || "";
  useEffect(() => {
    if (!firstColour) { setLotPreview(""); return; }
    let cancelled = false;
    void (async () => {
      try {
        const r = await previewLot({ color: firstColour, challan_number: challanNo.trim() || undefined, posting_date: postingDate });
        if (!cancelled) setLotPreview(r?.message?.lot_id || "");
      } catch { if (!cancelled) setLotPreview(""); }
    })();
    return () => { cancelled = true; };
  }, [firstColour, challanNo, postingDate, previewLot]);

  // One source of truth for the lot — what the field shows, what the guard checks and what
  // gets posted. (The field is read-only, so `lot` is only ever set by a challan fetch.)
  const effectiveLot = (lotPreview || lot).trim();

  /* ── Header actions ───────────────────────────────────── */

  /** Pull the challan's rolls from Veermetlon into the grid. Optional: an inward typed by
   *  hand never comes through here. */
  async function onFetchChallan() {
    const no = challanNo.trim();
    if (!no) return setError("Enter a challan number to fetch, or just type the rolls in below.");
    setError(null);
    setFlash(null);
    try {
      const r = await verifyCall({ challan_no: no });
      const m = r.message;
      setVerify(m);
      setOrders(m.matching_orders || []);
      const fetched: Row[] = (m.items || []).map((it) => ({
        job_work: false,
        challan_no: no,
        customer_order: "",
        roll: it.roll || "",
        color: it.color || "",
        cut: it.cut || "",
        qty: it.qty ?? "",
        weight: it.weight ?? "",
      }));
      // Keep anything already keyed in that carries data, so a fetch never eats work.
      setRows((prev) => {
        const kept = prev.filter((r) => r.roll || r.color || r.qty !== "" || r.weight !== "");
        return [...kept, ...(fetched.length ? fetched : [blankRow(no)])];
      });
      setLot(m.coating || m.challan_no || no);
      if (m.closed) setError(`Challan ${m.challan_no} is already fully received — no further inward allowed.`);
      else if ((m.items || []).length === 0) setError("Challan found but it has no rolls — enter them by hand.");
      else setFlash(`Fetched ${fetched.length} roll(s) from challan ${m.challan_no}.`);
    } catch (e) {
      setVerify(null);
      setOrders([]);
      setError(extractErrorMessage(e));
    }
  }

  /** Picking the header order fills Company and registers the whole inward against it. */
  function pickSalesOrder(v: string, opt?: SOOption) {
    setSalesOrder(v);
    if (opt?.company_name) setCompany(opt.company_name);
    setForceOpen(false);
    setForcePin("");
  }

  async function submitForceComplete() {
    setError(null);
    if (!salesOrder) return;
    try {
      await forceComplete({ order: salesOrder, pin: forcePin });
      setForceOpen(false);
      setForcePin("");
      setFlash(`Order ${salesOrder} force-completed.`);
      toast(`Order ${salesOrder} completed`);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  /* ── Grid ─────────────────────────────────────────────── */

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow(challanNo.trim())]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [blankRow(challanNo.trim())]));
  }

  /** Order → colour. The order knows its colours, so picking one fills the row instead of
   *  making the operator re-pick what the order already says. An existing colour wins —
   *  a colour read off a challan is what actually arrived. */
  function pickOrder(i: number, sales_order: string) {
    const opt = soByName.get(sales_order);
    const fromMatch = orders.find((o) => o.sales_order === sales_order);
    const colour = opt?.colours?.[0] || fromMatch?.color_name || "";
    const cut = opt?.cuts?.[0] || fromMatch?.cut || "";
    setRows((prev) =>
      prev.map((r, j) =>
        j === i ? { ...r, customer_order: sales_order, color: r.color || colour, cut: r.cut || cut } : r,
      ),
    );
  }

  // Keyboard: Enter adds another row so material can be keyed in without reaching for the
  // mouse; Cmd/Ctrl+Enter submits. Enter is left alone while a dropdown is open so it can
  // pick the highlighted suggestion.
  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); if (!busy) void onSubmit(); return; }
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT") return;
    if (el.closest(".mm-link-wrap") && document.querySelector("[data-mm-menu]")) return;
    e.preventDefault();
    addRow();
  }

  /* ── Bulk "Qty | Weight" dialog ───────────────────────── */

  function openBulk(i: number) {
    const r = rows[i];
    setBulkLines([{ count: 1, weight: r.weight === "" ? "" : r.weight }]);
    setBulkRow(i);
  }

  const bulkTotals = useMemo(() => {
    const n = bulkLines.reduce((s, l) => s + (Number(l.count) || 0), 0);
    const w = bulkLines.reduce((s, l) => s + (Number(l.count) || 0) * (Number(l.weight) || 0), 0);
    return { n, w };
  }, [bulkLines]);

  /** Expand the dialog's count × weight lines into that many identical rows, copied from
   *  the row the dialog was opened on (jobwork, challan, order, roll, colour). A source
   *  row with nothing weighed on it yet is replaced rather than left behind empty. */
  function applyBulk() {
    if (bulkRow === null) return;
    const src = rows[bulkRow];
    const made: Row[] = [];
    for (const l of bulkLines) {
      const count = Math.max(0, Math.floor(Number(l.count) || 0));
      const weight = Number(l.weight) || 0;
      for (let k = 0; k < count; k++) made.push({ ...src, qty: 1, weight: weight || "" });
    }
    if (made.length === 0) { setBulkRow(null); return; }
    const srcEmpty = src.qty === "" && src.weight === "";
    setRows((prev) => {
      const next = [...prev];
      next.splice(bulkRow, srcEmpty ? 1 : 0, ...made);
      return next;
    });
    setBulkRow(null);
    toast(`Added ${made.length} row${made.length > 1 ? "s" : ""}`);
  }

  /* ── Totals + verification ────────────────────────────── */

  const totals = useMemo(
    () => ({
      qty: rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
      weight: rows.reduce((s, r) => s + (Number(r.weight) || 0), 0),
    }),
    [rows],
  );

  // The server's own figures, not a copy of them: a mirrored constant drifts the moment
  // the setting changes, and the panel then warns about a limit that is no longer real.
  const { data: tolData } = useFrappeGetCall<{ message: { under: number; over: number } }>(
    "mahaveermetalic.mahaveer_metallic.doctype.mm_settings.mm_settings.inward_tolerances",
    undefined,
    "mm-inward-tolerances",
  );
  const overPct = (tolData?.message?.over ?? 20) / 100;
  const overTol = verify ? Math.max(0.5, (verify.expected_weight || 0) * overPct) : 0.5;
  const overReceipt = !!verify && totals.weight > verify.remaining_weight + overTol;

  // Only a grid actually filled from the fetched challan is posted as VM-verified. Change
  // the challan number after fetching and this is a plain manual inward again.
  const vmVerified = !!verify && verify.challan_no === challanNo.trim();

  function resetForm() {
    setRows([blankRow()]);
    setOrders([]);
    setVerify(null);
    setChallanNo("");
    setLot("");
    setIsPartial(false);
    setSalesOrder("");
  }

  async function onSubmit() {
    setError(null);
    setFlash(null);
    const filled = rows.filter((r) => r.color.trim() || r.roll.trim() || r.qty !== "" || r.weight !== "");
    if (filled.length === 0) return setError("Add at least one item row.");
    if (verify?.closed && vmVerified) return setError("This challan is already fully received — no further inward allowed.");
    if (!location.trim()) return setError("Choose a location (roll stock is tracked per location).");
    if (!company.trim()) return setError("Choose the company — rolls are received company-wise.");
    if (!effectiveLot && !challanNo.trim()) return setError("No lot could be resolved — pick a colour on the item rows first.");
    for (const [i, r] of filled.entries()) {
      if (!r.color.trim()) return setError(`Row ${i + 1} needs a colour.`);
      if (!(Number(r.weight) > 0) && !(Number(r.qty) > 0)) return setError(`Row ${i + 1} needs a weight or qty.`);
    }
    const payload = {
      doctype: "MM Inward",
      posting_date: postingDate,
      branch: branch || null,
      location,
      sales_order: salesOrder || null,
      challan_number: challanNo.trim(),
      lot_number: effectiveLot || challanNo.trim(),
      company_name: company,
      verify_against_vm: vmVerified,
      is_partial: isPartial,
      items: filled.map((r, i) => ({
        idx: i + 1,
        job_work: r.job_work ? 1 : 0,
        roll_name: r.roll,
        color_name: r.color,
        cut: r.cut,
        qty_box: Number(r.qty) || 0,
        weight: Number(r.weight) || 0,
        // Per-row allocation wins; otherwise fall back to the header order.
        customer_order: r.customer_order || salesOrder || null,
        challan_number: r.challan_no.trim() || challanNo.trim(),
      })),
    };
    try {
      const res = await postInward({ payload });
      const name = res?.message?.name;
      const status = res?.message?.receipt_status;
      const tag = status === "Partial" ? " (Partial — challan still open)" : status === "Complete" ? " (Complete)" : "";
      toast(`Inward ${name} posted${tag}`);
      setFlash(`Inward ${name} posted${tag} — roll stock updated.`);
      resetForm();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      toast(msg, "error");
    }
  }

  const busy = posting;

  return (
    <div className="mm-iw">
      <header className="mm-ws-head">
        <div>
          <h1 className="mm-page-title">Inward</h1>
          <p className="mm-page-sub">Key the rolls in a line at a time. Fetch a Veermetlon challan to fill them in for you.</p>
        </div>
      </header>

      {/* Header fields — date, where it lands, and the optional challan fetch. */}
      <section className="mm-card mm-card-pad">
        <div className="mm-iw-head-grid">
          <label className="mm-field">
            <span className="mm-field-label">Chalan date *</span>
            <input className="mm-input" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </label>
          <FieldInput field={F_LOCATION} value={location} onChange={(v) => setLocation(String(v ?? ""))} />
          <label className="mm-field">
            <span className="mm-field-label">Company *</span>
            <SearchSelect
              value={company}
              onChange={setCompany}
              required
              placeholder="Search company or party…"
              options={companies.map((c) => ({ value: c.company_name, label: c.company_name, meta: c.party_name }))}
            />
          </label>
          <FieldInput field={F_BRANCH} value={branch} onChange={(v) => setBranch(String(v ?? ""))} record={{ location }} />
          {/* Lot is assigned automatically (colour-wise LT id, reused per challan) — shown
              read-only so the operator can see which lot this will land in. */}
          <label className="mm-field">
            <span className="mm-field-label">Lot no</span>
            <input className="mm-input" value={effectiveLot} readOnly
              placeholder={rows.some((r) => r.color) ? "Resolving…" : "Auto — pick a colour"} />
          </label>
          <label className="mm-field">
            <span className="mm-field-label">Chalan no</span>
            <div className="mm-iw-fetch">
              <input
                className="mm-input"
                value={challanNo}
                placeholder="Veermetlon challan"
                onChange={(e) => setChallanNo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onFetchChallan(); } }}
              />
              <button type="button" className="mm-btn-secondary mm-btn-compact" disabled={fetching} onClick={() => void onFetchChallan()}
                title="Pull this challan's rolls from Veermetlon and verify the receipt against it">
                {fetching ? "…" : (<><Download size={14} /> Fetch</>)}
              </button>
            </div>
          </label>
          <SalesOrderPicker wide label="Sales order (optional — per-row order overrides it)" value={salesOrder} onChange={pickSalesOrder} />
        </div>

        {/* When an order is registered: it auto-completes once inward matches the ordered
            weight (within tolerance); this closes it early with the Admin PIN. */}
        {salesOrder && (
          <div className="mm-iw-force">
            <span className="mm-muted" style={{ fontSize: "0.82rem" }}>
              Order <strong>{salesOrder}</strong> completes automatically when inward matches the ordered weight.
            </span>
            {!forceOpen ? (
              <button type="button" className="mm-mini" onClick={() => setForceOpen(true)}>
                <PackageCheck size={13} /> Force complete order
              </button>
            ) : (
              <span style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="password"
                  className="mm-input mm-input-compact"
                  style={{ maxWidth: 150 }}
                  placeholder="Admin Override PIN"
                  value={forcePin}
                  onChange={(e) => setForcePin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitForceComplete(); }}
                />
                <button type="button" className="mm-mini mm-mini-ok" disabled={forcing || !forcePin.trim()} onClick={() => void submitForceComplete()}>
                  {forcing ? "…" : "Complete"}
                </button>
                <button type="button" className="mm-mini" onClick={() => { setForceOpen(false); setForcePin(""); }}>Cancel</button>
              </span>
            )}
          </div>
        )}

        {/* Verify panel — challan expected vs entered, from Veermetlon */}
        {verify && (
          <div className={`mm-verify ${verify.closed ? "mm-verify-closed" : ""}`}>
            <div className="mm-verify-row">
              <span className="mm-verify-badge"><PackageCheck size={13} /> Verified from Veermetlon · {verify.challan_no}</span>
              {verify.closed && <span className="mm-badge-low">Challan closed</span>}
              {!vmVerified && <span className="mm-badge-low">Challan no changed — posting unverified</span>}
              <button type="button" className="mm-mini" onClick={() => { setVerify(null); setOrders([]); }} title="Drop the challan verification">
                Clear
              </button>
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

        {error && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{error}</p>}
        {flash && <p className="mm-banner mm-banner-ok" style={{ marginTop: "0.6rem" }}>{flash}</p>}
      </section>

      {/* The entry grid. */}
      <section className="mm-card mm-iw-items-card">
        <div className="mm-iw-band">Inward items</div>
        <div className="mm-table-scroll" onKeyDown={onGridKeyDown}>
          <table className="mm-table mm-table-dense mm-iw-grid-table">
            <thead>
              <tr>
                <th className="mm-iw-c-no">No</th>
                <th className="mm-iw-c-jw">JobWork</th>
                <th className="mm-iw-c-chalan">Chalan No</th>
                <th className="mm-iw-c-order">Customer Order</th>
                <th className="mm-iw-c-roll">Roll</th>
                <th className="mm-iw-c-color">Color *</th>
                <th className="mm-iw-c-qty">Qty | Weight (Kg) *</th>
                <th className="mm-iw-c-act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mm-iw-c-no">{i + 1}</td>
                  <td className="mm-iw-c-jw">
                    <input
                      type="checkbox"
                      className="mm-iw-jw-box"
                      checked={r.job_work}
                      title="Job work — this material belongs to the customer"
                      aria-label={`Job work, row ${i + 1}`}
                      onChange={(e) => setRow(i, { job_work: e.target.checked })}
                    />
                  </td>
                  <td className="mm-iw-c-chalan">
                    <input className="mm-input mm-input-compact" value={r.challan_no} placeholder="Chalan No"
                      onChange={(e) => setRow(i, { challan_no: e.target.value })} />
                  </td>
                  <td className="mm-iw-c-order">
                    <SearchSelect
                      compact
                      value={r.customer_order}
                      placeholder="Select Order"
                      options={soOptions.map((o) => ({
                        value: o.sales_order,
                        label: o.sales_order,
                        meta: [o.party_name || o.party, (o.colours || []).join(", ")].filter(Boolean).join(" · "),
                      }))}
                      onChange={(v) => pickOrder(i, v)}
                    />
                  </td>
                  <td className="mm-iw-c-roll">
                    <input className="mm-input mm-input-compact" value={r.roll} placeholder="Roll"
                      onChange={(e) => setRow(i, { roll: e.target.value })} />
                  </td>
                  <td className="mm-iw-c-color">
                    <LinkField
                      compact
                      label=""
                      linkDoctype="MM Item Master"
                      value={r.color}
                      placeholder="Select Color"
                      createDefaults={{ item_type: "Roll" }}
                      onChange={(v) => setRow(i, { color: v })}
                    />
                  </td>
                  <td className="mm-iw-c-qty">
                    <div className="mm-iw-qtypair">
                      <input className="mm-input mm-input-compact" type="number" value={r.qty} placeholder="Qty"
                        onChange={(e) => setRow(i, { qty: e.target.value === "" ? "" : Number(e.target.value) })} />
                      <input className="mm-input mm-input-compact" type="number" value={r.weight} placeholder="Weight"
                        onChange={(e) => setRow(i, { weight: e.target.value === "" ? "" : Number(e.target.value) })} />
                      <button type="button" className="mm-iw-cart" title="Add several rolls at once — enter how many and the weight each"
                        aria-label={`Add several rolls like row ${i + 1}`} onClick={() => openBulk(i)}>
                        <ShoppingCart size={15} />
                      </button>
                    </div>
                  </td>
                  <td className="mm-iw-c-act">
                    <div className="mm-iw-rowacts">
                      <button type="button" className="mm-iw-add" title="Add row" aria-label="Add row" onClick={addRow}>
                        <Plus size={16} />
                      </button>
                      <button type="button" className="mm-icon-btn" title="Remove row" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(i)}>
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals + Submit, pinned to the bottom of the grid. */}
        <div className="mm-iw-footer">
          <span className="mm-iw-total">Total Qty: <strong>{totals.qty.toLocaleString()}</strong></span>
          <span className="mm-iw-total">Total Weight: <strong>{totals.weight.toFixed(2)}</strong></span>
          <label className="mm-check" title="Tick if more rolls are still coming on this challan">
            <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} />
            Partial — more to come
          </label>
          <button type="button" className="mm-btn-primary mm-iw-submit" disabled={busy || (vmVerified && !!verify?.closed)}
            onClick={() => void onSubmit()}>
            {busy ? "Posting…" : "Submit"} <span aria-hidden>→</span>
          </button>
        </div>
      </section>

      {/* Open orders for a fetched challan's coating — the allocation reference. */}
      {orders.length > 0 && (
        <section className="mm-card mm-card-pad">
          <div className="mm-iw-sec-head">
            <h2 className="mm-panel-title">Open orders for this coating</h2>
            <span className="mm-pill mm-pill-muted">{orders.length}</span>
          </div>
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead>
                <tr><th>Order</th><th>Party</th><th>Color</th><th>Size</th><th className="mm-num">Req</th></tr>
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
          <p className="mm-muted" style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
            One challan can serve several customers — set the order per row above.
          </p>
        </section>
      )}

      {/* Bulk qty/weight — "10 rolls at 25 kg" becomes 10 rows without keying each one. */}
      {bulkRow !== null && (
        <div className="mm-modal-scrim" style={{ zIndex: 70 }} onClick={() => setBulkRow(null)}>
          <div className="mm-modal mm-sheet mm-sheet-narrow" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Qty and weight">
            <div className="mm-modal-head">
              <span className="mm-modal-title">Qty | Weight (Kg)</span>
              <button className="mm-icon-btn" onClick={() => setBulkRow(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mm-modal-body">
              <p className="mm-muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
                How many rolls, and what each one weighs. Each line becomes that many rows, copied from row {bulkRow + 1}.
              </p>
              {bulkLines.map((l, i) => (
                <div className="mm-iw-bulk-line" key={i}>
                  <input className="mm-input" type="number" min={1} value={l.count} placeholder="Qty" autoFocus={i === 0}
                    aria-label={`How many, line ${i + 1}`}
                    onChange={(e) => setBulkLines((p) => p.map((x, j) => (j === i ? { ...x, count: e.target.value === "" ? "" : Number(e.target.value) } : x)))} />
                  <input className="mm-input" type="number" value={l.weight} placeholder="Weight"
                    aria-label={`Weight each, line ${i + 1}`}
                    onChange={(e) => setBulkLines((p) => p.map((x, j) => (j === i ? { ...x, weight: e.target.value === "" ? "" : Number(e.target.value) } : x)))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyBulk(); } }} />
                  {bulkLines.length > 1 ? (
                    <button type="button" className="mm-icon-btn" title="Remove line" aria-label="Remove line"
                      onClick={() => setBulkLines((p) => p.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </button>
                  ) : (
                    <span className="mm-iw-bulk-spacer" />
                  )}
                </div>
              ))}
              <button type="button" className="mm-iw-add mm-iw-bulk-add" title="Add another qty / weight line" aria-label="Add another line"
                onClick={() => setBulkLines((p) => [...p, { count: 1, weight: "" }])}>
                <Plus size={16} />
              </button>
              <p className="mm-muted" style={{ fontSize: "0.82rem" }}>
                Adds <strong>{bulkTotals.n}</strong> row{bulkTotals.n === 1 ? "" : "s"} · <strong>{bulkTotals.w.toFixed(2)}</strong> kg
              </p>
              <div className="mm-ow-po-actions">
                <button type="button" className="mm-btn-primary" disabled={bulkTotals.n === 0} onClick={applyBulk}>Add Qty</button>
                <button type="button" className="mm-btn-secondary" onClick={() => setBulkRow(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
