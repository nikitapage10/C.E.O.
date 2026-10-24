/**
 * Setup asks (#324; docs/SKIPPY.md, "Setup asks"): when a submind's thread needs something set up that only Nikita
 * can allow (creating a GitHub App, turning on a setting, granting a managed identity a role), it posts an ask on the
 * Desk instead of doing it. Each ask is one line saying what it will do and where, and a "What this does" box: the
 * service, what changes, why, and the cost and whether it can be undone. It sits beside the hand-off flags (#312) on
 * the room's Desk page; Nikita taps Approve or Decline there, in the passkey session; the thread reads the answer
 * with the read key, does the work, and closes the ask with a Trail line.
 *
 * The rule (Skippy, recorded on #324): agents never type keys, passwords or tokens, and never do sign-ins. Each ask
 * names its route, and the first choice is the one with no key at all:
 *   managed-identity  Azure's managed identity (a role assignment, no secret anywhere)
 *   oidc              federated credentials (GitHub Actions OIDC into Azure, no secret anywhere)
 *   key-vault-flow    a machine-to-machine flow that lands the key straight in the Key Vault (a GitHub App manifest
 *                     with its callback on the Function App), never through a person, a file or a thread
 *   browser           steps in Nikita's own browser that stop at every sign-in and passkey, which stay Nikita's
 * An ask whose words ask anyone to type, paste or send a key, password or token is refused (422 asks-for-secret).
 *
 * POST /api/setup-asks  x-ceo-room-key: <SUBMIND_FEED_TOKEN> (or Authorization: Bearer), JSON:
 *                         { action: "ask", room, title, where, service, changes, why, cost, reversible, route } → 201 { ok, id }
 *                         { action: "close", id, outcome: "done" | "dropped", trail } → 200 { ok }
 *                       "done" only once Nikita approved; "dropped" from open or approved. The answers say only that
 *                       the write was kept (the feed key reads nothing). A new ask pings Nikita's phone: counts-only
 *                       words, never what it says, quiet hours kept.
 *                       Refused: 401 the wrong key, 415 not JSON, 413 too big, 400 a bad shape, 422 anything that looks
 *                       private or asks for a secret, 404 no such ask, 409 not in a state that allows it, 429 past five
 *                       new asks an hour or eight still open, 503 no store.
 * POST /api/setup-asks  with the Desk's passkey session (requireSession), JSON { id, decision: "approve" | "decline" }
 *                       → 200 { ok, ask }. Only an open ask; a decline closes it with its Trail line at once.
 * GET  /api/setup-asks  the asks, open ones first, then newest first: a Desk passkey session, or the read key (with
 *                       an optional ?room= of the four active rooms). Anyone else: 401. There is no public view: the
 *                       public site never shows a setup ask.
 *
 * Kept in the private blob store (`desk/rooms/setup.json`, the `ceo-state` container on Azure): the last 100 asks,
 * none untouched for 30 days. Nothing in it is a secret, and nothing from it is logged. Azure only (azure/src/index.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { liveSubs, isQuiet, type PingText } from "../_desk/pings.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { privateParts, PRIVATE_LABEL, type PrivateKind } from "../_privacy.js";
import { KEY_LOG_ROOMS, bearerOf, roomKeyOf, roomKeyValue } from "../_site/roomkeys.js";
import { deliver, webPushSend } from "../desk-pings.js";

type Env = Record<string, string | undefined>;

export const SETUP_ROOMS = KEY_LOG_ROOMS;
export type SetupRoom = (typeof SETUP_ROOMS)[number];

/** How an ask gets done, in the order to try them: the first two need no key at all. */
export const SETUP_ROUTES = ["managed-identity", "oidc", "key-vault-flow", "browser"] as const;
export type SetupRoute = (typeof SETUP_ROUTES)[number];

export type SetupState = "open" | "approved" | "declined" | "done" | "dropped";

