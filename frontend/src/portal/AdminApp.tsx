import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Bell, CalendarDays, Check, ClipboardCheck, ExternalLink, Factory, Flame, ListTodo, Plus, Search,
  ShoppingBag, Trash2, Truck, X,
} from "lucide-react";
import { toast } from "@/components/Toaster";
import { call, fmtAgo, fmtDate, fmtKg, fmtNum, PORTAL, refreshAll, todayISO, useApi } from "./api";
import { useUnread } from "./Notifications";
import { registerServiceWorker, resyncPush } from "./pwa";
import { PurchaseCard, type PurchaseRow } from "./SupplierApp";
import { Async, Chips, Empty, ErrorBoundary, ErrorBox, Field, Pill, Sheet, Stat, useAction } from "./ui";

const SO_API = "mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order";
const HISAB_API = "mahaveermetalic.mahaveer_metallic.api.job_hisab";

type Me = { is_admin?: boolean; is_accounts?: boolean; can_mark_urgent?: boolean; full_name?: string };
type TabKey = "approvals" | "deliveries" | "purchase" | "floor" | "vm" | "followups";

type Counts = {
  approvals: number; requests: number; deliveries_today: number; dispatched_kg: number; purchase_pending: number;
  purchase_urgent: number; purchase_overdue: number; floor_pending: number; follow_ups: number;
};

export default function AdminApp() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "approvals";
  const setTab = (t: TabKey) => setParams({ tab: t }, { replace: true });
  const me = useApi<Me>(`${PORTAL}.me`);
  const home = useApi<{ counts: Counts; floor_days: number }>(`${PORTAL}.admin_home`, {}, 120000);
  const unread = useUnread();
  const c = home.data?.counts;

  useEffect(() => {
    void registerServiceWorker().then(() => resyncPush());
  }, []);

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "approvals", label: "Approvals", count: c?.approvals },
    { value: "deliveries", label: "Deliveries", count: c?.deliveries_today },
    { value: "purchase", label: "Purchase pending", count: c?.purchase_pending },
    { value: "floor", label: "Order pending", count: c?.floor_pending },
    { value: "followups", label: "Follow-ups", count: c?.follow_ups },
    ...(me.data?.is_admin ? [{ value: "vm" as TabKey, label: "Order to Veer Metlon" }] : []),
  ];

  return (
    <div className="pt-admin">
      <div className="pt-admin-head">
        <div>
          <h1 className="pt-title">Today</h1>
          <div className="pt-muted pt-small">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <Link to="/alerts" className="pt-icon-btn pt-bell" aria-label="Notifications">
          <Bell size={20} />
          {unread > 0 && <span className="pt-badge">{unread > 99 ? "99+" : unread}</span>}
        </Link>
      </div>

      {c && (
        <div className="pt-stats pt-stats-6">
          <Stat label="Waiting approval" value={c.approvals} tone={c.requests ? "accent" : undefined}
            sub={c.requests ? `${c.requests} from customers` : undefined} onClick={() => setTab("approvals")} />
          <Stat label="Dispatched today" value={fmtKg(c.dispatched_kg)} sub={`${c.deliveries_today} challan(s)`} onClick={() => setTab("deliveries")} />
          <Stat label="Purchase pending" value={c.purchase_pending} tone={c.purchase_urgent ? "bad" : undefined}
            sub={[c.purchase_urgent ? `${c.purchase_urgent} urgent` : "", c.purchase_overdue ? `${c.purchase_overdue} late` : ""].filter(Boolean).join(" · ") || undefined}
            onClick={() => setTab("purchase")} />
          <Stat label={`Uncut ${home.data?.floor_days ?? 5}+ days`} value={c.floor_pending} tone={c.floor_pending ? "warn" : undefined} onClick={() => setTab("floor")} />
          <Stat label="Follow-ups" value={c.follow_ups} onClick={() => setTab("followups")} />
        </div>
      )}
      {home.error && !home.data && <ErrorBox error={home.error} onRetry={home.reload} />}

      <Chips<TabKey> value={tab} onChange={setTab} options={tabs} />

      <ErrorBoundary key={tab}>
        {tab === "approvals" && <Approvals me={me.data} />}
        {tab === "deliveries" && <DeliveriesTab me={me.data} />}
        {tab === "purchase" && <PurchaseTab me={me.data} />}
        {tab === "floor" && <FloorTab days={home.data?.floor_days} />}
        {tab === "vm" && <VmOrder />}
        {tab === "followups" && <FollowUps />}
      </ErrorBoundary>
    </div>
  );
}

