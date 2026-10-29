/**
 * The Desk's load timings (#561), kept like the Lattice's boot timings (#373, timing.ts) and the Talk calls' (#512): on a
 * real load of the Desk (not the Lattice) the browser times the page from its opening to the Desk's first paint and to
 * its live data being ready (apps/world/src/desk/deskBeacon.ts) and sends the two numbers here. Behind the site lock,
 * like every function; on Vercel a rewrite (/api/desk-timing → /api/world?timing=desk), on Azure its own endpoint.
 *
 * POST /api/desk-timing { firstPaint, dataReady } → 204. Two numbers of milliseconds, each checked and clamped;
 *        anything else is dropped (no address, user agent, names, route or anything typed or read). The server stamps
 *        the time. The last KEEP are kept in the private Blob store (desk/boot/desk-timings.json).
 * GET  /api/desk-timing → { ok: true, loads }, newest first. Never cached.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";

export const PATH = "/api/desk-timing";
export const DESK_TIMINGS_PATH = "desk/boot/desk-timings.json";
export const KEEP = 40;
const MAX_BODY = 1000;
const MIN_GAP_MS = 1000;
const MS = 10 * 60_000;

export interface DeskLoad {
  at: string;
  /** Milliseconds from the page opening to the Desk's first paint. */
  firstPaint: number;
  /** Milliseconds from the page opening to the Desk's live data being ready. */
  dataReady: number;
}

export interface DeskLoadsView {
  ok: true;
  loads: DeskLoad[];
}

export interface DeskStore {
  read(): Promise<DeskLoad[]>;
  add(c: DeskLoad): Promise<void>;
}

export function isDeskTiming(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PATH || url.searchParams.get("timing") === "desk";
}

const int = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(max, Math.round(v))
    : null;

/** A load as it may be kept, or null when it isn't one. Unknown fields are dropped, numbers clamped. */
export function cleanLoad(v: unknown, at: string): DeskLoad | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const firstPaint = int(o.firstPaint, MS);
  const dataReady = int(o.dataReady, MS);
  if (firstPaint === null || dataReady === null) return null;
  return { at, firstPaint, dataReady };
}

function keepList(v: unknown): DeskLoad[] {
  const list = Array.isArray((v as { loads?: unknown } | null)?.loads)
    ? (v as { loads: unknown[] }).loads
    : [];
  return list
    .map((c) => {
      const at = (c as { at?: unknown } | null)?.at;
      return typeof at === "string" ? cleanLoad(c, at) : null;
    })
    .filter((c): c is DeskLoad => c !== null)
    .slice(0, KEEP);
}

export class BlobDeskStore implements DeskStore {
  constructor(private readonly blob: BlobBackend) {}
  private async load(): Promise<{ list: DeskLoad[]; etag: string | null }> {
    const found = await this.blob.get(DESK_TIMINGS_PATH);
    if (!found) return { list: [], etag: null };
    return {
      list: keepList(await new Response(found.stream).json().catch(() => null)),
      etag: found.etag,
    };
  }
  async read(): Promise<DeskLoad[]> {
    return (await this.load()).list;
  }
  async add(c: DeskLoad): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const { list, etag } = await this.load();
      const body = JSON.stringify({ loads: [c, ...list].slice(0, KEEP) });
      try {
        await this.blob.put(DESK_TIMINGS_PATH, body, {
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

export class MemoryDeskStore implements DeskStore {
  list: DeskLoad[] = [];
  async read(): Promise<DeskLoad[]> {
    return [...this.list];
  }
  async add(c: DeskLoad): Promise<void> {
    this.list = [c, ...this.list].slice(0, KEEP);
  }
}

export interface DeskDeps {
  store: DeskStore | null;
  now: number;
}

const live = (): DeskDeps => {
  const blob = pickBlob(process.env);
  return { store: blob ? new BlobDeskStore(blob) : null, now: Date.now() };
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
  deps: DeskDeps = live(),
): Promise<Response> {
  if (!deps.store) return json({ error: "not-set-up" }, 503);
  try {
    const view: DeskLoadsView = { ok: true, loads: await deps.store.read() };
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
  deps: DeskDeps = live(),
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
  const c = cleanLoad(body, new Date(deps.now).toISOString());
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
