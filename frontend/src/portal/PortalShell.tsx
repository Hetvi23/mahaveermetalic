import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bell, LogOut, Moon, Sun, type LucideIcon } from "lucide-react";
import { useUnread } from "./Notifications";
import { ErrorBoundary, OfflineBanner } from "./ui";
import { registerServiceWorker, resyncPush } from "./pwa";

export type Tab = { to: string; label: string; icon: LucideIcon; end?: boolean; primary?: boolean };

export async function logout() {
  // Frappe only ends the session on POST; a GET leaves it alive.
  try {
    await fetch("/api/method/logout", {
      method: "POST",
      credentials: "include",
      headers: { "X-Frappe-CSRF-Token": (window as unknown as { csrf_token?: string }).csrf_token || "" },
    });
  } catch { /* still leave */ }
  window.location.href = "/mahaveermetalic/login";
}

function useTheme(): [boolean, () => void] {
  const read = () => {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  };
  const [dark, setDark] = useState(read);
  const toggle = () => {
    const next = read() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("mm-theme", next); } catch { /* ignore */ }
    setDark(next === "dark");
  };
  return [dark, toggle];
}

/**
 * The phone app frame for customers and suppliers: a header with the bell, the screen,
 * and a bottom tab bar. It never shows the office navigation.
 */
export default function PortalShell({
  base, title, subtitle, tabs, children,
}: {
  base: string; title: string; subtitle?: string; tabs: Tab[]; children: ReactNode;
}) {
  const unread = useUnread();
  const loc = useLocation();
  const [dark, toggleTheme] = useTheme();

  useEffect(() => {
    void registerServiceWorker().then(() => resyncPush());
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="pt-app">
      <header className="pt-head">
        <Link to={base} className="pt-brand" aria-label="Home">
          <img src="/assets/mahaveermetalic/mahaveermetalic/icon.svg" alt="" width={34} height={34} />
          <span className="pt-brand-text">
            <span className="pt-brand-title">{title}</span>
            {subtitle && <span className="pt-brand-sub">{subtitle}</span>}
          </span>
        </Link>
        <div className="pt-head-actions">
          <button type="button" className="pt-icon-btn" onClick={toggleTheme} aria-label={dark ? "Light mode" : "Dark mode"}>
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <Link to={`${base}/alerts`} className="pt-icon-btn pt-bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell size={20} />
            {unread > 0 && <span className="pt-badge">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <button type="button" className="pt-icon-btn" onClick={() => void logout()} aria-label="Log out">
            <LogOut size={20} />
          </button>
        </div>
      </header>
      <OfflineBanner />
      <main className="pt-main">
        <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>
      </main>
      <nav className="pt-tabs" aria-label="Sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `pt-tab ${t.primary ? "pt-tab-primary" : ""} ${isActive ? "pt-tab-on" : ""}`}>
              <span className="pt-tab-icon"><Icon size={t.primary ? 24 : 22} /></span>
              <span className="pt-tab-label">{t.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
