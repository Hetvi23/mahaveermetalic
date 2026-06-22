import { Link, useLocation, useNavigate } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useState } from "react";
import {
  Home,
  ShoppingCart,
  ArrowDownToLine,
  Scissors,
  MoreHorizontal,
  LogOut,
  X,
  Search,
  ClipboardList,
  ArrowUpFromLine,
  ScrollText,
  Package,
  Monitor,
  Factory,
  Disc3,
  Rocket,
  ArrowDownFromLine,
  Truck,
  Users,
  Palette,
  Tags,
  Building2,
  HardHat,
  Bell,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; icon: LucideIcon; to?: string };
type Section = { key: string; label: string; items: NavItem[] };

/** Primary destinations on the bottom tab bar (mobile) + top of the rail. */
const PRIMARY: NavItem[] = [
  { label: "Home", icon: Home, to: "/" },
  { label: "Orders", icon: ShoppingCart, to: "/sales-order" },
  { label: "Inward", icon: ArrowDownToLine, to: "/inward" },
  { label: "Cutting", icon: Scissors, to: "/cutting" },
];

/**
 * Navigation grouped by function. Working features sit in their real group;
 * everything not built yet is collected in one "Coming soon" group so the full
 * scope stays visible without cluttering the working sections.
 */
const SECTIONS: Section[] = [
  {
    key: "commerce",
    label: "Orders & Purchase",
    items: [
      { label: "Orders", icon: ShoppingCart, to: "/sales-order" },
      { label: "Order Stock", icon: Search, to: "/sales-order/stock" },
      { label: "Purchase Orders", icon: ClipboardList, to: "/purchase-order" },
      { label: "Supplier Pending", icon: ArrowUpFromLine, to: "/supplier-pending" },
    ],
  },
  {
    key: "floor",
    label: "Shop Floor",
    items: [
      { label: "Inward", icon: ArrowDownToLine, to: "/inward" },
      { label: "Cutting", icon: Scissors, to: "/cutting" },
      { label: "Program", icon: Monitor, to: "/program" },
      { label: "Bobbin In / Out", icon: Disc3, to: "/bobbin-tracking" },
      { label: "Roll Inventory", icon: ScrollText, to: "/roll-inventory" },
    ],
  },
  {
    key: "masters",
    label: "Masters",
    items: [
      { label: "Customers", icon: Users, to: "/masters/party" },
      { label: "Colors / Items", icon: Palette, to: "/masters/item" },
      { label: "Item Types", icon: Tags, to: "/masters/item-type" },
      { label: "Bobbin Master", icon: Disc3, to: "/masters/bobbin" },
      { label: "Vendors", icon: Building2, to: "/masters/vendor" },
      { label: "Locations", icon: Truck, to: "/masters/location" },
      { label: "Staff", icon: HardHat, to: "/masters/employee" },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    items: [
      { label: "Reminders", icon: Bell, to: "/tools/reminders-chat" },
      { label: "Tasks", icon: ListChecks, to: "/tools/task-reminder" },
    ],
  },
  {
    key: "soon",
    label: "Coming soon",
    items: [
      { label: "Production", icon: Factory },
      { label: "Patties", icon: Package },
      { label: "Sales", icon: Rocket },
      { label: "Job Out", icon: ArrowUpFromLine },
      { label: "Job In", icon: ArrowDownFromLine },
      { label: "Chalan", icon: ClipboardList },
      { label: "Deliverable", icon: Truck },
    ],
  },
];

const PRIVILEGED = ["Administrator", "System Manager", "MM Admin", "MM Operations", "MM Inventory Manager", "MM Sales Team"];
export function isSupplierOnly(): boolean {
  const roles = (window as unknown as { frappe?: { boot?: { user?: { roles?: string[] } } } }).frappe?.boot?.user?.roles ?? [];
  return roles.includes("MM Supplier") && !PRIVILEGED.some((r) => roles.includes(r));
}

function pathActive(pathname: string, to?: string): boolean {
  if (!to) return false;
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function AppNav() {
  const loc = useLocation();
  const nav = useNavigate();
  const { currentUser, logout } = useFrappeAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const supplier = isSupplierOnly();

  // Close the More sheet on navigation.
  useEffect(() => setMoreOpen(false), [loc.pathname]);

  const doLogout = async () => {
    await logout();
    nav("/login", { replace: true });
  };

  const primary: NavItem[] = supplier
    ? [
        { label: "Home", icon: Home, to: "/supplier-pending" },
        { label: "My POs", icon: ClipboardList, to: "/purchase-order" },
      ]
    : PRIMARY;

  const displayName = currentUser ? currentUser.split("@")[0].replace(/[._]/g, " ") : "User";
  // Highlight "More" when the current page lives under it (not a primary tab).
  const onPrimary = primary.some((p) => pathActive(loc.pathname, p.to));
  const moreActive = moreOpen || !onPrimary;

  return (
    <>
      {/* ── Desktop left rail ───────────────────────────── */}
      <aside className="mm-rail">
        <div className="mm-rail-brand">
          <div className="mm-rail-logo"><Factory size={20} strokeWidth={2.2} /></div>
          <div className="mm-rail-brand-text">
            <span className="mm-rail-name">Mahavir</span>
            <span className="mm-rail-sub">Metalic</span>
          </div>
        </div>

        <nav className="mm-rail-nav">
          <RailLink item={{ label: "Home", icon: Home, to: supplier ? "/supplier-pending" : "/" }} pathname={loc.pathname} />
          {(supplier
            ? [{ key: "s", label: "Supplier", items: [{ label: "My Purchase Orders", icon: ClipboardList, to: "/purchase-order" }] }]
            : SECTIONS
          ).map((sec) => (
            <div key={sec.key} className={`mm-rail-group ${sec.key === "soon" ? "mm-group-soon" : ""}`}>
              <div className="mm-rail-group-label">{sec.label}</div>
              {sec.items.map((it) => (
                <RailLink key={it.label} item={it} pathname={loc.pathname} />
              ))}
            </div>
          ))}
        </nav>

        <div className="mm-rail-footer">
          <span className="mm-rail-user" title={currentUser || ""}>{displayName}</span>
          <button type="button" className="mm-rail-logout" title="Log out" onClick={() => void doLogout()}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom tab bar ──────────────────────── */}
      <nav className="mm-tabbar" aria-label="Primary">
        {primary.map((it) => {
          const Icon = it.icon;
          const active = pathActive(loc.pathname, it.to);
          return (
            <Link key={it.label} to={it.to!} className={`mm-tab ${active ? "mm-tab-active" : ""}`}>
              <Icon size={22} strokeWidth={active ? 2.3 : 1.9} />
              <span>{it.label}</span>
            </Link>
          );
        })}
        {supplier ? (
          <button type="button" className="mm-tab" onClick={() => void doLogout()}>
            <LogOut size={22} strokeWidth={1.9} />
            <span>Logout</span>
          </button>
        ) : (
          <button type="button" className={`mm-tab ${moreActive ? "mm-tab-active" : ""}`} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
            <MoreHorizontal size={22} strokeWidth={1.9} />
            <span>More</span>
          </button>
        )}
      </nav>

      {/* ── Mobile More sheet ──────────────────────────── */}
      {moreOpen && !supplier && (
        <div className="mm-sheet-scrim" onClick={() => setMoreOpen(false)}>
          <div className="mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="All sections">
            <div className="mm-sheet-grip" />
            <div className="mm-sheet-head">
              <span className="mm-sheet-title">All sections</span>
              <button type="button" className="mm-icon-btn" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="mm-sheet-body">
              {SECTIONS.map((sec) => (
                <div key={sec.key} className={`mm-sheet-group ${sec.key === "soon" ? "mm-group-soon" : ""}`}>
                  <div className="mm-sheet-group-label">{sec.label}</div>
                  <div className="mm-sheet-grid">
                    {sec.items.map((it) => {
                      const Icon = it.icon;
                      const inner = (
                        <>
                          <Icon size={22} strokeWidth={1.7} />
                          <span>{it.label}</span>
                          {!it.to && <em className="mm-sheet-soon">Soon</em>}
                        </>
                      );
                      return it.to ? (
                        <Link key={it.label} to={it.to} className="mm-sheet-item">{inner}</Link>
                      ) : (
                        <div key={it.label} className="mm-sheet-item mm-sheet-item-off">{inner}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button type="button" className="mm-sheet-logout" onClick={() => void doLogout()}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = pathActive(pathname, item.to);
  if (!item.to) {
    return (
      <div className="mm-rail-link mm-rail-link-off">
        <Icon size={17} strokeWidth={1.8} /> <span>{item.label}</span> <em className="mm-rail-soon">Soon</em>
      </div>
    );
  }
  return (
    <Link to={item.to} className={`mm-rail-link ${active ? "mm-rail-link-active" : ""}`}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} /> <span>{item.label}</span>
    </Link>
  );
}
