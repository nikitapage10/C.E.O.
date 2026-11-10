/**
 * The Kitchen's meal photo library (#687, the meal planner's part 3; contract in docs/HOME-DEVICES.md, "The meal photo
 * library"). Every photo lives in the private `haven-meals` container (infra/resources.bicep: no public access, reached
 * only with the Function App's identity), beside its catalog:
 *
 *   catalog.json       every photo: its meal, key, prompt, style, source, state and times (api/_haven/photoShape.ts)
 *   full/<id>.png|jpg  the image as made (OpenAI's PNG) or as uploaded
 *   720/<id>.jpg       the Desk's copy, 720 px wide
 *
 * Nothing of it is public and nothing is in the repo: the photos come back only through this route, to the Desk's
 * passkey session.
 *
 *   GET  /api/haven-photos?id=<id>[&size=full]     passkey session: the photo (720 px JPEG; `full` the original).
 *   GET  /api/haven-photos?view=catalog[&ids=a,b]  passkey session: { photos, budget, ready } (`ids` narrows it to
 *                                                  those photos, for polling a confirm's tickets).
 *   POST /api/haven-photos { action: "confirm", meals: MealToShoot[] }   passkey session: the confirm-week hook. Each
 *                                                  meal gets a ticket { meal, key, id, status } at once; the ones not
 *                                                  made yet are queued and made one at a time after the answer. The
 *                                                  same meal and components always give the same id, so confirming
 *                                                  again never makes a photo twice (a failed or over-budget one is
 *                                                  tried once more). → { photos: PhotoTicket[], budget }
 *   POST /api/haven-photos { action: "generate", meal: MealToShoot }    passkey session: the same for one meal.
 *                                                  → { photo: PhotoTicket, budget }
 *   POST /api/haven-photos { action: "find", meals: MealToShoot[] }     passkey session: cook mode's read (#1016): the
 *                                                  tickets those meals already have (null where none), never queueing
 *                                                  or making anything. → { photos: Array<PhotoTicket | null> }
 *   POST /api/haven-photos { action: "upload", meal, image, id?, name?, style?, components?, source? }
 *                                                  passkey session: one photo into the library (base64 PNG or JPEG,
 *                                                  at most UPLOAD_MAX bytes); its id is `id` or the meal's own.
 *                                                  → { photo: PhotoEntry }
 *   POST /api/haven-photos { action: "remove", id }  passkey session: a photo out of the library.
 *   PUT  /api/haven-photos { meal, image, … }       the feed key (SUBMIND_FEED_TOKEN, write-only) alone, no query: the
 *                                                  same upload, so the Builder can load the seed photos with no tap.
 *                                                  It answers { ok, id, bytes } only, never a photo or the catalog.
 *
 * An upload answers 400 bad-photo only when the bytes aren't an image it can read; when the library can't keep it, 503
 * store, and the log says the error's class (errorClassOf), never the photo, its meal or a path.
 *
 * Cook steps' pictures (style "step") are queued by the meal planner itself when a week is finalized (#1016,
 * api/_haven/stepShots.ts, `queueStepPhotos`), never when cook mode opens; they have their own $3 of the cap.
 *
 * The generator (api/_haven/photoGen.ts) runs after a confirm's answer and every ten minutes while anything is queued
 * (azure/src/index.ts, `haven_photos`), one run at a time under a lease in the catalog, under the $10 a month images
 * cap. Logs say counts and states, never a meal, a prompt or a key.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, randomUUID } from "node:crypto";
import { pickBlob, pickBlobIn, type BlobBackend } from "../_blob.js";
import { builderReads } from "../_site/builderkey.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { waitUntil } from "../_waitUntil.js";
import { readJson, updateJson } from "./json.js";
import { generateImage, ImageLedger, PHOTO_PLAN, STEP_PLAN, WORKOUT_PLAN, type GenDeps, type GenPlan } from "./photoGen.js";
import { kindOf, smallJpeg } from "./photoImage.js";
import {
  CATALOG_MAX,
  isStyle,
  keySource,
  PHOTO_ID,
  photoIdOf,
  plain,
  promptFor,
  readCatalog,
  readMealsToShoot,
  readMealToShoot,
  type MealToShoot,
  type PhotoBudget,
  type PhotoCatalog,
  type PhotoEntry,
  type PhotoSource,
  type PhotoStyle,
  type PhotoTicket,
} from "./photoShape.js";

export * from "./photoShape.js";

type Env = Record<string, string | undefined>;

/** The library's private container (infra/resources.bicep, HAVEN_MEALS_CONTAINER). */
export const MEALS_CONTAINER = "haven-meals";
export const CATALOG_PATH = "catalog.json";
export const smallPath = (id: string) => `720/${id}.jpg`;
/** The most an uploaded photo may be, decoded. */
export const UPLOAD_MAX = 4 * 1024 * 1024;
/** The most a request body may be: an upload's base64 with room for its fields. */
export const BODY_MAX = Math.ceil((UPLOAD_MAX * 4) / 3) + 8 * 1024;
/** How long one run holds the lease, renewed with each photo (a recipe's photo may try high, medium and low). */
export const LEASE_MS = 9 * 60_000;
/** A run stops taking new photos after this long (the Function App's timeout is ten minutes). */
export const RUN_MS = 7 * 60_000;

