/**
 * The Haven Kitchen's meal planner, server side (#678; the shapes and the edits are api/_haven/mealShape.ts). The taste
 * profile, the catalog and the week are one JSON file in the private store (`haven/meals.json`). Nothing of it is in
 * the repo, and nothing is public: signed out, the Haven's status view carries the counts only (`mealCounts`: nights
 * planned, cooking, HelloFresh, confirmed). The photos are the photo library's (#687, api/_haven/photos.ts); this file
 * only keeps their ids; Confirm week answers which customized nights need one (`photoJobs`), and the Desk asks the
 * photo library (/api/haven-photos, api/_haven/photos.ts) for them and writes each id back with the `photo` edit.
 *
 *   GET  /api/haven-meals                    passkey session: { meals, components } (meals null until it's seeded).
 *   POST /api/haven-meals { action: "edit", edit }      passkey session: one edit (`readEdit`) → { meals, changes }.
 *   POST /api/haven-meals { action: "confirm" }         passkey session: the week confirmed, its shopping onto the
 *                                                       Kitchen list (source "meals", where the King Soopers matcher
 *                                                       picks it up) → { changes, added, already, photos (the
 *                                                       customized nights waiting for a photo), meals }.
 *                                                       `week` (a Monday) aims confirm or send at a week ahead (#721).
 *                                                       Finalizing again after the plan changed (#761) also takes
 *                                                       off the open list lines the planner put there that no week
 *                                                       sent to the list wants any more. It also queues every
 *                                                       recipe's cook-step pictures in the photo library (#1016,
 *                                                       api/_haven/stepShots.ts; `stepPhotos`, how many), made after
 *                                                       the answer, never when cook mode opens.
 *   POST /api/haven-meals { action: "reopen" }          passkey session (#761, the Shopping card's Clear list): the
 *                                                       week back to a draft, not sent, so Finalize is open again
 *                                                       → { meals }.
 *   POST /api/haven-meals { action: "send" }            passkey session: the week's shopping onto the list again
 *                                                       → { added, already, meals }.
 *   POST /api/haven-meals { action: "seed", meals, replace? }   passkey session: load a whole file (checked by
 *                                                       `readMeals`); without `replace` only when there is none yet.
 *   PUT  /api/haven-meals { meals, replace? }   the feed key (SUBMIND_FEED_TOKEN, write-only) alone, no query: the
 *                                                       same load, so the Builder can seed the planner with no tap.
 *                                                       It answers counts only, never the plan.
 *   PUT  /api/haven-meals { meals, merge: "lunches" }   the feed key: only the seed's lunches added to the planner
 *                                                       that's there (`addLunches`: new quick lunches, the lunch days,
 *                                                       a lunch plan for a week that has none), never a replace. Undo
 *                                                       puts it back. Counts back.
 *
 * Every body is untrusted data: closed sets, clamped numbers, plain capped strings.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { builderReads } from "../_site/builderkey.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { readJson, updateJson } from "./json.js";
import { KitchenList, sameKey } from "./list.js";
import { livePhotoDeps, queueStepPhotos } from "./photos.js";
import { weekStepShots } from "./stepShots.js";
import { addLunches, allComponents, allWeeks, applyEdit, viewOf, mealCounts, photoJobs, readEdit, readMeals, shopLine, shoppingList, type EditResult, type MealCounts, type MealEdit, type MealsFile } from "./mealShape.js";

export * from "./mealShape.js";

export const MEALS_PATH = "haven/meals.json";
/** A whole seed, and the most any body may be. */
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

  /** The seed's lunches added to the file that's there (#719). Null when nothing is loaded yet. */
  async mergeLunches(seed: MealsFile, now: number): Promise<{ added: number; days: number } | null> {
    return updateJson<unknown, { added: number; days: number } | null>(this.blob, MEALS_PATH, null, (raw) => {
      const file = readMeals(raw);
      if (!file) return { next: null, result: null };
      const got = addLunches(file, seed, now);
      return { next: got.added || got.days ? got.file : null, result: { added: got.added, days: got.days } };
    });
  }

  /** A week back to a draft, not sent (#761): Finalize opens again. No Undo: it changes nothing about what's cooked. */
  async reopen(start?: string): Promise<MealsFile | null> {
    return updateJson<unknown, MealsFile | null>(this.blob, MEALS_PATH, null, (raw) => {
      const file = readMeals(raw);
      if (!file?.week) return { next: null, result: file };
      const open = <W extends { confirmedAt: string | null; photoQueue: unknown[]; sentAt: string | null }>(w: W): W => ({ ...w, confirmedAt: null, photoQueue: [], sentAt: null });
      const next = { ...file, week: !start || start === file.week.start ? open(file.week) : file.week, ahead: file.ahead.map((w) => (w.start === start ? open(w) : w)) };
      return { next, result: next };
    });
  }

  /** Marks a week sent (no Undo: the list keeps its own): the current one, or one ahead by its Monday (#721). */
  async sent(now: number, start?: string): Promise<MealsFile | null> {
    return updateJson<unknown, MealsFile | null>(this.blob, MEALS_PATH, null, (raw) => {
      const file = readMeals(raw);
      if (!file?.week) return { next: null, result: file };
      const at = new Date(now).toISOString();
      const ahead = file.ahead.map((w) => (w.start === start ? { ...w, sentAt: at } : w));
      const next = { ...file, week: !start || start === file.week.start ? { ...file.week, sentAt: at } : file.week, ahead };
      return { next, result: next };
    });
  }
}

