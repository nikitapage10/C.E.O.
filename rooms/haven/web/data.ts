import type { DeviceReading } from "../../../apps/world/src/desk/homeDevices.ts";
import { readPlan, type HavenPlan, type PlanRoom, type Spot, type Tab } from "../../../api/_haven/planShape.ts";

export type { HavenPlan, PlanRoom, PlanDevice, PlanItem, Spot, Tab, Kind, Floor, Rect, Seg } from "../../../api/_haven/planShape.ts";
export { readPlan };

/**
 * The Haven's data, browser side (#616). The floor plan comes from the private store through /api/haven-plan, only
 * to a passkey session; everything else is what the Desk already reads: the home devices (homeDevices.ts), the
 * Kitchen list and Today's to-dos. `litRooms` turns those readings into which rooms of the house light up: only the
 * rooms where something is going on, and only from real readings. Pure, so it is tested on its own.
 */

/** "waiting": no plan yet (the Haven says so); "out": the session is gone; "off": no endpoint here (a local build). */
export type PlanLoad = { state: "idle" } | { state: "ready"; plan: HavenPlan } | { state: "waiting" } | { state: "out" } | { state: "off" } | { state: "failed" };

const PATH = "/api/haven-plan";
const isJson = (res: Response) => (res.headers.get("content-type") ?? "").includes("json");

export async function loadPlan(f: typeof fetch = fetch): Promise<PlanLoad> {
  try {
    const res = await f(PATH, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) return { state: "out" };
    if (res.status === 404 || res.status === 405 || !isJson(res)) return { state: "off" };
    if (!res.ok) return { state: "failed" };
    const got = (await res.json().catch(() => null)) as { plan?: unknown } | null;
    const plan = got?.plan ? readPlan(got.plan) : null;
    return plan ? { state: "ready", plan } : { state: "waiting" };
  } catch {
    return { state: "failed" };
  }
}

