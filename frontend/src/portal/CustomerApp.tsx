import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Bell, CalendarDays, ChevronRight, Disc3, Home, ListOrdered, Package, Plus, Search, Trash2, Truck,
} from "lucide-react";
import { toast } from "@/components/Toaster";
import { call, fmtDate, fmtKg, fmtNum, PORTAL, refreshAll, todayISO, useApi } from "./api";
import Notifications from "./Notifications";
import PortalShell, { type Tab } from "./PortalShell";
import { Async, Chips, Empty, ErrorBox, Field, Pill, Progress, Sheet, Stat, useAction } from "./ui";

const BASE = "/c";

type Line = { color: string; cut?: string; weight: number; box: number; delivery_date?: string };
type Order = {
  name: string; company_name?: string; transaction_date: string; delivery_date?: string; stage: string;
  approval: string; fulfilment: string; ordered_weight: number; ordered_box: number; dispatched_weight: number;
  dispatched_box: number; pending_weight: number; colours: string; lines: Line[]; state_reason?: string;
  placed_via?: string; customer_remarks?: string;
};
type Challan = {
  name: string; challan_no?: string; transaction_date: string; company_name?: string; total_weight: number;
  total_box: number; vehicle_no?: string; transport?: string; orders: string; lines: { color: string; box: number; weight: number }[];
};
type Me = { party_name?: string; threshold?: number };