/**
 * What the planner wants on the Kitchen list (#761): every week whose shopping went to the list, with its lines as the
 * plan stands now. `keep` is their lines' keys; `changed` how many of those weeks changed since they were finalized (a
 * draft again), and `fresh` those weeks' lines, to tell which matches no longer fit and what isn't on the list yet.
 */
export function plannedLines(meals: MealsFile | null): { keep: Set<string>; changed: number; fresh: string[] } {
  const keep = new Set<string>();
  const fresh: string[] = [];
  let changed = 0;
  if (!meals?.week) return { keep, changed, fresh };
  for (const w of allWeeks(meals)) {
    if (!w.sentAt) continue;
    const lines = shoppingList(viewOf(meals, w.start === meals.week.start ? null : w.start)).map(shopLine);
    for (const l of lines) keep.add(sameKey(l));
    if (!w.confirmedAt) {
      changed++;
      fresh.push(...lines);
    }
  }
  return { keep, changed, fresh };
}

/**
 * The week's shopping onto the Kitchen list (source "meals"), then the week marked sent. Null when there's nothing to
 * send. With `sync` (finalizing, #761), the planner's own open lines that no sent week wants any more come off.
 */
export async function sendWeek(blob: BlobBackend, now: number, start?: string, sync = false): Promise<{ added: number; already: number; dropped: number; meals: MealsFile | null } | null> {
  const store = new MealsStore(blob);
  const meals = await store.read();
  const lines = meals?.week ? shoppingList(viewOf(meals, start)).map(shopLine) : [];
  if (!lines.length) return null;
  const list = new KitchenList(blob);
  const { added, already } = await list.add(lines, now, "meals");
  const sent = await store.sent(now, start);
  const dropped = sync && sent ? await list.dropMissing("meals", plannedLines(sent).keep, now) : 0;
  return { added: added.length, already: already.length, dropped, meals: sent };
}

/** The counts for the Haven's status view. */
export async function mealCountsOf(blob: BlobBackend): Promise<MealCounts | null> {
  return mealCounts(await new MealsStore(blob).read());
}

export interface MealsDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  /**
   * Finalize's hook for the cook steps' pictures (#1016): queues the week's step pictures in the photo library and
   * starts making them after the answer. How many were queued now, or null when the library isn't set up.
   */
  stepPhotos?: (meals: MealsFile, week?: string) => Promise<number | null>;
}

