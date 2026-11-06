import type { Light, LightsView } from "../../../api/_haven/lights/lights.ts";
import type { HavenPlan } from "./data.ts";

export type { Light, LightsView, Remote, Scene } from "../../../api/_haven/lights/lights.ts";

/**
 * The Haven's lights, browser side (#931): the list from /api/haven/lights (a passkey session only), a switch or a
 * scene posted back, and where each light goes on the house. A light's spot comes from the private plan's `lights`
 * (by its name in the app); without one, a light named after a room hangs in that room ("Kitchen", "Left Living
 * Room": the left or right half when its name says so); anything else is listed apart, so Nikita can say where it is.
 * Pure apart from the two calls, so the placing is tested on its own.
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
export async function postLights(body: { op: "set"; id: string; on: boolean } | { op: "scene"; id: string }, f: typeof fetch = fetch): Promise<{ ok: boolean; say: string }> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const got = (isJson(res) ? await res.json().catch(() => ({})) : {}) as { ok?: boolean; say?: string };
    if (res.status === 401) return { ok: false, say: "Your session ended. Sign in again." };
    return { ok: res.ok && got.ok === true, say: typeof got.say === "string" ? got.say : res.ok ? "Done." : "That didn't go through. Try again." };
  } catch {
    return { ok: false, say: "That didn't go through. Try again." };
  }
}

/** A light on the house: where it hangs, in plan units. */
export interface PlacedLight {
  light: Light;
  x: number;
  y: number;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Where each light goes: `placed` on the house, `loose` with no spot and no room in its name. */
export function placeLights(plan: HavenPlan, lights: readonly Light[]): { placed: PlacedLight[]; loose: Light[] } {
  const placed: PlacedLight[] = [], loose: Light[] = [];
  const rooms = plan.rooms.filter((r) => !r.detached);
  const perRoom = new Map<string, number>();
  for (const light of lights) {
    const name = words(light.name);
    const spot = plan.lights?.find((s) => words(s.name) === name);
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
