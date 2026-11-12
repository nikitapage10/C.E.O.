import type { HavenPlan, PlanItem, PlanRoom } from "./data.ts";
import { OPEN_ROOM, STUDIO_WALLS, flushWall } from "./furnish.ts";
import type { PlanLight } from "../../../api/_haven/planShape.ts";
import { LIGHT_KINDS as KINDS, type LightKind } from "../../../api/_haven/planShape.ts";

export type { LightKind };

/**
 * What a home's own light fixtures are and where they run (#1007). A SwitchBot switch is usually a run of fittings, not
 * a lamp: a row of ceiling spots, a backlight strip behind the kitchen's back panelling, a hall fitting. Each light
 * gets a kind: the plan's own (`kind` on its saved spot) when it says, else by the light's name (`NAMED_KINDS`), else
 * none (the older drawing: a room's lights, a floor lamp, an under-light or a ceiling puck).
 *
 * Where a kind runs: the saved spot first, a line when it has a far end (`x2`, `y2`, two taps on the house), a point
 * otherwise; else the house's own shape:
 *
 *   spots      the overhead lights: since #1020 soft light filling a zone (overheadZones), the first from the cabinet
 *              run to the island's middle across the open kitchen and the hall, the second from there on through the
 *              dining room, never over the living room (#1035); a saved run or point lights those same zones.
 *   backlight  the wall behind the cabinet run, between the hob and the coffee maker (or the run's far end).
 *   glow       a soft glow at the far end of the hall from the kitchen (the laundry end).
 *
 * Pure: the drawn (furnished) plan in, plan units out. No names of anyone's home here: the kinds by name are the apps'
 * light names, and every place comes from the plan.
 */

/** The kinds the Haven gives lights by their names in the app (#1007), any case: whole names. */
export const NAMED_KINDS: Readonly<Record<string, LightKind>> = {
  "left living room": "spots",
  "right living room": "spots",
  kitchen: "backlight",
  laundry: "glow",
};

/** A light's run on the plan: from (x0, y0) to (x1, y1); a point when both ends are the same. */
export interface Run {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a fixture is drawn: its kind, its run, and for a backlight which way the wall faces into the room. */
export interface FixturePlace {
  kind: LightKind;
  run: Run;
  /**
   * The floor an overhead light fills (#1020: soft light through the space, no spots to see), as a box (x0 < x1,
   * y0 < y1); for the overhead kinds only.
   */
  zone?: Run;
  /** A backlight's way into the room from its wall, as a unit step in plan units. */
  out?: [number, number];
}

/**
 * The kitchen island's under-light (#1085): whether the island's green underglow is lit. It follows the light whose
 * name says island (an under, glow or kick light, or the one island light that isn't a top or pendant light); lit
 * while the lights aren't read yet (null) or no such light is found, as the model always showed it; off when that
 * light is off or offline.
 */
export function islandGlowOn(lights: readonly { name: string; on: boolean | null; online: boolean }[] | null): boolean {
  if (!lights) return true;
  const island = lights.filter((l) => /\bisland\b/i.test(l.name) && !/\b(top|tops|pendant|pendants|over|above)\b/i.test(l.name));
  const under = island.find((l) => /\b(under|underneath|below|bottom|glow|kick|base)\b/i.test(l.name)) ?? (island.length === 1 ? island[0] : undefined);
  if (!under) return true;
  return under.online && under.on === true;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const KITCHEN = /\bkitchen\b/i;
const LIVING = /\bliving\b/i;
const HALL = /\b(hall|hallway|entry|foyer|corridor)\b/i;

/** A light's kind: the saved spot's, else its name's, else null (the older fixtures). */
export function kindOf(name: string, spot?: Pick<PlanLight, "kind"> | null): LightKind | null {
  if (spot?.kind && KINDS.includes(spot.kind)) return spot.kind;
  return NAMED_KINDS[words(name)] ?? null;
}

type Box = [number, number, number, number];
const box = (it: PlanItem): Box => (it.round ? [it.x - it.w / 2, it.y - it.w / 2, it.x + it.w / 2, it.y + it.w / 2] : [it.x, it.y, it.x + it.w, it.y + it.h]);
const mid = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p: [number, number], b: Box, pad = 0) => p[0] >= b[0] - pad && p[0] <= b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[3] + pad;
const largest = (r: PlanRoom): Box => {
  const p = r.parts.reduce((a, q) => (q[2] * q[3] > a[2] * a[3] ? q : a), r.parts[0]!);
  return [p[0], p[1], p[0] + p[2], p[1] + p[3]];
};

/** The kitchen's cabinet run as drawn: the room's box, the run, the wall it backs onto and what stands on it. */
export interface KitchenRun {
  R: Box;
  run: Box;
  wall: "n" | "s" | "e" | "w";
  hob: Box | null;
  coffee: Box | null;
  fridge: Box | null;
  island: Box | null;
}

export function kitchenRun(plan: HavenPlan): KitchenRun | null {
  const room = plan.rooms.find((r) => !r.detached && KITCHEN.test(r.name));
  if (!room) return null;
  const R = largest(room);
  const here = plan.items.filter((it) => inside(mid(box(it)), R, 2));
  const counters = here.filter((it) => it.k === "counter" && !it.round);
  if (!counters.length) return null;
  const run = box(counters.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)));
  const gaps: ["n" | "s" | "e" | "w", number][] = [["n", run[1] - R[1]], ["s", R[3] - run[3]], ["w", run[0] - R[0]], ["e", R[2] - run[2]]];
  const wall = gaps.reduce((a, c) => (c[1] < a[1] ? c : a))[0];
  const onRun = (it: PlanItem) => inside(mid(box(it)), run, 4);
  const pick = (k: PlanItem["k"][]) => {
    const it = here.find((i) => k.includes(i.k) && onRun(i));
    return it ? box(it) : null;
  };
  const fridge = here.find((i) => i.k === "fridge");
  const island = here.find((i) => i.k === "island");
  return { R, run, wall, hob: pick(["range"]), coffee: pick(["espresso", "kettle"]), fridge: fridge ? box(fridge) : null, island: island ? box(island) : null };
}

