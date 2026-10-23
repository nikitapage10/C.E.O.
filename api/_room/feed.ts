/**
 * The room feed (#281; docs/SKIPPY.md, "Room keys"): short events the active subminds post from their project threads
 * ("the Green's waiver call is in", "Merged the gate fix"). Each event is a room, a one-line title and an optional
 * detail. Azure only (registered in azure/src/index.ts), like the email agent: the keys live only in its Key Vault.
 *
 * POST /api/room-feed   x-ceo-room-key: <SUBMIND_FEED_TOKEN> (or Authorization: Bearer), JSON { room, title, detail? } → 201 { ok, id }.
 *                       The write-only key: the answer says only that the event was kept, never what is stored.
 *                       Refused: 401 without the feed key (the read key included), 415 not JSON, 413 too big,
 *                       400 a bad shape, 422 anything that looks private (the Desk's own privacy check, or a copy of
 *                       a room key), 429 past 20 events per room in an hour, 503 no store.
 * GET  /api/room-feed   newest first. With a Desk passkey session, or the read key: every event with its detail.
 *                       Otherwise (and always with ?view=public, which the Lattice asks for): the titles only,
 *                       scrubbed of money and links (publicTitle), never a detail.
 *
 * Kept in the private blob store (`desk/rooms/feed.json`, the `ceo-state` container on Azure): the last 200 events,
 * none older than 14 days. Nothing in it is a secret, and nothing from it is logged.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { privateParts, type PrivateKind } from "../_privacy.js";
import { KEY_LOG_ROOMS, readsWithLogKey, roomKeyOf, roomKeyValue } from "../_site/roomkeys.js";

type Env = Record<string, string | undefined>;

/** The rooms an event can belong to: the four with an active submind (docs/SKIPPY.md). */
export const FEED_ROOMS = KEY_LOG_ROOMS;
export type FeedRoom = (typeof FEED_ROOMS)[number];

export const FEED_PATH = "desk/rooms/feed.json";
export const TITLE_MAX = 120;
export const DETAIL_MAX = 600;
/** Kept: the last 200 events, none older than 14 days. */
export const FEED_KEEP = 200;
export const FEED_DAYS = 14;
const FEED_MS = FEED_DAYS * 24 * 60 * 60 * 1000;
/** The most a read sends. */
export const FEED_SHOW = 50;
/** A leaked feed key can't flood the Desk: at most this many events per room in an hour. */
export const FEED_PER_HOUR = 20;
const BODY_MAX = 4000;

export interface RoomEvent {
  id: string;
  /** ISO time it was posted. */
  at: string;
  room: FeedRoom;
  title: string;
  detail?: string;
}

/** What anyone without a session sees: the scrubbed title, no detail. */
export type PublicEvent = Omit<RoomEvent, "detail">;

const isFeedRoom = (v: unknown): v is FeedRoom => typeof v === "string" && (FEED_ROOMS as readonly string[]).includes(v);
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Money in any of the usual spellings: $12, $1,200.50, 3.5k USD, 40 dollars, 62¢, €9, 12 bucks. */
const MONEY = /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:[kKmM]\s?)?(?:usd|eur|gbp|dollars?|bucks|cents?|usdc)\b|\b\d[\d,]*(?:\.\d+)?\s?¢)/gi;
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/**
 * A title as the public site may show it (#281: "the public site never shows money, messages, contacts or keys"):
 * amounts of money and links become "…", whitespace is folded, and it is cut to the title's length. Contacts and keys
 * never get this far: an event that has one is refused when it is posted.
 */
export function publicTitle(title: string): string {
  return line(title.replace(MONEY, "…").replace(LINK, "…"), TITLE_MAX);
}

/** A stored event, checked again on the way out: null when it isn't one. */
export function cleanEvent(v: unknown): RoomEvent | null {
  const e = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const at = typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) ? new Date(Date.parse(e.at)).toISOString() : "";
  const id = typeof e.id === "string" && /^[a-z0-9-]{8,40}$/.test(e.id) ? e.id : "";
  const title = line(e.title, TITLE_MAX);
  const detail = line(e.detail, DETAIL_MAX);
  if (!at || !id || !title || !isFeedRoom(e.room)) return null;
  return { id, at, room: e.room, title, ...(detail && { detail }) };
}

/** The events, oldest first: only good ones, none older than 14 days, the last 200. */
export function keepEvents(raw: unknown, now: number): RoomEvent[] {
  const from = now - FEED_MS;
  return (Array.isArray(raw) ? raw : [])
    .map(cleanEvent)
    .filter((e): e is RoomEvent => e !== null && Date.parse(e.at) >= from && Date.parse(e.at) <= now + 60_000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-FEED_KEEP);
}

export interface FeedStore {
  /** Every kept event, oldest first. */
  all(now: number): Promise<RoomEvent[]>;
  /** Adds one, unless the room is at its hourly limit (then false). */
  add(event: RoomEvent, now: number): Promise<boolean>;
}

const underLimit = (events: RoomEvent[], room: FeedRoom, now: number) => events.filter((e) => e.room === room && now - Date.parse(e.at) < 3_600_000).length < FEED_PER_HOUR;