export const SETUP_STORE_PATH = "desk/rooms/setup.json";
/** The caps on each part of an ask. */
export const SETUP_MAX = { title: 120, where: 60, service: 60, changes: 200, why: 200, cost: 120, trail: 200 } as const;
/** Kept: the last 100 asks, none untouched for 30 days. */
export const SETUP_KEEP = 100;
export const SETUP_DAYS = 30;
const SETUP_MS = SETUP_DAYS * 24 * 60 * 60 * 1000;
/** A leaked feed key can't bury the Desk: five new asks an hour, eight waiting at once. */
export const SETUP_PER_HOUR = 5;
export const SETUP_OPEN_MAX = 8;
const BODY_MAX = 4000;

export interface SetupAsk {
  id: string;
  /** ISO time it was asked. */
  at: string;
  room: SetupRoom;
  /** One line: what it will do and where. */
  title: string;
  /** Where it happens, in a few words ("github.com", "the Azure portal"). */
  where: string;
  /** "What this does". */
  service: string;
  changes: string;
  why: string;
  cost: string;
  reversible: boolean;
  route: SetupRoute;
  state: SetupState;
  /** When Nikita approved or declined it. */
  decidedAt?: string;
  /** When it closed (declined, done or dropped), and its Trail line. */
  closedAt?: string;
  trail?: string;
}

const isRoom = (v: unknown): v is SetupRoom => typeof v === "string" && (SETUP_ROOMS as readonly string[]).includes(v);
const isRoute = (v: unknown): v is SetupRoute => typeof v === "string" && (SETUP_ROUTES as readonly string[]).includes(v);
const STATES: readonly SetupState[] = ["open", "approved", "declined", "done", "dropped"];
const isState = (v: unknown): v is SetupState => typeof v === "string" && (STATES as readonly string[]).includes(v);
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isoOf = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");
export const isSetupId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{8,40}$/.test(v);
/** Still waiting on someone: Nikita (open) or the thread (approved). */
export const isWaiting = (a: Pick<SetupAsk, "state">) => a.state === "open" || a.state === "approved";

/**
 * Words that would have someone type, paste or hand over a secret ("paste the token into…", "enter your password").
 * The rule on #324: no agent types one, and no ask asks Nikita to paste one; a key comes through a machine-to-machine
 * flow straight into the Key Vault, or isn't needed at all.
 */
const SECRET_ASK = /\b(?:paste[sd]?|pasting|types?|typed|typing|enter(?:s|ed|ing)?|cop(?:y|ies|ied|ying)|send (?:me|us|it)|share (?:the|your))\b[^.;:!?]{0,40}\b(?:keys?|tokens?|passwords?|passphrases?|secrets?|PATs?|credentials?)\b/i;
export const asksForSecret = (text: string): boolean => SECRET_ASK.test(text);

/** A stored ask, checked again on the way out: null when it isn't one. */
export function cleanAsk(v: unknown): SetupAsk | null {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const at = isoOf(a.at);
  const parts = {
    title: line(a.title, SETUP_MAX.title),
    where: line(a.where, SETUP_MAX.where),
    service: line(a.service, SETUP_MAX.service),
    changes: line(a.changes, SETUP_MAX.changes),
    why: line(a.why, SETUP_MAX.why),
    cost: line(a.cost, SETUP_MAX.cost),
  };
  if (!at || !isSetupId(a.id) || !isRoom(a.room) || !isRoute(a.route) || !isState(a.state) || typeof a.reversible !== "boolean") return null;
  if (Object.values(parts).some((p) => !p)) return null;
  const decidedAt = isoOf(a.decidedAt);
  const closedAt = isoOf(a.closedAt);
  const trail = line(a.trail, SETUP_MAX.trail);
  return { id: a.id, at, room: a.room, ...parts, reversible: a.reversible, route: a.route, state: a.state, ...(decidedAt && { decidedAt }), ...(closedAt && { closedAt }), ...(trail && { trail }) };
}

const touched = (a: SetupAsk) => Date.parse(a.closedAt ?? a.decidedAt ?? a.at);

/** The asks, oldest first: only good ones, none untouched for 30 days, the last 100. */
export function keepAsks(raw: unknown, now: number): SetupAsk[] {
  const from = now - SETUP_MS;
  return (Array.isArray(raw) ? raw : [])
    .map(cleanAsk)
    .filter((a): a is SetupAsk => a !== null && touched(a) >= from && Date.parse(a.at) <= now + 60_000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-SETUP_KEEP);
}