/** The photo's key: 16 hex of the SHA-256 of its meal, components and style. */
export const keyOf = (m: Pick<MealToShoot, "meal" | "components" | "style"> & { description?: string }) => createHash("sha256").update(keySource(m)).digest("hex").slice(0, 16);

const iso = (ms: number) => new Date(ms).toISOString();
const ticketOf = (p: PhotoEntry): PhotoTicket => ({ meal: p.meal, key: p.key, id: p.id, status: p.status });
/** A "making" photo whose run went quiet (its lease ran out) counts as queued again. */
const stale = (p: PhotoEntry, now: number) => p.status === "making" && Date.parse(p.updated) + LEASE_MS < now;

/** Keeps the catalog under its cap: the oldest failed, then over-budget, then any photo goes first. */
function trim(cat: PhotoCatalog): PhotoCatalog {
  if (cat.photos.length <= CATALOG_MAX) return cat;
  const order = (p: PhotoEntry) => (p.status === "failed" ? 0 : p.status === "budget" ? 1 : 2);
  const drop = new Set([...cat.photos].sort((a, b) => order(a) - order(b) || a.updated.localeCompare(b.updated)).slice(0, cat.photos.length - CATALOG_MAX).map((p) => p.id));
  return { ...cat, photos: cat.photos.filter((p) => !drop.has(p.id)) };
}

/** The bytes aren't an image this library can read (as opposed to the store failing). */
export class BadImageError extends Error {
  constructor(message = "not a readable image") {
    super(message);
    this.name = "BadImageError";
  }
}

/**
 * What kind of error an upload hit, for the log: its class and, from Azure's SDK, its error code (both fixed words,
 * never a meal, a name, a path or the bytes).
 */
export function errorClassOf(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  const name = /^[A-Za-z][\w]{0,40}$/.test(e.name) ? e.name : "Error";
  return typeof code === "string" && /^[A-Za-z][\w]{0,60}$/.test(code) ? `${name} ${code}` : name;
}

/** The library in its container. */
export class PhotoLibrary {
  constructor(private readonly blob: BlobBackend) {}

  async catalog(): Promise<PhotoCatalog> {
    return readCatalog(await readJson<unknown>(this.blob, CATALOG_PATH, null));
  }

  private change<R>(fn: (cat: PhotoCatalog) => { next: PhotoCatalog | null; result: R }): Promise<R> {
    return updateJson<unknown, R>(this.blob, CATALOG_PATH, null, (raw) => {
      const got = fn(readCatalog(raw));
      return { next: got.next ? trim(got.next) : null, result: got.result };
    });
  }

