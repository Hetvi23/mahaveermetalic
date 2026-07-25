import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { Check, CheckCircle2, RefreshCw, Scissors, X } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";

const API = "mahaveermetalic.mahaveer_metallic.api";

type Machine = { name: string; machine_no: string; cut?: string; closed?: number };
type Program = {
  name: string; roll_no?: string; shade?: string; machine_no?: string; cut?: string; status?: string;
  unfinished?: number; is_running?: number; released?: number; completed_batches?: number; total_batches?: number;
  net_weight?: number; remark?: string; roll_inventory?: string;
};
type StockGroup = { customer_order: string; party?: string; party_name?: string; roll_display?: string; entry_count: number; total_weight: number };
type BoardCard = { name: string; roll_no?: string; shade?: string; cut?: string; unfinished?: number; program_name?: string; total_net_weight?: number };
type Patty = { cutting?: string; roll_no?: string; shade?: string; cut?: string; party?: string; batches?: number; weight?: number };
type InvRoll = { name: string; roll_no?: string; lot_number?: string; location?: string; color_name?: string; available_weight?: number; stock_weight?: number };

const n = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const chip = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;

/**
 * Flow — the whole cutting→program pipeline on one screen (Layout B): the machine board
 * on top, then two shelves below (rolls waiting to be cut, and finished patties ready to
 * program). Read-first, with one-tap forward actions; deeper edits open the dedicated
 * Cutting / Program screens.
 */