/** What the Desk and the threads read: the ones still waiting first, then the rest, each newest first. */
export function shownAsks(asks: SetupAsk[], room?: SetupRoom): SetupAsk[] {
  const mine = room ? asks.filter((a) => a.room === room) : asks;
  const newest = [...mine].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return [...newest.filter(isWaiting), ...newest.filter((a) => !isWaiting(a))].slice(0, 50);
}

/** A change to the asks: the asks as they become (null: unchanged), and what it came to. */
type Change<T> = (asks: SetupAsk[]) => { asks: SetupAsk[] | null; out: T };

export interface SetupStore {
  all(now: number): Promise<SetupAsk[]>;
  change<T>(now: number, fn: Change<T>): Promise<T>;
}

/** The asks in the private blob store; a write checks the ETag, so two writes at once both land. */
export class BlobSetupStore implements SetupStore {
  constructor(private readonly blob: BlobBackend) {}
  private async load(): Promise<unknown> {
    const found = await this.blob.get(SETUP_STORE_PATH);
    return found ? await new Response(found.stream).json().catch(() => []) : [];
  }
  async all(now: number): Promise<SetupAsk[]> {
    return keepAsks(await this.load(), now);
  }
  async change<T>(now: number, fn: Change<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const etag = await this.blob.etag(SETUP_STORE_PATH);
      const { asks, out } = fn(keepAsks(etag ? await this.load() : [], now));
      if (!asks) return out;
      try {
        await this.blob.put(SETUP_STORE_PATH, JSON.stringify(keepAsks(asks, now)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return out;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
  }
}

/** In memory, for tests. */
export class MemorySetupStore implements SetupStore {
  asks: unknown[] = [];
  async all(now: number): Promise<SetupAsk[]> {
    return keepAsks(structuredClone(this.asks), now);
  }
  async change<T>(now: number, fn: Change<T>): Promise<T> {
    const { asks, out } = fn(keepAsks(structuredClone(this.asks), now));
    if (asks) this.asks = keepAsks(asks, now);
    return out;
  }
}

export interface SetupDeps {
  env: Env;
  store: SetupStore | null;
  desk: DeskDeps;
  /** Pings Nikita's phones; how many took it. */
  ping: (text: PingText) => Promise<number>;
  now: number;
  newId?: () => string;
}

const live = (): SetupDeps => {
  const env = process.env;
  const blob = pickBlob(env);
  const auth = pickAuthStore(env);
  const pingsOn = Boolean(env.DESK_VAPID_PUBLIC_KEY && env.DESK_VAPID_PRIVATE_KEY && auth);
  return {
    env,
    store: blob ? new BlobSetupStore(blob) : null,
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: auth, now: Date.now() },
    ping: async (text) => {
      if (!pingsOn || !auth) return 0;
      const [state, passkeys] = await Promise.all([auth.pings(), auth.passkeys()]);
      const subs = liveSubs(state.subs, passkeys);
      return subs.length ? deliver(auth, subs, text, webPushSend) : 0;
    },
    now: Date.now(),
  };
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...headers } });
}

/** The Desk page each room's asks sit on, for the ping to open. */
const ROOM_PAGE: Record<SetupRoom, string> = { green: "/green", exchange: "/exchange", boiler: "/boiler", foundry: "/foundry" };

/** A new ask's ping: that there is one, never what it says. Safe on a lock screen. */
export const askPing = (room: SetupRoom): PingText => ({ title: "C.E.O. Desk", body: "A setup ask on the Desk is waiting for your OK.", url: ROOM_PAGE[room] });

type Refusal = { ok: false; status: number; error: string; held?: string[] };

/** Private-looking words, or a copy of a room key, in what a thread sent: the refusal, or null. */
function heldBack(text: string, env: Env): Refusal | null {
  const kinds: PrivateKind[] = privateParts(text);
  const keys = [roomKeyValue(env, "log"), roomKeyValue(env, "feed")].filter((k): k is string => Boolean(k));
  if (keys.some((k) => text.includes(k)) && !kinds.includes("key")) kinds.push("key");
  if (kinds.length) return { ok: false, status: 422, error: "private", held: [...new Set(kinds)].map((k) => PRIVATE_LABEL[k]) };
  if (asksForSecret(text)) return { ok: false, status: 422, error: "asks-for-secret" };
  return null;
}

