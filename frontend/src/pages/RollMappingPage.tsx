import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import SearchSelect from "@/components/SearchSelect";
import { Link2, Link2Off, RefreshCw, Search } from "lucide-react";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.mapping";

type Order = {
  name: string; transaction_date?: string; party?: string; company_name?: string;
  colours?: string | null;
  ordered_weight: number; inwarded_weight: number; still_needed: number;
  mapped_rolls: number; mapped_weight: number; completed?: number; is_old?: boolean;
};
type Roll = {
  name: string; roll_no?: string; lot_number?: string; color_name?: string;
  supplier?: string; location?: string; stock_weight: number;
  mapped_inward?: string | null; mapped_order?: string | null; mapped_weight?: number;
};

const kg = (n?: number) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;

/**
 * ROLL → RECEIPT MAPPING.
 *
 * An inward is inserted and submitted in one go, so its Partial/Complete status was
 * decided the moment it was posted and then frozen — a challan that arrived over two days
 * left the first receipt reading "Partial" for ever. This page says which rolls answer for
 * which receipt, and the receipt's status follows from that (Hetvi: "the inward status also
 * keeps changing based on that sync").
 *
 * Nothing here creates or moves stock. The rolls are already in inventory, received in the
 * ordinary way; this only decides which receipt each one is credited to.
 */
