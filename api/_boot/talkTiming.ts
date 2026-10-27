/**
 * The Talk call's start timings (#512), kept like the Lattice's boot timings (#373, timing.ts): the Desk's Talk button
 * times each call from the tap to Skippy's first word (apps/world/src/desk/skippy/talk.ts, #496) and sends the numbers
 * here when the call reaches its first word or fails. Behind the site lock, like every function; on Vercel a rewrite
 * (/api/talk-timing → /api/world?timing=talk), on Azure its own endpoint.
 *
 * POST /api/talk-timing { ok, mic, token, code, connected, firstWord, server: { stage: ms } } → 204. Stage names and
 *        milliseconds only, each checked and clamped; anything else is dropped. Never words, audio or transcripts.
 *        The server stamps the time. The last KEEP are kept in the private Blob store (desk/boot/talk-timings.json).
 * GET  /api/talk-timing → { ok: true, calls }, newest first. Never cached.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";

export const PATH = "/api/talk-timing";
export const TALK_TIMINGS_PATH = "desk/boot/talk-timings.json";
export const KEEP = 40;
const MAX_BODY = 1000;
const MIN_GAP_MS = 1000;
const MS = 10 * 60_000;

/** The browser's stages, in the order a call goes through them. */
export const CLIENT_STAGES = [
  "mic",
  "token",
  "code",
  "connected",
  "firstWord",
] as const;
export type ClientStage = (typeof CLIENT_STAGES)[number];

export interface TalkCall {
  at: string;
  /** Whether the call reached his first word. */
  ok: boolean;
  /** Milliseconds from the tap, per stage reached. */
  stages: Partial<Record<ClientStage, number>>;
  /** The server's own stages in the start (Server-Timing), milliseconds each. */
  server: Record<string, number>;
}

export interface TalkCallsView {
  ok: true;
  calls: TalkCall[];
}

export interface TalkStore {
  read(): Promise<TalkCall[]>;
  add(c: TalkCall): Promise<void>;
}

export function isTalkTiming(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PATH || url.searchParams.get("timing") === "talk";
}

const int = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(max, Math.round(v))
    : null;

/** A call as it may be kept, or null when it isn't one. Unknown fields are dropped, numbers clamped. */
export function cleanCall(v: unknown, at: string): TalkCall | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.ok !== "boolean") return null;
  const stages: TalkCall["stages"] = {};
  for (const k of CLIENT_STAGES) {
    const n = int(o[k], MS);
    if (n !== null) stages[k] = n;
  }
  const server: Record<string, number> = {};
  if (o.server && typeof o.server === "object" && !Array.isArray(o.server)) {
    for (const [k, val] of Object.entries(
      o.server as Record<string, unknown>,
    ).slice(0, 12)) {
      const n = int(val, MS);
      if (n !== null && /^[a-z][a-z0-9_-]{0,20}$/i.test(k)) server[k] = n;
    }
  }
  if (o.ok && stages.firstWord === undefined) return null;
  return { at, ok: o.ok, stages, server };
}

function keepList(v: unknown): TalkCall[] {
  const list = Array.isArray((v as { calls?: unknown } | null)?.calls)
    ? (v as { calls: unknown[] }).calls
    : [];
  return list
    .map((c) => {
      const at = (c as { at?: unknown } | null)?.at;
      return typeof at === "string" ? cleanCall(c, at) : null;
    })
    .filter((c): c is TalkCall => c !== null)
    .slice(0, KEEP);
}

export class BlobTalkStore implements TalkStore {
  constructor(private readonly blob: BlobBackend) {}
  private async load(): Promise<{ list: TalkCall[]; etag: string | null }> {
    const found = await this.blob.get(TALK_TIMINGS_PATH);
    if (!found) return { list: [], etag: null };
    return {
      list: keepList(await new Response(found.stream).json().catch(() => null)),
      etag: found.etag,
    };
  }
  async read(): Promise<TalkCall[]> {
    return (await this.load()).list;
  }
  async add(c: TalkCall): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const { list, etag } = await this.load();
      const body = JSON.stringify({ calls: [c, ...list].slice(0, KEEP) });
      try {
        await this.blob.put(TALK_TIMINGS_PATH, body, {
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          ...(etag && { ifMatch: etag }),
        });
        return;
      } catch (e) {
        if (!(e instanceof BlobPreconditionError)) throw e;
      }
    }
  }
}

export class MemoryTalkStore implements TalkStore {
  list: TalkCall[] = [];
  async read(): Promise<TalkCall[]> {
    return [...this.list];
  }
  async add(c: TalkCall): Promise<void> {
    this.list = [c, ...this.list].slice(0, KEEP);
  }
}

export interface TalkDeps {
  store: TalkStore | null;
  now: number;
}

const live = (): TalkDeps => {
  const blob = pickBlob(process.env);
  return { store: blob ? new BlobTalkStore(blob) : null, now: Date.now() };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: Request,
  deps: TalkDeps = live(),
): Promise<Response> {
  if (!deps.store) return json({ error: "not-set-up" }, 503);
  try {
    const view: TalkCallsView = { ok: true, calls: await deps.store.read() };
    return json(view);
  } catch {
    return json({ error: "store" }, 502);
  }
}

let lastWrite = 0;

/** For tests: forget the last write's time. */
export function forgetLastWrite(): void {
  lastWrite = 0;
}

export async function POST(
  request: Request,
  deps: TalkDeps = live(),
): Promise<Response> {
  if (!deps.store) return json({ error: "not-set-up" }, 503);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const c = cleanCall(body, new Date(deps.now).toISOString());
  if (!c) return json({ error: "bad-request" }, 400);
  if (deps.now - lastWrite < MIN_GAP_MS)
    return json({ error: "slow-down" }, 429);
  lastWrite = deps.now;
  try {
    await deps.store.add(c);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return json({ error: "store" }, 502);
  }
}