export function liveMealsDeps(env: Record<string, string | undefined> = process.env): MealsDeps {
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    blob: pickBlob(env),
    env,
    log: (line) => console.log(line),
    stepPhotos: (meals, week) => queueStepPhotos(weekStepShots(meals, week), livePhotoDeps(env)),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

const view = (meals: MealsFile | null) => ({ meals, components: meals ? allComponents(meals) : [] });

/** GET /api/haven-meals. */
export async function mealsGet(request: Request, deps: MealsDeps): Promise<Response> {
  // The Builder's read key (#800) reads without a session; nothing else does.
  const signed = builderReads(request, deps.env) ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const reply = (res: Response) => (signed && signed.ok ? withCookie(res, signed) : res);
  if (!deps.blob) return reply(json({ error: "not-set-up" }, 503));
  const store = new MealsStore(deps.blob);
  const meals = await store.read().catch(() => undefined);
  if (meals === undefined) return reply(json({ error: "store" }, 503));
  return reply(json(view(meals)));
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
  // A week ahead by its Monday (#721); without one, the current week.
  const week = typeof body.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : undefined;
  if (body.action === "confirm") {
    const got = await store.edit({ op: "confirm", ...(week && { week }) }, now);
    if (!got.ok) return reply({ error: got.error }, got.error === "not-seeded" ? 404 : 409);
    const sent = await sendWeek(deps.blob, now, week, true);
    // The customized nights to photograph (`week.photoQueue`): the Desk hands them to the photo library
    // (POST /api/haven-photos, api/_haven/photos.ts) and writes the ids back with the `photo` edit.
    const photos = photoJobs(viewOf(got.file, week)).length;
    // Every recipe's step pictures (#1016), queued now and made after the answer; a failure here never fails finalize.
    const steps = deps.stepPhotos ? await deps.stepPhotos(sent?.meals ?? got.file, week).catch(() => null) : null;
    deps.log(`haven: the week was confirmed (${sent?.added ?? 0} to the list${sent?.dropped ? `, ${sent.dropped} off it` : ""}, ${photos} photos to make, ${steps ?? 0} step pictures queued)`);
    return reply({ ok: true, changes: got.changes, added: sent?.added ?? 0, already: sent?.already ?? 0, dropped: sent?.dropped ?? 0, photos, stepPhotos: steps ?? 0, ...view(sent?.meals ?? got.file) });
  }
  if (body.action === "reopen") {
    const meals = await store.reopen(week);
    if (!meals?.week) return reply({ error: "no-week" }, 409);
    deps.log("haven: the week was reopened");
    return reply({ ok: true, ...view(meals) });
  }
  if (body.action === "send") {
    const got = await sendWeek(deps.blob, now, week);
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
  return reply({ error: "bad-request" }, 400);
}

/** PUT /api/haven-meals: the feed key alone, a seed. Counts back, never the plan. */
export async function mealsPut(request: Request, deps: MealsDeps): Promise<Response> {
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const body = await bodyOf(request, MEALS_BODY_MAX);
  if (body === "too-big") return json({ error: "too-big" }, 413);
  if (!body) return json({ error: "bad-request" }, 400);
  try {
    const meals = readMeals(body.meals);
    if (!meals) return json({ error: "bad-meals" }, 400);
    if (body.merge !== undefined) {
      if (body.merge !== "lunches" || body.replace !== undefined) return json({ error: "bad-request" }, 400);
      const got = await new MealsStore(deps.blob).mergeLunches(meals, Date.now());
      if (!got) return json({ error: "not-seeded" }, 404);
      deps.log(`haven: lunches were added to the meal planner with the feed key (${got.added} new, ${got.days} days)`);
      return json({ ok: true, added: got.added, days: got.days });
    }
    const ok = await new MealsStore(deps.blob).seed(meals, body.replace === true);
    if (!ok) return json({ error: "already" }, 409);
    deps.log(`haven: the meal planner was loaded with the feed key (${meals.catalog.length} meals)`);
    return json({ ok: true, meals: meals.catalog.length, nights: meals.week?.slots.length ?? 0 });
  } catch {
    return json({ error: "store" }, 503);
  }
}

export const mealsRoute = {
  GET: (request: Request) => mealsGet(request, liveMealsDeps()),
  POST: (request: Request) => mealsPost(request, liveMealsDeps()),
  PUT: (request: Request) => mealsPut(request, liveMealsDeps()),
};