/** The backlight behind the run: along the wall, from the hob to the coffee maker (else the run's end away from the fridge). */
export function backlightRun(plan: HavenPlan): FixturePlace | null {
  const k = kitchenRun(plan);
  if (!k) return null;
  const along = k.wall === "n" || k.wall === "s";
  const A = (b: Box): [number, number] => (along ? [b[0], b[2]] : [b[1], b[3]]);
  const [r0, r1] = A(k.run);
  let a0: number, a1: number;
  if (k.hob) {
    const [h0, h1] = A(k.hob);
    const hc = (h0 + h1) / 2;
    // Toward the coffee maker, or the end of the run away from the fridge, or simply the longer side.
    const fc = k.fridge ? (A(k.fridge)[0] + A(k.fridge)[1]) / 2 : null;
    const cc = k.coffee ? (A(k.coffee)[0] + A(k.coffee)[1]) / 2 : null;
    const up = cc !== null ? cc > hc : fc !== null ? fc < hc : r1 - h1 > h0 - r0;
    [a0, a1] = up ? [h1 + 4, cc !== null ? A(k.coffee!)[0] - 4 : r1 - 6] : [cc !== null ? A(k.coffee!)[1] + 4 : r0 + 6, h0 - 4];
    if (a1 - a0 < 40) [a0, a1] = [r0 + (r1 - r0) * 0.2, r1 - (r1 - r0) * 0.2];
  } else [a0, a1] = [r0 + (r1 - r0) * 0.2, r1 - (r1 - r0) * 0.2];
  // On the wall line, a hair into the room.
  const w = k.wall === "n" ? k.run[1] + 1.5 : k.wall === "s" ? k.run[3] - 1.5 : k.wall === "w" ? k.run[0] + 1.5 : k.run[2] - 1.5;
  const out: [number, number] = k.wall === "n" ? [0, 1] : k.wall === "s" ? [0, -1] : k.wall === "w" ? [1, 0] : [-1, 0];
  return { kind: "backlight", run: along ? { x0: a0, y0: w, x1: a1, y1: w } : { x0: w, y0: a0, x1: w, y1: a1 }, out };
}

/**
 * The open kitchen's span along the cabinet run: the kitchen's own, carried into a hall that opens off either end of
 * it (the two are one space, furnish.ts), less a margin at each end.
 */
