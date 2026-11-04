/**
 * The Haven Kitchen's meal planner, server side (#678; the shapes and the edits are api/_haven/mealShape.ts). The taste
 * profile, the catalog and the week are one JSON file in the private store (`haven/meals.json`); the photos sit beside
 * it (`haven/meals/<id>.jpg`, about 720 px). Nothing of it is in the repo, and nothing is public: signed out, the
 * Haven's status view carries the counts only (`mealCounts`: nights planned, cooking, HelloFresh, confirmed).
 *
 *   GET  /api/haven-meals                    passkey session: { meals, components } (meals null until it's seeded).
 *   GET  /api/haven-meals?photo=<id>         passkey session: that meal's photo (JPEG), cached privately a day.
 *   POST /api/haven-meals { action: "edit", edit }      passkey session: one edit (`readEdit`) → { meals, changes }.
 *   POST /api/haven-meals { action: "send" }            passkey session: the week's shopping onto the Kitchen list
 *                                                       (source "meals"), where the King Soopers matcher picks it up
 *                                                       → { added, already, meals }.
 *   POST /api/haven-meals { action: "seed", meals, replace? }   passkey session: load a whole file (checked by
 *                                                       `readMeals`); without `replace` only when there is none yet.
 *   POST /api/haven-meals { action: "photo", id, jpeg } passkey session: one photo, base64 JPEG (the Desk shrinks it
 *                                                       first), at most PHOTO_MAX bytes.
 *   PUT  /api/haven-meals { meals } | { photo: { id, jpeg } }   the feed key (SUBMIND_FEED_TOKEN, write-only) alone,
 *                                                       no query: the same two loads, so the Builder can seed the
 *                                                       planner with no tap. It answers counts only, never the plan.
 *
 * Every body is untrusted data: closed sets, clamped numbers, plain capped strings, a JPEG's own magic bytes.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { readJson, updateJson } from "./json.js";
import { KitchenList } from "./list.js";
import { allComponents, applyEdit, ID, mealCounts, readEdit, readMeals, shopLine, shoppingList, type EditResult, type MealCounts, type MealEdit, type MealsFile } from "./mealShape.js";

export * from "./mealShape.js";

export const MEALS_PATH = "haven/meals.json";
export const photoPath = (id: string) => `haven/meals/${id}.jpg`;
/** The most a photo may be, decoded. */
export const PHOTO_MAX = 400 * 1024;
/** A whole seed (with its photos sent one by one), and the most any body may be. */
export const MEALS_BODY_MAX = 600 * 1024;
const EDIT_BODY_MAX = 8 * 1024;

/** The planner's file in the private store. */
export class MealsStore {
  constructor(private readonly blob: BlobBackend) {}

  async read(): Promise<MealsFile | null> {
    return readMeals(await readJson<unknown>(this.blob, MEALS_PATH, null));
  }

  /** One edit, with the store's ETag check (two at once both land). */
  async edit(edit: MealEdit, now: number): Promise<EditResult | { ok: false; error: "not-seeded" }> {
    return updateJson<unknown, EditResult | { ok: false; error: "not-seeded" }>(this.blob, MEALS_PATH, null, (raw) => {
      const file = readMeals(raw);
      if (!file) return { next: null, result: { ok: false, error: "not-seeded" } };
      const got = applyEdit(file, edit, now);
      return { next: got.ok ? got.file : null, result: got };
    });
  }

  /** A whole file. Without `replace`, only when there is none yet. False when one was already there. */
  async seed(file: MealsFile, replace: boolean): Promise<boolean> {
    return updateJson<unknown, boolean>(this.blob, MEALS_PATH, null, (raw) => (readMeals(raw) && !replace ? { next: null, result: false } : { next: file, result: true }));
  }

  /** Marks the week sent (no Undo: the list keeps its own). */
  async sent(now: number): Promise<MealsFile | null> {
    return updateJson<unknown, MealsFile | null>(this.blob, MEALS_PATH, null, (raw) => {
      const file = readMeals(raw);
      if (!file?.week) return { next: null, result: file };
      const next = { ...file, week: { ...file.week, sentAt: new Date(now).toISOString() } };
      return { next, result: next };
    });
  }

  async photo(id: string): Promise<Uint8Array | null> {
    if (!ID.test(id)) return null;
    const found = await this.blob.get(photoPath(id));
    return found ? new Uint8Array(await new Response(found.stream).arrayBuffer()) : null;
  }

