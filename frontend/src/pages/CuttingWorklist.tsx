import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRight, Scissors, CheckCircle2, X, LayoutGrid, List, Plus, Search, PackageSearch } from "lucide-react";
import { extractErrorMessage } from "@/utils/frappeError";
import SearchSelect from "@/components/SearchSelect";

const API = "mahaveermetalic.mahaveer_metallic.api.cutting";
const PROGRAM_API = "mahaveermetalic.mahaveer_metallic.api.program";
const today = () => new Date().toISOString().slice(0, 10);

type Group = {
  customer_order: string;
  party?: string;
  party_name?: string;
  rolls?: string[];
  roll_display?: string;
  entry_count: number;
  total_weight: number;
  latest_inward_date?: string;
};
type Entry = {
  inward_item: string;
  inward_date?: string;
  challan_number?: string;
  customer_order?: string;
  roll_name?: string;
  color_name?: string;
  cut?: string;
  qty_box?: number;
  weight?: number;
  job_work?: number;
};
type OrderOpt = { name: string; delivery_date?: string; required_weight?: number };
type BoardCard = {
  name: string;
  posting_date?: string;
  customer_order?: string;
  roll_no?: string;
  shade?: string;
  cut?: string;
  roll_qty?: number;
  total_patti_qty?: number;
  total_net_weight?: number;
  status?: string;
  program?: string;
  unfinished?: number;
  program_name?: string;
};

const stateClass = (s?: string) => `mm-state mm-state-${(s || "").toLowerCase().replace(/\s+/g, "")}`;
const CUT_STATUSES = ["Draft", "Open", "In Progress", "Completed"];

/**
 * Cutting screen: send order-grouped inward rolls into cutting (worklist), and a flat
 * list view of every cutting. Worklist = left "In Stock" (inward grouped by order) →
 * arrow opens a modal of that order's entries → assign into cutting → right "In Cutting
 * Processing", where a finished cutting becomes a patty for Program.
 */
