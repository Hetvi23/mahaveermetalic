import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, BellRing, Download, Share, Smartphone } from "lucide-react";
import { toast } from "@/components/Toaster";
import { call, fmtAgo, PUSH, useApi } from "./api";
import {
  canInstall, disablePush, enablePush, isIOS, isStandalone, onInstallChange, promptInstall, pushStatus,
  type PushStatus,
} from "./pwa";
import { Async, useAction } from "./ui";

type Note = { name: string; title: string; body?: string; url?: string; category?: string; read: number; creation: string };
type InboxData = { rows: Note[]; unread: number };

/** Unread count for the header bell; refreshed every minute and on focus. */
export function useUnread(): number {
  const s = useApi<InboxData>(`${PUSH}.inbox`, { limit: 1 }, 60000);
  return s.data?.unread ?? 0;
}

export function PushCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [installable, setInstallable] = useState(canInstall());
  const { busy, run } = useAction();

  useEffect(() => {
    pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
    return onInstallChange(() => setInstallable(canInstall()));
  }, []);

  async function turnOn() {
    await run(async () => {
      try {
        const s = await enablePush();
        setStatus(s);
        if (s === "on") {
          await call(`${PUSH}.send_test`, {}, { post: true }).catch(() => undefined);
          toast("Notifications are on for this device");
        } else if (s === "denied") {
          toast("Notifications are blocked — allow them in your browser settings", "error");
        } else if (s === "server-off") {
          toast("The server can't send phone notifications yet. You'll still see them here.", "info");
        }
      } catch (e) {
        toast((e as Error).message || "Could not turn notifications on", "error");
      }
    });
  }

  async function turnOff() {
    await run(async () => {
      setStatus(await disablePush());
      toast("Notifications turned off for this device", "info");
    });
  }

  async function sendTest() {
    await run(async () => {
      try {
        const r = await call<{ devices: number }>(`${PUSH}.send_test`, {}, { post: true });
        toast(r.devices ? "Test sent — it should buzz in a few seconds" : "No device is set up for notifications", r.devices ? "success" : "info");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });
  }

  return (
    <div className="pt-card pt-push">
      <div className="pt-push-head">
        {status === "on" ? <BellRing size={22} /> : status === "denied" ? <BellOff size={22} /> : <Bell size={22} />}
        <div>
          <div className="pt-card-title">Phone notifications</div>
          <div className="pt-muted">
            {status === null && "Checking…"}
            {status === "on" && "On for this device."}
            {status === "off" && "Get a buzz when an order is accepted, urgent or delivered."}
            {status === "denied" && "Blocked. Allow notifications for this site in your browser settings, then reopen the app."}
            {status === "unsupported" && "This browser can't receive notifications. They will still appear in the list below."}
            {status === "server-off" && "The server isn't set up to send them yet. They will still appear below."}
            {status === "needs-install" && "On iPhone, add the app to your Home Screen first, then turn notifications on from there."}
          </div>
        </div>
      </div>
      {status === "needs-install" && (
        <div className="pt-hint">
          <Share size={16} /> Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then open Mahaveer from your Home Screen.
        </div>
      )}
      <div className="pt-actions">
        {(status === "off" || status === "server-off") && (
          <button type="button" className="pt-btn pt-btn-primary" disabled={busy} onClick={() => void turnOn()}>
            <Bell size={16} /> Turn on
          </button>
        )}
        {status === "on" && (
          <>
            <button type="button" className="pt-btn pt-btn-ghost" disabled={busy} onClick={() => void sendTest()}>Send test</button>
            <button type="button" className="pt-btn pt-btn-ghost" disabled={busy} onClick={() => void turnOff()}>Turn off</button>
          </>
        )}
        {installable && (
          <button type="button" className="pt-btn pt-btn-ghost" onClick={() => void promptInstall()}>
            <Download size={16} /> Install app
          </button>
        )}
        {!installable && !isStandalone() && !isIOS() && (
          <span className="pt-muted pt-small"><Smartphone size={14} /> Use your browser menu → Install app / Add to Home screen.</span>
        )}
      </div>
    </div>
  );
}

export default function Notifications() {
  const state = useApi<InboxData>(`${PUSH}.inbox`, { limit: 60 }, 60000);
  const nav = useNavigate();
  const { run } = useAction();

  function open(n: Note) {
    if (!n.read) void call(`${PUSH}.mark_read`, { name: n.name }, { post: true }).then(state.reload).catch(() => undefined);
    if (!n.url) return;
    const path = n.url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/mahaveermetalic/, "") || "/";
    nav(path);
  }

  return (
    <div className="pt-page">
      <PushCard />
      <div className="pt-section-head">
        <h2>Notifications</h2>
        {!!state.data?.unread && (
          <button type="button" className="pt-link" onClick={() => void run(async () => {
            await call(`${PUSH}.mark_read`, {}, { post: true });
            state.reload();
          })}>
            Mark all read
          </button>
        )}
      </div>
      <Async state={state} empty={(d) => !d.rows.length} emptyTitle="No notifications yet">
        {(d) => (
          <div className="pt-list">
            {d.rows.map((n) => (
              <button key={n.name} type="button" className={`pt-note ${n.read ? "" : "pt-note-unread"}`} onClick={() => open(n)}>
                <span className={`pt-note-dot pt-note-${n.category || "info"}`} aria-hidden />
                <span className="pt-note-main">
                  <span className="pt-note-title">{n.title}</span>
                  {n.body && <span className="pt-note-body">{n.body}</span>}
                </span>
                <span className="pt-note-time">{fmtAgo(n.creation)}</span>
              </button>
            ))}
          </div>
        )}
      </Async>
    </div>
  );
}