// ------------------------------------------------------------------------- approvals

type ApprovalOrder = {
  name: string; party_name: string; colours: string; ordered_weight: number; ordered_box: number;
  transaction_date: string; delivery_date?: string; approval: string; placed_via?: string; customer_remarks?: string;
  state_reason?: string; lines: { color: string; cut?: string; weight: number; box: number }[]; urgent: boolean;
};
type Hisab = {
  name: string; job_out: string; party_name: string; posting_date: string; status: string; out_weight: number;
  in_weight: number; wastage_weight: number; wastage_percent: number; wastage_over_limit: number; total_amount: number;
  next_step: string; action: string | null; who: "admin" | "accounts" | null;
};

function Approvals({ me }: { me?: Me }) {
  const state = useApi<{ orders: ApprovalOrder[]; hisabs: Hisab[] }>(`${PORTAL}.admin_approvals`, {}, 60000);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [billFor, setBillFor] = useState<string | null>(null);
  const { busy, run } = useAction();

  async function act(label: string, method: string, args: Record<string, unknown>) {
    await run(async () => {
      try {
        await call(method, args, { post: true });
        toast(label);
        refreshAll();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });
  }

  return (
    <Async state={state}>
      {(d) => (
        <>
          <div className="pt-section-head"><h2><ShoppingBag size={18} /> Orders</h2></div>
          {d.orders.length === 0 ? <Empty title="No orders waiting" /> : (
            <div className="pt-list">
              {d.orders.map((o) => (
                <div key={o.name} className={`pt-card ${o.approval === "New" ? "pt-card-accent" : ""}`}>
                  <div className="pt-row-top">
                    <span className="pt-strong">#{o.name} · {o.party_name}</span>
                    <span className="pt-pills">
                      {o.urgent && <Pill tone="bad"><Flame size={12} /> Urgent</Pill>}
                      <Pill tone={o.approval === "New" ? "accent" : o.approval === "Rejected" ? "bad" : "info"}>
                        {o.approval === "New" ? "Customer request" : o.approval === "Pending" ? "Draft" : o.approval}
                      </Pill>
                    </span>
                  </div>
                  <div className="pt-lines">
                    {o.lines.map((l, i) => (
                      <div key={i} className="pt-line">
                        <span>{l.color}{l.cut ? <span className="pt-muted pt-small"> · {l.cut}</span> : null}</span>
                        <span className="pt-num">{fmtKg(l.weight)}{l.box ? ` · ${fmtNum(l.box)} box` : ""}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-row-foot pt-small pt-muted">
                    <span>{fmtDate(o.transaction_date)}{o.delivery_date ? ` · due ${fmtDate(o.delivery_date)}` : ""}</span>
                    {o.placed_via && <span>via {o.placed_via}</span>}
                  </div>
                  {o.customer_remarks && <div className="pt-note-box">Customer: {o.customer_remarks}</div>}
                  {o.state_reason && o.approval === "Rejected" && <div className="pt-note-box">Rejected: {o.state_reason}</div>}
                  <div className="pt-actions">
                    {me?.is_admin && o.approval === "New" && (
                      <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" disabled={busy}
                        onClick={() => void act(`Order #${o.name} accepted into drafts`, `${PORTAL}.accept_request`, { order: o.name })}>
                        <Check size={16} /> Accept
                      </button>
                    )}
                    {me?.is_admin && o.approval !== "New" && (
                      <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" disabled={busy}
                        onClick={() => void act(`Order #${o.name} approved`, `${SO_API}.approve_order`, { sales_order: o.name })}>
                        <Check size={16} /> Approve
                      </button>
                    )}
                    {me?.is_admin && o.approval !== "Rejected" && (
                      <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" disabled={busy} onClick={() => setRejecting(o.name)}>
                        <X size={16} /> Reject
                      </button>
                    )}
                    <Link to={`/sales-order?order=${encodeURIComponent(o.name)}`} className="pt-btn pt-btn-ghost pt-btn-sm">
                      <ExternalLink size={16} /> Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-section-head"><h2><ClipboardCheck size={18} /> Job hisab</h2></div>
          {d.hisabs.length === 0 ? <Empty title="No hisab waiting" /> : (
            <div className="pt-list">
              {d.hisabs.map((h) => {
                const mine = (h.who === "admin" && me?.is_admin) || (h.who === "accounts" && me?.is_accounts);
                return (
                  <div key={h.name} className="pt-card">
                    <div className="pt-row-top">
                      <span className="pt-strong">{h.party_name}</span>
                      <Pill tone="info">{h.status}</Pill>
                    </div>
                    <div className="pt-kv"><span>Job out</span><span>{h.job_out} · {fmtDate(h.posting_date)}</span></div>
                    <div className="pt-kv"><span>Out / In</span><span>{fmtKg(h.out_weight)} / {fmtKg(h.in_weight)}</span></div>
                    <div className="pt-kv">
                      <span>Wastage</span>
                      <span className={h.wastage_over_limit ? "pt-neg" : ""}>
                        {fmtKg(h.wastage_weight)} ({fmtNum(h.wastage_percent)}%){h.wastage_over_limit ? " · over limit" : ""}
                      </span>
                    </div>
                    {!!h.total_amount && <div className="pt-kv"><span>Amount</span><span>₹ {fmtNum(h.total_amount)}</span></div>}
                    <div className="pt-row-foot pt-small"><span className="pt-muted">Next: {h.next_step}</span></div>
                    <div className="pt-actions">
                      {mine && h.action === "enter_bill" && (
                        <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" disabled={busy} onClick={() => setBillFor(h.name)}>Enter bill no.</button>
                      )}
                      {mine && h.action && h.action !== "enter_bill" && (
                        <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" disabled={busy}
                          onClick={() => void act(`Hisab ${h.next_step.toLowerCase()} done`, `${HISAB_API}.${h.action}`, { name: h.name })}>
                          <Check size={16} /> {h.action === "final_approve" ? "Final approve" : "Approve"}
                        </button>
                      )}
                      {!mine && <span className="pt-muted pt-small">Waiting on {h.who === "admin" ? "the admin" : "accounts"}</span>}
                      <Link to="/job-hisab" className="pt-btn pt-btn-ghost pt-btn-sm"><ExternalLink size={16} /> Open</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ReasonSheet
            open={!!rejecting}
            title={`Reject order #${rejecting ?? ""}`}
            label="Reason (the customer sees this)"
            onClose={() => setRejecting(null)}
            onSubmit={async (reason) => {
              const name = rejecting!;
              setRejecting(null);
              await act(`Order #${name} sent back`, `${SO_API}.reject_order`, { sales_order: name, reason });
            }}
          />
          <ReasonSheet
            open={!!billFor}
            title="Enter bill number"
            label="Bill no."
            required
            onClose={() => setBillFor(null)}
            onSubmit={async (bill) => {
              const name = billFor!;
              setBillFor(null);
              await act("Bill number saved", `${HISAB_API}.enter_bill`, { name, bill_no: bill });
            }}
          />
        </>
      )}
    </Async>
  );
}

function ReasonSheet({ open, title, label, required, onClose, onSubmit }: {
  open: boolean; title: string; label: string; required?: boolean; onClose: () => void; onSubmit: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState("");
  useEffect(() => { if (open) setV(""); }, [open]);
  return (
    <Sheet
      title={title}
      open={open}
      onClose={onClose}
      footer={
        <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={required && !v.trim()} onClick={() => void onSubmit(v.trim())}>
          Save
        </button>
      }
    >
      <Field label={label}>
        <textarea rows={3} autoFocus value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
    </Sheet>
  );
}

// ------------------------------------------------------------------------- deliveries

type Challan = {
  name: string; challan_no?: string; party_name: string; company_name?: string; total_weight: number; total_box: number;
  orders: string; vehicle_no?: string; lines: { color: string; box: number; weight: number }[];
};
type DueOrder = {
  name: string; party_name: string; colours: string; pending_weight: number; ordered_weight: number;
  dispatched_weight: number; delivery_date: string; overdue_days: number; urgent: boolean;
};

function UrgentButton({ doctype, name, urgent, me }: { doctype: string; name: string; urgent: boolean; me?: Me }) {
  const { busy, run } = useAction();
  if (!me?.can_mark_urgent) return urgent ? <Pill tone="bad"><Flame size={12} /> Urgent</Pill> : null;
  return (
    <button
      type="button"
      className={`pt-btn pt-btn-sm ${urgent ? "pt-btn-danger" : "pt-btn-ghost"}`}
      disabled={busy}
      onClick={() => void run(async () => {
        try {
          const r = await call<{ suppliers_told: string[]; note?: string }>(`${PORTAL}.set_urgent`, { doctype, name, urgent: urgent ? 0 : 1 }, { post: true });
          if (!urgent) toast(r.suppliers_told.length ? `Urgent — ${r.suppliers_told.join(", ")} notified` : (r.note || "Marked urgent"), r.suppliers_told.length ? "success" : "info");
          else toast("Urgent flag cleared", "info");
          refreshAll();
        } catch (e) {
          toast((e as Error).message, "error");
        }
      })}
    >
      <Flame size={16} /> {urgent ? "Urgent" : "Mark urgent"}
    </button>
  );
}

function DeliveriesTab({ me }: { me?: Me }) {
  const [day, setDay] = useState(todayISO());
  const state = useApi<{ dispatched: Challan[]; dispatched_kg: number; due: DueOrder[] }>(`${PORTAL}.deliveries`, { day }, 120000);
  return (
    <>
      <div className="pt-daterange">
        <Field label="Day"><input type="date" value={day} onChange={(e) => setDay(e.target.value || todayISO())} /></Field>
      </div>
      <Async state={state}>
        {(d) => (
          <>
            <div className="pt-section-head">
              <h2><Truck size={18} /> Dispatched</h2>
              <span className="pt-muted pt-small">{d.dispatched.length} challan(s) · {fmtKg(d.dispatched_kg)}</span>
            </div>
            {d.dispatched.length === 0 ? <Empty title="No challan on this day" /> : (
              <div className="pt-list">
                {d.dispatched.map((c) => (
                  <div key={c.name} className="pt-card">
                    <div className="pt-row-top">
                      <span className="pt-strong">{c.party_name}</span>
                      <span className="pt-muted pt-small">{c.challan_no || c.name}</span>
                    </div>
                    <div className="pt-lines">
                      {c.lines.map((l) => (
                        <div key={l.color} className="pt-line"><span>{l.color}</span><span className="pt-num">{l.box ? `${fmtNum(l.box)} box · ` : ""}{fmtKg(l.weight)}</span></div>
                      ))}
                    </div>
                    <div className="pt-row-foot pt-small pt-muted"><span>{c.orders ? `Order ${c.orders}` : "No order"}</span><span>{c.vehicle_no}</span></div>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-section-head">
              <h2><CalendarDays size={18} /> Due by this day, not delivered</h2>
              <span className="pt-muted pt-small">{d.due.length}</span>
            </div>
            {d.due.length === 0 ? <Empty title="Nothing due" /> : (
              <div className="pt-list">
                {d.due.map((o) => (
                  <div key={o.name} className={`pt-card ${o.urgent ? "pt-card-urgent" : ""}`}>
                    <div className="pt-row-top">
                      <span className="pt-strong">#{o.name} · {o.party_name}</span>
                      {o.overdue_days > 0 ? <Pill tone="bad">{o.overdue_days} d late</Pill> : <Pill tone="warn">Due</Pill>}
                    </div>
                    <div className="pt-row-mid">{o.colours}</div>
                    <div className="pt-row-foot pt-small">
                      <span>{fmtKg(o.dispatched_weight)} of {fmtKg(o.ordered_weight)} sent · <strong>{fmtKg(o.pending_weight)} left</strong></span>
                      <span className="pt-muted">due {fmtDate(o.delivery_date)}</span>
                    </div>
                    <div className="pt-actions">
                      <UrgentButton doctype="MM Sales Order" name={o.name} urgent={o.urgent} me={me} />
                      <Link to={`/sales-order?order=${encodeURIComponent(o.name)}`} className="pt-btn pt-btn-ghost pt-btn-sm"><ExternalLink size={16} /> Open</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}

// ------------------------------------------------------------------------- purchase

function PurchaseTab({ me }: { me?: Me }) {
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const state = useApi<{ rows: PurchaseRow[]; suppliers: string[] }>(`${PORTAL}.purchase_pending`, { supplier, search }, 120000);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  useEffect(() => {
    if (!supplier && state.data?.suppliers) setSuppliers(state.data.suppliers);
  }, [state.data, supplier]);
  return (
    <>
      <div className="pt-filters">
        <select className="pt-select" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Supplier">
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="pt-search">
          <Search size={16} />
          <input placeholder="Order no. or colour" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Async state={state} empty={(d) => !d.rows.length} emptyTitle="Nothing pending from suppliers">
        {(d) => (
          <>
            <div className="pt-muted pt-small pt-count">{d.rows.length} pending · {fmtKg(d.rows.reduce((s, r) => s + r.pending, 0))}</div>
            <div className="pt-list">
              {d.rows.map((r) => (
                <PurchaseCard key={r.name} r={r} showSupplier action={<UrgentButton doctype="MM Purchase Order" name={r.name} urgent={r.urgent} me={me} />} />
              ))}
            </div>
          </>
        )}
      </Async>
    </>
  );
}

// ------------------------------------------------------------------------- floor pending

type FloorRow = { order: string; color: string; lot?: string; party_name?: string; rolls: number; weight: number; oldest: string; days: number; challans: string };

function FloorTab({ days }: { days?: number }) {
  const [d, setD] = useState<string>("");
  const state = useApi<{ days: number; rows: FloorRow[] }>(`${PORTAL}.floor_pending`, { days: d }, 300000);
  const shown = state.data?.days ?? days ?? 5;
  return (
    <>
      <div className="pt-filters">
        <Field label="Not cut for at least (days)">
          <input type="number" inputMode="numeric" min={1} value={d} placeholder={String(shown)} onChange={(e) => setD(e.target.value)} />
        </Field>
      </div>
      <p className="pt-muted pt-small">Rolls received against an order and not yet taken into cutting or a program.</p>
      <Async state={state} empty={(x) => !x.rows.length} emptyTitle={`Nothing waiting more than ${shown} days`}>
        {(x) => (
          <>
            <div className="pt-muted pt-small pt-count">{x.rows.length} lot(s) · {fmtKg(x.rows.reduce((s, r) => s + r.weight, 0))}</div>
            <div className="pt-list">
              {x.rows.map((r) => (
                <div key={`${r.order}-${r.color}-${r.lot}`} className="pt-card">
                  <div className="pt-row-top">
                    <span className="pt-strong">#{r.order} · {r.color}</span>
                    <Pill tone={r.days > shown * 2 ? "bad" : "warn"}>{r.days} days</Pill>
                  </div>
                  <div className="pt-row-mid pt-small">{r.party_name}{r.lot ? ` · lot ${r.lot}` : ""}</div>
                  <div className="pt-row-foot pt-small">
                    <span>{r.rolls} roll(s) · <strong>{fmtKg(r.weight)}</strong></span>
                    <span className="pt-muted">in since {fmtDate(r.oldest)}{r.challans ? ` · ch ${r.challans}` : ""}</span>
                  </div>
                </div>
              ))}
            </div>
            <Link to="/cutting" className="pt-btn pt-btn-ghost pt-btn-block"><Factory size={16} /> Go to cutting</Link>
          </>
        )}
      </Async>
    </>
  );
}

// ------------------------------------------------------------------------- Veer Metlon

type VmForm = { configured: boolean; vm_customer?: string; vm_vendor?: string; lacquers: string[]; customers: string[]; error?: string };
type VmLine = { key: number; colour: string; qty: string; rate: string };
let vmSeq = 1;

function VmOrder() {
  const state = useApi<VmForm>(`${PORTAL}.vm_order_form`);
  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<VmLine[]>([{ key: vmSeq++, colour: "", qty: "", rate: "" }]);
  const [date, setDate] = useState("");
  const [terms, setTerms] = useState("");
  const [order, setOrder] = useState("");
  const [result, setResult] = useState<{ vm_order: string; purchase_orders: string[] } | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (state.data?.vm_customer && !customer) setCustomer(state.data.vm_customer);
  }, [state.data, customer]);

  const set = (key: number, patch: Partial<VmLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = customer && lines.every((l) => l.colour && Number(l.qty) > 0 && Number(l.rate) > 0);

  async function submit() {
    setErr(null);
    if (!valid) { toast("Fill colour, kg and rate on every line", "error"); return; }
    if (!window.confirm(`Place this order with Veer Metlon under "${customer}"?`)) return;
    await run(async () => {
      try {
        const r = await call<{ vm_order: string; purchase_orders: string[] }>(`${PORTAL}.place_vm_order`, {
          items: lines.map((l) => ({ colour: l.colour, quantity: Number(l.qty), rate: Number(l.rate) })),
          vm_customer: customer, payment_terms: terms || undefined, delivery_date: date || undefined,
          sales_order: order.trim() || undefined,
        }, { post: true });
        setResult(r);
        refreshAll();
      } catch (e) {
        setErr(e as Error);
      }
    });
  }

  if (result) {
    return (
      <div className="pt-card pt-done">
        <div className="pt-done-icon">✓</div>
        <h2>Placed with Veer Metlon as {result.vm_order}</h2>
        <p className="pt-muted">Recorded here as purchase order {result.purchase_orders.join(", ")} — it now shows under Purchase pending.</p>
        <button type="button" className="pt-btn pt-btn-primary" onClick={() => { setResult(null); setLines([{ key: vmSeq++, colour: "", qty: "", rate: "" }]); }}>Place another</button>
      </div>
    );
  }

  return (
    <Async state={state}>
      {(f) => (
        <>
          {(f.error || !f.configured) && <ErrorBox error={new Error(f.error || "Veer Metlon is not connected.")} onRetry={state.reload} />}
          {f.configured && !f.vm_vendor && (
            <div className="pt-alert pt-alert-warn"><AlertTriangle size={18} /> Set “Veer Metlon as Supplier” in MM Veermetlon Settings before placing orders.</div>
          )}
          <Field label="Book under (customer in Veer Metlon)">
            <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Choose…</option>
              {f.customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <datalist id="vm-lacquers">{f.lacquers.map((l) => <option key={l} value={l} />)}</datalist>
          {lines.map((l, i) => (
            <div key={l.key} className="pt-card pt-order-line">
              <div className="pt-row-top">
                <span className="pt-muted pt-small">Colour {i + 1}</span>
                {lines.length > 1 && (
                  <button type="button" className="pt-icon-btn" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={18} /></button>
                )}
              </div>
              <Field label="Colour (as in Veer Metlon)">
                <input list="vm-lacquers" value={l.colour} onChange={(e) => set(l.key, { colour: e.target.value })} placeholder="Search…" />
              </Field>
              {l.colour && !f.lacquers.includes(l.colour) && <div className="pt-field-error">Not a Veer Metlon colour — pick one from the list.</div>}
              <div className="pt-grid2">
                <Field label="Quantity (kg)"><input type="number" inputMode="decimal" min={0} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></Field>
                <Field label="Rate (₹/kg)"><input type="number" inputMode="decimal" min={0} value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} /></Field>
              </div>
            </div>
          ))}
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-block" onClick={() => setLines((ls) => [...ls, { key: vmSeq++, colour: "", qty: "", rate: "" }])}>
            <Plus size={16} /> Add colour
          </button>
          <div className="pt-grid2">
            <Field label="Delivery by (optional)"><input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Payment terms (days)"><input type="number" inputMode="numeric" min={0} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
          </div>
          <Field label="For our order no. (optional)" hint="Links the purchase to a customer order here.">
            <input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
          </Field>
          {err && <ErrorBox error={err} />}
          <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={busy || !f.configured || !valid || lines.some((l) => !f.lacquers.includes(l.colour))} onClick={() => void submit()}>
            {busy ? "Placing…" : "Place order with Veer Metlon"}
          </button>
        </>
      )}
    </Async>
  );
}

// ------------------------------------------------------------------------- follow ups

type AutoItem = { kind: string; severity: string; title: string; detail: string; order?: string; party?: string; supplier?: string };
type Manual = {
  name: string; follow_up_date: string; party?: string; party_name?: string; supplier?: string; sales_order?: string;
  note: string; due: boolean; overdue: boolean; owner: string;
};
type Done = { name: string; note: string; outcome?: string; done_on: string; done_by: string; party?: string; supplier?: string };

function FollowUps() {
  const state = useApi<{ auto: AutoItem[]; manual: Manual[]; done: Done[] }>(`${PORTAL}.follow_ups`, {}, 120000);
  const [adding, setAdding] = useState<Partial<Manual> | null>(null);
  const [closing, setClosing] = useState<Manual | null>(null);
  const [view, setView] = useState<"open" | "done">("open");

  return (
    <Async state={state}>
      {(d) => (
        <>
          <div className="pt-section-head">
            <h2><AlertTriangle size={18} /> Needs chasing</h2>
            <span className="pt-muted pt-small">{d.auto.length}</span>
          </div>
          {d.auto.length === 0 ? <Empty title="Nothing to chase" /> : (
            <div className="pt-list">
              {d.auto.map((a, i) => (
                <div key={i} className={`pt-card pt-auto pt-auto-${a.severity}`}>
                  <div className="pt-strong">{a.title}</div>
                  <div className="pt-muted pt-small">{a.detail}</div>
                  <div className="pt-actions">
                    <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm"
                      onClick={() => setAdding({ note: a.title, party: a.party, supplier: a.supplier, sales_order: a.order, follow_up_date: todayISO(1) })}>
                      <Plus size={16} /> Add follow-up
                    </button>
                    {a.order && <Link to={`/sales-order?order=${encodeURIComponent(a.order)}`} className="pt-btn pt-btn-ghost pt-btn-sm"><ExternalLink size={16} /> Open</Link>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-section-head">
            <h2><ListTodo size={18} /> My follow-ups</h2>
            <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" onClick={() => setAdding({ follow_up_date: todayISO(1) })}><Plus size={16} /> New</button>
          </div>
          <Chips<"open" | "done"> value={view} onChange={setView} options={[
            { value: "open", label: "Open", count: d.manual.length },
            { value: "done", label: "Recently done" },
          ]} />
          {view === "open" && (d.manual.length === 0 ? <Empty title="No open follow-ups" /> : (
            <div className="pt-list">
              {d.manual.map((m) => (
                <div key={m.name} className={`pt-card ${m.overdue ? "pt-card-urgent" : ""}`}>
                  <div className="pt-row-top">
                    <span className="pt-strong">{m.note}</span>
                    <Pill tone={m.overdue ? "bad" : m.due ? "warn" : "info"}>{m.overdue ? "Overdue" : m.due ? "Today" : fmtDate(m.follow_up_date)}</Pill>
                  </div>
                  <div className="pt-muted pt-small">
                    {[m.party_name, m.supplier, m.sales_order ? `Order ${m.sales_order}` : ""].filter(Boolean).join(" · ") || "—"}
                    {m.overdue ? ` · was due ${fmtDate(m.follow_up_date)}` : ""}
                  </div>
                  <div className="pt-actions">
                    <button type="button" className="pt-btn pt-btn-primary pt-btn-sm" onClick={() => setClosing(m)}><Check size={16} /> Done</button>
                    <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" onClick={() => setAdding(m)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {view === "done" && (d.done.length === 0 ? <Empty title="Nothing done yet" /> : (
            <div className="pt-list">
              {d.done.map((m) => (
                <div key={m.name} className="pt-card">
                  <div className="pt-strong">{m.note}</div>
                  {m.outcome && <div className="pt-small">{m.outcome}</div>}
                  <div className="pt-muted pt-small">{m.done_by} · {fmtAgo(m.done_on)}</div>
                </div>
              ))}
            </div>
          ))}

          <FollowUpSheet value={adding} onClose={() => setAdding(null)} />
          <CloseSheet item={closing} onClose={() => setClosing(null)} />
        </>
      )}
    </Async>
  );
}

function PickInput({ kind, label, value, onChange }: { kind: "party" | "supplier" | "order"; label: string; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setQ(value), [value]);
  const state = useApi<{ name: string; label?: string }[]>(open ? `${PORTAL}.pick_options` : null, { kind, search: q });
  const options = useMemo(() => state.data ?? [], [state.data]);
  return (
    <Field label={label}>
      <div className="pt-pickinput">
        <input
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); onChange(""); }}
          placeholder="Search…"
        />
        {value && <button type="button" className="pt-icon-btn" aria-label="Clear" onClick={() => { setQ(""); onChange(""); }}><X size={16} /></button>}
        {open && options.length > 0 && (
          <div className="pt-pickinput-menu">
            {options.map((o) => (
              <button key={o.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.name); setQ(o.name); setOpen(false); }}>
                {o.name}{o.label && o.label !== o.name ? <span className="pt-muted pt-small"> · {o.label}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

function FollowUpSheet({ value, onClose }: { value: Partial<Manual> | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO(1));
  const [party, setParty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [order, setOrder] = useState("");
  const [err, setErr] = useState<Error | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (!value) return;
    setNote(value.note || "");
    setDate(value.follow_up_date || todayISO(1));
    setParty(value.party || "");
    setSupplier(value.supplier || "");
    setOrder(value.sales_order || "");
    setErr(null);
  }, [value]);
  async function save() {
    await run(async () => {
      try {
        await call(`${PORTAL}.save_follow_up`, {
          name: value?.name, note, follow_up_date: date, party, supplier, sales_order: order,
        }, { post: true });
        toast("Follow-up saved");
        refreshAll();
        onClose();
      } catch (e) {
        setErr(e as Error);
      }
    });
  }
  return (
    <Sheet
      title={value?.name ? "Edit follow-up" : "New follow-up"}
      open={!!value}
      onClose={onClose}
      footer={<button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={busy || !note.trim() || !date} onClick={() => void save()}>Save</button>}
    >
      <Field label="What to follow up"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="On"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <PickInput kind="party" label="Customer (optional)" value={party} onChange={setParty} />
      <PickInput kind="supplier" label="Supplier (optional)" value={supplier} onChange={setSupplier} />
      <PickInput kind="order" label="Order (optional)" value={order} onChange={setOrder} />
      {err && <ErrorBox error={err} />}
    </Sheet>
  );
}

function CloseSheet({ item, onClose }: { item: Manual | null; onClose: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [next, setNext] = useState("");
  const { busy, run } = useAction();
  useEffect(() => { setOutcome(""); setNext(""); }, [item]);
  async function save() {
    if (!item) return;
    await run(async () => {
      try {
        await call(`${PORTAL}.close_follow_up`, { name: item.name, outcome, next_date: next || undefined }, { post: true });
        toast(next ? "Done — next follow-up scheduled" : "Follow-up done");
        refreshAll();
        onClose();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });
  }
  return (
    <Sheet
      title="Mark done"
      open={!!item}
      onClose={onClose}
      footer={<button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={busy} onClick={() => void save()}>Done</button>}
    >
      <div className="pt-strong">{item?.note}</div>
      <Field label="What happened (optional)"><textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field>
      <Field label="Follow up again on (optional)"><input type="date" min={todayISO()} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
    </Sheet>
  );
}
