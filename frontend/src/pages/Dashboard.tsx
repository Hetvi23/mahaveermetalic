import { Link, useNavigate } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
import { useState } from "react";
import {
  Users,
  Palette,
  ScrollText,
  Disc3,
  HardHat,
  MessageCircle,
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
  BarChart3,
  PieChart,
  TrendingUp,
  FileBarChart,
  ListChecks,
  Bell,
  Search,
  LogOut,
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

const CATEGORIES: Category[] = [
  {
    key: "master",
    label: "Masters",
    icon: Users,
    items: [
      { label: "Customers", icon: Users, to: "/masters/party" },
      { label: "Colors", icon: Palette, to: "/masters/item" },
      { label: "Rolls", icon: ScrollText, to: "/roll-inventory" },
      { label: "Bobbins", icon: Disc3, to: "/masters/bobbin" },
      { label: "Staffs", icon: HardHat, to: "/masters/employee" },
      { label: "Chats", icon: MessageCircle },
    ],
  },
  {
    key: "process",
    label: "Process",
    icon: Factory,
    items: [
      { label: "Orders", icon: ShoppingCart, to: "/sales-order" },
      { label: "Bobbins", icon: Disc3, to: "/bobbin-tracking" },
      { label: "Inwards", icon: ArrowDownToLine, to: "/inward" },
      { label: "Cutting", icon: Scissors, to: "/cutting" },
      { label: "Program", icon: Monitor },
      { label: "Production", icon: Factory },
      { label: "Sales", icon: Rocket },
      { label: "Job Out", icon: ArrowUpFromLine },
      { label: "Job In", icon: ArrowDownFromLine },
      { label: "Chalan", icon: ClipboardList },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: Package,
    items: [
      { label: "Rolls", icon: ScrollText, to: "/roll-inventory" },
      { label: "Patties", icon: Package },
      { label: "Deliverable", icon: Truck },
      { label: "Bobbins", icon: Disc3, to: "/masters/bobbin" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      { label: "Inwards", icon: BarChart3 },
      { label: "Sales Ch.", icon: TrendingUp },
      { label: "Job Out", icon: FileBarChart },
      { label: "Bobbins", icon: PieChart },
      { label: "Chalan", icon: ClipboardList },
      { label: "Orders", icon: BarChart3 },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    icon: Bell,
    items: [
      { label: "Reminders", icon: Bell, to: "/tools/reminders-chat" },
      { label: "Tasks", icon: ListChecks, to: "/tools/task-reminder" },
      { label: "SO Stock", icon: Search, to: "/sales-order/stock" },
    ],
  },
];

export default function Dashboard() {
  const { currentUser, logout } = useFrappeAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("master");

  const displayName = currentUser
    ? currentUser.split("@")[0].replace(/[._]/g, " ")
    : "";

  const activeCat = CATEGORIES.find((c) => c.key === activeTab)!;

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
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.key}
                type="button"
                className={`mm-dash-side-btn ${activeTab === cat.key ? "mm-dash-side-btn-active" : ""}`}
                onClick={() => setActiveTab(cat.key)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mm-dash-side-footer">
          <div className="mm-dash-side-user" title={currentUser || ""}>
            {displayName || "User"}
          </div>
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
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="mm-dash-mobile-header">
        <div className="mm-dash-mobile-brand">
          <Factory size={18} strokeWidth={2.2} />
          <span>Mahavir Metalic</span>
        </div>
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
      </header>

      {/* Mobile tabs */}
      <div className="mm-dash-mobile-tabs">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              type="button"
              className={`mm-dash-mob-tab ${activeTab === cat.key ? "mm-dash-mob-tab-active" : ""}`}
              onClick={() => setActiveTab(cat.key)}
            >
              <Icon size={14} />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <main className="mm-dash-content">
        <div className="mm-dash-content-header">
          <h1 className="mm-dash-content-title">{activeCat.label}</h1>
          <span className="mm-dash-content-count">{activeCat.items.length} modules</span>
        </div>

        <div className="mm-dash-grid" key={activeTab}>
          {activeCat.items.map((item, i) => {
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
      </main>
    </div>
  );
}