function openSpan(plan: HavenPlan, k: KitchenRun): [number, number] {
  const along = k.wall === "n" || k.wall === "s";
  let [a0, a1] = along ? [k.R[0], k.R[2]] : [k.R[1], k.R[3]];
  const [d0, d1] = along ? [k.R[1], k.R[3]] : [k.R[0], k.R[2]];
  for (const r of plan.rooms) {
    if (r.detached || !HALL.test(r.name)) continue;
    for (const [x, y, w, h] of r.parts) {
      const [p0, p1] = along ? [x, x + w] : [y, y + h];
      const [q0, q1] = along ? [y, y + h] : [x, x + w];
      if (Math.min(q1, d1) - Math.max(q0, d0) < 40) continue;
      if (Math.abs(p1 - a0) < 3) a0 = p0;
      else if (Math.abs(p0 - a1) < 3) a1 = p1;
    }
  }
  return [a0 + 30, a1 - 30];
}

/** The two rows of ceiling spots across the open kitchen: [the cabinet run's row, the row past the island]. */
export function spotRows(plan: HavenPlan): [Run, Run] | null {
  const k = kitchenRun(plan);
  if (!k) return null;
  const along = k.wall === "n" || k.wall === "s";
  // Depth from the run's wall, into the room.
  const far = k.wall === "n" || k.wall === "w";
  const W = along ? (far ? k.R[1] : k.R[3]) : far ? k.R[0] : k.R[2];
  const depth = (b: Box): [number, number] => {
    const [p, q] = along ? [b[1], b[3]] : [b[0], b[2]];
    return far ? [p - W, q - W] : [W - q, W - p];
  };
  const room = along ? k.R[3] - k.R[1] : k.R[2] - k.R[0];
  const front = depth(k.run)[1];
  const [i0, i1] = k.island ? depth(k.island) : [front + (room - front) * 0.45, front + (room - front) * 0.45];
  const d1 = Math.max(front + 25, (front + i0) / 2);
  const d2 = Math.min(room - 20, i1 + (room - i1) * 0.55);
  const at = (d: number) => (far ? W + d : W - d);
  const [a0, a1] = openSpan(plan, k);
  const row = (d: number): Run => (along ? { x0: a0, y0: at(d), x1: a1, y1: at(d) } : { x0: at(d), y0: a0, x1: at(d), y1: a1 });
  return [row(d1), row(d2)];
}

/**
 * The floor the two overhead switches fill (#1020, #1022): the kitchen and the dining room (furnish.ts OPEN_ROOM, less
 * the living room), split across their length in two, the first ("left") at the kitchen's end, the second on to the
 * far end, meeting with no gap. A hall beside them carries the zone it touches up to 150 into it. The living room has
 * no ceiling light (#1035, Nikita): it is lit only by what spills in from these and by its floor lamp (realLights.ts
 * spillOf), so no zone reaches into it.
 */