const ASK_KEYS = ["action", "room", "title", "where", "service", "changes", "why", "cost", "reversible", "route"];
const CLOSE_KEYS = ["action", "id", "outcome", "trail"];

/** A thread's new ask, checked: its parts, or the refusal. */
export function readAsk(body: Record<string, unknown>, env: Env): { ok: true; ask: Omit<SetupAsk, "id" | "at" | "state"> } | Refusal {
  if (Object.keys(body).some((k) => !ASK_KEYS.includes(k))) return { ok: false, status: 400, error: "bad-request" };
  if (!isRoom(body.room)) return { ok: false, status: 400, error: "bad-room" };
  if (!isRoute(body.route)) return { ok: false, status: 400, error: "bad-route" };
  if (typeof body.reversible !== "boolean") return { ok: false, status: 400, error: "bad-request" };
  const names = ["title", "where", "service", "changes", "why", "cost"] as const;
  if (names.some((k) => typeof body[k] !== "string")) return { ok: false, status: 400, error: "bad-request" };
  if (names.some((k) => (body[k] as string).length > SETUP_MAX[k] * 2)) return { ok: false, status: 413, error: "too-long" };
  const parts = Object.fromEntries(names.map((k) => [k, line(body[k], SETUP_MAX[k])])) as Record<(typeof names)[number], string>;
  if (names.some((k) => !parts[k])) return { ok: false, status: 400, error: "missing" };
  const held = heldBack(names.map((k) => parts[k]).join("\n"), env);
  if (held) return held;
  return { ok: true, ask: { room: body.room, ...parts, reversible: body.reversible, route: body.route } };
}

/** The thread's side: a new ask, or closing one with its Trail line. The feed key only; reads nothing back. */
async function threadPost(body: Record<string, unknown>, deps: SetupDeps, store: SetupStore): Promise<Response> {
  const nowIso = new Date(deps.now).toISOString();
  if (body.action === "ask") {
    const got = readAsk(body, deps.env);
    if (!got.ok) return json({ error: got.error, ...(got.held && { held: got.held }) }, got.status);
    const id = (deps.newId ?? (() => crypto.randomUUID()))();
    const ask: SetupAsk = { id, at: nowIso, ...got.ask, state: "open" };
    let out: "ok" | "too-many";
    try {
      out = await store.change<typeof out>(deps.now, (asks) => {
        const lastHour = asks.filter((a) => deps.now - Date.parse(a.at) < 3_600_000).length;
        if (lastHour >= SETUP_PER_HOUR || asks.filter(isWaiting).length >= SETUP_OPEN_MAX) return { asks: null, out: "too-many" };
        return { asks: [...asks, ask], out: "ok" };
      });
    } catch {
      return json({ error: "unwritable" }, 502);
    }
    if (out === "too-many") return json({ error: "too-many" }, 429, { "Retry-After": "900" });
    // Quiet hours hold the ping (the ask still waits on the Desk); a failed ping never loses the ask.
    if (!isQuiet(deps.now)) await deps.ping(askPing(ask.room)).catch(() => 0);
    return json({ ok: true, id }, 201);
  }
  if (body.action === "close") {
    if (Object.keys(body).some((k) => !CLOSE_KEYS.includes(k))) return json({ error: "bad-request" }, 400);
    if (!isSetupId(body.id) || (body.outcome !== "done" && body.outcome !== "dropped") || typeof body.trail !== "string") return json({ error: "bad-request" }, 400);
    if (body.trail.length > SETUP_MAX.trail * 2) return json({ error: "too-long" }, 413);
    const trail = line(body.trail, SETUP_MAX.trail);
    if (!trail) return json({ error: "missing" }, 400);
    const held = heldBack(trail, deps.env);
    if (held) return json({ error: held.error, ...(held.held && { held: held.held }) }, held.status);
    const outcome = body.outcome;
    const id = body.id;
    let out: "ok" | "missing" | "not-yet" | "closed";
    try {
      out = await store.change<typeof out>(deps.now, (asks) => {
        const a = asks.find((x) => x.id === id);
        if (!a) return { asks: null, out: "missing" };
        if (!isWaiting(a)) return { asks: null, out: "closed" };
        // Done only once Nikita said yes: a thread can't approve its own ask.
        if (outcome === "done" && a.state !== "approved") return { asks: null, out: "not-yet" };
        return { asks: asks.map((x) => (x.id === id ? { ...x, state: outcome, closedAt: nowIso, trail } : x)), out: "ok" };
      });
    } catch {
      return json({ error: "unwritable" }, 502);
    }
    if (out === "missing") return json({ error: "missing" }, 404);
    if (out !== "ok") return json({ error: out }, 409);
    return json({ ok: true });
  }
  return json({ error: "bad-request" }, 400);
}

