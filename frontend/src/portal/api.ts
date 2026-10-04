import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The app's one way to talk to the server.
 *
 * Every failure comes back as a plain sentence a customer can read — Frappe's
 * `_server_messages`, its exception line, or "You're offline" — never a stack trace or
 * "[object Object]". Screens show that sentence with a Retry button and nothing else.
 */

export const PORTAL = "mahaveermetalic.mahaveer_metallic.api.portal";
export const PUSH = "mahaveermetalic.mahaveer_metallic.api.push";

export class ApiError extends Error {
  status: number;
  offline: boolean;
  constructor(message: string, status = 0, offline = false) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

function csrf(): string {
  const w = window as unknown as { csrf_token?: string; frappe?: { csrf_token?: string } };
  return w.csrf_token || w.frappe?.csrf_token || "";
}

function stripHtml(s: string): string {
  const d = document.createElement("div");
  d.innerHTML = s;
  return (d.textContent || "").trim();
}

function messageFrom(body: unknown, status: number): string {
  const b = (body ?? {}) as { _server_messages?: string; exception?: string; exc_type?: string; message?: unknown };
  if (b._server_messages) {
    try {
      const parts = (JSON.parse(b._server_messages) as string[])
        .map((m) => {
          try { return stripHtml((JSON.parse(m) as { message?: string }).message || ""); } catch { return stripHtml(m); }
        })
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    } catch { /* fall through */ }
  }
  if (b.exception) {
    const line = String(b.exception).split("\n")[0];
    const msg = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : line;
    if (msg) return msg;
  }
  if (status === 403) return "You don't have access to this. Please sign in again.";
  if (status === 404) return "Not found.";
  if (status === 417 || status === 409) return "That could not be saved.";
  if (status >= 500) return "The server had a problem. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

export async function call<T = unknown>(
  method: string,
  args: Record<string, unknown> = {},
  opts: { post?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const url = `/api/method/${method}`;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === "") continue;
    clean[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  if (!navigator.onLine) throw new ApiError("You're offline. Check your internet and try again.", 0, true);
  let res: Response;
  try {
    if (opts.post) {
      res = await fetch(url, {
        method: "POST",
        credentials: "include",
        signal: opts.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Frappe-CSRF-Token": csrf(),
        },
        body: JSON.stringify(clean),
      });
    } else {
      const qs = new URLSearchParams(clean).toString();
      res = await fetch(qs ? `${url}?${qs}` : url, {
        credentials: "include",
        signal: opts.signal,
        headers: { Accept: "application/json" },
      });
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Could not reach the server. Check your internet and try again.", 0, true);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 403 && /login|session/i.test(JSON.stringify(body ?? ""))) {
      window.location.href = "/mahaveermetalic/login";
    }
    throw new ApiError(messageFrom(body, res.status), res.status);
  }
  return (body as { message: T })?.message;
}

export type ApiState<T> = {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
};

/**
 * GET a method and keep it fresh: refetches when the app comes back to the foreground
 * or back online, and retries a network failure twice before showing it. A server
 * refusal (a real error) is shown at once — retrying it would only say the same thing.
 */
export function useApi<T>(method: string | null, args: Record<string, unknown> = {}, refreshMs = 0): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!method);
  const key = method ? `${method}?${JSON.stringify(args)}` : "";
  const [tick, setTick] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    if (!method) return;
    const ctrl = new AbortController();
    let attempt = 0;
    setLoading(true);
    const run = () => {
      call<T>(method, args, { signal: ctrl.signal })
        .then((d) => {
          if (!live.current) return;
          setData(d);
          setError(null);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError" || !live.current) return;
          const err = e instanceof ApiError ? e : new ApiError(String((e as Error)?.message || e));
          if (err.offline && attempt < 2 && navigator.onLine) {
            attempt += 1;
            setTimeout(run, 800 * attempt);
            return;
          }
          setError(err);
          setLoading(false);
        });
    };
    run();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    if (!method) return;
    const again = () => setTick((t) => t + 1);
    const onVisible = () => { if (document.visibilityState === "visible") again(); };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("mm-refresh", again);
    const timer = refreshMs > 0 ? window.setInterval(() => {
      if (document.visibilityState === "visible") again();
    }, refreshMs) : 0;
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("mm-refresh", again);
      if (timer) window.clearInterval(timer);
    };
  }, [method, refreshMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Ask every mounted screen to refetch (after an action changed something). */
export function refreshAll() {
  document.dispatchEvent(new CustomEvent("mm-refresh"));
}

export function fmtKg(n: number | null | undefined): string {
  const v = Number(n || 0);
  return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`;
}

export function fmtNum(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(String(d).length <= 10 ? `${d}T00:00:00` : String(d).replace(" ", "T"));
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtAgo(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(String(d).replace(" ", "T"));
  const s = Math.max(0, (Date.now() - dt.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
