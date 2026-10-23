/**
 * The Desk's pings (#135, api/_desk/pings.ts), as a function on the site (Azure, #313): a phone with the Desk on its home screen gets
 * one notification when something needs Nikita's call (a new idea waiting for the pick, a question from Rivet, a
 * blocker), instead of an email.
 *
 * GET                                   → { ready, key? }: whether pings are set up here, and the server's public
 *                                         VAPID key for pushManager.subscribe() (public by design).
 * POST { action: "on", subscription }   → signed in only (#132, requireSession): stores this device's push
 *                                         subscription against the passkey it signed in with, and sends one
 *                                         welcome ping so Nikita sees it works. { ok, welcomed }.
 * POST { action: "off", endpoint }      → signed in only: drops that subscription.
 * POST { action: "scan" }               → for the Desk pings workflow (.github/workflows/desk-pings.yml), with
 *                                         `Authorization: Bearer <DESK_PINGS_SECRET>`: reads the Foundry's open
 *                                         issues, decides what needs Nikita (planPings) and sends one ping to every
 *                                         enrolled device that turned pings on. { pinged, held, devices }: counts only.
 * Signing out (api/desk-auth.ts, "signout" with the device's endpoint) and removing a device drop its pings too.
 *
 * Pushes are standard Web Push (RFC 8030, 8291, 8292) through `web-push`: the payload is encrypted for the device,
 * and the push service (Apple's, Google's, Mozilla's, Microsoft's) only ever sees ciphertext.
 *
 * Environment (the Function App's settings, from Key Vault): DESK_VAPID_PUBLIC_KEY, DESK_VAPID_PRIVATE_KEY (the
 * server's push key pair; the private one never leaves the server), DESK_VAPID_SUBJECT (optional: an https: or mailto: contact the push services may
 * use; defaults to the site's address), DESK_PINGS_SECRET (the workflow reads it from the Key Vault at run time), plus
 * FOUNDRY_DESK_KEY and the blob store, as for sign-in. Nothing here logs or returns a key, a secret or an endpoint.
 */

import webpush from "web-push";
import { keyMatches } from "./_desk/keys.js";
import { dropEndpoint, liveSubs, needsOf, PING_TTL_S, pingText, planPings, readSubscription, WELCOME, withSub, type GhIssueLite, type PingSub, type PingText } from "./_desk/pings.js";
import { requireSession, withCookie, type DeskDeps } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import { githubToken } from "./_github.js";

const REPO = "nikitapage10/C.E.O.";
const SITE = "https://thankful-forest-019308c1e.5.azurestaticapps.net";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** How one push went: delivered to the push service, gone for good (the device unsubscribed), or failed this time. */
export type Sent = "ok" | "gone" | "failed";

export interface PingDeps extends DeskDeps {
  /** The server's public push key, or "" when pings aren't set up. */
  publicKey: string;
  /** DESK_PINGS_SECRET, or "". */
  secret: string;
  send: (sub: PingSub, text: PingText) => Promise<Sent>;
  /** The Foundry's open issues. */
  issues: () => Promise<GhIssueLite[]>;
}

const env = (name: string) => process.env[name] ?? "";

/** The VAPID contact: DESK_VAPID_SUBJECT when it is an https: or mailto: address, else the site itself. */
export function vapidSubject(given = env("DESK_VAPID_SUBJECT")): string {
  return /^(https:\/\/|mailto:)\S+$/.test(given) ? given : SITE;
}

export async function webPushSend(sub: PingSub, text: PingText): Promise<Sent> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(text), {
      vapidDetails: { subject: vapidSubject(), publicKey: env("DESK_VAPID_PUBLIC_KEY"), privateKey: env("DESK_VAPID_PRIVATE_KEY") },
      TTL: PING_TTL_S,
      urgency: "normal",
      // A newer ping replaces one the phone hasn't collected yet, so a phone that was off gets the latest, once.
      topic: "ceo-desk",
      timeout: 8_000,
    });
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: unknown }).statusCode;
    // 404 and 410: the subscription is gone (unsubscribed, app removed). Anything else may work next time.
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}

