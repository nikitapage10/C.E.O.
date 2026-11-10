/**
 * The Haven's floor plan (#616): the shape of Nikita's home that the Desk draws in 3D, kept as JSON in the private
 * store and never in the repo. The repo holds only this generic shape and the renderer; which rooms there are, where
 * the walls, doors, furniture and devices stand, all of it is data in `haven/plan.json`.
 *
 *   GET  /api/haven-plan                    passkey session: { plan } (null until one is saved).
 *   POST /api/haven-plan { action: "save", plan }   passkey session: checks it (`readPlan`) and saves it.
 *   POST /api/haven-plan { action: "clear" }        passkey session: forgets it; the Haven waits for one again.
 *   POST /api/haven-plan { action: "light", name, x, y[, x2, y2] }   passkey session (#974): one light's spot (a run to
 *                                           x2, y2 for a row of spots or a strip, #1007), set on the stored
 *                                           plan (a tap on the house); { action: "light", name, clear: true } takes it
 *                                           off. { ok, plan } back; 409 until a plan is saved.
 *   PUT  /api/haven-plan <plan JSON>        the feed key (SUBMIND_FEED_TOKEN, write-only) alone: checks it the same way
 *                                           and saves it, so the Builder can load it with no tap. It answers only
 *                                           { ok, rooms, pieces } (counts), never the plan. Reading stays passkey-only:
 *                                           the room keys can't GET it (the gate's read list doesn't hold this path).
 *
 * Nothing here is public: signed out, the Haven shows counts and states only, with no map. The plan is read as
 * untrusted data on the way in (closed sets, clamped numbers, trimmed plain names, capped lists), so a bad paste can't
 * put markup or anything outsized on the page.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, type BlobBackend } from "../_blob.js";
import { builderReads } from "../_site/builderkey.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { PLAN_BODY_MAX, placeLight, readPlan, type HavenPlan } from "./planShape.js";

export * from "./planShape.js";

export const PLAN_PATH = "haven/plan.json";

/** The plan in the private store. */
export class PlanStore {
  constructor(private readonly blob: BlobBackend) {}

  async read(): Promise<HavenPlan | null> {
    const found = await this.blob.get(PLAN_PATH);
    if (!found) return null;
    return readPlan(await new Response(found.stream).json().catch(() => null));
  }

  async write(plan: HavenPlan): Promise<void> {
    await this.blob.put(PLAN_PATH, JSON.stringify(plan), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  }

  async clear(): Promise<void> {
    await this.blob.del(PLAN_PATH);
  }

  /**
   * One light's spot on the stored plan (#974), or taken off with `at` null: the plan as saved, "no-plan" before one is
   * saved, "bad" for an empty name or a full list.
   */
  async placeLight(name: string, at: { x: number; y: number; x2?: number; y2?: number } | null): Promise<HavenPlan | "no-plan" | "bad"> {
    const plan = await this.read();
    if (!plan) return "no-plan";
    const next = placeLight(plan, name, at);
    if (!next) return "bad";
    await this.write(next);
    return next;
  }
}

export interface PlanDeps {
  desk: DeskDeps;
  blob: BlobBackend | null;
  /** The server's settings, for the feed key (PUT). */
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

export function livePlanDeps(env: Record<string, string | undefined> = process.env): PlanDeps {
  return { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() }, blob: pickBlob(env), env, log: (line) => console.log(line) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** GET /api/haven-plan. */
export async function planGet(request: Request, deps: PlanDeps): Promise<Response> {
  // The Builder's read key (#800) reads without a session; nothing else does.
  const signed = builderReads(request, deps.env) ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const reply = (res: Response) => (signed && signed.ok ? withCookie(res, signed) : res);
  if (!deps.blob) return reply(json({ error: "not-set-up" }, 503));
  const plan = await new PlanStore(deps.blob).read().catch(() => undefined);
  if (plan === undefined) return reply(json({ error: "store" }, 503));
  return reply(json({ plan }));
}

/** POST /api/haven-plan. */
export async function planPost(request: Request, deps: PlanDeps): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > PLAN_BODY_MAX) return json({ error: "too-big" }, 413);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.blob) return reply({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > PLAN_BODY_MAX) return reply({ error: "too-big" }, 413);
  let body: Record<string, unknown>;
  try {
    const got: unknown = JSON.parse(raw);
    body = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  } catch {
    return reply({ error: "bad-request" }, 400);
  }
  const store = new PlanStore(deps.blob);
  if (body.action === "clear") {
    await store.clear();
    deps.log("haven: the floor plan was cleared");
    return reply({ ok: true });
  }
  if (body.action === "light") {
    const run = typeof body.x2 === "number" && typeof body.y2 === "number" ? { x2: body.x2, y2: body.y2 } : {};
    const at = body.clear === true ? null : typeof body.x === "number" && typeof body.y === "number" ? { x: body.x, y: body.y, ...run } : undefined;
    if (typeof body.name !== "string" || at === undefined) return reply({ error: "bad-request" }, 400);
    const got = await store.placeLight(body.name, at);
    if (got === "no-plan") return reply({ error: "no-plan" }, 409);
    if (got === "bad") return reply({ error: "bad-request" }, 400);
    // Never the light's name or where it stands.
    deps.log(`haven: a light was ${at ? "placed" : "taken off"} on the floor plan`);
    return reply({ ok: true, plan: got });
  }
  if (body.action !== "save") return reply({ error: "bad-request" }, 400);
  const plan = readPlan(body.plan);
  if (!plan) return reply({ error: "bad-plan" }, 400);
  await store.write(plan);
  // Counts only: never a room's name or where anything stands.
  deps.log(`haven: a floor plan was saved (${plan.rooms.length} rooms, ${plan.items.length} pieces)`);
  return reply({ ok: true, plan });
}

/** PUT /api/haven-plan: the plan JSON as the body, the feed key alone. Counts back, never the plan. */
export async function planPut(request: Request, deps: PlanDeps): Promise<Response> {
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > PLAN_BODY_MAX) return json({ error: "too-big" }, 413);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > PLAN_BODY_MAX) return json({ error: "too-big" }, 413);
  let got: unknown;
  try {
    got = JSON.parse(raw);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const plan = readPlan(got);
  if (!plan) return json({ error: "bad-plan" }, 400);
  try {
    await new PlanStore(deps.blob).write(plan);
  } catch {
    return json({ error: "store" }, 503);
  }
  deps.log(`haven: a floor plan was saved with the feed key (${plan.rooms.length} rooms, ${plan.items.length} pieces)`);
  return json({ ok: true, rooms: plan.rooms.length, pieces: plan.items.length });
}

export const planRoute = {
  GET: (request: Request) => planGet(request, livePlanDeps()),
  POST: (request: Request) => planPost(request, livePlanDeps()),
  PUT: (request: Request) => planPut(request, livePlanDeps()),
};
