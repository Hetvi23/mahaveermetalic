import { type ReactNode, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Bell, CalendarDays, ClipboardList, Flame, Search } from "lucide-react";
import { fmtDate, fmtKg, PORTAL, useApi } from "./api";
import Notifications from "./Notifications";
import PortalShell, { type Tab } from "./PortalShell";
import { Async, Chips, Pill, Progress, Stat } from "./ui";

const BASE = "/s";

export type PurchaseRow = {
  name: string; order_no: string; supplier?: string; vm_sales_order?: string; color: string; cut?: string;
  qty_kg: number; qty_box: number; received: number; pending: number; done: boolean; order_date?: string;
  delivery_date?: string; overdue: boolean; urgent: boolean; urgent_on?: string; sales_order?: string;
};
type Data = {
  rows: PurchaseRow[];
  summary: { pending: number; pending_kg: number; urgent: number; overdue: number };
  vendor: string;
};

export default function SupplierApp({ me }: { me: { vendor?: string; full_name?: string } }) {
  const tabs: Tab[] = [
    { to: BASE, label: "Orders", icon: ClipboardList, end: true },
    { to: `${BASE}/alerts`, label: "Alerts", icon: Bell },
  ];
  return (
    <PortalShell base={BASE} title="Mahaveer Metalic" subtitle={me.vendor || me.full_name} tabs={tabs}>
      <Routes>
        <Route index element={<SupplierOrders />} />
        <Route path="alerts" element={<Notifications />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </PortalShell>
  );
}

type Status = "pending" | "done" | "all";

function SupplierOrders() {
  const [status, setStatus] = useState<Status>("pending");
  const [search, setSearch] = useState("");
  const state = useApi<Data>(`${PORTAL}.supplier_orders`, { status, search }, 120000);
  const s = state.data?.summary;
  return (
    <div className="pt-page">
      <h1 className="pt-title">Orders to supply</h1>
      {s && (
        <div className="pt-stats">
          <Stat label="Pending orders" value={s.pending} />
          <Stat label="Pending weight" value={fmtKg(s.pending_kg)} tone="accent" />
          <Stat label="Urgent" value={s.urgent} tone={s.urgent ? "bad" : undefined} />
          <Stat label="Overdue" value={s.overdue} tone={s.overdue ? "warn" : undefined} />
        </div>
      )}
      <Chips<Status>
        value={status}
        onChange={setStatus}
        options={[
          { value: "pending", label: "Pending", count: s?.pending },
          { value: "done", label: "Completed" },
          { value: "all", label: "All" },
        ]}
      />
      <div className="pt-search">
        <Search size={16} />
        <input placeholder="Order no. or colour" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Async state={state} empty={(d) => !d.rows.length} emptyTitle={status === "pending" ? "Nothing pending — all caught up" : "No orders"}>
        {(d) => <div className="pt-list">{d.rows.map((r) => <PurchaseCard key={r.name} r={r} />)}</div>}
      </Async>
    </div>
  );
}

export function PurchaseCard({ r, showSupplier, action }: { r: PurchaseRow; showSupplier?: boolean; action?: ReactNode }) {
  return (
    <div className={`pt-card ${r.urgent && !r.done ? "pt-card-urgent" : ""}`}>
      <div className="pt-row-top">
        <span className="pt-strong">Order {r.order_no}</span>
        <span className="pt-pills">
          {r.urgent && !r.done && <Pill tone="bad"><Flame size={12} /> Urgent</Pill>}
          {r.overdue && <Pill tone="bad">Overdue</Pill>}
          {r.done ? <Pill tone="ok">Received</Pill> : r.received > 0 ? <Pill tone="warn">Part received</Pill> : <Pill tone="info">Pending</Pill>}
        </span>
      </div>
      <div className="pt-row-mid">
        <span>
          <span className="pt-strong">{r.color}</span>
          {r.cut && <span className="pt-muted pt-small"> · size {r.cut}</span>}
          {showSupplier && r.supplier && <span className="pt-muted pt-small"> · {r.supplier}</span>}
        </span>
      </div>
      <Progress value={r.received} max={r.qty_kg} tone={r.done ? "ok" : r.urgent ? "bad" : undefined} />
      <div className="pt-row-foot pt-small">
        <span>{fmtKg(r.received)} of {fmtKg(r.qty_kg)} received{!r.done && r.pending > 0 ? <> · <strong>{fmtKg(r.pending)} to send</strong></> : null}</span>
      </div>
      <div className="pt-row-foot pt-small pt-muted">
        <span>Placed {fmtDate(r.order_date)}</span>
        <span className={r.overdue ? "pt-neg" : ""}>
          <CalendarDays size={13} /> {r.delivery_date ? `Deliver by ${fmtDate(r.delivery_date)}` : "No delivery date"}
        </span>
      </div>
      {action && <div className="pt-actions">{action}</div>}
    </div>
  );
}