export default function FlowScreen() {
  const nav = useNavigate();
  const [finishing, setFinishing] = useState<{ program: string; shade?: string } | null>(null);

  const machinesCall = useFrappeGetCall<{ message: Machine[] }>(`${API}.program.list_machines`, undefined, "flow-machines");
  const progCall = useFrappeGetCall<{ message: Program[] }>(`${API}.program.threads_processing`, undefined, "flow-threads");
  const stockCall = useFrappeGetCall<{ message: StockGroup[] }>(`${API}.cutting.inward_stock_by_order`, undefined, "flow-stock");
  const boardCall = useFrappeGetCall<{ message: BoardCard[] }>(`${API}.cutting.cutting_board`, undefined, "flow-cutboard");
  const pattyCall = useFrappeGetCall<{ message: Patty[] }>(`${API}.program.available_rolls`, { finished_only: 1 }, "flow-patties");

  const { call: complete } = useFrappePostCall(`${API}.program.complete_batches`);
  const { call: free } = useFrappePostCall(`${API}.program.free_program`);

  const machines = machinesCall.data?.message ?? [];
  const programs = useMemo(() => progCall.data?.message ?? [], [progCall.data]);
  const stock = stockCall.data?.message ?? [];
  const unfinishedCuts = useMemo(() => (boardCall.data?.message ?? []).filter((c) => c.unfinished), [boardCall.data]);
  const patties = pattyCall.data?.message ?? [];

  const byMachine = useMemo(() => {
    const m: Record<string, Program[]> = {};
    for (const p of programs) (m[p.machine_no || "—"] ||= []).push(p);
    return m;
  }, [programs]);

  const kpis = {
    toCut: stock.reduce((s, g) => s + (g.entry_count || 0), 0),
    patties: patties.length,
    running: programs.filter((p) => !p.unfinished).length,
    unfinished: programs.filter((p) => p.unfinished).length,
  };

  const refresh = () => { machinesCall.mutate(); progCall.mutate(); stockCall.mutate(); boardCall.mutate(); pattyCall.mutate(); };
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); refresh(); } catch (e) { alert(extractErrorMessage(e)); } };

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-screen-head">
        <div>
          <h1 className="mm-page-title"><Scissors size={20} /> Flow</h1>
          <p className="mm-page-sub">Rolls to cut, finished patties, and what's running on each machine — one screen. Tap a card to move it forward.</p>
        </div>
        <button type="button" className="mm-btn-secondary mm-btn-compact" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
      </header>

      <div className="mm-kpis mm-inv-kpis">
        <div className="mm-kpi mm-kpi-amber"><span className="mm-kpi-value">{kpis.toCut}</span><span className="mm-kpi-label">To cut</span></div>
        <div className="mm-kpi mm-kpi-green"><span className="mm-kpi-value">{kpis.patties}</span><span className="mm-kpi-label">Patties ready</span></div>
        <div className="mm-kpi mm-kpi-blue"><span className="mm-kpi-value">{kpis.running}</span><span className="mm-kpi-label">Programs running</span></div>
        <div className={`mm-kpi ${kpis.unfinished ? "mm-kpi-danger" : "mm-kpi-slate"}`}><span className="mm-kpi-value">{kpis.unfinished}</span><span className="mm-kpi-label">Unfinished</span></div>
      </div>

      {/* ── ③ Machine board ── */}
      <div className="mm-flow-shelf-head"><span className="mm-flow-num">3</span><h2>On machines</h2>
        <span className="mm-flow-count">{machines.length} machines</span>
        <button type="button" className="mm-mini" style={{ marginLeft: "auto" }} onClick={() => nav("/program")}>Open Program board →</button>
      </div>
      <section className="mm-card mm-card-pad" style={{ marginBottom: "1.4rem" }}>
        {machinesCall.isLoading ? <p className="mm-muted">Loading…</p> : (
          <div className="mm-table-scroll">
            <table className="mm-table mm-table-dense">
              <thead><tr><th style={{ width: 170 }}>Machine</th><th>Programs</th></tr></thead>
              <tbody>
                {machines.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <div className="mm-flow-mach-cell">
                        <span style={{ fontWeight: 700 }}>🖥 Machine {m.machine_no}</span>
                        <span className={`mm-pill ${m.cut ? "mm-pill-muted" : "mm-pill-pending"}`}>{m.cut || "no cut"}</span>
                        {m.closed ? <span className="mm-state mm-state-open">closed</span> : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                        {(byMachine[m.name] || []).length === 0 && (
                          <button type="button" className="mm-mini" onClick={() => nav("/program")}>+ Add program</button>
                        )}
                        {(byMachine[m.name] || []).map((p) => (
                          <div key={p.name} className={`mm-flow-card ${p.unfinished ? "mm-flow-card-red" : "mm-flow-card-cut"}`} style={{ minWidth: 230 }}>
                            <div className="mm-prog-card-top">
                              <span className="mm-flow-card-name">{p.roll_no || p.shade || "—"}</span>
                              {p.unfinished ? <span className="mm-state mm-state-unfinished">Unfinished</span> : <span className={chip(p.status)}>{p.status}</span>}
                            </div>
                            <div className="mm-prog-card-meta">
                              {p.cut || "—"} · {p.completed_batches ?? 0}/{p.total_batches ?? 0} batches · {p.unfinished ? "roll not picked" : `${n(p.net_weight)} kg`}
                            </div>
                            <div className="mm-prog-actions">
                              {p.unfinished ? (
                                <button className="mm-mini mm-mini-ok" onClick={() => setFinishing({ program: p.name, shade: p.shade })}><CheckCircle2 size={13} /> Finish (pick roll)</button>
                              ) : (
                                <>
                                  <button className="mm-mini" disabled={(p.completed_batches ?? 0) >= (p.total_batches ?? 0)} onClick={act(() => complete({ program: p.name, count: 1 }))}><Check size={13} /> Complete</button>
                                  {p.status === "Completed" && <button className="mm-mini mm-mini-ok" onClick={act(() => free({ program: p.name }))}><CheckCircle2 size={13} /> Free</button>}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── ① Rolls to cut ── */}
      <div className="mm-flow-shelf-head"><span className="mm-flow-num">1</span><h2>Rolls to cut</h2>
        <span className="mm-flow-count">{stock.length + unfinishedCuts.length}</span>
      </div>
      {stock.length === 0 && unfinishedCuts.length === 0 ? (
        <p className="mm-flow-empty-state">Nothing waiting to be cut.</p>
      ) : (
        <div className="mm-flow-shelf">
          {stock.map((g) => (
            <article key={g.customer_order} className="mm-flow-card mm-flow-card-cut">
              <div className="mm-prog-card-top"><span className="mm-flow-card-name">{g.party_name || g.party || "—"}</span><span className="mm-state mm-state-inventory">stock</span></div>
              <div className="mm-prog-card-meta">{g.roll_display || "—"}</div>
              <div className="mm-prog-card-meta">Order {g.customer_order} · {g.entry_count} roll(s) · <strong>{n(g.total_weight)} kg</strong></div>
              <div className="mm-prog-actions"><button className="mm-btn-primary mm-btn-compact" onClick={() => nav("/cutting")}>→ Send to cutting</button></div>
            </article>
          ))}
          {unfinishedCuts.map((c) => (
            <article key={c.name} className="mm-flow-card mm-flow-card-red">
              <div className="mm-prog-card-top"><span className="mm-flow-card-name" style={{ color: "#b91c1c" }}>{c.shade || c.roll_no || "—"}</span><span className="mm-state mm-state-unfinished">to cut</span></div>
              <div className="mm-prog-card-meta">{c.cut || "—"} · planned from inventory · roll not picked</div>
              <div className="mm-prog-actions">
                {c.program_name && <button className="mm-mini mm-mini-ok" onClick={() => setFinishing({ program: c.program_name!, shade: c.shade })}><CheckCircle2 size={13} /> Finish (pick roll)</button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── ② Finished patties ── */}
      <div className="mm-flow-shelf-head" style={{ marginTop: "1.2rem" }}><span className="mm-flow-num">2</span><h2>Finished patties</h2>
        <span className="mm-flow-count">{patties.length} ready</span>
      </div>
      {patties.length === 0 ? (
        <p className="mm-flow-empty-state">No finished patties waiting to program.</p>
      ) : (
        <div className="mm-flow-shelf">
          {patties.map((p, i) => (
            <article key={p.cutting || i} className="mm-flow-card mm-flow-card-patty">
              <div className="mm-prog-card-top"><span className="mm-flow-card-name">{p.roll_no || p.shade || "—"}</span><span className="mm-state mm-state-cut">cut</span></div>
              <div className="mm-prog-card-meta">Cut {p.cut || "—"} · {p.batches ?? 0} patty · <strong>{n(p.weight)} kg</strong></div>
              {p.party && <div className="mm-prog-card-meta">{p.party}</div>}
              <div className="mm-prog-actions"><button className="mm-btn-primary mm-btn-compact" onClick={() => nav("/program")}>→ Program it</button></div>
            </article>
          ))}
        </div>
      )}

      {finishing && <FinishModal program={finishing.program} shade={finishing.shade} onClose={() => setFinishing(null)} onDone={() => { setFinishing(null); refresh(); }} />}
    </div>
  );
}

/* Finish an unfinished program by picking the actual roll from inventory (matched by colour). */
function FinishModal({ program, shade, onClose, onDone }: { program: string; shade?: string; onClose: () => void; onDone: () => void }) {
  const color = shade || "";
  const rollsCall = useFrappeGetCall<{ message: InvRoll[] }>(`${API}.program.program_inventory_search`, { color }, `flow-finish-${color}`);
  const { call: finish, loading } = useFrappePostCall(`${API}.program.finish_unfinished`);
  const rolls = rollsCall.data?.message ?? [];
  const [roll, setRoll] = useState<InvRoll | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!roll) return setErr("Pick the roll from inventory to finish.");
    try { await finish({ program, roll_inventory: roll.name }); onDone(); } catch (e) { setErr(extractErrorMessage(e)); }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Finish — pick the {color || "roll"} roll</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <p className="mm-muted" style={{ marginTop: 0, fontSize: "0.8rem" }}>Its full weight is fetched onto the program and taken out of stock.</p>
          {rollsCall.isLoading ? <p className="mm-muted">Loading…</p> : rolls.length === 0 ? (
            <p className="mm-empty">No {color} rolls in stock.</p>
          ) : (
            <div style={{ maxHeight: 260, overflow: "auto" }}>
              {rolls.map((r) => (
                <div key={r.name} className={`mm-pick-row ${roll?.name === r.name ? "mm-pick-row-active" : ""}`} onClick={() => setRoll(r)}>
                  <span>{r.roll_no || r.color_name || "—"}{r.lot_number ? ` · ${r.lot_number}` : ""}{r.location ? ` · ${r.location}` : ""}</span>
                  <span className="mm-prog-card-meta">{n(r.available_weight ?? r.stock_weight)} kg</span>
                </div>
              ))}
            </div>
          )}
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading || !roll} onClick={() => void submit()}>{loading ? "Finishing…" : roll ? `Finish · ${n(roll.available_weight ?? roll.stock_weight)} kg` : "Finish"}</button>
        </div>
      </div>
    </div>
  );
}
