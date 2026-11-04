import { THERMO_MAX_F, THERMO_MIN_F, type DeviceKind, type DeviceReading, type ThermoMode, type Vendor, type VendorState } from "../homeDevices.ts";
import type { Climate } from "./data.ts";
import type { HavenPlan, Kind, Spot, Tab } from "./data.ts";

/**
 * The Haven's instrument plinth (#680, concept 3): the house-wide readings as one strip of engraved gauges, a hi-fi
 * faceplate in the dark beside the house, each gauge's lamp threaded to its device in the scene. Pure: what each gauge
 * says, where its thread goes, and how the Climate dial turns. The strip is Plinth.tsx; the threads are house.ts's.
 */

export type GaugeId = "climate" | "roborock" | "petlibro" | "whisker" | "kitchen" | "gym" | "todos";
/** The lamp: lit amber, ember-orange for a device that's down, dim while it waits. */
export type Tone = "on" | "down" | "wait";

export interface Gauge {
  id: GaugeId;
  name: string;
  /** The big serif value. */
  value: string;
  /** The small-caps line under the name. */
  state: string;
  tone: Tone;
}

/** Where a gauge's thread lands in the house: a device, a room's tab (on its fridge or desk if it has one), or furniture. */
export type ThreadTo = { spot: Spot[] } | { tab: Tab; item?: Kind[] } | { item: Kind[] };

export const THREAD_TO: Record<GaugeId, ThreadTo> = {
  climate: { spot: ["thermostat"] },
  roborock: { spot: ["vacuum"] },
  petlibro: { spot: ["dry-feeder", "wet-feeder", "fountain"] },
  whisker: { spot: ["litter"] },
  kitchen: { tab: "kitchen", item: ["fridge"] },
  gym: { tab: "gym" },
  todos: { item: ["desk", "console"] },
};