  /** One ticket per meal; the ones not made yet are queued (a failed or over-budget one once more). */
  async enqueue(meals: MealToShoot[], now: number): Promise<PhotoTicket[]> {
    return this.change((cat) => {
      const photos = [...cat.photos];
      let changed = false;
      const tickets = meals.map((m) => {
        const key = keyOf(m);
        // The same meal as built: a ready photo with this key wins (an upload included), else the key's own id.
        const hit = photos.find((p) => p.key === key && p.status === "ready") ?? photos.find((p) => p.key === key);
        if (hit) {
          if (hit.status === "failed" || hit.status === "budget" || stale(hit, now)) {
            const i = photos.indexOf(hit);
            photos[i] = { ...hit, status: "queued", updated: iso(now) };
            delete photos[i]!.error;
            changed = true;
            return ticketOf(photos[i]!);
          }
          return ticketOf(hit);
        }
        const id = photoIdOf(m.meal, key);
        const entry: PhotoEntry = { id, meal: m.meal, name: m.name, components: m.components, style: m.style, key, prompt: promptFor(m), source: "openai", status: "queued", created: iso(now), updated: iso(now), tries: 0 };
        const same = photos.findIndex((p) => p.id === id);
        if (same >= 0) photos[same] = entry;
        else photos.push(entry);
        changed = true;
        return ticketOf(entry);
      });
      return { next: changed ? { ...cat, photos } : null, result: tickets };
    });
  }

  /** Whether anything waits to be made. */
  async pending(now: number): Promise<boolean> {
    return (await this.catalog()).photos.some((p) => p.status === "queued" || stale(p, now));
  }

  /**
   * Takes the lease (or renews it, for `by`) and the oldest waiting photo, marked "making"; null when there is none or
   * another run holds the lease. A recipe's photo goes before any cook step's picture (#1016: a finalized week queues
   * dozens of steps, and the meals' own photos shouldn't wait behind them).
   */
  async claim(by: string, now: number): Promise<PhotoEntry | null> {
    return this.change((cat) => {
      if (cat.worker && cat.worker.by !== by && Date.parse(cat.worker.until) > now) return { next: null, result: null };
      const waiting = cat.photos
        .filter((p) => p.status === "queued" || stale(p, now))
        .sort((a, b) => Number(a.style === "step") - Number(b.style === "step") || a.updated.localeCompare(b.updated));
      const next = waiting[0];
      if (!next) return { next: cat.worker?.by === by ? { ...cat, worker: null } : null, result: null };
      const taken: PhotoEntry = { ...next, status: "making", updated: iso(now), tries: next.tries + 1 };
      return { next: { ...cat, worker: { until: iso(now + LEASE_MS), by }, photos: cat.photos.map((p) => (p.id === next.id ? taken : p)) }, result: taken };
    });
  }

  /** Lets the lease go. */
  async release(by: string): Promise<void> {
    await this.change((cat) => ({ next: cat.worker?.by === by ? { ...cat, worker: null } : null, result: undefined }));
  }

  /**
   * The tickets of the photos these meals already have, made or on their way, without queueing anything (#1016: cook
   * mode only reads its steps' pictures); null for a meal the library has no photo for.
   */
  async find(meals: MealToShoot[]): Promise<Array<PhotoTicket | null>> {
    const cat = await this.catalog();
    return meals.map((m) => {
      const key = keyOf(m);
      const hit = cat.photos.find((p) => p.key === key && p.status === "ready") ?? cat.photos.find((p) => p.key === key);
      return hit ? ticketOf(hit) : null;
    });
  }

  /** Changes one photo's entry; with `alsoQueued`, every queued one too (only those `which` picks, when given). */
  async settle(id: string, patch: Partial<PhotoEntry>, now: number, alsoQueued?: Partial<PhotoEntry>, which: (p: PhotoEntry) => boolean = () => true): Promise<void> {
    await this.change((cat) => ({
      next: {
        ...cat,
        photos: cat.photos.map((p) => {
          if (p.id === id) {
            const out: PhotoEntry = { ...p, ...patch, updated: iso(now) };
            if (patch.status === "ready") delete out.error;
            return out;
          }
          return alsoQueued && p.status === "queued" && which(p) ? { ...p, ...alsoQueued, updated: iso(now) } : p;
        }),
      },
      result: undefined,
    }));
  }