export default function CustomerApp({ me }: { me: Me }) {
  const tabs: Tab[] = [
    { to: BASE, label: "Home", icon: Home, end: true },
    { to: `${BASE}/orders`, label: "Orders", icon: ListOrdered },
    { to: `${BASE}/new`, label: "New order", icon: Plus, primary: true },
    { to: `${BASE}/bobbins`, label: "Bobbins", icon: Disc3 },
    { to: `${BASE}/alerts`, label: "Alerts", icon: Bell },
  ];
  return (
    <PortalShell base={BASE} title="Mahaveer Metalic" subtitle={me.party_name} tabs={tabs}>
      <Routes>
        <Route index element={<CustomerHome />} />
        <Route path="orders" element={<CustomerOrders />} />
        <Route path="orders/:name" element={<CustomerOrder />} />
        <Route path="new" element={<NewOrder />} />
        <Route path="bobbins" element={<Bobbins />} />
        <Route path="deliveries" element={<Deliveries />} />
        <Route path="alerts" element={<Notifications />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </PortalShell>
  );
}

// ------------------------------------------------------------------------- home

type HomeData = {
  kpis: { open_orders: number; pending_weight: number; requested: number };
  threshold: { threshold: number; active_weight: number; below: boolean };
  today: Challan[];
  recent: Order[];
};

function CustomerHome() {
  const state = useApi<HomeData>(`${PORTAL}.customer_home`, {}, 120000);
  const nav = useNavigate();
  return (
    <div className="pt-page">
      <Async state={state} rows={4}>
        {(d) => (
          <>
            {d.threshold.below && (
              <div className="pt-alert pt-alert-warn">
                <AlertTriangle size={20} />
                <div>
                  <strong>Running low on orders</strong>
                  <div>
                    You have {fmtKg(d.threshold.active_weight)} on order — below your usual {fmtKg(d.threshold.threshold)}.
                  </div>
                </div>
                <Link to={`${BASE}/new`} className="pt-btn pt-btn-primary pt-btn-sm">Order now</Link>
              </div>
            )}
            <div className="pt-stats">
              <Stat label="Open orders" value={d.kpis.open_orders} onClick={() => nav(`${BASE}/orders?stage=open`)} />
              <Stat label="Still to deliver" value={fmtKg(d.kpis.pending_weight)} tone="accent" />
              <Stat label="Waiting approval" value={d.kpis.requested} onClick={() => nav(`${BASE}/orders?stage=requested`)} />
              <Stat label="Delivered today" value={d.today.length ? fmtKg(d.today.reduce((s, c) => s + c.total_weight, 0)) : "—"} tone={d.today.length ? "ok" : undefined} />
            </div>

            <div className="pt-section-head">
              <h2><Truck size={18} /> Today's delivery</h2>
              <Link to={`${BASE}/deliveries`} className="pt-link">All deliveries</Link>
            </div>
            {d.today.length === 0
              ? <Empty title="Nothing dispatched today yet">A challan made today will show up here.</Empty>
              : <div className="pt-list">{d.today.map((c) => <ChallanCard key={c.name} c={c} />)}</div>}

            <div className="pt-section-head">
              <h2><ListOrdered size={18} /> Recent orders</h2>
              <Link to={`${BASE}/orders`} className="pt-link">See all</Link>
            </div>
            {d.recent.length === 0
              ? <Empty title="No orders yet"><Link to={`${BASE}/new`} className="pt-link">Place your first order</Link></Empty>
              : <div className="pt-list">{d.recent.map((o) => <OrderCard key={o.name} o={o} />)}</div>}
          </>
        )}
      </Async>
    </div>
  );
}

function ChallanCard({ c }: { c: Challan }) {
  return (
    <div className="pt-card">
      <div className="pt-row-top">
        <span className="pt-strong">{c.challan_no ? `Challan ${c.challan_no}` : c.name}</span>
        <span className="pt-muted pt-small">{fmtDate(c.transaction_date)}</span>
      </div>
      <div className="pt-lines">
        {c.lines.map((l) => (
          <div key={l.color} className="pt-line">
            <span>{l.color}</span>
            <span className="pt-num">{l.box ? `${fmtNum(l.box)} box · ` : ""}{fmtKg(l.weight)}</span>
          </div>
        ))}
      </div>
      <div className="pt-row-foot pt-muted pt-small">
        <span>{c.orders ? `Order ${c.orders}` : ""}{c.company_name ? ` · ${c.company_name}` : ""}</span>
        <span>{[c.vehicle_no, c.transport].filter(Boolean).join(" · ")}</span>
      </div>
    </div>
  );
}

function OrderCard({ o }: { o: Order }) {
  const delivered = o.ordered_box > 0 ? o.dispatched_box : o.dispatched_weight;
  const total = o.ordered_box > 0 ? o.ordered_box : o.ordered_weight;
  return (
    <Link to={`${BASE}/orders/${encodeURIComponent(o.name)}`} className="pt-card pt-card-link">
      <div className="pt-row-top">
        <span className="pt-strong">#{o.name} · {o.colours || "—"}</span>
        <Pill>{o.stage}</Pill>
      </div>
      <div className="pt-row-mid pt-muted pt-small">
        <span>Ordered {fmtDate(o.transaction_date)}</span>
        {o.delivery_date && <span><CalendarDays size={13} /> Due {fmtDate(o.delivery_date)}</span>}
      </div>
      {["Confirmed", "Part delivered", "Delivered"].includes(o.stage) && (
        <>
          <Progress value={delivered} max={total} tone={o.stage === "Delivered" ? "ok" : undefined} />
          <div className="pt-row-foot pt-small">
            <span>{o.ordered_box > 0 ? `${fmtNum(o.dispatched_box)} of ${fmtNum(o.ordered_box)} box` : `${fmtKg(o.dispatched_weight)} of ${fmtKg(o.ordered_weight)}`}</span>
            <ChevronRight size={16} />
          </div>
        </>
      )}
      {!["Confirmed", "Part delivered", "Delivered"].includes(o.stage) && (
        <div className="pt-row-foot pt-small">
          <span>{fmtKg(o.ordered_weight)}{o.ordered_box ? ` · ${fmtNum(o.ordered_box)} box` : ""}</span>
          <ChevronRight size={16} />
        </div>
      )}
    </Link>
  );
}

// ------------------------------------------------------------------------- orders

type Stage = "open" | "requested" | "delivered" | "closed" | "all";

function CustomerOrders() {
  const initial = (new URLSearchParams(window.location.search).get("stage") as Stage) || "open";
  const [stage, setStage] = useState<Stage>(initial);
  const [search, setSearch] = useState("");
  const [colour, setColour] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showDates, setShowDates] = useState(false);
  const state = useApi<Order[]>(`${PORTAL}.customer_orders`, { stage, search, colour, from_date: from, to_date: to });

  return (
    <div className="pt-page">
      <h1 className="pt-title">My orders</h1>
      <Chips<Stage>
        value={stage}
        onChange={setStage}
        options={[
          { value: "open", label: "Open" },
          { value: "requested", label: "Awaiting" },
          { value: "delivered", label: "Delivered" },
          { value: "closed", label: "Rejected / cancelled" },
          { value: "all", label: "All" },
        ]}
      />
      <div className="pt-filters">
        <div className="pt-search">
          <Search size={16} />
          <input inputMode="numeric" placeholder="Order no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="pt-search">
          <Package size={16} />
          <input placeholder="Colour" value={colour} onChange={(e) => setColour(e.target.value)} />
        </div>
        <button type="button" className={`pt-btn pt-btn-ghost pt-btn-sm ${showDates || from || to ? "pt-btn-on" : ""}`} onClick={() => setShowDates((v) => !v)}>
          <CalendarDays size={16} /> Dates
        </button>
      </div>
      {showDates && (
        <div className="pt-daterange">
          <Field label="From"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          {(from || to) && <button type="button" className="pt-link" onClick={() => { setFrom(""); setTo(""); }}>Clear</button>}
        </div>
      )}
      <Async state={state} empty={(d) => !d.length} emptyTitle="No orders match">
        {(d) => (
          <>
            <div className="pt-muted pt-small pt-count">{d.length} order{d.length === 1 ? "" : "s"} · {fmtKg(d.reduce((s, o) => s + o.ordered_weight, 0))}</div>
            <div className="pt-list">{d.map((o) => <OrderCard key={o.name} o={o} />)}</div>
          </>
        )}
      </Async>
    </div>
  );
}

