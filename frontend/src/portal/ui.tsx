import { Component, type ReactNode, useEffect, useState } from "react";
import { AlertTriangle, Inbox, RefreshCw, WifiOff, X } from "lucide-react";
import type { ApiError } from "./api";

/* Small building blocks shared by the customer, supplier and admin screens. */

const STAGE_TONE: Record<string, string> = {
  Requested: "accent",
  New: "accent",
  Accepted: "info",
  Pending: "info",
  Confirmed: "info",
  "Part delivered": "warn",
  Delivered: "ok",
  Complete: "ok",
  Rejected: "bad",
  Cancelled: "muted",
  Urgent: "bad",
  Overdue: "bad",
  Done: "ok",
};

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  const t = tone || STAGE_TONE[String(children)] || "muted";
  return <span className={`pt-pill pt-pill-${t}`}>{children}</span>;
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="pt-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`pt-progress-bar ${tone ? `pt-progress-${tone}` : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pt-loading" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="pt-skel" />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  const offline = (error as ApiError).offline;
  return (
    <div className="pt-error" role="alert">
      {offline ? <WifiOff size={20} /> : <AlertTriangle size={20} />}
      <div className="pt-error-text">{error.message}</div>
      {onRetry && (
        <button type="button" className="pt-btn pt-btn-ghost" onClick={onRetry}>
          <RefreshCw size={16} /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="pt-empty">
      <Inbox size={28} strokeWidth={1.6} />
      <div className="pt-empty-title">{title}</div>
      {children && <div className="pt-empty-sub">{children}</div>}
    </div>
  );
}

/** Loading → error → empty → content, in that order, for any useApi result. */
export function Async<T>({
  state, empty, emptyTitle, children, rows,
}: {
  state: { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => void };
  empty?: (d: T) => boolean;
  emptyTitle?: string;
  children: (d: T) => ReactNode;
  rows?: number;
}) {
  if (state.error && state.data === undefined) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <Loading rows={rows} />;
  return (
    <>
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
      {empty && empty(state.data) ? <Empty title={emptyTitle || "Nothing here yet"} /> : children(state.data)}
    </>
  );
}

export function Chips<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="pt-chips" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`pt-chip ${value === o.value ? "pt-chip-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="pt-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone, sub, onClick }: {
  label: string; value: ReactNode; tone?: string; sub?: ReactNode; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`pt-stat ${tone ? `pt-stat-${tone}` : ""}`} onClick={onClick}>
      <span className="pt-stat-label">{label}</span>
      <span className="pt-stat-value">{value}</span>
      {sub && <span className="pt-stat-sub">{sub}</span>}
    </Tag>
  );
}

/** A bottom sheet on phones, a centred dialog on wider screens. */
export function Sheet({ title, open, onClose, children, footer }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pt-scrim" onClick={onClose}>
      <div className="pt-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="pt-sheet-head">
          <span className="pt-sheet-title">{title}</span>
          <button type="button" className="pt-icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="pt-sheet-body">{children}</div>
        {footer && <div className="pt-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="pt-field">
      <span className="pt-field-label">{label}</span>
      {children}
      {hint && <span className="pt-field-hint">{hint}</span>}
    </label>
  );
}

export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="pt-offline" role="status">
      <WifiOff size={16} /> You're offline — showing what was last loaded.
    </div>
  );
}

/**
 * Catches a screen that crashed while drawing and offers a reload, instead of a blank
 * white page. Keyed by route in the shells so moving to another tab clears it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Screen crashed:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pt-crash">
        <AlertTriangle size={28} />
        <div className="pt-empty-title">This screen hit a problem</div>
        <div className="pt-empty-sub">Your data is safe. Reload to continue.</div>
        <button type="button" className="pt-btn pt-btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> Reload
        </button>
      </div>
    );
  }
}

/** Runs an async action with a busy flag; the button can't be pressed twice. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