  /** Writes both sizes of a photo; returns where the full one went and its size. */
  async store(id: string, bytes: Uint8Array): Promise<{ full: string; width: number; height: number }> {
    const kind = kindOf(bytes);
    if (!kind) throw new BadImageError("not an image");
    let small: ReturnType<typeof smallJpeg>;
    try {
      small = smallJpeg(bytes);
    } catch {
      throw new BadImageError();
    }
    const full = `full/${id}.${kind === "png" ? "png" : "jpg"}`;
    const put = { addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 } as const;
    await this.blob.put(full, bytes, { ...put, contentType: kind === "png" ? "image/png" : "image/jpeg" });
    await this.blob.put(smallPath(id), small.jpeg, { ...put, contentType: "image/jpeg" });
    // A photo once kept under the other extension.
    const other = `full/${id}.${kind === "png" ? "jpg" : "png"}`;
    await this.blob.del(other).catch(() => undefined);
    return { full, width: small.width, height: small.height };
  }

  /** One uploaded photo into the library, ready at once. */
  async upload(u: Upload, now: number): Promise<PhotoEntry> {
    const key = keyOf(u);
    const id = u.id ?? u.meal;
    const where = await this.store(id, u.bytes);
    const entry: PhotoEntry = { id, meal: u.meal, name: u.name, components: u.components, style: u.style, key, prompt: "", source: u.source, status: "ready", created: iso(now), updated: iso(now), ...where, tries: 0 };
    await this.change((cat) => {
      const before = cat.photos.find((p) => p.id === id);
      const kept = before ? { ...entry, created: before.created } : entry;
      return { next: { ...cat, photos: before ? cat.photos.map((p) => (p.id === id ? kept : p)) : [...cat.photos, kept] }, result: undefined };
    });
    return entry;
  }

  /** A photo's bytes, or null. */
  async read(id: string, size: "720" | "full"): Promise<{ bytes: Uint8Array; type: string } | null> {
    let path = smallPath(id);
    if (size === "full") {
      const entry = (await this.catalog()).photos.find((p) => p.id === id);
      if (!entry?.full) return null;
      path = entry.full;
    }
    const found = await this.blob.get(path);
    if (!found) return null;
    return { bytes: new Uint8Array(await new Response(found.stream).arrayBuffer()), type: found.contentType || "image/jpeg" };
  }

  /** A photo out of the library; false when there was none. */
  async remove(id: string): Promise<boolean> {
    const gone = await this.change((cat) => {
      const hit = cat.photos.find((p) => p.id === id);
      return hit ? { next: { ...cat, photos: cat.photos.filter((p) => p.id !== id) }, result: hit } : { next: null, result: null };
    });
    if (!gone) return false;
    await Promise.all([this.blob.del(smallPath(id)), ...(gone.full ? [this.blob.del(gone.full)] : [])].map((p) => p.catch(() => undefined)));
    return true;
  }
}

export interface Upload {
  meal: string;
  id?: string;
  name: string;
  components: string[];
  style: PhotoStyle;
  source: PhotoSource;
  bytes: Uint8Array;
}

/* ── The generator's run ── */

export interface RunDeps {
  library: PhotoLibrary;
  gen: GenDeps;
  now: () => number;
  log: (line: string) => void;
}

/** How a photo of this style is made: a cook step small and low (#1010), the Gym's art medium, a recipe high first (#1016). */
export const planFor = (style: PhotoStyle): GenPlan => (style === "step" ? STEP_PLAN : style === "workout" ? WORKOUT_PLAN : PHOTO_PLAN);

/**
 * Makes the waiting photos one at a time until none wait, the cap is reached or the run's time is up. When only the
 * cook steps' share of the cap is spent (#1016), the queued steps wait and the recipes' photos carry on.
 */
