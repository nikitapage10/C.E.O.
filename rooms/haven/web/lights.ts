import type { Light, LightsView } from "../../../api/_haven/lights/lights.ts";
import { readPlan, type PlanLight } from "../../../api/_haven/planShape.ts";
import { roomAt, type HavenPlan, type PlanRoom } from "./data.ts";
import { kindOf } from "./fixtures.ts";

export type { Group, Light, LightLook, LightsView, Remote, Scene } from "../../../api/_haven/lights/lights.ts";
export { HIDDEN_LIGHTS, shownLights } from "../../../api/_haven/lights/hidden.ts";

/**
 * The Haven's lights, browser side (#931): the list from /api/haven/lights (a passkey session only), a switch or a
 * scene posted back, and where each light goes on the house. A light's spot comes from the private plan's `lights`
 * (by its name in the app); without one, a light named after a room hangs in that room ("Kitchen", "Left Living
 * Room": the left or right half when its name says so); anything else is listed apart, so Nikita can say where it is.
 * #974: a light is placed by a tap on the house (`placeLightAt`, saved to the private plan) or by Skippy
 * (lights_place); a Govee light's colour, brightness and mood go back as `look`. Pure apart from the calls, so the
 * placing is tested on its own.
 * #1002: the lights Nikita doesn't use are left out of the Haven (`HIDDEN_LIGHTS`, still switchable by Skippy), and a
 * SwitchBot switch is a room's own lights: the whole room is lit while it's on and dark while it's off (`roomLightOf`).
 * The laundry's switch counts as the hall's.
 * #1007: a light with a fixture kind (fixtures.ts: the living room's two rows of ceiling spots, the kitchen's backlight,
 * the laundry's fitting) is drawn as that fixture where it really is, not as a whole room's lights.
 */

const PATH = "/api/haven/lights";
const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

export type LightsLoad = { state: "idle" } | { state: "ready"; view: LightsView } | { state: "off" } | { state: "out" } | { state: "failed" };

export async function loadLights(f: typeof fetch = fetch, fresh = false, live = false): Promise<LightsLoad> {
  try {
    // Fresh (#1020): after a tap or a scene, SwitchBot's states as they are now, not as kept a moment ago. Live
    // (#1077): the Lights panel is on screen, so the server reads Govee's lamps every 20 s instead of every 2 minutes.
    const q = [fresh && "fresh=1", live && "live=1"].filter(Boolean).join("&");
    const res = await f(q ? `${PATH}?${q}` : PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || res.status === 503 || !isJson(res)) return { state: "off" };
    if (!res.ok) return { state: "failed" };
    const view = (await res.json().catch(() => null)) as LightsView | null;
    return view && Array.isArray(view.lights) ? { state: "ready", view } : { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}

/**
 * How often the Haven reads the lights (#1020, #1077): every 20 s while the Lights panel is on screen in a visible tab,
 * every 2 minutes while the tab is visible otherwise, and never while it's hidden. Govee allows 10,000 calls a day.
 */
export const LIGHTS_LIVE_MS = 20_000;
export const LIGHTS_IDLE_MS = 120_000;

/** What the panel says when Govee isn't answering (#1077): its lamps stay listed, unreachable, until it's back. */
export function downNote(view: Pick<LightsView, "vendors" | "until">, at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })): string | null {
  const down = (["switchbot", "govee"] as const).filter((v) => view.vendors[v] === "down");
  if (!down.length) return null;
  const until = view.until?.govee;
  if (down.includes("govee") && until) {
    const rest = down.length > 1 ? " SwitchBot didn't answer just now." : "";
    return `Govee's daily limit is used up: its lamps show as unreachable until ${at(until)}, then come back by themselves.${rest}`;
  }
  const names = down.map((v) => (v === "govee" ? "Govee" : "SwitchBot"));
  return `${names.join(" and ")} didn't answer just now${down.includes("govee") ? ": its lamps show as unreachable until it does" : ""}.`;
}

/** A scene that turns the lights off, by its name ("Turn off lights", "All off", "Lights off"). */
export const isOffScene = (name: string) => / off /.test(words(name)) && !/ on /.test(words(name));

/**
 * The view as it will be once an off scene has run (#1020): every SwitchBot switch off at once, on screen and in the
 * panel, until the vendors' own states are read again (a moment later, fresh) and win. Govee lamps wait for that read:
 * the scene may not reach them.
 */
export function afterScene(view: LightsView, scene: string): LightsView {
  if (!isOffScene(scene)) return view;
  return { ...view, lights: view.lights.map((l) => (l.vendor === "switchbot" && l.online ? { ...l, on: false } : l)) };
}