export default function RollMappingPage() {
  const [sel, setSel] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [iq, setIq] = useState("");
  const [rq, setRq] = useState("");
  /* Mapping is decided a colour at a time — the floor works through one shade's rolls and
     credits them, then the next. The search box matches colour as a SUBSTRING, so it
     cannot say "only this one". */
  const [colour, setColour] = useState("");
  /** Which rolls the right-hand list is showing: the ones nobody has claimed, the ones on
   *  the selected receipt, or everything in stock. */
  const [view, setView] = useState<"free" | "mine" | "all">("free");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const [party, setParty] = useState("");
  const ordersCall = useFrappeGetCall<{ message: Order[] }>(
    `${API}.orders`,
    {
      search: iq || undefined, only_open: onlyOpen ? 1 : 0,
      party: party || undefined,
    },
    `map-orders-${iq}-${onlyOpen}-${party}`, { keepPreviousData: true },
  );
  const parties = useFrappeGetDocList<{ name: string; party_name?: string }>("MM Party Master", {
    fields: ["name", "party_name"], limit: 0, orderBy: { field: "party_name", order: "asc" },
  });
  const rollsCall = useFrappeGetCall<{ message: Roll[] }>(
    `${API}.rolls`,
    {
      search: rq || undefined,
      color: colour || undefined,
      order: view === "mine" ? sel || "__none__" : undefined,
      unmapped_only: view === "free" ? 1 : 0,
    },
    `map-rolls-${rq}-${colour}-${view}-${view === "mine" ? sel : ""}`, { keepPreviousData: true },
  );
  /* The colours in the pool being shown, not every colour on file: the list narrows with
     the Free / Mine / All view so it can never offer one that would come back empty. */
  const coloursCall = useFrappeGetCall<{ message: { color: string; rolls: number; weight: number }[] }>(
    `${API}.roll_colours`,
    {
      order: view === "mine" ? sel || "__none__" : undefined,
      unmapped_only: view === "free" ? 1 : 0,
    },
    `map-colours-${view}-${view === "mine" ? sel : ""}`, { keepPreviousData: true },
  );
  const colourOpts = useMemo(
    () => (coloursCall.data?.message ?? []).map((c) => ({
      value: c.color,
      label: c.color,
      meta: `${c.rolls} roll${c.rolls === 1 ? "" : "s"} \u00b7 ${kg(c.weight)}`,
    })),
    [coloursCall.data?.message],
  );
  /* A colour picked under one view may not exist under the next — drop it rather than
     silently filtering everything away. */
  useEffect(() => {
    if (colour && colourOpts.length && !colourOpts.some((o) => o.value === colour)) setColour("");
  }, [colourOpts, colour]);
  const { call: assign, loading: assigning } = useFrappePostCall(`${API}.assign_to_order`);
  const { call: unassign, loading: unassigning } = useFrappePostCall(`${API}.unassign_from_order`);

  const orders = ordersCall.data?.message ?? [];
  const rolls = rollsCall.data?.message ?? [];
  const current = orders.find((o) => o.name === sel) || null;
  const picked = useMemo(() => Object.keys(checked).filter((k) => checked[k]), [checked]);
  const pickedKg = useMemo(
    () => rolls.filter((r) => checked[r.name]).reduce((s, r) => s + Number(r.stock_weight || 0), 0),
    [rolls, checked],
  );

  function refresh() {
    void ordersCall.mutate();
    void rollsCall.mutate();
  }

  async function run(fn: () => Promise<unknown>, what: string) {
    try {
      await fn();
      setChecked({});
      refresh();
      toast(what);
    } catch (e) {
      toast(extractErrorMessage(e), "error");
    }
  }

  return (
    <div className="mm-screen">
      <div className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Roll Mapping</h1>
          <p className="mm-page-sub">
            Say which order the rolls in stock answer for. Nothing moves — they are already in
            stock; this decides what each order is credited with, and its Inwards (Kg) follows,
            which is what it may then dispatch.
          </p>
        </div>
        <div className="mm-ws-toolbar-right">
          <button className="mm-mini" onClick={refresh} title="Re-read both lists">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="mm-map-split">
        {/* ── Orders ────────────────────────────────────────── */}
        <section className="mm-card mm-map-pane">
          <div className="mm-map-head">
            <h2>Orders</h2>
            <label className="mm-field-inline" title="Hide orders that already have all their material">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              <span className="mm-field-label">Open only</span>
            </label>
          </div>
          <div className="mm-map-filters">
            <div className="mm-search-box">
              <Search size={15} />
              <input className="mm-input mm-input-compact" placeholder="Order id, party or company…"
                value={iq} onChange={(e) => setIq(e.target.value)} />
            </div>
            <SearchSelect value={party} onChange={setParty} placeholder="All parties"
              className="mm-map-colour" menuMinWidth={260}
              options={(parties.data ?? []).map((p) => ({ value: p.name, label: p.party_name || p.name }))} />
            {(iq || party) && (
              <button type="button" className="mm-mini"
                onClick={() => { setIq(""); setParty(""); }}>Clear</button>
            )}
          </div>
          {ordersCall.isLoading && !orders.length ? (
            <p className="mm-muted">Loading\u2026</p>
          ) : orders.length === 0 ? (
            <p className="mm-flow-empty-state">
              {onlyOpen ? "Every order has all the material it asked for \u2014 untick \u201cOpen only\u201d to see them all."
                : "No orders."}
            </p>
          ) : (
            <div className="mm-map-list">
              {orders.map((o) => {
                const pct = o.ordered_weight > 0
                  ? Math.min(100, Math.round((o.inwarded_weight / o.ordered_weight) * 100)) : 0;
                return (
                  <button type="button" key={o.name}
                    className={`mm-map-row${sel === o.name ? " mm-map-row-active" : ""}`}
                    onClick={() => { setSel(o.name); setChecked({}); }}>
                    <div className="mm-map-row-top">
                      <span className="mm-muted">Order</span>
                      <strong>{o.name}</strong>
                      {o.still_needed <= 0
                        ? <span className="mm-state mm-state-done">covered</span>
                        : <span className="mm-state mm-state-open">{kg(o.still_needed)} short</span>}
                      {/* Backlog, not this week's work. */}
                      {o.is_old && (
                        <span className="mm-state mm-state-old"
                          title={`Order dated ${o.transaction_date} \u2014 on or before 15 Oct 2026`}>old</span>
                      )}
                    </div>
                    <div className="mm-map-row-meta">
                      {o.transaction_date} \u00b7 {o.company_name || o.party || "no party"}
                      {o.colours ? ` \u00b7 ${o.colours}` : ""}
                    </div>
                    <div className="mm-map-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
                    {/* What the order asked for against what it actually has \u2014 including
                        the rolls this page credited, which is the point of the board. */}
                    <div className="mm-map-row-meta">
                      {kg(o.inwarded_weight)} of {kg(o.ordered_weight)}
                      {o.mapped_rolls > 0
                        ? ` \u00b7 ${o.mapped_rolls} roll${o.mapped_rolls === 1 ? "" : "s"} mapped here (${kg(o.mapped_weight)})`
                        : " \u00b7 nothing mapped here yet"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Rolls ────────────────────────────────────────────── */}
        <section className="mm-card mm-map-pane">
          <div className="mm-map-head">
            <h2>Rolls in stock</h2>
            <div className="mm-seg">
              {([["free", "Unmapped"], ["mine", "On this order"], ["all", "All"]] as const).map(([k, label]) => (
                <button key={k} className={`mm-seg-btn${view === k ? " mm-seg-btn-active" : ""}`}
                  disabled={k === "mine" && !sel}
                  onClick={() => { setView(k); setChecked({}); }}>{label}</button>
              ))}
            </div>
          </div>
          <div className="mm-map-filters">
            <div className="mm-search-box">
              <Search size={15} />
              <input className="mm-input mm-input-compact" placeholder="Roll, lot, colour or supplier…"
                value={rq} onChange={(e) => setRq(e.target.value)} />
            </div>
            <SearchSelect value={colour} onChange={setColour} options={colourOpts}
              placeholder="All colours" className="mm-map-colour" menuMinWidth={260}
              emptyText="No colour in this pool." />
            {(rq || colour) && (
              <button type="button" className="mm-mini"
                onClick={() => { setRq(""); setColour(""); }}>Clear</button>
            )}
          </div>

          {!current && <p className="mm-muted">Pick an order on the left to credit rolls to it.</p>}

          {rollsCall.isLoading && !rolls.length ? (
            <p className="mm-muted">Loading…</p>
          ) : rolls.length === 0 ? (
            <p className="mm-flow-empty-state">
              {view === "mine" ? "No roll is credited to this order yet."
                : view === "free" ? "Every roll in stock is already credited to a receipt."
                  : "No roll matches."}
            </p>
          ) : (
            <div className="mm-map-list">
              <table className="mm-table mm-map-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input type="checkbox" aria-label="Select every roll shown"
                        checked={rolls.length > 0 && rolls.every((r) => checked[r.name])}
                        onChange={(e) => setChecked(
                          e.target.checked ? Object.fromEntries(rolls.map((r) => [r.name, true])) : {},
                        )} />
                    </th>
                    <th>Roll</th><th>Lot</th><th>Colour</th>
                    <th className="mm-num">Stock</th><th>Credited to</th>
                  </tr>
                </thead>
                <tbody>
                  {rolls.map((r) => (
                    <tr key={r.name} className={checked[r.name] ? "mm-map-tr-on" : undefined}>
                      <td>
                        <input type="checkbox" checked={!!checked[r.name]}
                          aria-label={`Select roll ${r.roll_no || r.name}`}
                          onChange={(e) => setChecked((p) => ({ ...p, [r.name]: e.target.checked }))} />
                      </td>
                      <td>{r.roll_no || "—"}</td>
                      <td>{r.lot_number || "—"}</td>
                      <td>{r.color_name || "—"}</td>
                      <td className="mm-num">{kg(r.stock_weight)}</td>
                      <td>
                        {r.mapped_inward
                          ? <span title={`Credited with ${kg(r.mapped_weight)}`}>
                              {r.mapped_inward === sel ? "this receipt" : r.mapped_inward}
                            </span>
                          : <span className="mm-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The two actions, with what they are about to do spelled out: crediting rolls
              moves the order's Inwards (Kg) — and with it how much may be dispatched
              against it — so it should never be a mystery click. */}
          <div className="mm-map-actions">
            <span className="mm-muted">
              {picked.length
                ? `${picked.length} roll${picked.length === 1 ? "" : "s"} · ${kg(pickedKg)}`
                : "Tick the rolls to map."}
            </span>
            <button className="mm-mini mm-mini-ok" disabled={!current || !picked.length || assigning}
              title={current
                ? `Credit these rolls to order ${current.name} — its Inwards (Kg) goes up by ${kg(pickedKg)}`
                : "Pick an order first"}
              onClick={() => run(() => assign({ order: sel, rolls: JSON.stringify(picked) }),
                `${picked.length} roll(s) credited to order ${sel}`)}>
              <Link2 size={13} /> Map to order
            </button>
            <button className="mm-mini" disabled={!picked.length || unassigning}
              title="Take these rolls off whatever order they are credited to"
              onClick={() => run(() => unassign({ rolls: JSON.stringify(picked) }), `${picked.length} roll(s) unmapped`)}>
              <Link2Off size={13} /> Unmap
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