export async function runQueue(deps: RunDeps): Promise<{ made: number; failed: number; budget: boolean }> {
  const by = randomUUID();
  const started = deps.now();
  const out = { made: 0, failed: 0, budget: false };
  try {
    while (deps.now() - started < RUN_MS) {
      const next = await deps.library.claim(by, deps.now());
      if (!next) break;
      const got = await generateImage(next.prompt, deps.gen, planFor(next.style));
      if (got.ok) {
        try {
          const where = await deps.library.store(next.id, got.bytes);
          await deps.library.settle(next.id, { status: "ready", quality: got.quality, ...where }, deps.now());
          out.made++;
        } catch {
          await deps.library.settle(next.id, { status: "failed", error: "store" }, deps.now());
          out.failed++;
        }
      } else if (got.error === "budget" && next.style === "step") {
        // The steps' share (or the whole cap) is spent: every queued step waits for the next finalize after it resets;
        // a recipe's photo still queued gets its own try (and parks everything itself if the whole cap is gone).
        const parked = { status: "budget", error: "budget reached" } as const;
        await deps.library.settle(next.id, parked, deps.now(), parked, (p) => p.style === "step");
        out.budget = true;
      } else if (got.error === "budget") {
        // Nothing more this month: this one and every queued one wait for the next confirm after the cap resets.
        await deps.library.settle(next.id, { status: "budget", error: "budget reached" }, deps.now(), { status: "budget", error: "budget reached" });
        out.budget = true;
        break;
      } else {
        await deps.library.settle(next.id, { status: "failed", error: got.error === "no-key" ? "no key" : (got.detail ?? "failed") }, deps.now());
        out.failed++;
        if (got.error === "no-key") break;
      }
    }
  } finally {
    await deps.library.release(by).catch(() => undefined);
  }
  if (out.made || out.failed || out.budget) deps.log(`haven photos: ${out.made} made, ${out.failed} failed${out.budget ? ", the month's image cap is reached (or the cook steps' share of it)" : ""}`);
  return out;
}

/* ── The routes ── */

export interface PhotoDeps {
  desk: DeskDeps;
  /** The `haven-meals` container, or null when storage isn't set up here. */
  library: PhotoLibrary | null;
  /** The month's image ledger (in the private store), or null. */
  ledger: ImageLedger | null;
  /** The OpenAI key (OPENAI_STUDIO_KEY), empty when unset. */
  openaiKey: string;
  fetch: GenDeps["fetch"];
  env: Env;
  log: (line: string) => void;
  /** Runs the generator after the answer (waitUntil live; a test may run it inline or not at all). */
  kick: (run: () => Promise<unknown>) => void;
}

export function livePhotoDeps(env: Env = process.env): PhotoDeps {
  const base = pickBlob(env);
  const lib = pickBlobIn(env.HAVEN_MEALS_CONTAINER?.trim() || MEALS_CONTAINER, env);
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    library: lib ? new PhotoLibrary(lib) : null,
    ledger: base ? new ImageLedger(base) : null,
    openaiKey: env.OPENAI_STUDIO_KEY?.trim() ?? "",
    fetch: (url, init) => fetch(url, init),
    env,
    log: (line) => console.log(line),
    kick: (run) => waitUntil(run()),
  };
}

const runDeps = (deps: PhotoDeps, library: PhotoLibrary, ledger: ImageLedger): RunDeps => ({
  library,
  gen: { key: deps.openaiKey, fetch: deps.fetch, ledger, now: () => Date.now() },
  now: () => Date.now(),
  log: deps.log,
});

/**
 * The finalize hook for cook steps' pictures (#1016, api/_haven/stepShots.ts): every shot queued in the library (one
 * catalog write, before the planner answers), and the run kicked off after the answer when anything new waits. A step
 * already made, or on its way, is left as it is. → how many were newly queued, or null when the library isn't set up.
 */
export async function queueStepPhotos(shots: MealToShoot[], deps: PhotoDeps): Promise<number | null> {
  if (!deps.library || !deps.ledger) return null;
  if (!shots.length) return 0;
  const library = deps.library;
  const ledger = deps.ledger;
  const waiting = new Set((await library.catalog()).photos.filter((p) => p.status === "queued").map((p) => p.id));
  const tickets = await library.enqueue(shots, deps.desk.now);
  const queued = tickets.filter((t) => t.status === "queued" && !waiting.has(t.id)).length;
  // A run whenever anything of it waits, newly queued or left by an earlier run that stopped partway.
  if (tickets.some((t) => t.status === "queued")) deps.kick(() => runQueue(runDeps(deps, library, ledger)).catch(() => deps.log("haven photos: the run failed")));
  deps.log(`haven photos: ${shots.length} step pictures for the finalized week (${queued} queued)`);
  return queued;
}