export interface GaugeInput {
  signedIn: boolean;
  /** The device route hasn't answered yet. */
  loading: boolean;
  vendors: Record<Vendor, VendorState>;
  /** The public face's device states (kind, state word, online), signed in or out. */
  devices: { kind: DeviceKind; state: string; online: boolean }[];
  climate: Climate;
  kitchenOpen: number | null;
  gym: { perWeek: number; doneThisWeek: number } | null;
  todos: number | null;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const VENDOR_SAYS: Record<Exclude<Vendor, "nest">, { kind: DeviceKind[]; what: string }> = {
  roborock: { kind: ["vacuum"], what: "Roborock" },
  petlibro: { kind: ["dry-feeder", "wet-feeder", "fountain"], what: "Petlibro" },
  whisker: { kind: ["litter"], what: "Whisker" },
};

/** The climate's state line: what it's doing and to what. */
export function climateLine(c: Climate): string {
  if (c.state !== "live") return "";
  if (c.mode === "off") return "off";
  if (c.mode === "eco") return "eco";
  const doing = c.running ? (c.mode === "cool" ? "cooling" : "heating") : "holding";
  return c.target !== null ? `${doing} · ${c.mode === "cool" ? "cool" : "heat"} to ${c.target}°` : doing;
}

/** The strip's gauges, left to right, from the same live readings the house uses. Nothing made up: waiting says so. */
export function gaugesOf(i: GaugeInput): Gauge[] {
  const nest = i.vendors.nest;
  const climate: Gauge =
    i.climate.state === "live"
      ? { id: "climate", name: "Climate", value: `${i.climate.inside}°`, state: climateLine(i.climate), tone: "on" }
      : nest === "down"
        ? { id: "climate", name: "Climate", value: "Down", state: "not answering", tone: "down" }
        : nest === "live"
          ? { id: "climate", name: "Climate", value: "Live", state: i.signedIn ? "the thermostat" : "sign in for the temperature", tone: "on" }
          : { id: "climate", name: "Climate", value: i.loading ? "…" : "Waiting", state: "not connected", tone: "wait" };
  const vendor = (v: Exclude<Vendor, "nest">): Gauge => {
    const id = v as GaugeId;
    const name = VENDOR_SAYS[v].what;
    const s = i.vendors[v];
    if (i.loading) return { id, name, value: "…", state: "reading", tone: "wait" };
    if (s === "waiting") return { id, name, value: "Waiting", state: "not connected", tone: "wait" };
    if (s === "down") return { id, name, value: "Down", state: "not answering", tone: "down" };
    const devs = i.devices.filter((d) => VENDOR_SAYS[v].kind.includes(d.kind));
    const off = devs.filter((d) => !d.online).length;
    if (devs.length && off === devs.length) return { id, name, value: "Offline", state: "live · device offline", tone: "down" };
    // The vacuum and the litter box say what they're doing; the Petlibro set is several devices, so it says how many answer.
    const one = devs.length === 1 && devs[0]!.state ? cap(devs[0]!.state) : null;
    const value = v === "petlibro" ? (devs.length ? `${devs.length - off} of ${devs.length}` : "Live") : (one ?? "Live");
    return { id, name, value, state: off ? `live · ${off} offline` : v === "petlibro" && devs.length ? "live · answering" : "live", tone: off ? "down" : "on" };
  };
  const count = (id: GaugeId, name: string, n: number | null, zero: string, some: string): Gauge => (n === null ? { id, name, value: "–", state: "waiting", tone: "wait" } : { id, name, value: String(n), state: n ? some : zero, tone: "on" });
  return [
    climate,
    vendor("roborock"),
    vendor("petlibro"),
    vendor("whisker"),
    count("kitchen", "Kitchen list", i.kitchenOpen, "nothing to get", "to get"),
    i.gym ? { id: "gym", name: "Gym", value: `${i.gym.doneThisWeek} of ${i.gym.perWeek}`, state: "this week", tone: "on" } : { id: "gym", name: "Gym", value: "–", state: "waiting", tone: "wait" },
    count("todos", "To-dos", i.todos, "clear", "open, on Today"),
  ];
}

/**
 * The strip's gauges in the order their threads land, left to right on screen (#718): each thread then runs up to its
 * room beside its neighbours and none cross. A gauge with no place on screen keeps its own place among the rest.
 */
export function orderGauges(gauges: Gauge[], order: GaugeId[] | null): Gauge[] {
  if (!order?.length) return gauges;
  const at = new Map(order.map((id, i) => [id, i]));
  const placed = gauges.filter((g) => at.has(g.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  const out: Gauge[] = [];
  let k = 0;
  for (const g of gauges) out.push(at.has(g.id) ? placed[k++]! : g);
  return out;
}

/* ── the Climate dial ── */

/** The dial's sweep: 270°, from the lower left (60 °F) round the top to the lower right (80 °F). Angles in radians, 0 at 3 o'clock, clockwise (screen). */
export const DIAL_A0 = Math.PI * 0.75;
export const DIAL_SWEEP = Math.PI * 1.5;

/** The angle a set point sits at on the dial. */
export function angleOf(f: number): number {
  const k = (Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, f)) - THERMO_MIN_F) / (THERMO_MAX_F - THERMO_MIN_F);
  return DIAL_A0 + k * DIAL_SWEEP;
}

/** The set point an angle on the dial means (whole degrees, 60 to 80 °F); the dead zone at the bottom snaps to the nearer end. */
export function setOf(angle: number): number {
  let a = angle - DIAL_A0;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (a > DIAL_SWEEP) a = a - DIAL_SWEEP < (2 * Math.PI - DIAL_SWEEP) / 2 ? DIAL_SWEEP : 0;
  return Math.round(THERMO_MIN_F + (a / DIAL_SWEEP) * (THERMO_MAX_F - THERMO_MIN_F));
}

/** The heat-and-cool gap the server's rails keep (api/_haven/devices/rails.ts, THERMO_GAP_F). */
export const GAP_F = 3;

/** What the dial turns: the set point in heat or cool, the heat side in heat-and-cool; null when it can't turn (off, eco, offline). */
export function dialOf(d: DeviceReading | null): { mode: ThermoMode; set: number } | null {
  if (!d || !d.online || d.eco || !d.mode || d.mode === "off") return null;
  const set = d.mode === "cool" ? d.coolF : d.heatF;
  return typeof set === "number" ? { mode: d.mode, set } : null;
}

/**
 * The change a turn to `f` sends, through the same action as the Climate control (thermostat.set): the set point in
 * heat or cool; in heat-and-cool the heat side, with the cool side pushed up to keep the gap (both inside 60 to 80 °F).
 */
export function turnTo(d: DeviceReading, f: number): { tempF?: number; heatF?: number; coolF?: number } | null {
  const dial = dialOf(d);
  if (!dial) return null;
  const at = Math.max(THERMO_MIN_F, Math.min(THERMO_MAX_F, Math.round(f)));
  if (dial.mode !== "heatcool") return { tempF: at };
  const heatF = Math.min(at, THERMO_MAX_F - GAP_F);
  const coolF = Math.max(d.coolF ?? heatF + GAP_F, heatF + GAP_F);
  return { heatF, coolF };
}

/** The point a thread lands on, in plan units (x, y and height), or null when the plan has nothing there. */
export function threadPoint(plan: HavenPlan, to: ThreadTo): [number, number, number] | null {
  if ("spot" in to) {
    for (const k of to.spot) {
      const d = plan.devices.find((x) => x.kind === k);
      if (d) return [d.x, d.y, d.lift + 20];
    }
    return null;
  }
  const room = "tab" in to ? plan.rooms.find((r) => r.tab === to.tab) : null;
  if ("tab" in to && !room) return null;
  const inRoom = (x: number, y: number) => !room || room.parts.some(([px, py, pw, ph]) => x >= px && x < px + pw && y >= py && y < py + ph);
  for (const k of to.item ?? []) {
    const it = plan.items.find((x) => x.k === k && inRoom(x.round ? x.x : x.x + x.w / 2, x.round ? x.y : x.y + x.h / 2));
    if (it) return it.round ? [it.x, it.y, 60] : [it.x + it.w / 2, it.y + it.h / 2, 60];
  }
  if (!room) return null;
  let ax = 0, ay = 0, a = 0;
  for (const [x, y, w, h] of room.parts) {
    ax += (x + w / 2) * w * h;
    ay += (y + h / 2) * w * h;
    a += w * h;
  }
  return a ? [ax / a, ay / a, 40] : null;
}