/** Saves a plan from a paste or a file. The server checks it again; its cleaned copy comes back. */
export async function savePlan(plan: unknown, f: typeof fetch = fetch): Promise<{ ok: true; plan: HavenPlan } | { ok: false; error: string }> {
  try {
    const res = await f(PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action: "save", plan }) });
    const got = (isJson(res) ? await res.json().catch(() => ({})) : {}) as { plan?: HavenPlan; error?: string };
    return res.ok && got.plan ? { ok: true, plan: got.plan } : { ok: false, error: String(got.error ?? (res.status === 401 ? "signed-out" : "failed")) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export const PLAN_NOTE: Record<string, string> = {
  "bad-plan": "That isn't a floor plan the Haven can read. Check it's the whole file.",
  "too-big": "That's bigger than any floor plan should be.",
  "signed-out": "Your session ended. Sign in again.",
  "not-set-up": "The private store isn't set up on this copy of the Desk.",
  failed: "That didn't save. Try again.",
};

/** The house-wide climate (the Nest, #637): waiting until its thermostat reading is there (signed in, connected). */
export type Climate = { state: "waiting" } | { state: "live"; inside: number; target: number | null; mode: "heat" | "cool" | "off" | "eco"; running: boolean };

/** The climate from the thermostat's reading (signed in only); waiting without one, or while it's offline. */
export function climateOf(devices: DeviceReading[] | null): Climate {
  const t = devices?.find((d) => d.kind === "thermostat");
  if (!t || !t.online || typeof t.tempF !== "number") return { state: "waiting" };
  const running = t.hvac === "heating" || t.hvac === "cooling";
  const mode = t.eco ? "eco" : t.mode === "off" ? "off" : t.mode === "cool" || (t.mode === "heatcool" && t.hvac === "cooling") ? "cool" : "heat";
  const target = t.mode === "heat" ? (t.heatF ?? null) : t.mode === "cool" ? (t.coolF ?? null) : null;
  return { state: "live", inside: t.tempF, target, mode, running };
}

/** The room a plan point is in, or null. */
export function roomAt(plan: HavenPlan, x: number, y: number): PlanRoom | null {
  for (const r of plan.rooms) for (const [px, py, pw, ph] of r.parts) if (x >= px && x < px + pw && y >= py && y < py + ph) return r;
  return null;
}

/** The middle of a room (area-weighted over its parts), in plan units. */
export function centreOf(room: PlanRoom): [number, number] {
  let ax = 0, ay = 0, a = 0;
  for (const [x, y, w, h] of room.parts) {
    ax += (x + w / 2) * w * h;
    ay += (y + h / 2) * w * h;
    a += w * h;
  }
  return a ? [ax / a, ay / a] : [0, 0];
}

const PET_SPOTS: readonly Spot[] = ["dry-feeder", "wet-feeder", "fountain", "litter"];

/** The tab a room opens: its own, or Pets where the cat's things stand, or the Hall where the vacuum docks. */
export function tabOf(plan: HavenPlan, room: PlanRoom): Tab | null {
  if (room.tab) return room.tab;
  const here = plan.devices.filter((d) => roomAt(plan, d.x, d.y)?.id === room.id).map((d) => d.kind);
  if (here.some((k) => PET_SPOTS.includes(k))) return "pets";
  if (here.includes("vacuum")) return "hall";
  return null;
}

export interface Lit {
  /** 0 quiet, up to 1 busy. */
  level: number;
  /** Something here wants Nikita (an alert, food low, the drawer full, a device offline). */
  needs: boolean;
  /** Short plain reasons, for the room's label: "vacuum running", "food low". */
  why: string[];
}

export interface LitInput {
  devices: DeviceReading[] | null;
  /** The Kitchen list's open items, or null when it couldn't be read. */
  kitchenOpen: number | null;
  climate: Climate;
  /** The Gym's plan is there (#660): its room is lit while it is. */
  gym?: boolean;
  now: number;
}

/** A room lit because what's in it is connected and answering (#671): a steady glow, brighter when something runs. */
const ALIVE: Lit = { level: 0.3, needs: false, why: [] };
/** A room smaller than this (plan units², about 2 m²) is a passage or a nook: what stands there serves the room next to it. */
const NOOK = 20_000;

const areaOf = (r: PlanRoom) => r.parts.reduce((a, [, , w, h]) => a + w * h, 0);
function gapTo(r: PlanRoom, x: number, y: number) {
  let best = Infinity;
  for (const [px, py, pw, ph] of r.parts) best = Math.min(best, Math.hypot(Math.max(px - x, 0, x - (px + pw)), Math.max(py - y, 0, y - (py + ph))));
  return best;
}

/**
 * The rooms a device lights: the one the plan says (`lights`, the climate's living room), else the one it stands in;
 * and when that is a passage or a nook, also the room it stands nearest to (the litter box in the passage by the
 * Studio lights the Studio).
 */
export function roomsLitBy(plan: HavenPlan, spot: { x: number; y: number; lights: string | null }): string[] {
  if (spot.lights) return [spot.lights];
  const here = roomAt(plan, spot.x, spot.y);
  if (!here) return [];
  if (areaOf(here) >= NOOK) return [here.id];
  const next = plan.rooms.filter((r) => r.id !== here.id && areaOf(r) >= NOOK).sort((a, b) => gapTo(a, spot.x, spot.y) - gapTo(b, spot.x, spot.y))[0];
  return next ? [here.id, next.id] : [here.id];
}

const HOUR = 3_600_000;
const recent = (iso: string | null | undefined, now: number, ms = HOUR) => (iso ? now - Date.parse(iso) < ms && now >= Date.parse(iso) : false);

/** What one device's reading says about its room. */
export function deviceLit(d: DeviceReading, now: number): Lit {
  const why: string[] = [];
  let level = 0;
  let needs = false;
  if (!d.online) return { level: 0.35, needs: true, why: ["offline"] };
  if (d.alerts.length) {
    needs = true;
    why.push(...d.alerts.slice(0, 2));
  }
  if (d.kind === "vacuum") {
    if (d.state === "cleaning" || d.state === "returning") {
      level = 1;
      why.unshift(d.state === "cleaning" ? "vacuum running" : "vacuum heading home");
    } else if (d.state === "paused") {
      level = 0.6;
      why.unshift("vacuum paused");
    }
  } else if (d.kind === "dry-feeder" || d.kind === "wet-feeder") {
    if (d.foodLow) {
      needs = true;
      why.push("food low");
    }
    if (recent(d.lastFed, now)) {
      level = Math.max(level, 0.7);
      why.unshift("just fed");
    }
  } else if (d.kind === "fountain") {
    if (d.water !== null && d.water !== undefined && d.water < 25) {
      needs = true;
      why.push("water low");
    }
  } else if (d.kind === "litter") {
    if (d.catInside || d.state === "cat-inside") {
      level = 0.8;
      why.unshift("cat inside");
    } else if (d.state === "cycling") {
      level = 0.8;
      why.unshift("cleaning cycle");
    }
    if ((d.drawer ?? 0) >= 85) {
      needs = true;
      why.push("drawer full");
    }
  }
  if (needs) level = Math.max(level, 0.85);
  // What needs Nikita leads the room's line: "food low" before "just fed".
  const urgent = new Set([...d.alerts, "food low", "water low", "drawer full"]);
  return { level, needs, why: [...why.filter((w) => urgent.has(w)), ...why.filter((w) => !urgent.has(w))] };
}

const KIND_OF: Partial<Record<Spot, DeviceReading["kind"]>> = { vacuum: "vacuum", "dry-feeder": "dry-feeder", "wet-feeder": "wet-feeder", fountain: "fountain", litter: "litter" };

function merge(into: Record<string, Lit>, id: string, lit: Lit) {
  if (lit.level <= 0 && !lit.needs) return;
  const was = into[id] ?? { level: 0, needs: false, why: [] };
  into[id] = { level: Math.max(was.level, lit.level), needs: was.needs || lit.needs, why: [...new Set([...was.why, ...lit.why])].slice(0, 3) };
}

/**
 * Which rooms light up, and why (#671): every room holding something connected and answering glows (a device online,
 * the climate reading, the Kitchen list, the Gym's plan), and what is running or wants Nikita burns brighter. A room
 * with nothing connected is left out (it stays dim). All from the plan's own placings, no room named here.
 */
export function litRooms(plan: HavenPlan, input: LitInput): Record<string, Lit> {
  const out: Record<string, Lit> = {};
  for (const spot of plan.devices) {
    const rooms = roomsLitBy(plan, spot);
    for (const room of rooms) {
      if (spot.kind === "thermostat") {
        const c = input.climate;
        if (c.state !== "live") continue;
        merge(out, room, ALIVE);
        if (c.running && c.mode !== "off" && c.mode !== "eco") merge(out, room, { level: 0.75, needs: false, why: [c.mode === "cool" ? "cooling" : "heating"] });
        continue;
      }
      const kind = KIND_OF[spot.kind];
      const reading = input.devices?.find((d) => d.kind === kind);
      if (!reading) continue;
      if (reading.online) merge(out, room, ALIVE);
      merge(out, room, deviceLit(reading, input.now));
    }
  }
  const byTab = (tab: Tab) => plan.rooms.filter((r) => r.tab === tab);
  if (input.kitchenOpen !== null) for (const r of byTab("kitchen")) merge(out, r.id, input.kitchenOpen ? { level: 0.55, needs: false, why: [`${input.kitchenOpen} to get`] } : ALIVE);
  if (input.gym) for (const r of byTab("gym")) merge(out, r.id, ALIVE);
  return out;
}

/** The plain line under the Haven's title: what needs Nikita, or that the house is quiet. */
export function summaryOf(lit: Record<string, Lit>, plan: HavenPlan | null): string {
  const needs = Object.entries(lit).filter(([, l]) => l.needs);
  const busy = Object.entries(lit).filter(([, l]) => !l.needs && l.level > 0 && l.why[0]);
  const name = (id: string) => plan?.rooms.find((r) => r.id === id)?.name ?? id;
  if (needs.length) return `${needs.map(([id, l]) => `${name(id)}: ${l.why[0] ?? "needs a look"}`).join(" · ")}`;
  if (busy.length) return `${busy.map(([id, l]) => `${name(id)}: ${l.why[0]}`).join(" · ")}`;
  return "All quiet. Nothing in the house needs you.";
}
