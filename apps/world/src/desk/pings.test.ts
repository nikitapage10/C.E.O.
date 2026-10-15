import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HOME_SCREEN_HINT, PingSwitchView, type PingSwitchProps } from "./PingSwitch.tsx";
import { isAppleMobile, keyBytes, pingSupport } from "./pings.ts";
import { SignInPanel } from "./SignIn.tsx";

/** The Desk on a phone (#135): the manifest, the service worker, and the "Pings on this device" switch. */

const PUBLIC = resolve(import.meta.dirname, "../../public");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("the Desk as a home-screen app", () => {
  const manifest = JSON.parse(readFileSync(resolve(PUBLIC, "manifest.webmanifest"), "utf8")) as {
    start_url: string;
    scope: string;
    display: string;
    name: string;
    short_name: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it("opens straight to the Desk, standalone, in the Lattice's navy", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.short_name).toBe("C.E.O.");
    expect(manifest.background_color).toBe("#04060b");
  });

  it("has the icons it names, at the sizes it says, with a maskable one", async () => {
    for (const icon of manifest.icons) {
      const file = resolve(PUBLIC, `.${icon.src}`);
      expect(existsSync(file), icon.src).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
    }
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("the page links the manifest and the iPhone icon", async () => {
    const html = readFileSync(resolve(PUBLIC, "../index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/desk/apple-touch-icon.png" />');
    expect((await sharp(resolve(PUBLIC, "desk/apple-touch-icon.png")).metadata()).width).toBe(180);
    expect(existsSync(resolve(PUBLIC, "desk/badge-96.png"))).toBe(true);
  });
});

/** Runs public/sw.js in a bare context with a fake service worker scope, and hands back its listeners. */
function loadWorker(clients: { url: string; postMessage: (m: unknown) => void; focus: () => Promise<void> }[] = []) {
  const source = readFileSync(resolve(PUBLIC, "sw.js"), "utf8");
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://ceo.test" },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => undefined,
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
    clients: { claim: async () => undefined, matchAll: async () => clients, openWindow: async (url: string) => void opened.push(url) },
  };
  runInNewContext(source, { self, fetch: () => Promise.reject(new Error("offline")), Response, URL });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (done = p), respondWith: (p: Promise<unknown>) => (done = p) });
    return done;
  };
  return { source, listeners, shown, opened, fire };
}

const pushOf = (data: unknown) => ({ data: { json: () => data } });

describe("the Desk's service worker", () => {
  it("keeps nothing: no cache, no copy of the Lattice or of anything private", () => {
    const { source, listeners } = loadWorker();
    expect(source).not.toMatch(/caches\s*\.|CacheStorage|indexedDB|localStorage/);
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "notificationclick", "push"]);
  });

  it("answers a page load that can't reach the network with a short offline page, and leaves other requests alone", async () => {
    const { fire } = loadWorker();
    const page = (await fire("fetch", { request: { mode: "navigate", url: "https://ceo.test/foundry" } })) as Response;
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("The Desk is offline");
    let answered = false;
    const { listeners } = loadWorker();
    listeners.fetch!({ request: { mode: "cors", url: "https://ceo.test/models/x.glb" }, respondWith: () => (answered = true) });
    expect(answered).toBe(false);
  });

  it("shows a ping as one notification, opening only one of the Desk's tabs", async () => {
    const { fire, shown } = loadWorker();
    await fire("push", pushOf({ title: "C.E.O. Desk", body: "Rivet has a question", url: "/foundry" }));
    expect(shown[0]).toMatchObject({ title: "C.E.O. Desk", options: { body: "Rivet has a question", tag: "ceo-desk", data: { url: "/foundry" } } });
    await fire("push", pushOf({ title: "x", body: "y", url: "https://evil.example/" }));
    expect((shown[1]!.options.data as { url: string }).url).toBe("/");
    await fire("push", { data: { json: () => JSON.parse("not json") } });
    expect(shown[2]).toMatchObject({ title: "C.E.O. Desk", options: { body: "Something needs your call." } });
  });

  it("tapping a ping brings an open Desk to the tab, or opens it there", async () => {
    const messages: unknown[] = [];
    let focused = false;
    const open = loadWorker([{ url: "https://ceo.test/", postMessage: (m) => messages.push(m), focus: async () => void (focused = true) }]);
    await open.fire("notificationclick", { notification: { close: () => undefined, data: { url: "/foundry" } } });
    expect(messages).toEqual([{ type: "ceo-desk-open", url: "/foundry" }]);
    expect(focused).toBe(true);
    const closed = loadWorker([]);
    await closed.fire("notificationclick", { notification: { close: () => undefined, data: { url: "/foundry" } } });
    expect(closed.opened).toEqual(["/foundry"]);
  });
});

describe("where pings can be turned on", () => {
  it("an iPhone in Safari needs the Desk on the home screen first", () => {
    expect(pingSupport({ ua: IPHONE, touchPoints: 5, standalone: false, push: false })).toBe("home-screen");
    expect(pingSupport({ ua: IPHONE, touchPoints: 5, standalone: true, push: true })).toBe("ok");
    expect(pingSupport({ ua: MAC, touchPoints: 5, standalone: false, push: true })).toBe("home-screen"); // an iPad
    expect(isAppleMobile(MAC, 0)).toBe(false);
  });

  it("Android and desktop browsers can, when they have Web Push", () => {
    expect(pingSupport({ ua: ANDROID, touchPoints: 5, standalone: false, push: true })).toBe("ok");
    expect(pingSupport({ ua: MAC, touchPoints: 0, standalone: false, push: true })).toBe("ok");
    expect(pingSupport({ ua: ANDROID, touchPoints: 5, standalone: false, push: false })).toBe("unsupported");
  });

  it("turns the server's public key into bytes", () => {
    expect([...keyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("the Pings on this device switch", () => {
  const render = (p: Partial<PingSwitchProps>) => renderToStaticMarkup(createElement(PingSwitchView, { support: "ok", state: "off", onToggle: () => undefined, ...p }));

  it("is a real switch, in the Desk's sign-in bar look", () => {
    const off = render({});
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("Pings on this device");
    expect(off).toContain("desk-auth__pings");
    const on = render({ state: "on" });
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("desk-switch--on");
    expect(on).toContain("quiet from 10pm to 7am");
  });

  it("on an iPhone in Safari: one line to add the Desk to the home screen first, and the switch off", () => {
    const html = render({ support: "home-screen" });
    expect(html).toContain(HOME_SCREEN_HINT);
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("shows nothing where the browser can't take pings", () => {
    expect(render({ support: "unsupported" })).toBe("");
  });

  it("sits on the signed-in bar only", () => {
    const base = { now: 0, onSignIn: () => undefined, onAdd: () => undefined, onEnrol: () => undefined, onSignOut: () => undefined, onRemove: () => undefined, defaultLabel: "iPhone", pings: createElement("i", { className: "the-switch" }) };
    expect(renderToStaticMarkup(createElement(SignInPanel, { ...base, auth: { status: "in", device: "iPhone", devices: [] } }))).toContain("the-switch");
    expect(renderToStaticMarkup(createElement(SignInPanel, { ...base, auth: { status: "out" } }))).not.toContain("the-switch");
  });
});