/** The timer's job: a run when anything waits (one blob read otherwise). */
export async function drainPhotos(deps: PhotoDeps = livePhotoDeps()): Promise<"idle" | "ran" | "not-set-up"> {
  if (!deps.library || !deps.ledger) return "not-set-up";
  if (!(await deps.library.pending(Date.now()))) return "idle";
  await runQueue(runDeps(deps, deps.library, deps.ledger));
  return "ran";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

async function budgetOf(deps: PhotoDeps, now: number): Promise<PhotoBudget | null> {
  return deps.ledger ? deps.ledger.read(now).catch(() => null) : null;
}

/** GET /api/haven-photos. */
export async function photosGet(request: Request, deps: PhotoDeps): Promise<Response> {
  // The Builder's read key (#800) reads without a session; nothing else does.
  const signed = builderReads(request, deps.env) ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const cookied = (res: Response) => (signed && signed.ok ? withCookie(res, signed) : res);
  const reply = (body: unknown, status = 200) => cookied(json(body, status));
  if (!deps.library) return reply({ error: "not-set-up" }, 503);
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (id !== null) {
    const size = q.get("size") === "full" ? "full" : "720";
    const got = PHOTO_ID.test(id) ? await deps.library.read(id, size).catch(() => null) : null;
    if (!got) return reply({ error: "not-found" }, 404);
    const res = new Response(got.bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      // Private to this browser; an hour, since an upload may replace a photo under the same id.
      headers: { "Content-Type": got.type, "Cache-Control": "private, max-age=3600", "Content-Length": String(got.bytes.length), "X-Content-Type-Options": "nosniff" },
    });
    return cookied(res);
  }
  if (q.get("view") !== "catalog") return reply({ error: "bad-request" }, 400);
  const cat = await deps.library.catalog().catch(() => null);
  if (!cat) return reply({ error: "store" }, 503);
  const ids = q.get("ids");
  const want = ids ? new Set(ids.split(",").filter((x) => PHOTO_ID.test(x)).slice(0, 50)) : null;
  const photos = want ? cat.photos.filter((p) => want.has(p.id)) : cat.photos;
  return reply({ photos, budget: await budgetOf(deps, deps.desk.now), ready: Boolean(deps.openaiKey && deps.ledger) });
}

/** An upload's fields from a body, or why not. */
function readUpload(body: Record<string, unknown>, sourceDefault: PhotoSource): Upload | "bad-photo" | "too-big" {
  const meal = typeof body.meal === "string" && PHOTO_ID.test(body.meal) ? body.meal : null;
  const id = body.id === undefined ? undefined : typeof body.id === "string" && PHOTO_ID.test(body.id) ? body.id : null;
  if (!meal || id === null || typeof body.image !== "string") return "bad-photo";
  const b64 = body.image.replace(/^data:image\/(?:png|jpeg);base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return "bad-photo";
  if (Math.floor((b64.length * 3) / 4) > UPLOAD_MAX) return "too-big";
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (!kindOf(bytes)) return "bad-photo";
  const shot = readMealToShoot({ meal, name: plain(body.name, 80) || meal, components: body.components, style: body.style });
  const source: PhotoSource = body.source === "seed" ? "seed" : sourceDefault;
  return { meal, ...(id && { id }), name: shot?.name ?? meal, components: shot?.components ?? [], style: isStyle(body.style) ? body.style : "plate", source, bytes };
}

async function readBody(request: Request): Promise<Record<string, unknown> | "too-big" | "bad-request"> {
  const raw = await request.text().catch(() => "");
  if (raw.length > BODY_MAX) return "too-big";
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : "bad-request";
  } catch {
    return "bad-request";
  }
}

/**
 * One upload, or why not: "bad-photo" when the bytes couldn't be read as an image, "store" when the library couldn't
 * keep it. Either way the log gets the error's class (never the photo, its meal or a path), so a failing store no
 * longer passes for a bad photo.
 */
async function uploadOrWhy(library: PhotoLibrary, u: Upload, now: number, log: (line: string) => void): Promise<PhotoEntry | "bad-photo" | "store"> {
  try {
    return await library.upload(u, now);
  } catch (e) {
    const why = e instanceof BadImageError ? "bad-photo" : "store";
    log(`haven photos: an upload failed (${why}: ${errorClassOf(e)})`);
    return why;
  }
}

