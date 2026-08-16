import { Link, useLocation, useNavigate } from "react-router-dom";
import { useFrappeAuth } from "frappe-react-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronRight,
  ShoppingCart,
  ArrowDownToLine,
  Scissors,
  MoreHorizontal,
  LogOut,
  X,
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
  Boxes,
  Network,
  FileText,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; icon: LucideIcon; to?: string };
type Section = { key: string; label: string; icon: LucideIcon; items: NavItem[] };

/** Which nav groups are open, kept across sessions like the rail's own width. */
const GROUPS_KEY = "mm-nav-groups";
function readOpenGroups(): Set<string> {
  try {
    const saved = localStorage.getItem(GROUPS_KEY);
    return new Set<string>(saved ? (JSON.parse(saved) as string[]) : ["commerce", "floor"]);
  } catch {
    return new Set(["commerce", "floor"]);
  }
}

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
    icon: ShoppingCart,
    items: [
      { label: "Orders", icon: ShoppingCart, to: "/sales-order" },
      { label: "Purchase Orders", icon: ClipboardList, to: "/purchase-order" },
      { label: "Order Report", icon: ScrollText, to: "/order-report" },
      { label: "Sales Challan Voucher", icon: FileText, to: "/sales-challan-voucher" },
    ],
  },
  {
    key: "floor",
    label: "Shop Floor",
    icon: Factory,
    items: [
      { label: "Inward", icon: ArrowDownToLine, to: "/inward" },
      { label: "Inward Report", icon: ScrollText, to: "/inward-report" },
      { label: "Cutting", icon: Scissors, to: "/cutting" },
      { label: "Program", icon: Monitor, to: "/program" },
      { label: "Program View", icon: Monitor, to: "/production-view" },
      { label: "Production", icon: Factory, to: "/production" },
      { label: "Bobbin In / Out", icon: Disc3, to: "/bobbin-tracking" },
      { label: "Bobbin Report", icon: Disc3, to: "/bobbin-report" },
      { label: "Inventory", icon: Boxes, to: "/inventory" },
      { label: "Stock Ledger", icon: ScrollText, to: "/stock-ledger" },
      { label: "Close-out Stack", icon: ScrollText, to: "/closeout" },
      { label: "Job Out", icon: ArrowUpFromLine, to: "/job-out" },
      { label: "Job In", icon: ArrowDownFromLine, to: "/job-in" },
      { label: "Job Report", icon: ScrollText, to: "/job-report" },
    ],
  },
  {
    key: "masters",
    label: "Masters",
    icon: Boxes,
    items: [
      { label: "Customers", icon: Users, to: "/masters/party" },
      { label: "Colors / Items", icon: Palette, to: "/masters/item" },
      { label: "Item Types", icon: Tags, to: "/masters/item-type" },
      { label: "Bobbin Master", icon: Disc3, to: "/masters/bobbin" },
      { label: "Vendors", icon: Building2, to: "/masters/vendor" },
      { label: "Locations", icon: Truck, to: "/masters/location" },
      { label: "Branches", icon: Network, to: "/masters/branch" },
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
  {
    key: "soon",
    label: "Coming soon",
    icon: Rocket,
    items: [
      { label: "Patties", icon: Package },
      { label: "Sales", icon: Rocket },
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
  const [theme, setTheme] = useState<string>(
    () => (typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : "") || "",
  );
  const supplier = isSupplierOnly();
  // Collapsed state lives on <html data-rail>, not in React, for the same reason the
  // theme does: the rail and the content offset are rendered by DIFFERENT components
  // (AppNav and App), so a shared attribute avoids lifting state or adding a context
  // just to keep one number in sync. main.tsx applies it before first paint.
  const [railCollapsed, setRailCollapsed] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.getAttribute("data-rail") === "collapsed",
  );

  // Groups fold, so the rail shows five headings instead of a wall of thirty links.
  const [openGroups, setOpenGroups] = useState<Set<string>>(readOpenGroups);
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Whichever group holds the current page opens itself — navigating from a link that
  // isn't in the rail (a card, a redirect) should still reveal where you are.
  useEffect(() => {
    const sec = SECTIONS.find((s) => s.items.some((it) => pathActive(loc.pathname, it.to)));
    if (!sec) return;
    setOpenGroups((prev) => {
      if (prev.has(sec.key)) return prev;
      const next = new Set(prev).add(sec.key);
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [loc.pathname]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      document.documentElement.setAttribute("data-rail", next ? "collapsed" : "expanded");
      try { localStorage.setItem("mm-rail", next ? "collapsed" : "expanded"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // "[" collapses/expands, the way an editor sidebar does — but never while the operator
  // is typing into a field, or entering a size like "50/85" would toggle the nav.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      toggleRail();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRail]);

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const prefersDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
    const next = cur ? (cur === "dark" ? "light" : "dark") : prefersDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mm-theme", next); } catch { /* ignore */ }
    setTheme(next);
  }
  const isDark = theme === "dark" || (!theme && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);

  // Close the More sheet on navigation.
  useEffect(() => setMoreOpen(false), [loc.pathname]);

  const doLogout = async () => {
    await logout();
    nav("/login", { replace: true });
  };

  // A supplier login has exactly one screen: its own purchase orders, scoped server-side
  // by po_permission_query. (It used to land on the pending summary, now removed.)
  const primary: NavItem[] = supplier
    ? [{ label: "My POs", icon: ClipboardList, to: "/purchase-order" }]
    : PRIMARY;

  const displayName = currentUser ? currentUser.split("@")[0].replace(/[._]/g, " ") : "User";
  // Highlight "More" when the current page lives under it (not a primary tab).
  const onPrimary = primary.some((p) => pathActive(loc.pathname, p.to));
  const moreActive = moreOpen || !onPrimary;

  return (
    <>
      {/* ── Desktop left rail ───────────────────────────── */}
      <aside className="mm-rail" aria-label="Sections">
        <div className="mm-rail-brand">
          <div className="mm-rail-logo"><Factory size={20} strokeWidth={2.2} /></div>
          <div className="mm-rail-brand-text">
            <span className="mm-rail-name">Mahavir</span>
            <span className="mm-rail-sub">Metalic</span>
          </div>
          <button
            type="button"
            className="mm-rail-toggle"
            onClick={toggleRail}
            aria-expanded={!railCollapsed}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${railCollapsed ? "Expand" : "Collapse"} sidebar  [`}
          >
            {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="mm-rail-nav">
          {/* No "Home" for suppliers — their group below IS their only destination. */}
          {!supplier && <RailLink item={{ label: "Home", icon: Home, to: "/" }} pathname={loc.pathname} />}
          {(supplier
            ? [{ key: "s", label: "Supplier", icon: ClipboardList, items: [{ label: "My Purchase Orders", icon: ClipboardList, to: "/purchase-order" }] }]
            : SECTIONS
          ).map((sec) => {
            const Icon = sec.icon;
            const hasActive = sec.items.some((it) => pathActive(loc.pathname, it.to));
            const open = openGroups.has(sec.key);
            return (
              <div key={sec.key} className={`mm-rail-group ${sec.key === "soon" ? "mm-group-soon" : ""}`}>
                <button
                  type="button"
                  className={`mm-rail-group-btn ${hasActive ? "mm-rail-group-btn-on" : ""}`}
                  onClick={() => toggleGroup(sec.key)}
                  aria-expanded={open}
                  title={sec.label}
                >
                  {/* Marks the group holding the current page while it is folded away —
                      otherwise collapsing a group hides where you are. */}
                  {hasActive && !open && <span className="mm-rail-group-mark" aria-hidden />}
                  <Icon size={17} strokeWidth={hasActive ? 2.2 : 1.8} />
                  <span>{sec.label}</span>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="mm-rail-tip">{sec.label}</span>
                </button>
                {open && (
                  <div className="mm-rail-group-items">
                    {sec.items.map((it) => (
                      <RailLink key={it.label} item={it} pathname={loc.pathname} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="mm-rail-footer">
          <span className="mm-rail-user" title={currentUser || ""}>{displayName}</span>
          <button type="button" className="mm-rail-logout" title={isDark ? "Switch to light" : "Switch to dark"} onClick={toggleTheme}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
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
    // title + .mm-rail-tip: collapsed, the rail is nothing but icons — it had no labels
    // of any kind, so you had to click one to find out what it was.
    <Link to={item.to} className={`mm-rail-link ${active ? "mm-rail-link-active" : ""}`} title={item.label}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} /> <span>{item.label}</span>
      <span className="mm-rail-tip">{item.label}</span>
    </Link>
  );
}
