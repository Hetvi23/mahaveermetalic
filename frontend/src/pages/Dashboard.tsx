import { Link } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
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
  type LucideIcon,
} from "lucide-react";

const APP_VERSION = "1.0.5";

type NavCard = {
  label: string;
  icon: LucideIcon;
  color: string;
  to?: string;
};

type Section = {
  title: string;
  accent: string;
  cards: NavCard[];
};

const SECTIONS: Section[] = [
  {
    title: "Master",
    accent: "#6b3a05",
    cards: [
      { label: "Customers", icon: Users, color: "#e67e22", to: "/masters/party" },
      { label: "Colors", icon: Palette, color: "#e74c3c", to: "/masters/item" },
      { label: "Rolls", icon: ScrollText, color: "#3498db", to: "/roll-inventory" },
      { label: "Bobbins", icon: Disc3, color: "#9b59b6", to: "/masters/bobbin" },
      { label: "Staffs", icon: HardHat, color: "#27ae60", to: "/masters/employee" },
      { label: "Chats", icon: MessageCircle, color: "#e67e22" },
    ],
  },
  {
    title: "Process",
    accent: "#6b3a05",
    cards: [
      { label: "Orders", icon: ShoppingCart, color: "#e74c3c", to: "/sales-order" },
      { label: "Bobbins", icon: Disc3, color: "#3498db", to: "/bobbin-tracking" },
      { label: "Inwards", icon: ArrowDownToLine, color: "#27ae60", to: "/inward" },
      { label: "Cutting", icon: Scissors, color: "#e67e22", to: "/cutting" },
      { label: "Program", icon: Monitor, color: "#8e44ad" },
      { label: "Production", icon: Factory, color: "#2c3e50" },
      { label: "Sales", icon: Rocket, color: "#e74c3c" },
      { label: "Job Out", icon: ArrowUpFromLine, color: "#16a085" },
      { label: "Job In", icon: ArrowDownFromLine, color: "#2980b9" },
      { label: "Chalan", icon: ClipboardList, color: "#d35400" },
    ],
  },
  {
    title: "Inventory",
    accent: "#6b3a05",
    cards: [
      { label: "Rolls", icon: ScrollText, color: "#3498db", to: "/roll-inventory" },
      { label: "Patties", icon: Package, color: "#e67e22" },
      { label: "Deliverable", icon: Truck, color: "#27ae60" },
      { label: "Bobbins", icon: Disc3, color: "#9b59b6", to: "/masters/bobbin" },
    ],
  },
  {
    title: "Reports",
    accent: "#6b3a05",
    cards: [
      { label: "Inwards", icon: BarChart3, color: "#2980b9" },
      { label: "Sales Ch.", icon: TrendingUp, color: "#e74c3c" },
      { label: "Job Out", icon: FileBarChart, color: "#16a085" },
      { label: "Bobbins", icon: PieChart, color: "#9b59b6" },
      { label: "Chalan", icon: ClipboardList, color: "#d35400" },
      { label: "Orders", icon: BarChart3, color: "#e67e22" },
    ],
  },
  {
    title: "Tools",
    accent: "#6b3a05",
    cards: [
      { label: "Reminders", icon: Bell, color: "#e74c3c", to: "/tools/reminders-chat" },
      { label: "Tasks", icon: ListChecks, color: "#27ae60", to: "/tools/task-reminder" },
    ],
  },
];

export default function Dashboard() {
  const { currentUser } = useFrappeAuth();
  const displayName = currentUser
    ? currentUser.split("@")[0].replace(/[._]/g, " ")
    : "";

  return (
    <div className="mm-home">
      <header className="mm-home-header">
        <div className="mm-home-brand">
          <div className="mm-home-brand-icon">
            <Factory size={28} strokeWidth={2.2} />
          </div>
          <div className="mm-home-brand-text">
            <span className="mm-brand-name">Mahavir Metalic</span>
            <span className="mm-brand-tagline">Management System</span>
          </div>
        </div>
        <div className="mm-home-right">
          {displayName && (
            <span className="mm-home-greeting">Hi, {displayName}</span>
          )}
          <span className="mm-home-version">v{APP_VERSION}</span>
        </div>
      </header>

      <div className="mm-home-body">
        {SECTIONS.map((section, si) => (
          <div
            key={section.title}
            className="mm-section mm-fade-in"
            style={{ animationDelay: `${si * 0.07}s` }}
          >
            <div className="mm-section-head">{section.title}</div>
            <div className="mm-section-grid">
              {section.cards.map((card) => {
                const Icon = card.icon;
                const inner = (
                  <>
                    <div
                      className="mm-nav-icon-wrap"
                      style={{ background: `${card.color}14`, color: card.color }}
                    >
                      <Icon size={26} strokeWidth={1.8} />
                    </div>
                    <span className="mm-nav-label">{card.label}</span>
                  </>
                );
                return card.to ? (
                  <Link key={card.label} to={card.to} className="mm-nav-card">
                    {inner}
                  </Link>
                ) : (
                  <div key={card.label} className="mm-nav-card mm-nav-card-disabled">
                    {inner}
                    <span className="mm-coming-soon">Soon</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