/** POST /api/haven-photos. */
export async function photosPost(request: Request, deps: PhotoDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "too-big" }, 413);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.library) return reply({ error: "not-set-up" }, 503);
  const body = await readBody(request);
  if (body === "too-big") return reply({ error: "too-big" }, 413);
  if (body === "bad-request") return reply({ error: "bad-request" }, 400);
  const now = deps.desk.now;
  const library = deps.library;

  if (body.action === "confirm" || body.action === "generate") {
    const meals = body.action === "confirm" ? readMealsToShoot(body.meals) : ((m) => (m ? [m] : null))(readMealToShoot(body.meal));
    if (!meals) return reply({ error: "bad-meals" }, 400);
    if (!deps.ledger) return reply({ error: "not-set-up" }, 503);
    const tickets = await library.enqueue(meals, now).catch(() => null);
    if (!tickets) return reply({ error: "store" }, 503);
    const ledger = deps.ledger;
    if (tickets.some((t) => t.status === "queued")) deps.kick(() => runQueue(runDeps(deps, library, ledger)).catch(() => deps.log("haven photos: the run failed")));
    deps.log(`haven photos: ${body.action} for ${tickets.length} (${tickets.filter((t) => t.status === "queued").length} queued)`);
    const budget = await budgetOf(deps, now);
    return body.action === "confirm" ? reply({ photos: tickets, budget }) : reply({ photo: tickets[0], budget });
  }
  if (body.action === "find") {
    // Cook mode's read (#1016): the tickets its steps' pictures already have, never a new one, never a run.
    const meals = readMealsToShoot(body.meals);
    if (!meals) return reply({ error: "bad-meals" }, 400);
    const found = await library.find(meals).catch(() => null);
    if (!found) return reply({ error: "store" }, 503);
    return reply({ photos: found });
  }
  if (body.action === "upload") {
    const u = readUpload(body, "upload");
    if (u === "too-big") return reply({ error: "too-big" }, 413);
    if (u === "bad-photo") return reply({ error: "bad-photo" }, 400);
    const got = await uploadOrWhy(library, u, now, deps.log);
    if (got === "bad-photo") return reply({ error: "bad-photo" }, 400);
    if (got === "store") return reply({ error: "store" }, 503);
    const photo = got;
    deps.log(`haven photos: one uploaded (${photo.source})`);
    return reply({ photo });
  }
  if (body.action === "remove") {
    if (typeof body.id !== "string" || !PHOTO_ID.test(body.id)) return reply({ error: "bad-request" }, 400);
    return (await library.remove(body.id)) ? reply({ ok: true }) : reply({ error: "not-found" }, 404);
  }
  return reply({ error: "bad-request" }, 400);
}

/** PUT /api/haven-photos: one upload with the feed key alone. Counts back, never a photo. */
export async function photosPut(request: Request, deps: PhotoDeps): Promise<Response> {
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "too-big" }, 413);
  if (!deps.library) return json({ error: "not-set-up" }, 503);
  const body = await readBody(request);
  if (body === "too-big") return json({ error: "too-big" }, 413);
  if (body === "bad-request") return json({ error: "bad-request" }, 400);
  const u = readUpload(body, "seed");
  if (u === "too-big") return json({ error: "too-big" }, 413);
  if (u === "bad-photo") return json({ error: "bad-photo" }, 400);
  const photo = await uploadOrWhy(deps.library, u, deps.desk.now, deps.log);
  if (photo === "bad-photo") return json({ error: "bad-photo" }, 400);
  if (photo === "store") return json({ error: "store" }, 503);
  deps.log("haven photos: one uploaded with the feed key");
  return json({ ok: true, id: photo.id, bytes: u.bytes.length });
}

export const photosRoute = {
  GET: (request: Request) => photosGet(request, livePhotoDeps()),
  POST: (request: Request) => photosPost(request, livePhotoDeps()),
  PUT: (request: Request) => photosPut(request, livePhotoDeps()),
};
