import { call, PUSH } from "./api";

/**
 * Service worker, phone notifications and "Add to Home Screen".
 *
 * The worker is served by the server (api.push.service_worker) rather than from
 * /assets, because a worker only controls pages under its own folder unless the server
 * says otherwise — and only the server can say so.
 */

const SW_URL = `/api/method/${PUSH}.service_worker`;
const SCOPE = "/mahaveermetalic";

export function swSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

export function pushSupported(): boolean {
  return swSupported() && "PushManager" in window && "Notification" in window;
}

/** iPhone/iPad Safari: push works only once the app is on the Home Screen. */
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker
      .register(SW_URL, { scope: SCOPE })
      .then((r) => {
        // Pick up a new worker without waiting for every tab to close.
        r.update().catch(() => undefined);
        return r;
      })
      .catch((e) => {
        console.warn("Service worker not registered:", e);
        return null;
      });
  }
  return registration;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushStatus = "unsupported" | "needs-install" | "denied" | "off" | "on" | "server-off";

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registerServiceWorker();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/**
 * Turn notifications on for this device. Must run inside a tap — browsers refuse a
 * permission prompt that was not started by the user.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const cfg = await call<{ enabled: boolean; public_key?: string; reason?: string }>(
    `${PUSH}.push_config`, {}, { post: true },
  );
  if (!cfg?.enabled || !cfg.public_key) return "server-off";
  const reg = await registerServiceWorker();
  if (!reg) return "unsupported";
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const want = keyBytes(cfg.public_key);
  // A subscription made under an older key can never be delivered to — replace it.
  if (sub) {
    const have = sub.options?.applicationServerKey;
    const same = have && new Uint8Array(have).every((b, i) => b === want[i]);
    if (!same) {
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want as BufferSource });
  }
  await call(`${PUSH}.subscribe`, { subscription: sub.toJSON(), user_agent: navigator.userAgent }, { post: true });
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await call(`${PUSH}.unsubscribe`, { endpoint: sub.endpoint }, { post: true }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
}

/** Re-send this device's subscription after login — the same phone may have changed hands. */
export async function resyncPush(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const reg = await registerServiceWorker();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await call(`${PUSH}.subscribe`, { subscription: sub.toJSON(), user_agent: navigator.userAgent }, { post: true });
  } catch { /* best effort */ }
}

// ---- Add to Home Screen ------------------------------------------------------------

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function canInstall(): boolean {
  return !!deferred && !isStandalone();
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferred = null;
  listeners.forEach((l) => l());
  return choice.outcome === "accepted";
}
