import { roomAt, type HavenPlan, type Seg } from "./data.ts";

/*
 * Setting the openings wall by wall (#747): which walls of the home have windows, which have a glass door out to a
 * balcony, which are solid, and which wall the TV hangs on. The Haven's wall editor (WallEditor.tsx) uses these on
 * the private plan and saves it back through the passkey session; nothing here knows any home's layout. Pure.
 */

export type Side = "n" | "e" | "s" | "w";
export type Glass = "solid" | "windows" | "door" | "both";
export type At = "start" | "middle" | "end";

export interface WallSide {
  /** `<room id>:<side>`, stable across edits. */
  key: string;
  room: string;
  name: string;
  side: Side;
  seg: Seg;
  /** Nothing but outdoors on the far side (an outside wall). */
  outside: boolean;
}

/** The balcony door's width, and how far windows keep from a wall's ends and from doors (plan units). */
export const DOOR_W = 90;
const END = 20;
const SIDE_NAME: Record<Side, string> = { n: "north", e: "east", s: "south", w: "west" };
export const sideName = (s: Side) => SIDE_NAME[s];

/** Every wall of the home's rooms (each room's largest part), the detached Gym left out. */
export function wallSides(plan: HavenPlan): WallSide[] {
  const out: WallSide[] = [];
  for (const r of plan.rooms) {
    if (r.detached) continue;
    const [x, y, w, h] = r.parts.reduce((a, p) => (p[2] * p[3] > a[2] * a[3] ? p : a), r.parts[0]!);
    const sides: [Side, Seg, number, number][] = [
      ["n", [x, y, x + w, y], x + w / 2, y - 12],
      ["e", [x + w, y, x + w, y + h], x + w + 12, y + h / 2],
      ["s", [x, y + h, x + w, y + h], x + w / 2, y + h + 12],
      ["w", [x, y, x, y + h], x - 12, y + h / 2],
    ];
    for (const [side, seg, px, py] of sides) out.push({ key: `${r.id}:${side}`, room: r.id, name: r.name, side, seg, outside: !roomAt(plan, px, py) });
  }
  return out;
}

const hz = (s: Seg) => s[1] === s[3];
/** The segment's line and its span along it, low to high. */
const span = (s: Seg): { line: number; a: number; b: number; h: boolean } => (hz(s) ? { line: s[1], a: Math.min(s[0], s[2]), b: Math.max(s[0], s[2]), h: true } : { line: s[0], a: Math.min(s[1], s[3]), b: Math.max(s[1], s[3]), h: false });
const make = (h: boolean, line: number, a: number, b: number): Seg => (h ? [a, line, b, line] : [line, a, line, b]);
const same = (s: Seg, w: Seg) => {
  const p = span(s), q = span(w);
  return p.h === q.h && Math.abs(p.line - q.line) <= 6;
};

/** The parts of `segs` along wall `w`, clipped to it. */
export function onWall(segs: Seg[], w: Seg): [number, number][] {
  const q = span(w);
  return segs
    .filter((s) => same(s, w))
    .map((s) => span(s))
    .map(({ a, b }) => [Math.max(a, q.a), Math.min(b, q.b)] as [number, number])
    .filter(([a, b]) => b - a > 1);
}

/** `segs` with whatever lies along wall `w` taken out (a run that goes past its ends keeps those ends). */
function without(segs: Seg[], w: Seg): Seg[] {
  const q = span(w);
  const out: Seg[] = [];
  for (const s of segs) {
    if (!same(s, w)) {
      out.push(s);
      continue;
    }
    const p = span(s);
    if (p.b <= q.a || p.a >= q.b) out.push(s);
    else {
      if (p.a < q.a - 1) out.push(make(p.h, p.line, p.a, q.a));
      if (p.b > q.b + 1) out.push(make(p.h, p.line, q.b, p.b));
    }
  }
  return out;
}

/** What wall `w` has now. */
export function glassOf(plan: HavenPlan, w: Seg): { glass: Glass; at: At; tv: boolean } {
  const win = onWall(plan.windows, w).length > 0;
  const door = onWall(plan.balconies ?? [], w)[0];
  const q = span(w);
  let at: At = "middle";
  if (door) {
    const mid = (door[0] + door[1]) / 2, f = (mid - q.a) / Math.max(1, q.b - q.a);
    at = f < 0.34 ? "start" : f > 0.66 ? "end" : "middle";
  }
  return { glass: door ? (win ? "both" : "door") : win ? "windows" : "solid", at, tv: onWall(plan.tv ?? [], w).length > 0 };
}

/** Free runs of [a, b] after taking out the `cut` intervals, each grown by `pad`. */
function free(a: number, b: number, cuts: [number, number][], pad: number): [number, number][] {
  let runs: [number, number][] = [[a, b]];
  for (const [c, d] of cuts) {
    const next: [number, number][] = [];
    for (const [x, y] of runs) {
      if (d + pad <= x || c - pad >= y) next.push([x, y]);
      else {
        if (c - pad > x) next.push([x, c - pad]);
        if (d + pad < y) next.push([d + pad, y]);
      }
    }
    runs = next;
  }
  return runs.filter(([x, y]) => y - x >= 30);
}

/**
 * The plan with wall `w` set: solid (no windows, no balcony door), windows along it (clear of its ends and its doors),
 * a balcony door at its start, middle or end, or both. Start is the wall's top or left end as the map shows it.
 */
export function setGlass(plan: HavenPlan, w: Seg, glass: Glass, at: At = "middle"): HavenPlan {
  const q = span(w);
  let windows = without(plan.windows, w);
  let balconies = without(plan.balconies ?? [], w);
  const doors = onWall(plan.doors, w);
  const L = q.b - q.a;
  if (glass === "door" || glass === "both") {
    const dw = Math.min(DOOR_W, L - 2 * END);
    const a = at === "start" ? q.a + END : at === "end" ? q.b - END - dw : q.a + (L - dw) / 2;
    if (dw >= 40) {
      balconies = [...balconies, make(q.h, q.line, Math.round(a), Math.round(a + dw))];
      doors.push([a, a + dw]);
    }
  }
  if (glass === "windows" || glass === "both") windows = [...windows, ...free(q.a + END, q.b - END, doors, 14).map(([a, b]) => make(q.h, q.line, Math.round(a), Math.round(b)))];
  return { ...plan, windows, balconies };
}

/** The plan with the TV on wall `w` (on: the only TV wall of that room), or off it. */
export function setTv(plan: HavenPlan, w: Seg, on: boolean, roomWalls: Seg[] = []): HavenPlan {
  let tv = without(plan.tv ?? [], w);
  for (const o of roomWalls) tv = without(tv, o);
  if (on) tv = [...tv, w];
  return { ...plan, tv };
}