async function openIssues(): Promise<GhIssueLite[]> {
  const token = await githubToken("read");
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues?labels=foundry&state=open&per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return (await res.json()) as GhIssueLite[];
}

const live = (): PingDeps => ({
  deskKey: env("FOUNDRY_DESK_KEY"),
  store: pickAuthStore(),
  now: Date.now(),
  publicKey: env("DESK_VAPID_PUBLIC_KEY") && env("DESK_VAPID_PRIVATE_KEY") ? env("DESK_VAPID_PUBLIC_KEY") : "",
  secret: env("DESK_PINGS_SECRET"),
  send: webPushSend,
  issues: openIssues,
});

const ready = (deps: PingDeps) => Boolean(deps.publicKey && deps.deskKey && deps.store);

export function handleGet(deps: PingDeps = live()): Response {
  return ready(deps) ? json({ ready: true, key: deps.publicKey }) : json({ ready: false });
}

/** Sends one ping to each device; drops the ones the push service says are gone. Returns how many took it. */
export async function deliver(store: AuthStore, subs: PingSub[], text: PingText, send: PingDeps["send"]): Promise<number> {
  const results = await Promise.all(subs.map((s) => send(s, text)));
  const gone = new Set(subs.filter((_, i) => results[i] === "gone").map((s) => s.endpoint));
  if (gone.size) {
    const state = await store.pings();
    await store.savePings({ ...state, subs: state.subs.filter((s) => !gone.has(s.endpoint)) });
  }
  return results.filter((r) => r === "ok").length;
}

/** The workflow's scan: one ping for whatever newly needs Nikita, or nothing. */
export async function scan(deps: PingDeps & { store: AuthStore }): Promise<Response> {
  let issues: GhIssueLite[];
  try {
    issues = await deps.issues();
  } catch {
    // Nothing is decided on a failed read: the next scan tries again with the same memory.
    return json({ error: "github" }, 502);
  }
  const passkeys = await deps.store.passkeys();
  const state = await deps.store.pings();
  const open = new Set(issues.filter((i) => !i.pull_request).map((i) => i.number));
  const plan = planPings(needsOf(issues), state.sent, deps.now, open);
  const subs = liveSubs(state.subs, passkeys);
  // What is about to be pinged is written down first, so a second scan landing now doesn't ping it again.
  // The scan's own time too: it shows the workflow's secret matches the site's (the setup list on Today, #164).
  await deps.store.savePings({ ...state, sent: plan.sent, scanned: deps.now });
  if (!plan.ping.length || !subs.length) return json({ pinged: 0, held: plan.held, devices: subs.length });
  const took = await deliver(deps.store, subs, pingText(plan.ping, plan.morning), deps.send);
  return json({ pinged: plan.ping.length, held: 0, devices: took });
}

export async function handlePost(request: Request, deps: PingDeps = live()): Promise<Response> {
  if (!ready(deps) || !deps.store) return json({ error: "not-set-up" }, 503);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const body = (await request.json().catch(() => null)) as { action?: unknown; subscription?: unknown; endpoint?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "bad-request" }, 400);
  const store = deps.store;

  if (body.action === "scan") {
    const auth = request.headers.get("authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!deps.secret || !keyMatches(given, deps.secret)) return json({ error: "unauthorized" }, 401);
    return scan({ ...deps, store });
  }

  // Everything else is a device turning its own pings on or off: only in a passkey session, from the Desk itself.
  const signed = await requireSession(request, deps);
  if (!signed.ok) return signed.response;

  if (body.action === "on") {
    const given = readSubscription(body.subscription);
    if (!given) return withCookie(json({ error: "bad-subscription" }, 400), signed);
    const sub: PingSub = { ...given, passkey: signed.passkey.id, added: new Date(deps.now).toISOString() };
    await store.savePings(withSub(await store.pings(), sub));
    const welcomed = (await deliver(store, [sub], WELCOME, deps.send)) > 0;
    return withCookie(json({ ok: true, welcomed }), signed);
  }

  if (body.action === "off") {
    await dropEndpoint(store, body.endpoint);
    return withCookie(json({ ok: true }), signed);
  }

  return withCookie(json({ error: "bad-request" }, 400), signed);
}

export function GET(): Response {
  return handleGet();
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
