/* Mahaveer Metalic LLP — service worker.
 *
 * Served by api.push.service_worker with Service-Worker-Allowed: /mahaveermetalic, so it
 * controls the whole app. Three jobs and no more:
 *   1. show a push notification, and open the right screen when it is tapped;
 *   2. when a page cannot be loaded at all (no signal), show a friendly offline page
 *      instead of the browser's dinosaur;
 *   3. nothing else — API calls and assets go straight to the network, so nobody is ever
 *      shown yesterday's orders from a cache.
 */

const VERSION = "mm-sw-1";
const OFFLINE_URL = "/assets/mahaveermetalic/mahaveermetalic/offline.html";
const ICON = "/assets/mahaveermetalic/mahaveermetalic/icon-192.png";
const BADGE = "/assets/mahaveermetalic/mahaveermetalic/badge-96.png";
const APP = "/mahaveermetalic";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll([OFFLINE_URL, ICON]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Mahaveer Metalic", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Mahaveer Metalic";
  const options = {
    body: data.body || "",
    icon: ICON,
    badge: BADGE,
    tag: data.tag || "mm",
    renotify: true,
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [200, 100, 200, 100, 300] : [120],
    data: { url: data.url || APP },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || APP, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin + APP)) {
          return w.focus().then((f) => (f && "navigate" in f ? f.navigate(target) : f));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
