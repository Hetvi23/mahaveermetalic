import { Link, useNavigate } from "react-router-dom";
import { useFrappeAuth, useFrappeGetCall } from "frappe-react-sdk";
import { useState } from "react";
import {
  Home,
  Users,
  Palette,
  ScrollText,
  Disc3,
  HardHat,
  Building2,
  Boxes,
  ShoppingCart,
  ArrowDownToLine,
  Scissors,
  Monitor,
  Factory,
  Rocket,
  ArrowUpFromLine,
  ArrowDownFromLine,
  ClipboardList,
  Package,
  Truck,
  Bell,
  ListChecks,
  Search,
  LogOut,
  ArrowRight,
  CalendarClock,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  icon: LucideIcon;
  to?: string;
};

type Category = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

/**
 * Reorganised around the physical shop-floor pipeline instead of abstract
 * module type. This removes the duplicate-name confusion (Bobbins / Rolls /
 * Orders / Chalan each appeared in 2–4 of the old menus).
 */
const CATEGORIES: Category[] = [
  {
    key: "orders",
    label: "Orders",
    icon: ShoppingCart,
    items: [
      { label: "Orders", icon: ShoppingCart, to: "/sales-order" },
      { label: "Order Stock", icon: Search, to: "/sales-order/stock" },
      { label: "Purchase Orders", icon: ClipboardList, to: "/purchase-order" },
    ],
  },
  {
    key: "inward",
    label: "Inward",
    icon: ArrowDownToLine,
    items: [
      { label: "Inwards", icon: ArrowDownToLine, to: "/inward" },
      { label: "Rolls in Stock", icon: ScrollText, to: "/roll-inventory" },
    ],
  },
  {
    key: "cutting",
    label: "Cutting",
    icon: Scissors,
    items: [
      { label: "Cutting", icon: Scissors, to: "/cutting" },
      { label: "Patties", icon: Package },
    ],
  },
  {
    key: "production",
    label: "Production",
    icon: Factory,
    items: [
      { label: "Program", icon: Monitor },
      { label: "Production", icon: Factory },
      { label: "Bobbin In/Out", icon: Disc3, to: "/bobbin-tracking" },
    ],
  },
  {
    key: "dispatch",
    label: "Dispatch",
    icon: Truck,
    items: [
      { label: "Sales", icon: Rocket },
      { label: "Job Out", icon: ArrowUpFromLine },
      { label: "Job In", icon: ArrowDownFromLine },
      { label: "Chalan", icon: ClipboardList },
      { label: "Deliverable", icon: Truck },
    ],
  },
  {
    key: "masters",
    label: "Masters",
    icon: Boxes,
    items: [
      { label: "Customers", icon: Users, to: "/masters/party" },
      { label: "Colors / Items", icon: Palette, to: "/masters/item" },
      { label: "Roll Inventory", icon: ScrollText, to: "/roll-inventory" },
      { label: "Bobbins", icon: Disc3, to: "/masters/bobbin" },
      { label: "Vendors", icon: Building2, to: "/masters/vendor" },
      { label: "Locations", icon: Building2, to: "/masters/location" },
      { label: "Staff", icon: HardHat, to: "/masters/employee" },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    icon: Bell,
    items: [
      { label: "Reminders", icon: Bell, to: "/tools/reminders-chat" },
      { label: "Tasks", icon: ListChecks, to: "/tools/task-reminder" },
    ],
  },
];

type OpenOrder = {
  name: string;
  transaction_date: string;
  delivery_date: string | null;
  party: string;
  production_completed_percent: number | null;
  order_locked: number;
};

type DueOrder = {
  name: string;
  delivery_date: string;
  party: string;
  production_completed_percent: number | null;
};

type LowStockRoll = {
  name: string;
  location: string;
  color_name: string;
  cut: string | null;
  available: number;
  reorder_weight: number;
};

type Summary = {
  orders: { open: number; completed: number };
  rolls: { in_stock: number; weight: number };
  cutting: { active: number; pending: number };
  inward_today: number;
  bobbin_boxes_out: number;
  deliveries: { today: number; overdue: number };
  low_stock: number;
  recent_open_orders: OpenOrder[];
  due_orders: DueOrder[];
  low_stock_rolls: LowStockRoll[];
};

type Kpi = {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  to: string;
  tone: "accent" | "amber" | "blue" | "green" | "slate" | "danger";
};

const TODAY_ISO = new Date().toISOString().slice(0, 10);

function HomeView() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useFrappeGetCall<{ message: Summary }>(
    "mahaveermetalic.api.dashboard.get_summary",
    undefined,
    "mm-dashboard-summary",
  );
  const s = data?.message;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    // Reuse the orders list + its server-side party filter via ?q=.
    navigate(q ? `/sales-order?q=${encodeURIComponent(q)}` : "/sales-order");
  };

  const overdue = s?.deliveries.overdue ?? 0;
  const lowStock = s?.low_stock ?? 0;

  const kpis: Kpi[] = [
    {
      label: "Open orders",
      value: s?.orders.open ?? 0,
      hint: `${s?.orders.completed ?? 0} completed`,
      icon: ShoppingCart,
      to: "/sales-order",
      tone: "accent",
    },
    {
      label: "Due today",
      value: s?.deliveries.today ?? 0,
      hint: overdue > 0 ? `${overdue} overdue` : "deliveries",
      icon: CalendarClock,
      to: "/sales-order",
      tone: overdue > 0 ? "danger" : "blue",
    },
    {
      label: "Rolls to cut",
      value: s?.rolls.in_stock ?? 0,
      hint: `${(s?.rolls.weight ?? 0).toLocaleString()} kg in stock`,
      icon: ScrollText,
      to: "/cutting",
      tone: "amber",
    },
    {
      label: "In cutting",
      value: s?.cutting.active ?? 0,
      hint: `${s?.cutting.pending ?? 0} queued`,
      icon: Scissors,
      to: "/cutting",
      tone: "slate",
    },
    {
      label: "Inward today",
      value: s?.inward_today ?? 0,
      hint: "receipts posted",
      icon: ArrowDownToLine,
      to: "/inward",
      tone: "green",
    },
    {
      label: "Bobbin boxes out",
      value: s?.bobbin_boxes_out ?? 0,
      hint: "returnable, pending",
      icon: Disc3,
      to: "/bobbin-tracking",
      tone: "slate",
    },
    {
      label: "Low stock",
      value: lowStock,
      hint: "rolls below reorder",
      icon: AlertTriangle,
      to: "/roll-inventory",
      tone: lowStock > 0 ? "danger" : "green",
    },
  ];

  const ready = !error && !isLoading && s;

  return (
    <div className="mm-home">
      <form className="mm-home-search" onSubmit={submitSearch} role="search">
        <Search size={18} className="mm-home-search-icon" aria-hidden />
        <input
          className="mm-home-search-input"
          placeholder="Search orders by party…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search orders by party"
        />
        <button type="submit" className="mm-home-search-btn">
          Search
        </button>
      </form>

      <div className="mm-kpis">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <Link
              key={k.label}
              to={k.to}
              className={`mm-kpi mm-kpi-${k.tone} mm-fade-in`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="mm-kpi-top">
                <Icon size={20} strokeWidth={1.8} />
                <ArrowRight size={15} className="mm-kpi-arrow" />
              </div>
              <span className="mm-kpi-value">{isLoading ? "—" : k.value}</span>
              <span className="mm-kpi-label">{k.label}</span>
              <span className="mm-kpi-hint">{k.hint}</span>
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="mm-home-empty">Could not load — {String(error.message || error)}</div>
      )}
      {!error && isLoading && <div className="mm-home-empty">Loading…</div>}

      {/* Deliveries due / overdue — only render when there is something to chase. */}
      {ready && s.due_orders.length > 0 && (
        <div className="mm-home-section">
          <div className="mm-home-section-head">
            <h2>Deliveries due &amp; overdue</h2>
            <Link to="/sales-order" className="mm-home-section-link">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mm-open-table">
            <div className="mm-open-row mm-open-head">
              <span>Order</span>
              <span>Delivery</span>
              <span>Party</span>
              <span className="mm-open-prog">Progress</span>
            </div>
            {s.due_orders.map((o) => {
              const pct = Math.round(o.production_completed_percent ?? 0);
              const isOverdue = !!o.delivery_date && o.delivery_date < TODAY_ISO;
              return (
                <Link key={o.name} to={`/sales-order/${encodeURIComponent(o.name)}`} className="mm-open-row">
                  <span className="mm-open-name">{o.name}</span>
                  <span className={`mm-open-date ${isOverdue ? "mm-open-overdue" : "mm-open-due"}`}>
                    {o.delivery_date}
                    {isOverdue ? " · overdue" : " · today"}
                  </span>
                  <span className="mm-open-party">{o.party || "—"}</span>
                  <span className="mm-open-prog">
                    <span className="mm-open-bar">
                      <span className="mm-open-bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="mm-open-pct">{pct}%</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Low stock rolls */}
      {ready && s.low_stock_rolls.length > 0 && (
        <div className="mm-home-section">
          <div className="mm-home-section-head">
            <h2>Low stock rolls</h2>
            <Link to="/roll-inventory" className="mm-home-section-link">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mm-open-table">
            <div className="mm-open-row mm-low-row mm-open-head">
              <span>Location</span>
              <span>Color</span>
              <span>Cut</span>
              <span className="mm-open-prog">Available / Reorder</span>
            </div>
            {s.low_stock_rolls.map((r) => (
              <Link key={r.name} to="/roll-inventory" className="mm-open-row mm-low-row">
                <span className="mm-open-party">{r.location || "—"}</span>
                <span className="mm-open-name">{r.color_name || "—"}</span>
                <span className="mm-open-date">{r.cut || "—"}</span>
                <span className="mm-open-prog mm-low-figures">
                  <span className="mm-low-avail">{r.available.toLocaleString()}</span>
                  <span className="mm-low-sep">/ {r.reorder_weight.toLocaleString()} kg</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Open orders */}
      <div className="mm-home-section">
        <div className="mm-home-section-head">
          <h2>Open orders</h2>
          <Link to="/sales-order" className="mm-home-section-link">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {ready && s.recent_open_orders.length === 0 && (
          <div className="mm-home-empty">No open orders. 🎉</div>
        )}

        {ready && s.recent_open_orders.length > 0 && (
          <div className="mm-open-table">
            <div className="mm-open-row mm-open-head">
              <span>Order</span>
              <span>Date</span>
              <span>Party</span>
              <span className="mm-open-prog">Progress</span>
            </div>
            {s.recent_open_orders.map((o) => {
              const pct = Math.round(o.production_completed_percent ?? 0);
              return (
                <Link key={o.name} to={`/sales-order/${encodeURIComponent(o.name)}`} className="mm-open-row">
                  <span className="mm-open-name">{o.name}</span>
                  <span className="mm-open-date">{o.transaction_date || "—"}</span>
                  <span className="mm-open-party">{o.party || "—"}</span>
                  <span className="mm-open-prog">
                    <span className="mm-open-bar">
                      <span className="mm-open-bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="mm-open-pct">{pct}%</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { currentUser, logout } = useFrappeAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("home");

  const displayName = currentUser
    ? currentUser.split("@")[0].replace(/[._]/g, " ")
    : "";

  const activeCat = CATEGORIES.find((c) => c.key === activeTab);
  const isHome = activeTab === "home";

  const TABS: { key: string; label: string; icon: LucideIcon }[] = [
    { key: "home", label: "Home", icon: Home },
    ...CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon })),
  ];

  const logoutBtn = (
    <button
      type="button"
      className="mm-dash-side-logout"
      title="Log out"
      onClick={async () => {
        await logout();
        navigate("/login", { replace: true });
      }}
    >
      <LogOut size={16} />
    </button>
  );

  return (
    <div className="mm-dash">
      {/* Sidebar */}
      <aside className="mm-dash-side">
        <div className="mm-dash-side-brand">
          <div className="mm-dash-side-logo">
            <Factory size={22} strokeWidth={2.2} />
          </div>
          <div className="mm-dash-side-brand-text">
            <span className="mm-dash-side-name">Mahavir</span>
            <span className="mm-dash-side-sub">Metalic</span>
          </div>
        </div>

        <nav className="mm-dash-side-nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={`mm-dash-side-btn ${activeTab === tab.key ? "mm-dash-side-btn-active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mm-dash-side-footer">
          <div className="mm-dash-side-user" title={currentUser || ""}>
            {displayName || "User"}
          </div>
          {logoutBtn}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="mm-dash-mobile-header">
        <div className="mm-dash-mobile-brand">
          <Factory size={18} strokeWidth={2.2} />
          <span>Mahavir Metalic</span>
        </div>
        {logoutBtn}
      </header>

      {/* Mobile tabs */}
      <div className="mm-dash-mobile-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={`mm-dash-mob-tab ${activeTab === tab.key ? "mm-dash-mob-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <main className="mm-dash-content">
        <div className="mm-dash-content-header">
          <h1 className="mm-dash-content-title">{isHome ? "Today" : activeCat!.label}</h1>
          <span className="mm-dash-content-count">
            {isHome
              ? new Date().toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : `${activeCat!.items.length} modules`}
          </span>
        </div>

        {isHome ? (
          <HomeView />
        ) : (
          <div className="mm-dash-grid" key={activeTab}>
            {activeCat!.items.map((item, i) => {
              const Icon = item.icon;
              const inner = (
                <>
                  <div className="mm-dash-card-icon">
                    <Icon size={28} strokeWidth={1.6} />
                  </div>
                  <span className="mm-dash-card-label">{item.label}</span>
                  {!item.to && <span className="mm-dash-card-soon">Soon</span>}
                </>
              );

              if (item.to) {
                return (
                  <Link
                    key={`${item.label}-${i}`}
                    to={item.to}
                    className="mm-dash-card mm-fade-in"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    {inner}
                  </Link>
                );
              }
              return (
                <div
                  key={`${item.label}-${i}`}
                  className="mm-dash-card mm-dash-card-disabled mm-fade-in"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
