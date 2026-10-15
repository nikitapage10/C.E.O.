/**
 * The Desk on a phone (#135), browser side: the service worker (public/sw.js) that lets the Desk sit on the home
 * screen, and the "Pings on this device" switch. Pings are standard Web Push: the browser makes a subscription for
 * the server's public key, and the Desk hands it to api/desk-pings.ts, which keeps it only while this device is
 * signed in with its passkey (signing out drops it; so does removing the device).
 *
 * Kept free of the sign-in store, so signin.ts can call the two device helpers on sign-out without a loop.
 */

import { create } from "zustand";
import { navigateTo } from "../route.ts";

/** Where pings can be turned on: here, not until the Desk is on the home screen (iPhone, iPad), or not at all. */
export type PingSupport = "ok" | "home-screen" | "unsupported";

export type PingState = "checking" | "off" | "on" | "busy" | "blocked" | "not-set-up";

const hasWindow = () => typeof window !== "undefined" && typeof navigator !== "undefined";

/** An iPhone or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isAppleMobile(ua: string, touchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  if (!hasWindow()) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * Whether this browser can take pings. Safari on an iPhone or iPad only offers Web Push to a site added to the
 * home screen (iOS 16.4 and later), so there the answer is "add it first".
 */
export function pingSupport(env: { ua: string; touchPoints: number; standalone: boolean; push: boolean }): PingSupport {
  if (isAppleMobile(env.ua, env.touchPoints) && !env.standalone) return "home-screen";
  return env.push ? "ok" : "unsupported";
}

const hereSupport = (): PingSupport =>
  hasWindow()
    ? pingSupport({
        ua: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints ?? 0,
        standalone: isStandalone(),
        push: "serviceWorker" in navigator && typeof window.PushManager === "function" && typeof window.Notification === "function",
      })
    : "unsupported";

/** The server's public key (base64url) as pushManager.subscribe() takes it. */
export function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "="));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ── The service worker ── */

let registered: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the Desk's service worker (production builds only: a dev server keeps none), and lets a tapped ping move
 * an open Desk to its tab without a reload.
 */
export function startDeskWorker(prod = import.meta.env.PROD): Promise<ServiceWorkerRegistration | null> {
  if (registered) return registered;
  if (!prod || !hasWindow() || !("serviceWorker" in navigator)) return (registered = Promise.resolve(null));
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const msg = e.data as { type?: unknown; url?: unknown } | null;
    if (msg?.type === "ceo-desk-open" && typeof msg.url === "string" && msg.url.startsWith("/")) navigateTo(msg.url);
  });
  registered = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  return registered;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasWindow() || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** This device's push endpoint, if it has pings on: sent with a sign-out so the server drops it. */
export async function pushEndpoint(): Promise<string | null> {
  return (await currentSubscription())?.endpoint ?? null;
}

/** Turns this device's pings off in the browser too (after a sign-out, or removing this device). */
export async function dropLocalPush(): Promise<void> {
  const sub = await currentSubscription();
  await sub?.unsubscribe().catch(() => false);
  usePings.setState({ state: "off" });
}

/* ── The switch ── */

const post = (body: unknown) => fetch("/api/desk-pings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });

interface PingsStore {
  support: PingSupport;
  state: PingState;
  /** A line under the switch after the last change, if any. */
  note: string;
  check: () => Promise<void>;
  /** Turns pings on for this device: asks the browser's permission, subscribes, and hands the server the subscription. */
  turnOn: () => Promise<"ok" | "signed-out" | "failed">;
  turnOff: () => Promise<void>;
}

export const PING_NOTE = {
  blocked: "Notifications are blocked for the Desk in this browser's settings.",
  failed: "Pings didn't turn on. Try again in a moment.",
  "not-set-up": "Pings aren't set up on the server yet.",
} as const;

export const usePings = create<PingsStore>((set, get) => ({
  support: "unsupported",
  state: "checking",
  note: "",
  check: async () => {
    const support = hereSupport();
    if (support !== "ok") return set({ support, state: "off" });
    const blocked = Notification.permission === "denied";
    set({ support, state: blocked ? "blocked" : (await currentSubscription()) ? "on" : "off" });
  },
  turnOn: async () => {
    if (get().support !== "ok") return "failed";
    set({ state: "busy", note: "" });
    try {
      const info = (await (await fetch("/api/desk-pings", { credentials: "same-origin" })).json()) as { ready?: boolean; key?: string };
      if (!info.ready || !info.key) {
        set({ state: "not-set-up", note: PING_NOTE["not-set-up"] });
        return "failed";
      }
      if ((await Notification.requestPermission()) !== "granted") {
        set({ state: Notification.permission === "denied" ? "blocked" : "off", note: Notification.permission === "denied" ? PING_NOTE.blocked : "" });
        return "failed";
      }
      const reg = (await startDeskWorker(true)) && (await navigator.serviceWorker.ready);
      if (!reg) throw new Error("no worker");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) }));
      const res = await post({ action: "on", subscription: sub.toJSON() });
      if (res.status === 401) {
        await sub.unsubscribe().catch(() => false);
        set({ state: "off" });
        return "signed-out";
      }
      if (!res.ok) throw new Error(String(res.status));
      set({ state: "on" });
      return "ok";
    } catch {
      set({ state: "off", note: PING_NOTE.failed });
      return "failed";
    }
  },
  turnOff: async () => {
    set({ state: "busy", note: "" });
    const sub = await currentSubscription();
    if (sub) await post({ action: "off", endpoint: sub.endpoint }).catch(() => null);
    await sub?.unsubscribe().catch(() => false);
    set({ state: "off" });
  },
}));
