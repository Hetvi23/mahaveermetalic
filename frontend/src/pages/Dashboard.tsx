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
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  icon: LucideIcon;
  to?: string;
  desc?: string;
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
      { label: "Customers", icon: Users, to: "/masters/party", desc: "Manage parties & contacts" },
      { label: "Colors", icon: Palette, to: "/masters/item", desc: "Item master & types" },
      { label: "Roll Stock", icon: ScrollText, to: "/roll-inventory", desc: "Current roll inventory" },
      { label: "Bobbins", icon: Disc3, to: "/masters/bobbin", desc: "Bobbin types & weights" },
      { label: "Staffs", icon: HardHat, to: "/masters/employee", desc: "Employee directory" },
      { label: "Chats", icon: MessageCircle, desc: "Team messaging" },
    ],
  },
  {
    key: "process",
    label: "Process",
    icon: Factory,
    items: [
      { label: "Orders", icon: ShoppingCart, to: "/sales-order", desc: "Sales orders" },
      { label: "Bobbin Track", icon: Disc3, to: "/bobbin-tracking", desc: "Given & received" },
      { label: "Inwards", icon: ArrowDownToLine, to: "/inward", desc: "Material inward entry" },
      { label: "Cutting", icon: Scissors, to: "/cutting", desc: "Roll cutting records" },
      { label: "Program", icon: Monitor, desc: "Shift planning" },
      { label: "Production", icon: Factory, desc: "Production tracking" },
      { label: "Sales", icon: Rocket, desc: "Sales challans" },
      { label: "Job Out", icon: ArrowUpFromLine, desc: "Job work dispatch" },
      { label: "Job In", icon: ArrowDownFromLine, desc: "Job work receipt" },
      { label: "Chalan", icon: ClipboardList, desc: "Delivery challans" },
    ],
  },
  {
    key: "inventory",
    label: "Stock",
    icon: Package,
    items: [
      { label: "Rolls", icon: ScrollText, to: "/roll-inventory", desc: "Roll-wise stock" },
      { label: "Patties", icon: Package, desc: "Patti inventory" },
      { label: "Deliverable", icon: Truck, desc: "Ready to dispatch" },
      { label: "Bobbins", icon: Disc3, to: "/masters/bobbin", desc: "Bobbin stock" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      { label: "Inwards", icon: BarChart3, desc: "Inward analysis" },
      { label: "Sales Ch.", icon: TrendingUp, desc: "Sales challan report" },
      { label: "Job Out", icon: FileBarChart, desc: "Job work summary" },
      { label: "Bobbins", icon: PieChart, desc: "Bobbin movement" },
      { label: "Chalan", icon: ClipboardList, desc: "Challan register" },
      { label: "Orders", icon: BarChart3, desc: "Order book report" },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    icon: Bell,
    items: [
      { label: "Reminders", icon: Bell, to: "/tools/reminders-chat", desc: "Task reminder chat" },
      { label: "Tasks", icon: ListChecks, to: "/tools/task-reminder", desc: "All task reminders" },
      { label: "SO Stock", icon: Search, to: "/sales-order/stock", desc: "Check stock for SO" },
    ],
  },
];

export default function Dashboard() {
  const { currentUser, logout } = useFrappeAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("master");
  const [search, setSearch] = useState("");

  const displayName = currentUser
    ? currentUser.split("@")[0].replace(/[._]/g, " ")
    : "";

  const activeCat = CATEGORIES.find((c) => c.key === activeTab)!;

  // Flatten all items for search
  const allItems = CATEGORIES.flatMap((c) =>
    c.items.map((item) => ({ ...item, category: c.label }))
  );
  const filtered = search.trim()
    ? allItems.filter(
        (i) =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          (i.desc && i.desc.toLowerCase().includes(search.toLowerCase()))
      )
    : null;

  const itemsToShow = filtered || activeCat.items;

  return (
    <div className="mm-dash">
      {/* Header */}
      <header className="mm-dash-header">
        <div className="mm-dash-header-top">
          <div className="mm-dash-greeting">
            <span className="mm-dash-hello">
              {getGreeting()}, <strong>{displayName || "User"}</strong>
            </span>
            <span className="mm-dash-sub">Mahavir Metalic</span>
          </div>
          <button
            type="button"
            className="mm-dash-logout"
            title="Log out"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="mm-dash-search-wrap">
          <Search size={16} className="mm-dash-search-icon" />
          <input
            className="mm-dash-search"
            placeholder="Search modules..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {/* Category tabs - horizontal scroll */}
      {!filtered && (
        <div className="mm-dash-tabs">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.key}
                type="button"
                className={`mm-dash-tab ${activeTab === cat.key ? "mm-dash-tab-active" : ""}`}
                onClick={() => setActiveTab(cat.key)}
              >
                <Icon size={15} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtered && (
        <div className="mm-dash-search-label">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"
        </div>
      )}

      {/* Items list */}
      <div className="mm-dash-items">
        {itemsToShow.map((item, i) => {
          const Icon = item.icon;
          const inner = (
            <>
              <div className="mm-dash-item-left">
                <div className="mm-dash-item-icon">
                  <Icon size={20} strokeWidth={1.8} />
                </div>
                <div className="mm-dash-item-text">
                  <span className="mm-dash-item-name">{item.label}</span>
                  {item.desc && <span className="mm-dash-item-desc">{item.desc}</span>}
                </div>
              </div>
              <ChevronRight size={16} className="mm-dash-item-arrow" />
            </>
          );

          if (item.to) {
            return (
              <Link
                key={`${item.label}-${i}`}
                to={item.to}
                className="mm-dash-item mm-fade-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {inner}
              </Link>
            );
          }
          return (
            <div
              key={`${item.label}-${i}`}
              className="mm-dash-item mm-dash-item-soon mm-fade-in"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {inner}
              <span className="mm-dash-soon-badge">Coming Soon</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