  async putPhoto(id: string, bytes: Uint8Array): Promise<void> {
    await this.blob.put(photoPath(id), bytes, { contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  }
}

/** The week's shopping onto the Kitchen list (source "meals"), then the week marked sent. Null when there's nothing to send. */
export async function sendWeek(blob: BlobBackend, now: number): Promise<{ added: number; already: number; meals: MealsFile | null } | null> {
  const store = new MealsStore(blob);
  const meals = await store.read();
  const lines = meals?.week ? shoppingList(meals).map(shopLine) : [];
  if (!lines.length) return null;
  const { added, already } = await new KitchenList(blob).add(lines, now, "meals");
  return { added: added.length, already: already.length, meals: await store.sent(now) };
}

/** The counts for the Haven's status view. */
export async function mealCountsOf(blob: BlobBackend): Promise<MealCounts | null> {
  return mealCounts(await new MealsStore(blob).read());
}

/** A base64 JPEG, decoded and checked: its magic bytes and its size. Null when it isn't one. */
export function readJpeg(v: unknown): Uint8Array | null {
  if (typeof v !== "string" || v.length > Math.ceil((PHOTO_MAX * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const bytes = new Uint8Array(Buffer.from(v, "base64"));
  return bytes.length > 3 && bytes.length <= PHOTO_MAX && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

export interface MealsDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

export function liveMealsDeps(env: Record<string, string | undefined> = process.env): MealsDeps {
  return { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() }, blob: pickBlob(env), env, log: (line) => console.log(line) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

const view = (meals: MealsFile | null) => ({ meals, components: meals ? allComponents(meals) : [] });

/** GET /api/haven-meals. */
export async function mealsGet(request: Request, deps: MealsDeps): Promise<Response> {
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if (!deps.blob) return withCookie(json({ error: "not-set-up" }, 503), signed);
  const store = new MealsStore(deps.blob);
  const photo = new URL(request.url).searchParams.get("photo");
  if (photo !== null) {
    const bytes = ID.test(photo) ? await store.photo(photo).catch(() => null) : null;
    if (!bytes) return withCookie(json({ error: "not-found" }, 404), signed);
    const res = new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff" } });
    return withCookie(res, signed);
  }
  const meals = await store.read().catch(() => undefined);
  if (meals === undefined) return withCookie(json({ error: "store" }, 503), signed);
  return withCookie(json(view(meals)), signed);
}

async function bodyOf(request: Request, max: number): Promise<Record<string, unknown> | "too-big" | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return "too-big";
  const raw = await request.text().catch(() => "");
  if (raw.length > max) return "too-big";
  try {
    const got: unknown = JSON.parse(raw);
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /api/haven-meals. */
export async function mealsPost(request: Request, deps: MealsDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > MEALS_BODY_MAX) return json({ error: "too-big" }, 413);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.blob) return reply({ error: "not-set-up" }, 503);
  const body = await bodyOf(request, MEALS_BODY_MAX);
  if (body === "too-big") return reply({ error: "too-big" }, 413);
  if (!body) return reply({ error: "bad-request" }, 400);
  const store = new MealsStore(deps.blob);
  const now = deps.desk.now;

  if (body.action === "edit") {
    if (JSON.stringify(body.edit ?? null).length > EDIT_BODY_MAX) return reply({ error: "too-big" }, 413);
    const edit = readEdit(body.edit);
    if (!edit) return reply({ error: "bad-request" }, 400);
    const got = await store.edit(edit, now);
    if (!got.ok) return reply({ error: got.error }, got.error === "not-seeded" || got.error === "not-found" ? 404 : 409);
    // The kind of edit only: never a meal or a taste.
    deps.log(`haven: meals ${edit.op}`);
    return reply({ ok: true, changes: got.changes, ...view(got.file) });
  }
  if (body.action === "send") {
    const got = await sendWeek(deps.blob, now);
    if (!got) return reply({ error: "empty" }, 409);
    deps.log(`haven: the week went to the list (${got.added} added, ${got.already} already there)`);
    return reply({ ok: true, added: got.added, already: got.already, ...view(got.meals) });
  }
  if (body.action === "seed") {
    const meals = readMeals(body.meals);
    if (!meals) return reply({ error: "bad-meals" }, 400);
    const ok = await store.seed(meals, body.replace === true);
    if (!ok) return reply({ error: "already" }, 409);
    deps.log(`haven: the meal planner was loaded (${meals.catalog.length} meals)`);
    return reply({ ok: true, ...view(meals) });
  }
  if (body.action === "photo") {
    const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
    const bytes = readJpeg(body.jpeg);
    if (!id || !bytes) return reply({ error: "bad-photo" }, 400);
    await store.putPhoto(id, bytes);
    return reply({ ok: true, id, bytes: bytes.length });
  }
  return reply({ error: "bad-request" }, 400);
}

/** PUT /api/haven-meals: the feed key alone. Counts back, never the plan. */
export async function mealsPut(request: Request, deps: MealsDeps): Promise<Response> {
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const body = await bodyOf(request, MEALS_BODY_MAX);
  if (body === "too-big") return json({ error: "too-big" }, 413);
  if (!body) return json({ error: "bad-request" }, 400);
  const store = new MealsStore(deps.blob);
  try {
    if (body.meals !== undefined) {
      const meals = readMeals(body.meals);
      if (!meals) return json({ error: "bad-meals" }, 400);
      const ok = await store.seed(meals, body.replace === true);
      if (!ok) return json({ error: "already" }, 409);
      deps.log(`haven: the meal planner was loaded with the feed key (${meals.catalog.length} meals)`);
      return json({ ok: true, meals: meals.catalog.length, nights: meals.week?.slots.length ?? 0 });
    }
    const p = body.photo && typeof body.photo === "object" ? (body.photo as Record<string, unknown>) : {};
    const id = typeof p.id === "string" && ID.test(p.id) ? p.id : null;
    const bytes = readJpeg(p.jpeg);
    if (!id || !bytes) return json({ error: "bad-photo" }, 400);
    await store.putPhoto(id, bytes);
    return json({ ok: true, bytes: bytes.length });
  } catch {
    return json({ error: "store" }, 503);
  }
}

export const mealsRoute = {
  GET: (request: Request) => mealsGet(request, liveMealsDeps()),
  POST: (request: Request) => mealsPost(request, liveMealsDeps()),
  PUT: (request: Request) => mealsPut(request, liveMealsDeps()),
};
