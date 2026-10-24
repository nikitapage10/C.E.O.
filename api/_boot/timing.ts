/**
 * The Lattice's boot-timing beacon (#373), as routes inside an existing function: the Hobby plan's twelve functions are
 * all taken, so vercel.json rewrites /api/lattice-timing to /api/world?timing=lattice and api/world.ts hands it here.
 * On Azure it is its own endpoint (azure/src/index.ts). Both sit behind the site lock, like every function.
 *
 * POST /api/lattice-timing { kind, trip, firstFrame, curtain, fps, worstFrame, draws, triangles, programs }
 *        → 204. From the Lattice in a real browser after each arrival (apps/world/src/bootBeacon.ts). Timings and
 *          counts only, each checked and clamped here; anything else in the body is dropped. The server stamps the
 *          time. The last KEEP are kept in the private Blob store (desk/boot/lattice-timings.json).
 * GET  /api/lattice-timing → TimingsView, newest first, for the Boiler Room. Never cached.
 *
 * Writes cost a Blob read and write each; at most one a second per warm instance, and the browser sends one per trip.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { TRIP_KINDS, type Timing, type TimingIn, type TimingsView, type TripKind } from "./types.js";

export const PATH = "/api/lattice-timing";
export const TIMINGS_PATH = "desk/boot/lattice-timings.json";
/** How many timings are kept. */
export const KEEP = 40;
const MAX_BODY = 1000;
const MIN_GAP_MS = 1000;

export interface TimingStore {
  read(): Promise<Timing[]>;
  /** Adds one, keeping the newest KEEP. */
  add(t: Timing): Promise<void>;
}

/** Whether a request to the host function is for this route (by its own path, or the rewrite's query). */
export function isTiming(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === PATH || url.searchParams.get("timing") === "lattice";
}

const int = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : null);

/** A timing as it may be kept, or null when it isn't one. Unknown fields are dropped, numbers clamped. */
export function cleanTiming(v: unknown, at: string): Timing | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!(TRIP_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const MS = 10 * 60_000;
  const fields = {
    trip: int(o.trip, 10_000),
    firstFrame: int(o.firstFrame, MS),
    curtain: int(o.curtain, MS),
    fps: int(o.fps, 1000),
    worstFrame: int(o.worstFrame, MS),
    draws: int(o.draws, 1_000_000),
    triangles: int(o.triangles, 1_000_000_000),
    programs: int(o.programs, 10_000),
  };
  if (Object.values(fields).some((x) => x === null)) return null;
  return { at, kind: o.kind as TripKind, ...(fields as Omit<TimingIn, "kind">) };
}

function keepList(v: unknown): Timing[] {
  const list = Array.isArray((v as { timings?: unknown } | null)?.timings) ? (v as { timings: unknown[] }).timings : [];
  return list
    .map((t) => (t && typeof t === "object" && typeof (t as { at?: unknown }).at === "string" ? cleanTiming(t, (t as { at: string }).at) : null))
    .filter((t): t is Timing => t !== null)
    .slice(0, KEEP);
}

export class BlobTimingStore implements TimingStore {
  constructor(private readonly blob: BlobBackend) {}
  private async load(): Promise<{ list: Timing[]; etag: string | null }> {
    const found = await this.blob.get(TIMINGS_PATH);
    if (!found) return { list: [], etag: null };
    return { list: keepList(await new Response(found.stream).json().catch(() => null)), etag: found.etag };
  }
  async read(): Promise<Timing[]> {
    return (await this.load()).list;
  }
  async add(t: Timing): Promise<void> {
    // Two arrivals at once: the second write loses its condition and goes again on what the first left.
    for (let i = 0; i < 3; i++) {
      const { list, etag } = await this.load();
      const body = JSON.stringify({ timings: [t, ...list].slice(0, KEEP) });
      try {
        await this.blob.put(TIMINGS_PATH, body, { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, ...(etag && { ifMatch: etag }) });
        return;
      } catch (e) {
        if (!(e instanceof BlobPreconditionError)) throw e;
      }
    }
  }
}

export class MemoryTimingStore implements TimingStore {
  list: Timing[] = [];
  async read(): Promise<Timing[]> {
    return [...this.list];
  }
  async add(t: Timing): Promise<void> {
    this.list = [t, ...this.list].slice(0, KEEP);
  }
}

export function pickTimingStore(env: Record<string, string | undefined> = process.env): TimingStore | null {
  const blob = pickBlob(env);
  return blob ? new BlobTimingStore(blob) : null;
}

export interface TimingDeps {
  store: TimingStore | null;
  now: number;
}

const live = (): TimingDeps => ({ store: pickTimingStore(), now: Date.now() });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, deps: TimingDeps = live()): Promise<Response> {
  if (!deps.store) return json({ error: "not-set-up" }, 503);
  try {
    const view: TimingsView = { ok: true, timings: await deps.store.read() };
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

export async function POST(request: Request, deps: TimingDeps = live()): Promise<Response> {
  if (!deps.store) return json({ error: "not-set-up" }, 503);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const t = cleanTiming(body, new Date(deps.now).toISOString());
  if (!t) return json({ error: "bad-request" }, 400);
  if (deps.now - lastWrite < MIN_GAP_MS) return json({ error: "slow-down" }, 429);
  lastWrite = deps.now;
  try {
    await deps.store.add(t);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return json({ error: "store" }, 502);
  }
}
