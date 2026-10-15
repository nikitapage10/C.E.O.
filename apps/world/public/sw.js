/**
 * The Desk's service worker (#135): what lets the Desk sit on a phone's home screen like an app, and show a ping.
 *
 * It keeps nothing. No cache, no copy of the Lattice, no private data: every request goes to the network as usual.
 * Only a page load that can't reach the network gets a short "you're offline" page instead of the browser's error.
 *
 * A ping (api/desk-pings.ts) arrives as a push with { title, body, url }: short, lock-screen-safe words written by
 * the server (counts, never issue text). Tapping it opens the Desk at that tab, or brings an open Desk forward there.
 */

/** The Desk's tabs: the only places a ping may open. Anything else opens the Desk's front page. */
const TABS = ["/", "/relay", "/foundry", "/systems", "/chronicle"];

const OFFLINE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline · C.E.O.</title>
<style>
  html, body { margin: 0; height: 100%; background: #04060b; color: #e8f1ff; font: 15px/1.5 system-ui, sans-serif; }
  main { display: grid; place-content: center; gap: 10px; height: 100%; padding: 24px; text-align: center; }
  h1 { margin: 0; font: 300 26px Georgia, serif; letter-spacing: 0.3em; color: #8fe8ff; }
  p { margin: 0; color: #8a93a6; }
</style></head>
<body><main><h1>C.E.O.</h1><p>The Desk is offline. It comes back as soon as this device does.</p></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Page loads only, straight from the network; everything else isn't touched at all.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
        }),
    ),
  );
});

/** A ping's words, kept short and plain whatever arrives. */
function readPing(data) {
  let got = {};
  try {
    got = data ? data.json() : {};
  } catch {
    got = {};
  }
  const line = (v, max, fallback) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback);
  return {
    title: line(got.title, 60, "C.E.O. Desk"),
    body: line(got.body, 160, "Something needs your call."),
    url: TABS.includes(got.url) ? got.url : "/",
  };
}

self.addEventListener("push", (event) => {
  const ping = readPing(event.data);
  event.waitUntil(
    self.registration.showNotification(ping.title, {
      body: ping.body,
      // One ping on the screen at a time: a new one replaces the last instead of stacking up.
      tag: "ceo-desk",
      renotify: true,
      icon: "/desk/icon-192.png",
      badge: "/desk/badge-96.png",
      data: { url: ping.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = TABS.includes(event.notification.data && event.notification.data.url) ? event.notification.data.url : "/";
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const desk = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (desk) {
        // The Desk moves itself to the tab (apps/world/src/desk/pings.ts), without a reload.
        desk.postMessage({ type: "ceo-desk-open", url });
        if ("focus" in desk) await desk.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