/** Nikita's side: Approve or Decline, in the passkey session. */
async function deskPost(body: Record<string, unknown>, deps: SetupDeps, store: SetupStore): Promise<Response> {
  if (Object.keys(body).some((k) => k !== "id" && k !== "decision")) return json({ error: "bad-request" }, 400);
  if (!isSetupId(body.id) || (body.decision !== "approve" && body.decision !== "decline")) return json({ error: "bad-request" }, 400);
  const id = body.id;
  const yes = body.decision === "approve";
  const nowIso = new Date(deps.now).toISOString();
  type Decided = { ok: true; ask: SetupAsk } | { ok: false; why: "missing" | "decided" };
  let out: Decided;
  try {
    out = await store.change<Decided>(deps.now, (asks) => {
      const a = asks.find((x) => x.id === id);
      if (!a) return { asks: null, out: { ok: false, why: "missing" } };
      if (a.state !== "open") return { asks: null, out: { ok: false, why: "decided" } };
      const next: SetupAsk = yes ? { ...a, state: "approved", decidedAt: nowIso } : { ...a, state: "declined", decidedAt: nowIso, closedAt: nowIso, trail: "Declined on the Desk; nothing was changed." };
      return { asks: asks.map((x) => (x.id === id ? next : x)), out: { ok: true, ask: next } };
    });
  } catch {
    return json({ error: "unwritable" }, 502);
  }
  if (!out.ok) return json({ error: out.why }, out.why === "missing" ? 404 : 409);
  return json({ ok: true, ask: out.ask });
}

export async function handlePost(request: Request, deps: SetupDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== "") return json({ error: "bad-request" }, 400);
  const key = roomKeyOf(request, deps.env);
  // Anything that carries a key must be the feed key; the read key and a wrong key get nothing.
  if (bearerOf(request) !== null && key !== "feed") return json({ error: "no-key" }, 401);
  const signed = key === "feed" ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const answer = async (): Promise<Response> => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad-request" }, 415);
    if (!deps.store) return json({ error: "not-set-up" }, 503);
    const text = await request.text().catch(() => "");
    if (text.length > BODY_MAX) return json({ error: "too-big" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "bad-request" }, 400);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "bad-request" }, 400);
    const body = raw as Record<string, unknown>;
    return key === "feed" ? threadPost(body, deps, deps.store) : deskPost(body, deps, deps.store);
  };
  const res = await answer();
  return signed?.ok ? withCookie(res, signed) : res;
}

export async function handleGet(request: Request, deps: SetupDeps): Promise<Response> {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const room = url.searchParams.get("room");
  if (keys.some((k) => k !== "room") || url.searchParams.getAll("room").length > 1 || (room !== null && !isRoom(room))) return json({ error: "bad-request" }, 400);
  const key = roomKeyOf(request, deps.env);
  if (bearerOf(request) !== null && key !== "log") return json({ error: "no-key" }, 401);
  const signed = key === "log" ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const read = async (): Promise<Response> => {
    if (!deps.store) return json({ error: "not-set-up" }, 503);
    try {
      return json({ asks: shownAsks(await deps.store.all(deps.now), room ?? undefined) });
    } catch {
      return json({ error: "unreadable" }, 502);
    }
  };
  const res = await read();
  return signed?.ok ? withCookie(res, signed) : res;
}

export function GET(request: Request): Promise<Response> {
  return handleGet(request, live());
}

export function POST(request: Request): Promise<Response> {
  return handlePost(request, live());
}
