import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Link2, Link2Off, Lock, RefreshCw, Search } from "lucide-react";
import { toast } from "@/components/Toaster";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api.mapping";

type Inward = {
  name: string; posting_date: string; party?: string; company_name?: string;
  challan_number?: string; lot_number?: string; receipt_status: string;
  expected_weight: number; mapped_weight: number; still_due: number;
  mapped_rolls: number; locked: boolean; sales_order?: string;
};
type Roll = {
  name: string; roll_no?: string; lot_number?: string; color_name?: string;
  supplier?: string; location?: string; stock_weight: number;
  mapped_inward?: string | null; mapped_weight?: number;
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
  /** Which rolls the right-hand list is showing: the ones nobody has claimed, the ones on
   *  the selected receipt, or everything in stock. */
  const [view, setView] = useState<"free" | "mine" | "all">("free");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const inwardsCall = useFrappeGetCall<{ message: Inward[] }>(
    `${API}.inwards`, { search: iq || undefined, only_open: onlyOpen ? 1 : 0 },
    `map-inwards-${iq}-${onlyOpen}`, { keepPreviousData: true },
  );
  const rollsCall = useFrappeGetCall<{ message: Roll[] }>(
    `${API}.rolls`,
    {
      search: rq || undefined,
      inward: view === "mine" ? sel || "__none__" : undefined,
      unmapped_only: view === "free" ? 1 : 0,
    },
    `map-rolls-${rq}-${view}-${view === "mine" ? sel : ""}`, { keepPreviousData: true },
  );
  const { call: assign, loading: assigning } = useFrappePostCall(`${API}.assign`);
  const { call: unassign, loading: unassigning } = useFrappePostCall(`${API}.unassign`);

  const inwards = inwardsCall.data?.message ?? [];
  const rolls = rollsCall.data?.message ?? [];
  const current = inwards.find((i) => i.name === sel) || null;
  const picked = useMemo(() => Object.keys(checked).filter((k) => checked[k]), [checked]);
  const pickedKg = useMemo(
    () => rolls.filter((r) => checked[r.name]).reduce((s, r) => s + Number(r.stock_weight || 0), 0),
    [rolls, checked],
  );

  function refresh() {
    void inwardsCall.mutate();
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
            Say which rolls answer for which receipt. Nothing moves — the rolls are already in
            stock; this decides what each receipt is credited with, and its Partial/Complete
            status follows.
          </p>
        </div>
        <div className="mm-ws-toolbar-right">
          <button className="mm-mini" onClick={refresh} title="Re-read both lists">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="mm-map-split">
        {/* ── Receipts ─────────────────────────────────────────── */}
        <section className="mm-card mm-map-pane">
          <div className="mm-map-head">
            <h2>Receipts</h2>
            <label className="mm-field-inline" title="Hide receipts already settled">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              <span className="mm-field-label">Open only</span>
            </label>
          </div>
          <div className="mm-search-box">
            <Search size={15} />
            <input className="mm-input mm-input-compact" placeholder="Inward, challan, party or lot…"
              value={iq} onChange={(e) => setIq(e.target.value)} />
          </div>
          {inwardsCall.isLoading && !inwards.length ? (
            <p className="mm-muted">Loading…</p>
          ) : inwards.length === 0 ? (
            <p className="mm-flow-empty-state">
              {onlyOpen ? "No receipt is waiting — untick “Open only” to see settled ones." : "No receipts."}
            </p>
          ) : (
            <div className="mm-map-list">
              {inwards.map((i) => {
                const pct = i.expected_weight > 0
                  ? Math.min(100, Math.round((i.mapped_weight / i.expected_weight) * 100)) : 0;
                return (
                  <button type="button" key={i.name}
                    className={`mm-map-row${sel === i.name ? " mm-map-row-active" : ""}`}
                    onClick={() => { setSel(i.name); setChecked({}); }}>
                    <div className="mm-map-row-top">
                      <strong>{i.challan_number || i.name}</strong>
                      <span className={i.receipt_status === "Complete" ? "mm-state mm-state-done" : "mm-state mm-state-open"}>
                        {i.receipt_status}
                      </span>
                      {i.locked && (
                        <span className="mm-state" title="This challan was closed by another receipt — its mapping is fixed">
                          <Lock size={11} /> closed
                        </span>
                      )}
                    </div>
                    <div className="mm-map-row-meta">
                      {i.posting_date} · {i.party || "—"}
                      {i.lot_number ? ` · lot ${i.lot_number}` : ""}
                    </div>
                    <div className="mm-map-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
                    {/* A receipt nobody has mapped yet is not short — it is untouched, and
                        saying "147 kg still due" beside the word Complete reads as a
                        contradiction on every historic receipt the day this page opens. */}
                    <div className="mm-map-row-meta">
                      {i.mapped_rolls === 0
                        ? `Nothing mapped yet · expected ${kg(i.expected_weight)}`
                        : `${kg(i.mapped_weight)} of ${kg(i.expected_weight)}`
                          + (i.still_due > 0 ? ` · ${kg(i.still_due)} still due` : " · settled")
                          + ` · ${i.mapped_rolls} roll${i.mapped_rolls === 1 ? "" : "s"}`}
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
              {([["free", "Unmapped"], ["mine", "On this receipt"], ["all", "All"]] as const).map(([k, label]) => (
                <button key={k} className={`mm-seg-btn${view === k ? " mm-seg-btn-active" : ""}`}
                  disabled={k === "mine" && !sel}
                  onClick={() => { setView(k); setChecked({}); }}>{label}</button>
              ))}
            </div>
          </div>
          <div className="mm-search-box">
            <Search size={15} />
            <input className="mm-input mm-input-compact" placeholder="Roll, lot, colour or supplier…"
              value={rq} onChange={(e) => setRq(e.target.value)} />
          </div>

          {!current && <p className="mm-muted">Pick a receipt on the left to map rolls to it.</p>}

          {rollsCall.isLoading && !rolls.length ? (
            <p className="mm-muted">Loading…</p>
          ) : rolls.length === 0 ? (
            <p className="mm-flow-empty-state">
              {view === "mine" ? "No roll is credited to this receipt yet."
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

          {/* The two actions, with what they are about to do spelled out: a mapping changes
              a submitted receipt's status, so it should never be a mystery click. */}
          <div className="mm-map-actions">
            <span className="mm-muted">
              {picked.length
                ? `${picked.length} roll${picked.length === 1 ? "" : "s"} · ${kg(pickedKg)}`
                : "Tick the rolls to map."}
            </span>
            <button className="mm-mini mm-mini-ok" disabled={!current || !picked.length || assigning || !!current?.locked}
              title={current?.locked
                ? "This challan is closed — its mapping is fixed"
                : current ? `Credit these rolls to ${current.challan_number || current.name}` : "Pick a receipt first"}
              onClick={() => run(() => assign({ inward: sel, rolls: JSON.stringify(picked) }),
                `${picked.length} roll(s) credited to ${current?.challan_number || sel}`)}>
              <Link2 size={13} /> Map to receipt
            </button>
            <button className="mm-mini" disabled={!picked.length || unassigning}
              title="Take these rolls off whatever receipt they are credited to"
              onClick={() => run(() => unassign({ rolls: JSON.stringify(picked) }), `${picked.length} roll(s) unmapped`)}>
              <Link2Off size={13} /> Unmap
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