function CustomerOrder() {
  const { name = "" } = useParams();
  const state = useApi<Order & { challans: Challan[] }>(`${PORTAL}.customer_order`, { order: name });
  const nav = useNavigate();
  const { busy, run } = useAction();

  async function withdraw() {
    if (!window.confirm(`Withdraw order request #${name}?`)) return;
    await run(async () => {
      try {
        await call(`${PORTAL}.withdraw_request`, { order: name }, { post: true });
        toast(`Order #${name} withdrawn`, "info");
        refreshAll();
        nav(`${BASE}/orders`);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });
  }

  return (
    <div className="pt-page">
      <button type="button" className="pt-back" onClick={() => nav(-1)}>‹ Back</button>
      <Async state={state}>
        {(o) => (
          <>
            <div className="pt-title-row">
              <h1 className="pt-title">Order #{o.name}</h1>
              <Pill>{o.stage}</Pill>
            </div>
            <div className="pt-card">
              <div className="pt-kv"><span>Ordered on</span><span>{fmtDate(o.transaction_date)}</span></div>
              {o.delivery_date && <div className="pt-kv"><span>Delivery by</span><span>{fmtDate(o.delivery_date)}</span></div>}
              {o.company_name && <div className="pt-kv"><span>Firm</span><span>{o.company_name}</span></div>}
              <div className="pt-kv"><span>Ordered</span><span>{fmtKg(o.ordered_weight)}{o.ordered_box ? ` · ${fmtNum(o.ordered_box)} box` : ""}</span></div>
              <div className="pt-kv"><span>Delivered</span><span>{fmtKg(o.dispatched_weight)}{o.dispatched_box ? ` · ${fmtNum(o.dispatched_box)} box` : ""}</span></div>
              {o.pending_weight > 0 && <div className="pt-kv"><span>Still to come</span><span className="pt-strong">{fmtKg(o.pending_weight)}</span></div>}
              {["Confirmed", "Part delivered", "Delivered"].includes(o.stage) && (
                <Progress value={o.ordered_box > 0 ? o.dispatched_box : o.dispatched_weight} max={o.ordered_box > 0 ? o.ordered_box : o.ordered_weight} tone={o.stage === "Delivered" ? "ok" : undefined} />
              )}
              {o.state_reason && ["Rejected", "Cancelled"].includes(o.stage) && (
                <div className="pt-note-box">Reason: {o.state_reason}</div>
              )}
              {o.customer_remarks && <div className="pt-note-box">Your note: {o.customer_remarks}</div>}
            </div>

            <h2 className="pt-h2">Items</h2>
            <div className="pt-card pt-table-card">
              {o.lines.map((l, i) => (
                <div key={i} className="pt-line">
                  <span>
                    <span className="pt-strong">{l.color}</span>
                    {l.cut && <span className="pt-muted pt-small"> · size {l.cut}</span>}
                  </span>
                  <span className="pt-num">{fmtKg(l.weight)}{l.box ? ` · ${fmtNum(l.box)} box` : ""}</span>
                </div>
              ))}
            </div>

            <h2 className="pt-h2">Deliveries</h2>
            {o.challans.length === 0
              ? <Empty title="Nothing delivered yet" />
              : <div className="pt-list">{o.challans.map((c) => <ChallanCard key={c.name} c={c} />)}</div>}

            {o.stage === "Requested" && (
              <button type="button" className="pt-btn pt-btn-danger pt-btn-block" disabled={busy} onClick={() => void withdraw()}>
                Withdraw request
              </button>
            )}
          </>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------------- new order

type FormData = { usual: string[]; colours: string[]; companies: string[] };
type Draft = { key: number; color: string; weight: string; box: string; cut: string; date: string };

let seq = 1;
const blank = (date = ""): Draft => ({ key: seq++, color: "", weight: "", box: "", cut: "", date });

function NewOrder() {
  const form = useApi<FormData>(`${PORTAL}.customer_order_form`);
  const [lines, setLines] = useState<Draft[]>([blank()]);
  const [company, setCompany] = useState("");
  const [date, setDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState<string[] | null>(null);
  const [serverError, setServerError] = useState<Error | null>(null);
  const { busy, run } = useAction();
  const nav = useNavigate();

  const set = (key: number, patch: Partial<Draft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  function validate(): boolean {
    const errs: Record<number, string> = {};
    const today = todayISO();
    for (const l of lines) {
      if (!l.color) errs[l.key] = "Choose a colour";
      else if (!(Number(l.weight) > 0)) errs[l.key] = "Enter the weight in kg";
      else if (l.box && Number(l.box) < 0) errs[l.key] = "Boxes can't be negative";
      else if (l.cut && /[a-z]/i.test(l.cut)) errs[l.key] = "Size is digits only, e.g. 50/85";
      else if (l.date && l.date < today) errs[l.key] = "Delivery date can't be in the past";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    setServerError(null);
    if (!validate()) {
      toast("Please fix the highlighted lines", "error");
      return;
    }
    await run(async () => {
      try {
        const res = await call<{ orders: string[] }>(`${PORTAL}.place_order`, {
          items: lines.map((l) => ({
            color_name: l.color, qty_weight: Number(l.weight), qty_box: Number(l.box) || 0,
            cut: l.cut.trim(), delivery_date: l.date || undefined,
          })),
          delivery_date: date || undefined,
          remarks,
          company_name: company || undefined,
        }, { post: true });
        setDone(res.orders);
        refreshAll();
      } catch (e) {
        setServerError(e as Error);
      }
    });
  }

  if (done) {
    return (
      <div className="pt-page pt-done">
        <div className="pt-done-icon">✓</div>
        <h1 className="pt-title">Order sent</h1>
        <p className="pt-muted">
          Mahaveer will review it shortly. You'll get a notification when it's accepted.
          <br />Order no. {done.map((n) => `#${n}`).join(", ")}
        </p>
        <div className="pt-actions pt-actions-center">
          <button type="button" className="pt-btn pt-btn-primary" onClick={() => nav(`${BASE}/orders?stage=requested`)}>View my orders</button>
          <button type="button" className="pt-btn pt-btn-ghost" onClick={() => { setDone(null); setLines([blank()]); setRemarks(""); setDate(""); }}>Place another</button>
        </div>
      </div>
    );
  }

  const total = lines.reduce((s, l) => s + (Number(l.weight) || 0), 0);

  return (
    <div className="pt-page">
      <h1 className="pt-title">New order</h1>
      <Async state={form}>
        {(f) => (
          <>
            {f.companies.length > 1 && (
              <Field label="Firm">
                <select value={company} onChange={(e) => setCompany(e.target.value)}>
                  <option value="">Choose…</option>
                  {f.companies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <Field label="Delivery by (optional)">
              <input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </Field>

            <h2 className="pt-h2">Items</h2>
            {lines.map((l, i) => (
              <div key={l.key} className={`pt-card pt-order-line ${errors[l.key] ? "pt-card-error" : ""}`}>
                <div className="pt-row-top">
                  <span className="pt-muted pt-small">Item {i + 1}</span>
                  {lines.length > 1 && (
                    <button type="button" className="pt-icon-btn" aria-label="Remove item" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                <button type="button" className={`pt-picker ${l.color ? "" : "pt-picker-empty"}`} onClick={() => setPicking(l.key)}>
                  {l.color || "Choose colour"} <ChevronRight size={18} />
                </button>
                <div className="pt-grid2">
                  <Field label="Weight (kg)">
                    <input type="number" inputMode="decimal" min={0} step="any" value={l.weight} onChange={(e) => set(l.key, { weight: e.target.value })} placeholder="0" />
                  </Field>
                  <Field label="Boxes (optional)">
                    <input type="number" inputMode="numeric" min={0} step="1" value={l.box} onChange={(e) => set(l.key, { box: e.target.value })} placeholder="—" />
                  </Field>
                  <Field label="Size (optional)">
                    <input inputMode="numeric" value={l.cut} onChange={(e) => set(l.key, { cut: e.target.value })} placeholder="e.g. 50/85" />
                  </Field>
                  <Field label="Delivery by">
                    <input type="date" value={l.date} min={todayISO()} onChange={(e) => set(l.key, { date: e.target.value })} />
                  </Field>
                </div>
                {errors[l.key] && <div className="pt-field-error">{errors[l.key]}</div>}
              </div>
            ))}
            <button type="button" className="pt-btn pt-btn-ghost pt-btn-block" onClick={() => setLines((ls) => [...ls, blank(date)])} disabled={lines.length >= 20}>
              <Plus size={16} /> Add another colour
            </button>

            <Field label="Note for Mahaveer (optional)">
              <textarea rows={3} value={remarks} maxLength={1000} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything we should know" />
            </Field>

            {serverError && <ErrorBox error={serverError} />}
            <div className="pt-submit-bar">
              <span className="pt-small"><span className="pt-muted">Total</span> <strong>{fmtKg(total)}</strong></span>
              <button type="button" className="pt-btn pt-btn-primary" disabled={busy} onClick={() => void submit()}>
                {busy ? "Sending…" : "Send order"}
              </button>
            </div>

            <ColourSheet
              open={picking !== null}
              usual={f.usual}
              colours={f.colours}
              onClose={() => setPicking(null)}
              onPick={(c) => { if (picking !== null) set(picking, { color: c }); setPicking(null); }}
            />
          </>
        )}
      </Async>
    </div>
  );
}

function ColourSheet({ open, usual, colours, onClose, onPick }: {
  open: boolean; usual: string[]; colours: string[]; onClose: () => void; onPick: (c: string) => void;
}) {
  const [q, setQ] = useState("");
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = useMemo(() => {
    const k = key(q);
    return k ? colours.filter((c) => key(c).includes(k)).slice(0, 80) : [];
  }, [q, colours]);
  return (
    <Sheet title="Choose colour" open={open} onClose={() => { setQ(""); onClose(); }}>
      <div className="pt-search pt-search-lg">
        <Search size={18} />
        <input autoFocus placeholder="Search colour" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!q && usual.length > 0 && <div className="pt-group-label">Your usual colours</div>}
      <div className="pt-pick-list">
        {(q ? matches : usual.length ? usual : colours.slice(0, 80)).map((c) => (
          <button key={c} type="button" className="pt-pick" onClick={() => { setQ(""); onPick(c); }}>{c}</button>
        ))}
        {q && matches.length === 0 && <Empty title="No colour matches">Ask Mahaveer to add it, or mention it in the note.</Empty>}
      </div>
      {!q && <div className="pt-muted pt-small pt-center">Type to search all {colours.length} colours</div>}
    </Sheet>
  );
}

// ------------------------------------------------------------------------- bobbins

type BobbinRow = {
  date: string; voucher_type: string; voucher_no: string; bobbin: string; in_qty: number; out_qty: number;
  qty: number; balance_qty: number; box: number;
};
type BobbinData = {
  from_date: string; to_date: string;
  statement: { opening_qty: number; closing_qty: number; opening_box: number; closing_box: number; rows: BobbinRow[] };
  balances: { bobbin: string; qty: number; box: number }[];
};

function Bobbins() {
  const [from, setFrom] = useState(todayISO(-90));
  const [to, setTo] = useState(todayISO());
  const state = useApi<BobbinData>(`${PORTAL}.customer_bobbins`, { from_date: from, to_date: to });
  return (
    <div className="pt-page">
      <h1 className="pt-title">Bobbin statement</h1>
      <div className="pt-daterange">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || todayISO(-90))} /></Field>
        <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || todayISO())} /></Field>
      </div>
      <Async state={state}>
        {(d) => (
          <>
            <h2 className="pt-h2">Balance now</h2>
            {d.balances.length === 0
              ? <Empty title="No bobbins outstanding" />
              : (
                <div className="pt-stats">
                  {d.balances.map((b) => (
                    <Stat key={b.bobbin} label={b.bobbin} value={fmtNum(b.qty)} sub={b.box ? `${fmtNum(b.box)} box` : undefined} />
                  ))}
                </div>
              )}
            <h2 className="pt-h2">Movements</h2>
            <div className="pt-card pt-table-card">
              <div className="pt-line pt-line-head"><span>Opening</span><span className="pt-num">{fmtNum(d.statement.opening_qty)}</span></div>
              {d.statement.rows.length === 0 && <div className="pt-muted pt-small pt-pad">No movement in these dates.</div>}
              {d.statement.rows.map((r, i) => (
                <div key={`${r.voucher_no}-${r.bobbin}-${i}`} className="pt-bob">
                  <div className="pt-bob-main">
                    <span className="pt-strong">{r.bobbin}</span>
                    <span className="pt-muted pt-small">{fmtDate(r.date)} · {r.voucher_type} {r.voucher_no}</span>
                  </div>
                  <span className={`pt-num ${r.qty < 0 ? "pt-neg" : "pt-pos"}`}>{r.qty > 0 ? "+" : ""}{fmtNum(r.qty)}</span>
                  <span className="pt-num pt-muted">{fmtNum(r.balance_qty)}</span>
                </div>
              ))}
              <div className="pt-line pt-line-head"><span>Closing</span><span className="pt-num">{fmtNum(d.statement.closing_qty)}</span></div>
            </div>
          </>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------------- deliveries

function Deliveries() {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const state = useApi<Challan[]>(`${PORTAL}.customer_deliveries`, { from_date: from, to_date: to });
  return (
    <div className="pt-page">
      <h1 className="pt-title">Deliveries</h1>
      <div className="pt-daterange">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || todayISO(-30))} /></Field>
        <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || todayISO())} /></Field>
      </div>
      <Async state={state} empty={(d) => !d.length} emptyTitle="No deliveries in these dates">
        {(d) => (
          <>
            <div className="pt-muted pt-small pt-count">{d.length} challan{d.length === 1 ? "" : "s"} · {fmtKg(d.reduce((s, c) => s + c.total_weight, 0))}</div>
            <div className="pt-list">{d.map((c) => <ChallanCard key={c.name} c={c} />)}</div>
          </>
        )}
      </Async>
    </div>
  );
}