export default function CuttingWorklist() {
  const [view, setView] = useState<"worklist" | "list">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "list" ? "list" : "worklist",
  );
  const [active, setActive] = useState<Group | null>(null);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<BoardCard | null>(null);
  // In-stock rolls are the FIRST STEP OF STARTING A CUT, not a permanent panel: the screen
  // is otherwise about what is on the floor right now. "New cutting" opens the picker;
  // creating a cutting (or closing it) puts the screen back to the in-cutting board.
  const [picking, setPicking] = useState(false);

  const stock = useFrappeGetCall<{ message: Group[] }>(`${API}.inward_stock_by_order`, undefined, "cut-stock");
  const board = useFrappeGetCall<{ message: BoardCard[] }>(`${API}.cutting_board`, undefined, "cut-board");
  const { call: finish } = useFrappePostCall(`${API}.complete_cutting`);
  const { call: forceClose } = useFrappePostCall("mahaveermetalic.mahaveer_metallic.api.closeout.force_close");

  const groups = stock.data?.message ?? [];
  const cards = board.data?.message ?? [];

  // group cutting cards by Cut → columns
  const byCut = useMemo(() => {
    const m: Record<string, BoardCard[]> = {};
    for (const c of cards) (m[c.cut || "—"] ||= []).push(c);
    return m;
  }, [cards]);
  const cuts = Object.keys(byCut);

  const refreshAll = () => {
    void stock.mutate();
    void board.mutate();
  };

  async function onFinish(name: string) {
    try {
      await finish({ cutting: name });
      refreshAll();
    } catch (e) {
      alert(extractErrorMessage(e));
    }
  }

  // Close this cutting's leftover by hand — it moves to the Close-out stack, revertible.
  async function onForceClose(name: string) {
    if (!window.confirm(`Force close ${name}? Its leftover stops showing as available (revertible from the Close-out stack).`)) return;
    try {
      await forceClose({ doctype: "MM Cutting", name });
      refreshAll();
    } catch (e) {
      alert(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-screen mm-page-enter">
      <header className="mm-ws-toolbar">
        <div>
          <h1 className="mm-page-title">Cutting</h1>
          <p className="mm-page-sub">What is on the floor right now. Hit New cutting to pick an in-stock roll; finished cuttings become patty.</p>
        </div>
        <div className="mm-ws-toolbar-right">
          <div className="mm-seg" role="tablist">
            <button className={`mm-seg-btn ${view === "worklist" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("worklist")}>
              <LayoutGrid size={15} /> Worklist
            </button>
            <button className={`mm-seg-btn ${view === "list" ? "mm-seg-btn-active" : ""}`} onClick={() => setView("list")}>
              <List size={15} /> List
            </button>
          </div>
          <button className="mm-btn-primary mm-btn-compact" onClick={() => { setView("worklist"); setPicking(true); }}>
            <Plus size={15} /> New cutting
          </button>
        </div>
      </header>

      {view === "worklist" ? (
        <>
          {/* In stock rolls — the picker for starting a cut, shown only while doing that. */}
          {picking && (
          <section className="mm-card mm-card-pad" style={{ marginBottom: "1.25rem" }}>
            <div className="mm-cut-panel-head">
              <h2 className="mm-panel-title">In stock roll</h2>
              <div className="mm-cut-panel-acts">
                <button className="mm-mini" onClick={() => setAdding(true)} title="Cut something not tied to an inward entry">
                  <Plus size={13} /> Cut by hand
                </button>
                <button className="mm-icon-btn" aria-label="Close the picker" title="Close" onClick={() => setPicking(false)}>
                  <X size={15} />
                </button>
              </div>
            </div>
            {stock.isLoading && <p className="mm-muted">Loading…</p>}
            {!stock.isLoading && groups.length === 0 && <p className="mm-empty">No in-stock inward against any order.</p>}
            {groups.length > 0 && (
              <div className="mm-table-scroll">
                <table className="mm-table mm-table-hover">
                  <thead>
                    <tr><th>Chalan Date</th><th>Order</th><th>Roll</th><th className="mm-num">Qty</th><th className="mm-num">Weight (Kg)</th><th /></tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.customer_order}>
                        <td>{g.latest_inward_date || "—"}</td>
                        <td>{g.party_name || g.customer_order}</td>
                        <td>{g.roll_display || "—"}</td>
                        <td className="mm-num">{g.entry_count}</td>
                        <td className="mm-num">{(g.total_weight ?? 0).toLocaleString()}</td>
                        <td className="mm-td-actions">
                          <button type="button" className="mm-cut-go" title="Send to cutting" onClick={() => setActive(g)}>
                            <ArrowRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}

          {/* In cutting — grouped by Cut (cut = column, each cutting = a card) */}
          <div className="mm-cut-panel-head"><h2 className="mm-panel-title"><Scissors size={16} /> In cutting — by cut</h2></div>
          {board.isLoading && <p className="mm-muted">Loading…</p>}
          {!board.isLoading && cards.length === 0 && <p className="mm-empty">Nothing in cutting right now.</p>}
          {cards.length > 0 && (
            <div className="mm-cutboard">
              {cuts.map((cut) => (
                <div className="mm-cutcol" key={cut}>
                  <div className="mm-cutcol-head">Cut {cut}</div>
                  <div className="mm-cutcol-body">
                    {byCut[cut].map((c) => (
                      <div className={`mm-prog-card ${c.unfinished ? "mm-prog-card-unfinished" : ""}`} key={c.name}>
                        <div className="mm-prog-card-top">
                          <span className="mm-prog-card-name">{c.roll_no || c.shade || "—"}</span>
                          {c.unfinished ? <span className="mm-state mm-state-unfinished">To cut</span> : <span className={stateClass(c.status)}>{c.status}</span>}
                        </div>
                        <div className="mm-prog-card-meta">
                          {c.customer_order || "—"} · {(c.total_patti_qty ?? 0)} patty · {(c.total_net_weight ?? 0).toLocaleString()} kg{c.unfinished ? " · planned from inventory" : c.program ? " · planned" : ""}
                        </div>
                        <div className="mm-prog-actions">
                          {c.unfinished ? (
                            <button className="mm-mini mm-mini-ok" onClick={() => setFinishing(c)} title="Pick the roll from inventory and finish">
                              <PackageSearch size={13} /> Pick roll &amp; finish
                            </button>
                          ) : c.status !== "Completed" && (
                            <button className="mm-mini mm-mini-ok" onClick={() => void onFinish(c.name)} title="Mark finished (becomes a patty)">
                              <CheckCircle2 size={13} /> Finish
                            </button>
                          )}
                          {/* Always available — closes this cutting's leftover out;
                              it lands on the Close-out stack and can be reverted. */}
                          <button className="mm-mini mm-mini-warn" onClick={() => void onForceClose(c.name)} title="Force close this leftover">
                            Force close
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <CuttingList />
      )}

      {active && (
        <CuttingModal group={active} onClose={() => setActive(null)}
          onDone={() => { setActive(null); setPicking(false); refreshAll(); }} />
      )}
      {adding && (
        <NewCuttingModal onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); setPicking(false); refreshAll(); }} />
      )}
      {finishing && (
        <FinishRollModal card={finishing} onClose={() => setFinishing(null)} onDone={() => { setFinishing(null); refreshAll(); }} />
      )}
    </div>
  );
}

/* ── Finish a "to cut" (planned-from-inventory) card: pick the actual roll ───── */
type InvRoll = {
  name: string; roll_no?: string; lot_number?: string; location?: string;
  color_name?: string; stock_weight?: number; stock_box?: number; available_weight?: number;
};
const ceil2 = (n: number) => Math.ceil(Math.round((Number(n) || 0) * 100 * 1e6) / 1e6) / 100;

function FinishRollModal({ card, onClose, onDone }: { card: BoardCard; onClose: () => void; onDone: () => void }) {
  const colour = card.shade || card.roll_no || "";
  const [allColours, setAllColours] = useState(false);
  // Inward is roll-wise, so list the individual rolls in stock — this colour by default,
  // or every available roll when "all colours" is on.
  const rollsCall = useFrappeGetCall<{ message: InvRoll[] }>(
    `${PROGRAM_API}.program_inventory_search`,
    allColours ? {} : { color: colour },
    `finish-rolls-${card.name}-${allColours ? "all" : "one"}`,
  );
  const { call: finishUnfinished, loading } = useFrappePostCall(`${PROGRAM_API}.finish_unfinished`);
  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options_for_party`,
    card.customer_order ? { customer_order: card.customer_order } : undefined,
    card.customer_order ? `finish-orders-${card.customer_order}` : null,
  );
  const rolls = rollsCall.data?.message ?? [];

  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, InvRoll>>({});
  const [patty, setPatty] = useState<number>(1);
  const [cut, setCut] = useState<string>(card.cut || "");
  const [cuttingDate, setCuttingDate] = useState<string>(today());
  const [order, setOrder] = useState<string>(card.customer_order || "");
  const [jobWork, setJobWork] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const shown = q
    ? rolls.filter((r) => `${r.roll_no || ""} ${r.lot_number || ""} ${r.location || ""} ${r.color_name || ""}`.toLowerCase().includes(q))
    : rolls;

  const chosen = Object.values(picked);
  const totalWeight = chosen.reduce((s, r) => s + Number(r.stock_weight || 0), 0);
  const perPatty = patty > 0 ? ceil2(totalWeight / patty) : 0;
  const toggle = (r: InvRoll) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[r.name]) delete n[r.name];
      else n[r.name] = r;
      return n;
    });

  async function submit() {
    setErr(null);
    if (!card.program) return setErr("This planned cut has no linked program.");
    if (chosen.length === 0) return setErr("Select at least one roll.");
    if (!(patty > 0)) return setErr("Enter the number of patty.");
    try {
      await finishUnfinished({
        program: card.program,
        rolls: JSON.stringify(chosen.map((r) => r.name)),
        no_of_patty: patty,
        cut: cut || undefined,
        cutting_date: cuttingDate,
        customer_order: order || undefined,
        job_work: jobWork ? 1 : 0,
      });
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-modal-scrim mm-scrim-right" onClick={onClose}>
      <div className="mm-modal mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">Cutting — select rolls{colour ? ` · ${colour}` : ""}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <div className="mm-cutpick-head">
            <div className="mm-search-box" style={{ flex: 1 }}>
              <Search size={15} />
              <input className="mm-input mm-input-compact" placeholder="Search roll / lot / location / colour…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="mm-field mm-field-inline" style={{ whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={allColours} onChange={(e) => setAllColours(e.target.checked)} />
              <span className="mm-field-label">All colours</span>
            </label>
          </div>

          {rollsCall.isLoading ? (
            <p className="mm-muted">Loading rolls…</p>
          ) : shown.length === 0 ? (
            <p className="mm-empty">No rolls in stock{allColours ? "" : ` for “${colour}”`}.</p>
          ) : (
            <div className="mm-table-scroll mm-cutpick-table">
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th /><th>Roll</th><th>Colour</th><th>Lot</th><th>Location</th><th className="mm-num">Weight (Kg)</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.name} className={picked[r.name] ? "mm-ws-row-active" : undefined} onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
                      <td><input type="checkbox" checked={!!picked[r.name]} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /></td>
                      <td>{r.roll_no || r.lot_number || r.name}</td>
                      <td>{r.color_name || "—"}</td>
                      <td>{r.lot_number || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td className="mm-num">{(r.stock_weight ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cutting details — auto-filled from the planned cut, editable */}
          <div className="mm-form-grid" style={{ marginTop: "1rem" }}>
            <label className="mm-field">
              <span className="mm-field-label">Customer Order</span>
              <SearchSelect value={order} placeholder={card.customer_order || "— none —"}
                options={(orderOpts.data?.message ?? []).map((o) => ({ value: o.name, label: o.name }))} onChange={setOrder} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cutting Date *</span>
              <input className="mm-input" type="date" value={cuttingDate} onChange={(e) => setCuttingDate(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Qty | Weight (Kg)</span>
              <input className="mm-input" value={`${chosen.length} | ${totalWeight.toLocaleString()}`} readOnly />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">No of Patty *</span>
              <span className="mm-patty-step">
                <button type="button" className="mm-mini" onClick={() => setPatty((p) => Math.max(1, p - 1))}>−</button>
                <input className="mm-input" type="number" min={1} value={patty}
                  onChange={(e) => setPatty(Math.max(1, Number(e.target.value) || 1))} />
                <button type="button" className="mm-mini" onClick={() => setPatty((p) => p + 1)}>+</button>
              </span>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cut</span>
              <input className="mm-input" value={cut} onChange={(e) => setCut(e.target.value)} placeholder="e.g. 50/85" />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>

          <div className="mm-banner" style={{ marginTop: "0.9rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <span>Rolls: <strong>{chosen.length}</strong></span>
            <span>Total weight: <strong>{totalWeight.toLocaleString()} kg</strong></span>
            <span>Per patty: <strong>{perPatty.toLocaleString()} kg</strong></span>
          </div>

          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading || chosen.length === 0} onClick={() => void submit()}>
            {loading ? "Finishing…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── New cutting (manual add) ───────────────────────────── */
function NewCuttingModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { call, loading } = useFrappePostCall(`${API}.create_manual_cutting`);
  const colors = useFrappeGetDocList<{ name: string }>("MM Item Master", { fields: ["name"], limit: 0, orderBy: { field: "name", order: "asc" } }, "cut-colors");
  const colorOptions = (colors.data ?? []).map((c) => c.name);
  const [shade, setShade] = useState("");
  const [cut, setCut] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [patti, setPatti] = useState<number | "">(1);
  const [weight, setWeight] = useState<number | "">("");
  const [jobWork, setJobWork] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!shade.trim()) return setErr("Pick a colour / shade.");
    if (patti === "" || Number(patti) <= 0) return setErr("Enter the number of patty.");
    if (weight === "" || Number(weight) <= 0) return setErr("Enter the weight.");
    try {
      await call({ shade, cut, roll_no: rollNo, patti_qty: patti, weight, cutting_date: today(), job_work: jobWork ? 1 : 0 });
      onDone();
    } catch (e) {
      setErr(extractErrorMessage(e));
    }
  }

  return (
    <div className="mm-modal-scrim" onClick={onClose}>
      <div className="mm-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="mm-modal-head">
          <span className="mm-modal-title">New cutting</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Colour *</span>
              <SearchSelect value={shade} placeholder="— colour —"
                options={colorOptions.map((c) => ({ value: c, label: c }))} onChange={setShade} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cut</span>
              <input className="mm-input" value={cut} placeholder="e.g. 50/85" onChange={(e) => setCut(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Roll no</span>
              <input className="mm-input" value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">No of Patty *</span>
              <input className="mm-input" type="number" min={1} value={patti} onChange={(e) => setPatti(e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Weight (Kg) *</span>
              <input className="mm-input" type="number" value={weight} onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
          </div>
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Create cutting"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Assign modal ───────────────────────────────────────── */
function CuttingModal({ group, onClose, onDone }: { group: Group; onClose: () => void; onDone: () => void }) {
  const entries = useFrappeGetCall<{ message: Entry[] }>(
    `${API}.inward_entries_for_order`, { customer_order: group.customer_order }, `cut-entries-${group.customer_order}`,
  );
  const orderOpts = useFrappeGetCall<{ message: OrderOpt[] }>(
    `${API}.order_options_for_party`, { party: group.party ?? "", customer_order: group.customer_order }, `cut-orders-${group.customer_order}`,
  );
  const { call: create, loading } = useFrappePostCall(`${API}.create_cutting`);

  const rows = entries.data?.message ?? [];
  const orders = orderOpts.data?.message ?? [];

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState(group.customer_order);
  const [jobWork, setJobWork] = useState(false);
  const [cuttingDate, setCuttingDate] = useState(today());
  const [weight, setWeight] = useState<number | "">("");
  const [noPatty, setNoPatty] = useState(1);
  const [cut, setCut] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(() => rows.filter((r) => picked[r.inward_item]), [rows, picked]);
  const selWeight = selected.reduce((s, r) => s + (r.weight || 0), 0);

  function toggle(r: Entry) {
    setPicked((p) => ({ ...p, [r.inward_item]: !p[r.inward_item] }));
    if (!cut && r.cut) setCut(r.cut);
  }

  async function submit() {
    setErr(null);
    if (selected.length === 0) return setErr("Select at least one inward entry.");
    try {
      await create({
        inward_items: selected.map((r) => r.inward_item),
        customer_order: order,
        cut: cut || selected[0].cut,
        weight: weight === "" ? selWeight : weight,
        no_of_patty: noPatty,
        cutting_date: cuttingDate,
        job_work: jobWork ? 1 : 0,
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
          <span className="mm-modal-title">Cutting — {group.party_name || group.customer_order}</span>
          <button className="mm-chat-overlay-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mm-modal-body">
          {entries.isLoading ? (
            <p className="mm-muted">Loading entries…</p>
          ) : rows.length === 0 ? (
            <p className="mm-empty">No in-stock entries for this order.</p>
          ) : (
            <div className="mm-table-scroll" style={{ marginBottom: "1rem" }}>
              <table className="mm-table mm-table-dense">
                <thead>
                  <tr><th /><th>Inward Date</th><th>Chalan No</th><th>Roll</th><th>Cut</th><th className="mm-num">Weight (Kg)</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.inward_item} className={picked[r.inward_item] ? "mm-ws-row-active" : undefined} onClick={() => toggle(r)} style={{ cursor: "pointer" }}>
                      <td><input type="checkbox" checked={!!picked[r.inward_item]} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /></td>
                      <td>{r.inward_date || "—"}</td>
                      <td>{r.challan_number || "—"}</td>
                      <td>{r.roll_name || "—"}</td>
                      <td>{r.cut || "—"}</td>
                      <td className="mm-num">{(r.weight ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mm-form-grid">
            <label className="mm-field">
              <span className="mm-field-label">Customer Order</span>
              <SearchSelect value={order} options={orders.map((o) => ({ value: o.name, label: o.name }))} onChange={setOrder} />
            </label>
            <label className="mm-field mm-field-inline">
              <input type="checkbox" checked={jobWork} onChange={(e) => setJobWork(e.target.checked)} /> <span className="mm-field-label">Is Job Work?</span>
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cutting Date *</span>
              <input className="mm-input" type="date" value={cuttingDate} onChange={(e) => setCuttingDate(e.target.value)} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Weight (Kg) *</span>
              <input className="mm-input" type="number" placeholder={String(selWeight || "")} value={weight} onChange={(e) => setWeight(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">No of Patty *</span>
              <input className="mm-input" type="number" min={1} value={noPatty} onChange={(e) => setNoPatty(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="mm-field">
              <span className="mm-field-label">Cut</span>
              <input className="mm-input" value={cut} onChange={(e) => setCut(e.target.value)} placeholder="Cut" />
            </label>
          </div>
          {err && <p className="mm-error" style={{ marginTop: "0.6rem" }}>{err}</p>}
        </div>
        <div className="mm-modal-foot">
          <span className="mm-muted" style={{ marginRight: "auto" }}>{selected.length} selected · {selWeight.toLocaleString()} kg</span>
          <button className="mm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="mm-btn-primary" disabled={loading} onClick={() => void submit()}>{loading ? "Saving…" : "Submit"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Flat list view (status editable inline) ────────────── */
function CuttingList() {
  const { data, isLoading, mutate } = useFrappeGetDocList<BoardCard & { docstatus?: number }>("MM Cutting", {
    fields: ["name", "posting_date", "customer_order", "roll_no", "cut", "roll_qty", "total_patti_qty", "total_net_weight", "status"],
    filters: [["docstatus", "<", 2]],
    orderBy: { field: "modified", order: "desc" },
    limit: 200,
  });
  const { call: setStatus } = useFrappePostCall(`${API}.set_cutting_status`);
  const rows = data ?? [];

  async function onStatus(name: string, status: string) {
    try {
      await setStatus({ cutting: name, status });
      void mutate();
    } catch (e) {
      alert(extractErrorMessage(e));
    }
  }

  return (
    <section className="mm-card mm-card-pad">
      {isLoading && <p className="mm-muted">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="mm-empty">No cuttings yet.</p>}
      {rows.length > 0 && (
        <div className="mm-table-scroll">
          <table className="mm-table mm-table-hover">
            <thead>
              <tr><th>Date</th><th>Order</th><th>Roll</th><th>Cut</th><th className="mm-num">Roll | Patty</th><th className="mm-num">Net Wt</th><th>Status (editable)</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>{c.posting_date || "—"}</td>
                  <td>{c.customer_order || "—"}</td>
                  <td>{c.roll_no || "—"}</td>
                  <td>{c.cut || "—"}</td>
                  <td className="mm-num">{c.roll_qty ?? 0} | {(c.total_patti_qty ?? 0).toLocaleString()}</td>
                  <td className="mm-num">{(c.total_net_weight ?? 0).toLocaleString()}</td>
                  <td>
                    <select
                      className={`mm-input mm-input-compact mm-status-select ${stateClass(c.status)}`}
                      value={c.status || "Draft"}
                      onChange={(e) => void onStatus(c.name, e.target.value)}
                    >
                      {CUT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