/** The feed in the private blob store; a write checks the ETag, so two posts at once both land. */
export class BlobFeedStore implements FeedStore {
  constructor(private readonly blob: BlobBackend) {}
  private async load(): Promise<unknown> {
    const found = await this.blob.get(FEED_PATH);
    return found ? await new Response(found.stream).json().catch(() => []) : [];
  }
  async all(now: number): Promise<RoomEvent[]> {
    return keepEvents(await this.load(), now);
  }
  async add(event: RoomEvent, now: number): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const etag = await this.blob.etag(FEED_PATH);
      const cur = keepEvents(etag ? await this.load() : [], now);
      if (!underLimit(cur, event.room, now)) return false;
      try {
        await this.blob.put(FEED_PATH, JSON.stringify(keepEvents([...cur, event], now)), {
          contentType: "application/json",
          addRandomSuffix: false,
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        });
        return true;
      } catch (e) {
        if (attempt === 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
      }
    }
    return false;
  }
}

/** In memory, for tests. */
export class MemoryFeedStore implements FeedStore {
  events: unknown[] = [];
  async all(now: number): Promise<RoomEvent[]> {
    return keepEvents(structuredClone(this.events), now);
  }
  async add(event: RoomEvent, now: number): Promise<boolean> {
    const cur = keepEvents(this.events, now);
    if (!underLimit(cur, event.room, now)) return false;
    this.events = keepEvents([...cur, event], now);
    return true;
  }
}

export interface FeedDeps {
  env: Env;
  feed: FeedStore | null;
  desk: DeskDeps;
  now: number;
  /** A new event's id. */
  newId?: () => string;
}

const live = (): FeedDeps => {
  const blob = pickBlob(process.env);
  return { env: process.env, feed: blob ? new BlobFeedStore(blob) : null, desk: { deskKey: process.env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(), now: Date.now() }, now: Date.now() };
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...headers } });
}

const newestFirst = <T>(xs: T[]) => xs.slice(-FEED_SHOW).reverse();

/** The posted event, checked: the event, or the refusal to send. */
export function readPost(raw: unknown, env: Env): { ok: true; room: FeedRoom; title: string; detail: string } | { ok: false; status: number; error: string; kinds?: PrivateKind[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, error: "bad-request" };
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "room" && k !== "title" && k !== "detail")) return { ok: false, status: 400, error: "bad-request" };
  if (!isFeedRoom(body.room)) return { ok: false, status: 400, error: "bad-room" };
  if (typeof body.title !== "string" || (body.detail !== undefined && typeof body.detail !== "string")) return { ok: false, status: 400, error: "bad-request" };
  if (body.title.length > TITLE_MAX * 2 || (typeof body.detail === "string" && body.detail.length > DETAIL_MAX * 2)) return { ok: false, status: 413, error: "too-long" };
  const title = line(body.title, TITLE_MAX);
  const detail = line(body.detail, DETAIL_MAX);
  if (!title) return { ok: false, status: 400, error: "no-title" };
  const text = `${title}\n${detail}`;
  const kinds = privateParts(text);
  // A room key pasted into an event would reach the Desk; refuse it like any other key.
  const keys = [roomKeyValue(env, "log"), roomKeyValue(env, "feed")].filter((k): k is string => Boolean(k));
  if (keys.some((k) => text.includes(k)) && !kinds.includes("key")) kinds.push("key");
  if (kinds.length) return { ok: false, status: 422, error: "private", kinds };
  return { ok: true, room: body.room, title, detail };
}

/** POST: the feed key only. */
export async function handlePost(request: Request, deps: FeedDeps): Promise<Response> {
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "no-key" }, 401);
  const url = new URL(request.url);
  if (url.search !== "") return json({ error: "bad-request" }, 400);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (!deps.feed) return json({ error: "not-set-up" }, 503);
  const text = await request.text().catch(() => "");
  if (text.length > BODY_MAX) return json({ error: "too-big" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const post = readPost(raw, deps.env);
  if (!post.ok) return json({ error: post.error, ...(post.kinds && { kinds: post.kinds }) }, post.status);
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const event: RoomEvent = { id, at: new Date(deps.now).toISOString(), room: post.room, title: post.title, ...(post.detail && { detail: post.detail }) };
  let kept: boolean;
  try {
    kept = await deps.feed.add(event, deps.now);
  } catch {
    return json({ error: "unwritable" }, 502);
  }
  if (!kept) return json({ error: "too-many" }, 429, { "Retry-After": "600" });
  return json({ ok: true, id }, 201);
}

/** GET: everything for a Desk session or the read key; scrubbed titles for everyone else (and for ?view=public). */
export async function handleGet(request: Request, deps: FeedDeps): Promise<Response> {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const publicView = keys.length === 1 && url.searchParams.getAll("view").length === 1 && url.searchParams.get("view") === "public";
  if (keys.length > 0 && !publicView) return json({ error: "bad-request" }, 400);
  if (!deps.feed) return json({ error: "not-set-up" }, 503);
  let events: RoomEvent[];
  try {
    events = await deps.feed.all(deps.now);
  } catch {
    return json({ error: "unreadable" }, 502);
  }
  if (!publicView && readsWithLogKey(request, deps.env)) return json({ view: "full", events: newestFirst(events) });
  if (!publicView) {
    const signed = await requireSession(request, deps.desk);
    if (signed.ok) return withCookie(json({ view: "full", events: newestFirst(events) }), signed);
  }
  const shown: PublicEvent[] = newestFirst(events).map(({ id, at, room, title }) => ({ id, at, room, title: publicTitle(title) }));
  return json({ view: "public", events: shown.filter((e) => e.title && e.title !== "…") });
}

export function GET(request: Request): Promise<Response> {
  return handleGet(request, live());
}

export function POST(request: Request): Promise<Response> {
  return handlePost(request, live());
}