export function overheadZones(plan: HavenPlan): [Run, Run] | null {
  const home = plan.rooms.filter((r) => !r.detached);
  const open = home.filter((r) => OPEN_ROOM.test(r.name) && !LIVING.test(r.name));
  const kitchen = open.find((r) => /\bkitchen\b/i.test(r.name));
  if (!kitchen) return null;
  const parts = open.flatMap((r) => r.parts);
  const U = { x0: Math.min(...parts.map((p) => p[0])), y0: Math.min(...parts.map((p) => p[1])), x1: Math.max(...parts.map((p) => p[0] + p[2])), y1: Math.max(...parts.map((p) => p[1] + p[3])) };
  const long = U.x1 - U.x0 >= U.y1 - U.y0;
  const kc = kitchen.parts.reduce((n, p) => n + (long ? p[0] + p[2] / 2 : p[1] + p[3] / 2), 0) / kitchen.parts.length;
  const [lo, hi] = long ? [U.x0, U.x1] : [U.y0, U.y1];
  const mid = (lo + hi) / 2;
  const kitchenLow = kc <= mid;
  const span = (a: number, b: number): Run => (long ? { x0: a, y0: U.y0, x1: b, y1: U.y1 } : { x0: U.x0, y0: a, x1: U.x1, y1: b });
  const z = kitchenLow ? [span(lo, mid), span(mid, hi)] : [span(mid, hi), span(lo, mid)];
  // Part of a hall beside the open room: up to 150 into it, along the stretch it shares.
  for (const h of home.filter((r) => HALL.test(r.name) && !OPEN_ROOM.test(r.name)))
    for (const [px, py, pw, ph] of h.parts) {
      const P = { x0: px, y0: py, x1: px + pw, y1: py + ph };
      const ox = Math.min(P.x1, U.x1) - Math.max(P.x0, U.x0), oy = Math.min(P.y1, U.y1) - Math.max(P.y0, U.y0);
      let add: Run | null = null;
      if (oy > 20 && Math.abs(P.x1 - U.x0) <= 2) add = { x0: Math.max(P.x0, U.x0 - 150), y0: Math.max(P.y0, U.y0), x1: U.x0, y1: Math.min(P.y1, U.y1) };
      else if (oy > 20 && Math.abs(P.x0 - U.x1) <= 2) add = { x0: U.x1, y0: Math.max(P.y0, U.y0), x1: Math.min(P.x1, U.x1 + 150), y1: Math.min(P.y1, U.y1) };
      else if (ox > 20 && Math.abs(P.y1 - U.y0) <= 2) add = { x0: Math.max(P.x0, U.x0), y0: Math.max(P.y0, U.y0 - 150), x1: Math.min(P.x1, U.x1), y1: U.y0 };
      else if (ox > 20 && Math.abs(P.y0 - U.y1) <= 2) add = { x0: Math.max(P.x0, U.x0), y0: U.y1, x1: Math.min(P.x1, U.x1), y1: Math.min(P.y1, U.y1 + 150) };
      if (!add) continue;
      const c = long ? (add.x0 + add.x1) / 2 : (add.y0 + add.y1) / 2;
      // The zone whose middle is nearer the hall's stretch.
      const near = z.map((q) => Math.abs((long ? (q.x0 + q.x1) / 2 : (q.y0 + q.y1) / 2) - c));
      const k = near[0]! <= near[1]! ? 0 : 1;
      const q = z[k]!;
      z[k] = { x0: Math.min(q.x0, add.x0), y0: Math.min(q.y0, add.y0), x1: Math.max(q.x1, add.x1), y1: Math.max(q.y1, add.y1) };
    }
  return [z[0]!, z[1]!];
}

/** A band of overhead light round a run (a saved row), `half` either side, as a box. */
export function bandOf(run: Run, half = 110): Run {
  return { x0: Math.min(run.x0, run.x1) - half, y0: Math.min(run.y0, run.y1) - half, x1: Math.max(run.x0, run.x1) + half, y1: Math.max(run.y0, run.y1) + half };
}

/** The floor a single fitting lights (#1020): a box round it, kept inside the room it's in. */
export function glowZone(plan: HavenPlan, x: number, y: number, half = 120): Run {
  const room = plan.rooms.find((r) => !r.detached && r.parts.some(([px, py, pw, ph]) => x >= px && x <= px + pw && y >= py && y <= py + ph));
  const b = { x0: x - half, y0: y - half, x1: x + half, y1: y + half };
  if (!room) return b;
  const [r0, r1, r2, r3] = largest(room);
  return { x0: Math.max(b.x0, r0), y0: Math.max(b.y0, r1), x1: Math.min(b.x1, r2), y1: Math.min(b.y1, r3) };
}

/** The hall's far end from the kitchen, where the laundry is: a point a fifth of the hall's length in from that end. */
export function laundrySpot(plan: HavenPlan): { x: number; y: number } | null {
  const hall = plan.rooms.find((r) => !r.detached && HALL.test(r.name));
  if (!hall) return null;
  const [x0, y0, x1, y1] = largest(hall);
  const k = kitchenRun(plan);
  const [kx, ky] = k ? mid(k.run) : [x0, y0];
  if (y1 - y0 >= x1 - x0) {
    const end = Math.abs(ky - y0) > Math.abs(ky - y1) ? 0 : 1;
    return { x: (x0 + x1) / 2, y: end === 0 ? y0 + (y1 - y0) * 0.2 : y1 - (y1 - y0) * 0.2 };
  }
  const end = Math.abs(kx - x0) > Math.abs(kx - x1) ? 0 : 1;
  return { x: end === 0 ? x0 + (x1 - x0) * 0.2 : x1 - (x1 - x0) * 0.2, y: (y0 + y1) / 2 };
}

