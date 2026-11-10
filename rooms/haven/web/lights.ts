import type { Light, LightsView } from "../../../api/_haven/lights/lights.ts";
import { readPlan, type PlanLight } from "../../../api/_haven/planShape.ts";
import type { HavenPlan } from "./data.ts";

export type { Group, Light, LightLook, LightsView, Remote, Scene } from "../../../api/_haven/lights/lights.ts";

/**
 * The Haven's lights, browser side (#931): the list from /api/haven/lights (a passkey session only), a switch or a
 * scene posted back, and where each light goes on the house. A light's spot comes from the private plan's `lights`
 * (by its name in the app); without one, a light named after a room hangs in that room ("Kitchen", "Left Living
 * Room": the left or right half when its name says so); anything else is listed apart, so Nikita can say where it is.
 * #974: a light is placed by a tap on the house (`placeLightAt`, saved to the private plan) or by Skippy
 * (lights_place); a Govee light's colour, brightness and mood go back as `look`. Pure apart from the calls, so the
 * placing is tested on its own.
 */

const PATH = "/api/haven/lights";
const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

export type LightsLoad = { state: "idle" } | { state: "ready"; view: LightsView } | { state: "off" } | { state: "out" } | { state: "failed" };

export async function loadLights(f: typeof fetch = fetch): Promise<LightsLoad> {
  try {
    const res = await f(PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || res.status === 503 || !isJson(res)) return { state: "off" };
    if (!res.ok) return { state: "failed" };
    const view = (await res.json().catch(() => null)) as LightsView | null;
    return view && Array.isArray(view.lights) ? { state: "ready", view } : { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

/** A switch (`on`) or a scene: Skippy's line back, and whether it went through. */
export type LightsPost = { op: "set"; id: string; on: boolean } | { op: "scene"; id: string } | ({ op: "look"; id: string } & ({ rgb: string } | { kelvin: number } | { brightness: number } | { mood: string }));

export async function postLights(body: LightsPost, f: typeof fetch = fetch): Promise<{ ok: boolean; say: string }> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = (isJson(res) ? await res.json().catch(() => ({})) : {}) as { ok?: boolean; say?: string };
    if (res.status === 401) return { ok: false, say: "Your session ended. Sign in again." };
    return { ok: res.ok && got.ok === true, say: typeof got.say === "string" ? got.say : res.ok ? "Done." : "That didn't go through. Try again." };
  } catch {
    return { ok: false, say: "That didn't go through. Try again." };
  }
}

/**
 * One light's spot on the private plan (#974), or off it (`at` null): the plan's light spots as saved, or what to say.
 * Passkey only, like the plan.
 */
export async function placeLightAt(name: string, at: { x: number; y: number } | null, f: typeof fetch = fetch): Promise<{ ok: true; spots: PlanLight[] } | { ok: false; say: string }> {
  try {
    const body = at ? { action: "light", name, x: Math.round(at.x), y: Math.round(at.y) } : { action: "light", name, clear: true };
    const res = await f("/api/haven-plan", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) return { ok: false, say: "Your session ended. Sign in again." };
    if (res.status === 409) return { ok: false, say: "Save the floor plan first." };
    const got = (isJson(res) ? await res.json().catch(() => null) : null) as { ok?: boolean; plan?: unknown } | null;
    const plan = got?.ok ? readPlan(got.plan) : null;
    return plan ? { ok: true, spots: plan.lights ?? [] } : { ok: false, say: "That spot didn't save. Try again." };
  } catch {
    return { ok: false, say: "That spot didn't save. Try again." };
  }
}

/** What a light is drawn as (#974): a floor lamp is a tall LED line, an under-light a glow low down, else a ceiling light. */
export type Fixture = "floor" | "under" | "ceiling";
export function fixtureOf(name: string): Fixture {
  const w = words(name);
  if (/ floor (lamp|light)s? | uplights? | led (line|bar)s? | torchi?e?re /.test(w)) return "floor";
  if (/ under ?(light|lights|glow|cabinet)s? | underlights? | under /.test(w)) return "under";
  return "ceiling";
}

/** The room the Desk's own light is assumed on in (#974: the Studio, while Nikita is on the Desk from a desktop). */
export const deskRoom = (plan: HavenPlan) => plan.rooms.find((r) => !r.detached && / studio /.test(words(r.name))) ?? null;

/** A light on the house: where it hangs, in plan units. */
export interface PlacedLight {
  light: Light;
  x: number;
  y: number;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Where each light goes: `placed` on the house, `loose` with no spot and no room in its name. */
export function placeLights(plan: HavenPlan, lights: readonly Light[], spots: readonly PlanLight[] | undefined = plan.lights): { placed: PlacedLight[]; loose: Light[] } {
  const placed: PlacedLight[] = [], loose: Light[] = [];
  const rooms = plan.rooms.filter((r) => !r.detached);
  const perRoom = new Map<string, number>();
  for (const light of lights) {
    const name = words(light.name);
    const spot = spots?.find((s) => words(s.name) === name);
    if (spot) {
      placed.push({ light, x: spot.x, y: spot.y });
      continue;
    }
    // The room whose name the light's holds, the longest name first ("Living room" before "Room").
    const room = [...rooms].sort((a, b) => b.name.length - a.name.length).find((r) => name.includes(words(r.name)));
    if (!room) {
      loose.push(light);
      continue;
    }
    const [x, y, w, h] = room.parts.reduce((a, p) => (p[2] * p[3] > a[2] * a[3] ? p : a), room.parts[0]!);
    const side = / left /.test(name) ? 0.3 : / right /.test(name) ? 0.7 : 0.5;
    // Two plain lights in one room stand a little apart instead of on one spot.
    const k = side === 0.5 ? (perRoom.get(room.id) ?? 0) : 0;
    if (side === 0.5) perRoom.set(room.id, k + 1);
    placed.push({ light, x: x + w * side + k * 30, y: y + h * 0.5 + k * 20 });
  }
  return { placed, loose };
}