/** How long a switch or a scene's target holds against reads that still say otherwise (#1022). */
export const HOLD_MS = 40_000;
/** The targets held: a light's id, what it was set to, until when. */
export type Holds = Map<string, { on: boolean; until: number }>;

/** Holds every online SwitchBot switch off after an off scene (#1022): the real switches take a while to follow. */
export function holdScene(view: LightsView, scene: string, holds: Holds, now: number) {
  if (!isOffScene(scene)) return;
  for (const l of view.lights) if (l.vendor === "switchbot" && l.online) holds.set(l.id, { on: false, until: now + HOLD_MS });
}

/**
 * A read as shown (#1022, Nikita: the off scene turned the lights off, then all back on, then off one by one): a light
 * held by a switch or a scene keeps its target while reads still say otherwise, until a read agrees or the hold ends;
 * then the read wins. Ends the holds it's done with.
 */
export function held(view: LightsView, holds: Holds, now: number): LightsView {
  if (!holds.size) return view;
  const lights = view.lights.map((l) => {
    const h = holds.get(l.id);
    if (!h) return l;
    if (now >= h.until || l.on === h.on || !l.online) {
      holds.delete(l.id);
      return l;
    }
    return { ...l, on: h.on };
  });
  return { ...view, lights };
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
export async function placeLightAt(name: string, at: { x: number; y: number; x2?: number; y2?: number } | null, f: typeof fetch = fetch): Promise<{ ok: true; spots: PlanLight[] } | { ok: false; say: string }> {
  try {
    // A run (#1007: a row of spots, a backlight) sends its far end too.
    const far = at && typeof at.x2 === "number" && typeof at.y2 === "number" ? { x2: Math.round(at.x2), y2: Math.round(at.y2) } : {};
    const body = at ? { action: "light", name, x: Math.round(at.x), y: Math.round(at.y), ...far } : { action: "light", name, clear: true };
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

/** A word in a light's name that means another room (#1002: the laundry is the hall, for all intents and purposes). */
const ROOM_ALIASES: Record<string, readonly string[]> = { laundry: ["hall", "hallway", "corridor"] };

/** The room a light's name says, the longest room name first ("Living room" before "Room"), aliases after. */
function roomNamed(plan: HavenPlan, name: string): PlanRoom | null {
  const rooms = plan.rooms.filter((r) => !r.detached).sort((a, b) => b.name.length - a.name.length);
  const direct = rooms.find((r) => name.includes(words(r.name)));
  if (direct) return direct;
  for (const [word, means] of Object.entries(ROOM_ALIASES))
    if (name.includes(` ${word} `)) {
      const r = rooms.find((x) => means.some((m) => words(x.name).includes(` ${m} `)));
      if (r) return r;
    }
  return null;
}

/**
 * The room a light lights as a whole (#1002): a SwitchBot switch is the room's own overhead lights (the living room,
 * the kitchen, the dining room, the hall), so it lights the room its name says, else the room its spot is in. A floor
 * lamp or an under-light, or a Govee light, lights only round itself: null.
 */
export function roomLightOf(plan: HavenPlan, light: Pick<Light, "vendor" | "name">, at?: { x: number; y: number; spot?: PlanLight }): PlanRoom | null {
  if (light.vendor !== "switchbot" || fixtureOf(light.name) !== "ceiling" || kindOf(light.name, at?.spot) !== null) return null;
  const r = roomNamed(plan, words(light.name)) ?? (at ? roomAt(plan, at.x, at.y) : null);
  return r && !r.detached ? r : null;
}

/** A light on the house: where it hangs, in plan units. */
export interface PlacedLight {
  light: Light;
  x: number;
  y: number;
  /** The plan's own spot for it, when it has one (#1007: a run's far end and its kind live there). */
  spot?: PlanLight;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Where each light goes: `placed` on the house, `loose` with no spot and no room in its name. */
export function placeLights(plan: HavenPlan, lights: readonly Light[], spots: readonly PlanLight[] | undefined = plan.lights): { placed: PlacedLight[]; loose: Light[] } {
  const placed: PlacedLight[] = [], loose: Light[] = [];
  const perRoom = new Map<string, number>();
  for (const light of lights) {
    const name = words(light.name);
    const spot = spots?.find((s) => words(s.name) === name);
    if (spot) {
      placed.push({ light, x: spot.x, y: spot.y, spot });
      continue;
    }
    // The room whose name the light's holds, the longest name first ("Living room" before "Room"); "Laundry" the hall.
    const room = roomNamed(plan, name);
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