/** A row through a saved point, across the open kitchen along the run when the point is in it, else along its room. */
function rowThrough(plan: HavenPlan, x: number, y: number): Run {
  const k = kitchenRun(plan);
  const room = plan.rooms.find((r) => !r.detached && r.parts.some(([px, py, pw, ph]) => x >= px && x <= px + pw && y >= py && y <= py + ph));
  if (k && room && (KITCHEN.test(room.name) || HALL.test(room.name))) {
    const [a0, a1] = openSpan(plan, k);
    return k.wall === "n" || k.wall === "s" ? { x0: a0, y0: y, x1: a1, y1: y } : { x0: x, y0: a0, x1: x, y1: a1 };
  }
  if (!room) return { x0: x - 150, y0: y, x1: x + 150, y1: y };
  const [x0, y0, x1, y1] = largest(room);
  return x1 - x0 >= y1 - y0 ? { x0: x0 + 30, y0: y, x1: x1 - 30, y1: y } : { x0: x, y0: y0 + 30, x1: x, y1: y1 - 30 };
}

/**
 * Where a light of `kind` is drawn on the drawn plan: from its saved spot (already moved onto the drawn plan) when it
 * has one, else from the house. `index` tells the two spot rows apart (0: the run's row, "left"; 1: past the island).
 */
export function placeFixture(plan: HavenPlan, kind: LightKind, spot: Pick<PlanLight, "x" | "y" | "x2" | "y2"> | null, index = 0): FixturePlace | null {
  if (spot && typeof spot.x2 === "number" && typeof spot.y2 === "number") {
    const run = { x0: spot.x, y0: spot.y, x1: spot.x2, y1: spot.y2 };
    if (kind === "spots") return { kind, run, zone: overheadZones(plan)?.[Math.min(1, Math.max(0, index))] ?? bandOf(run) };
    if (kind === "glow") return { kind, run, zone: bandOf(run, 90) };
    // A saved backlight faces into the room it runs along: the side its middle's room lies on.
    const dx = run.x1 - run.x0, dy = run.y1 - run.y0, L = Math.hypot(dx, dy) || 1;
    const n: [number, number] = [-dy / L + 0, dx / L + 0];
    const mx = (run.x0 + run.x1) / 2, my = (run.y0 + run.y1) / 2;
    const inRoom = (px: number, py: number) => plan.rooms.some((r) => !r.detached && r.parts.some(([x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h));
    return { kind, run, out: inRoom(mx + n[0] * 30, my + n[1] * 30) ? n : [-n[0], -n[1]] };
  }
  if (kind === "spots") {
    // The open room's two halves always (#1022): a saved spot moves only the row the zone is named after.
    const rows = spotRows(plan), zones = overheadZones(plan);
    const i = Math.min(1, Math.max(0, index));
    const run = spot ? rowThrough(plan, spot.x, spot.y) : rows?.[i];
    if (!run) return null;
    return { kind, run, zone: zones?.[i] ?? bandOf(run) };
  }
  if (kind === "backlight") {
    const b = backlightRun(plan);
    if (!spot) return b;
    // A saved point: the strip along the run's wall still, when the point is by it; else a short strip at the point.
    if (b) return b;
    return { kind, run: { x0: spot.x - 60, y0: spot.y, x1: spot.x + 60, y1: spot.y }, out: [0, 1] };
  }
  const p = spot ?? laundrySpot(plan);
  return p ? { kind, run: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, zone: glowZone(plan, p.x, p.y) } : null;
}

const STUDIO = /\b(studio|study)\b/i;

/**
 * Where the Studio's floor lamps stand when the plan saves no spot for them (#1007): one in the corner over the DJ
 * decks, one in the corner behind the two sofas (furnish.ts STUDIO_WALLS), a little in from both walls. A lamp named
 * "left" takes the sofas' corner and "right" the decks'; otherwise the first lamp the decks' and the second the sofas'.
 * Null when the plan has no Studio.
 */
export function studioLampSpots(plan: HavenPlan): { dj: { x: number; y: number }; sofas: { x: number; y: number } } | null {
  const room = plan.rooms.find((r) => !r.detached && STUDIO.test(r.name));
  if (!room) return null;
  const corner = ([a, b]: readonly [string, string], [x0, y0, x1, y1]: Box) => {
    const side = [a, b];
    // Right in the corner, against both walls (#1022): the lamp's base is about 30 across.
    const inset = 16;
    return { x: side.includes("w") ? x0 + inset : x1 - inset, y: side.includes("n") ? y0 + inset : y1 - inset };
  };
  // The decks' lamp at the end of the whole window wall, the nook off it included (#1060: the decks stand along it).
  const [ex, ey, ew, eh] = flushWall(room, STUDIO_WALLS.desk);
  return { dj: corner(STUDIO_WALLS.dj, [ex, ey, ex + ew, ey + eh]), sofas: corner(STUDIO_WALLS.sofas, largest(room)) };
}

const MASTER_BED = /\b(master|primary)\b/i;
const BED = /\bbed/i;

/**
 * Where the main bedroom's floor lamps stand (#1060): the two corners either side of its dresser, on the wall the
 * dresser backs onto, a little in from both walls; facing that wall, the left-hand corner first. Null with no bedroom
 * or no dresser in it. `plan` is the drawn (furnished) plan.
 */
export function bedLampSpots(plan: HavenPlan): [{ x: number; y: number }, { x: number; y: number }] | null {
  const beds = plan.rooms.filter((r) => !r.detached && BED.test(r.name) && !/\bbath/i.test(r.name));
  const room = beds.find((r) => MASTER_BED.test(r.name)) ?? beds[0];
  if (!room) return null;
  const R = largest(room);
  const dresser = plan.items.find((i) => i.k === "dresser" && inside(mid(box(i)), R));
  if (!dresser) return null;
  const b = box(dresser);
  const gaps: [string, number][] = [["n", b[1] - R[1]], ["s", R[3] - b[3]], ["w", b[0] - R[0]], ["e", R[2] - b[2]]];
  const wall = gaps.reduce((a, c) => (c[1] < a[1] ? c : a))[0];
  const inset = 16;
  const [x0, y0, x1, y1] = [R[0] + inset, R[1] + inset, R[2] - inset, R[3] - inset];
  // Facing the wall: on the north wall the left is west, on the south east, on the east north, on the west south.
  const pair: Record<string, [[number, number], [number, number]]> = {
    n: [[x0, y0], [x1, y0]],
    s: [[x1, y1], [x0, y1]],
    e: [[x1, y0], [x1, y1]],
    w: [[x0, y1], [x0, y0]],
  };
  const [l, r] = pair[wall]!;
  return [{ x: l[0], y: l[1] }, { x: r[0], y: r[1] }];
}

/** Whether a point is in the main bedroom (the room bedLampSpots goes by). */
export function inBedroom(plan: HavenPlan, x: number, y: number): boolean {
  const beds = plan.rooms.filter((r) => !r.detached && BED.test(r.name) && !/\bbath/i.test(r.name));
  const room = beds.find((r) => MASTER_BED.test(r.name)) ?? beds[0];
  return !!room && room.parts.some(([px, py, pw, ph]) => x >= px && x <= px + pw && y >= py && y <= py + ph);
}

/** Which Studio corner a floor lamp takes: by "left" or "right" in its name, else by its order among the Studio's lamps. */
export function studioLampCorner(name: string, order: number): "dj" | "sofas" {
  const w = ` ${words(name)} `;
  if (/ left /.test(w)) return "sofas";
  if (/ right /.test(w)) return "dj";
  return order % 2 === 0 ? "dj" : "sofas";
}

/** Whether a point is in the plan's Studio. */
export function inStudio(plan: HavenPlan, x: number, y: number): boolean {
  return plan.rooms.some((r) => !r.detached && STUDIO.test(r.name) && r.parts.some(([px, py, pw, ph]) => x >= px && x <= px + pw && y >= py && y <= py + ph));
}

/** Whether a kind is placed as a run, two taps (#1007): a row of spots or a backlight strip. */
export const isRun = (k: LightKind | null) => k === "spots" || k === "backlight";

/** Which of the spot rows a light is by its name: "right" the second, anything else the first. */
export const rowIndex = (name: string) => (/\bright\b/.test(words(name)) ? 1 : 0);
