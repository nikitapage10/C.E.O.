import type { HavenPlan, Kind, PlanItem, PlanRoom, Seg } from "./data.ts";
import { KIND_STYLE } from "./style.ts";

/*
 * Dressing the Haven's main rooms (#747). The plan says where the walls, windows and doors are; a sparse or dated
 * furniture list read as a different flat. Each room named here is laid out again from its own walls, the way it is
 * actually lived in, by rules, not by stored positions:
 *
 *   Living room   the TV on the solid wall facing the windows, a long low console under it, an L sectional facing
 *                 it with a square coffee table on a rug between, an arc lamp behind the sofa, a drinks fridge beside
 *                 it, and the tall cat tree in the corner by the balcony door.
 *   Studio        the desk along the window wall (two monitors, an office chair, speakers either side, a tall shelf
 *                 at its end), two low sofas meeting in an L in the corner farthest from the door, a coffee table on
 *                 a rug in the middle, the DJ deck and the cat tree by the door. No printer.
 *   Kitchen       what the plan has, plus a sideboard at the end of the counter run with the espresso machine on it
 *                 and shelves above; a tub chair in a free corner of the dining area.
 *   Balcony nook  beside a balcony door anywhere else: a small plant greenhouse, a round cat bed by it, and an air
 *                 purifier under the nearest window.
 *
 * Pure and deterministic, and only the drawing uses it: the stored plan is untouched. Devices stay where they are.
 */

type Side = "n" | "s" | "w" | "e";
type Rect = [number, number, number, number];
type Box = [number, number, number, number];

const LIVING = /\bliving\b/i;
const STUDIO = /\b(studio|study)\b/i;
const BATH = /\bbath/i;
const HALL = /\b(hall|entry|foyer)\b/i;
const KITCHEN = /\bkitchen\b/i;
const DINING = /\bdining\b/i;

const OPP: Record<Side, Side> = { n: "s", s: "n", w: "e", e: "w" };
const SIDES: Side[] = ["n", "e", "s", "w"];
const ACROSS: Record<Side, [Side, Side]> = { n: ["w", "e"], s: ["w", "e"], w: ["n", "s"], e: ["n", "s"] };

/** The room's largest part: the rectangle the layout works in. */
export function mainRect(r: PlanRoom): Rect {
  return r.parts.reduce((a, p) => (p[2] * p[3] > a[2] * a[3] ? p : a), r.parts[0]!);
}

const wallLen = (R: Rect, s: Side) => (s === "n" || s === "s" ? R[2] : R[3]);
const depthTo = (R: Rect, s: Side) => (s === "n" || s === "s" ? R[3] : R[2]);

/** A box against wall `s`: `t` along it from its start (west or north end), `len` along, `dep` into the room, `gap` off it. */
function against(R: Rect, s: Side, t: number, len: number, dep: number, gap = 4): Rect {
  const [x, y, w, h] = R;
  if (s === "n") return [x + t, y + gap, len, dep];
  if (s === "s") return [x + t, y + h - gap - dep, len, dep];
  if (s === "w") return [x + gap, y + t, dep, len];
  return [x + w - gap - dep, y + t, dep, len];
}

/** A box `off` in from wall `s` (its near edge), otherwise as `against`. */
const inFrom = (R: Rect, s: Side, t: number, len: number, dep: number, off: number) => against(R, s, t, len, dep, off);

/** How much of a segment lies on wall `s` of R, and where along it (from its start). */
function onWall(R: Rect, s: Side, seg: Seg): [number, number] | null {
  const [x, y, w, h] = R;
  const hz = seg[1] === seg[3], vt = seg[0] === seg[2];
  const near = (a: number, b: number) => Math.abs(a - b) <= 6;
  if ((s === "n" || s === "s") && hz && near(seg[1], s === "n" ? y : y + h)) {
    const a = Math.max(x, Math.min(seg[0], seg[2])), b = Math.min(x + w, Math.max(seg[0], seg[2]));
    return b > a ? [a - x, b - x] : null;
  }
  if ((s === "w" || s === "e") && vt && near(seg[0], s === "w" ? x : x + w)) {
    const a = Math.max(y, Math.min(seg[1], seg[3])), b = Math.min(y + h, Math.max(seg[1], seg[3]));
    return b > a ? [a - y, b - y] : null;
  }
  return null;
}

const runs = (R: Rect, s: Side, segs: Seg[]) => segs.map((g) => onWall(R, s, g)).filter((v): v is [number, number] => v !== null);
const glass = (R: Rect, s: Side, p: HavenPlan) => [...runs(R, s, p.windows), ...runs(R, s, p.balconies ?? [])].reduce((n, [a, b]) => n + b - a, 0);

const item = (k: Kind, r: Rect): PlanItem => ({ k, x: Math.round(r[0]), y: Math.round(r[1]), w: Math.round(r[2]), h: Math.round(r[3]), round: false });
const round = (k: Kind, cx: number, cy: number, d: number): PlanItem => ({ k, x: Math.round(cx), y: Math.round(cy), w: Math.round(d), h: Math.round(d), round: true });
const centreOfRect = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const clampLen = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A point `inA` in from wall a and `inB` in from wall b (two walls meeting at a corner). */
function corner(R: Rect, a: Side, b: Side, inA: number, inB: number): [number, number] {
  const [x, y, w, h] = R;
  const px = a === "w" ? x + inA : a === "e" ? x + w - inA : b === "w" ? x + inB : x + w - inB;
  const py = a === "n" ? y + inA : a === "s" ? y + h - inA : b === "n" ? y + inB : y + h - inB;
  return [px, py];
}

/** The start ("lo") or end ("hi") of wall s, as the side wall that meets it there. */
const endSide = (s: Side, end: "lo" | "hi"): Side => ACROSS[s][end === "lo" ? 0 : 1];

function boxOf(it: PlanItem): Box {
  return it.round ? [it.x - it.w / 2, it.y - it.w / 2, it.x + it.w / 2, it.y + it.w / 2] : [it.x, it.y, it.x + it.w, it.y + it.h];
}
const inRect = (px: number, py: number, R: Rect) => px >= R[0] && px <= R[0] + R[2] && py >= R[1] && py <= R[1] + R[3];

/** The window wall: the side with the most glass; else the longest outside wall; else the longest. */
function windowWall(R: Rect, p: HavenPlan): Side {
  return [...SIDES].sort((a, b) => glass(R, b, p) - glass(R, a, p) || wallLen(R, b) - wallLen(R, a))[0]!;
}

/** Pieces that stand on the floor and take it up (not rugs and mats, not what hangs or sits on something else). */
const solid = (it: PlanItem) => KIND_STYLE[it.k].height > 2 && KIND_STYLE[it.k].lift < 20;
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/** Whether a piece would stand in another's footprint (a rug only clashes with another rug). */
const clash = (list: PlanItem[], it: PlanItem) => list.some((o) => (solid(it) ? solid(o) : o.k === it.k) && overlaps(boxOf(o), boxOf(it)));
const fits = (R: Rect, it: PlanItem) => {
  const b = boxOf(it);
  return b[0] >= R[0] && b[1] >= R[1] && b[2] <= R[0] + R[2] && b[3] <= R[1] + R[3];
};

/* ── the rooms ── */

function living(R: Rect, p: HavenPlan): PlanItem[] {
  const win = windowWall(R, p);
  // The TV wall: the one the plan names; else across from the windows when that wall is solid, else the longest wall
  // without glass.
  const named = SIDES.find((s) => runs(R, s, p.tv ?? []).length);
  const tvWall = named ?? (glass(R, OPP[win], p) === 0 ? OPP[win] : ([...SIDES].filter((s) => glass(R, s, p) === 0).sort((a, b) => wallLen(R, b) - wallLen(R, a))[0] ?? OPP[win]));
  const L = wallLen(R, tvWall), D = depthTo(R, tvWall);
  const out: PlanItem[] = [];
  const conLen = clampLen(L * 0.6, 120, 260);
  out.push(item("console", against(R, tvWall, (L - conLen) / 2, conLen, 40)));
  const tvLen = clampLen(L * 0.5, 110, 220);
  out.push(item("tv", against(R, tvWall, (L - tvLen) / 2, tvLen, 6, 0)));
  // Where the balcony door is on this room, if anywhere: the cat tree's corner, and the sectional's open end.
  let door: { s: Side; at: number } | null = null;
  for (const s of SIDES) for (const [a, b] of runs(R, s, p.balconies ?? [])) door ??= { s, at: (a + b) / 2 };
  // The sectional faces the TV: a long run across the room, its return on the end away from the balcony door.
  const sofaDep = 90, sofaOff = clampLen(D * 0.58, 200, D - sofaDep - 30);
  const sofaLen = clampLen(L * 0.62, 180, 300);
  const t0 = (L - sofaLen) / 2;
  out.push(item("sofa", inFrom(R, tvWall, t0, sofaLen, sofaDep, sofaOff)));
  const doorEnd: "lo" | "hi" = door && (door.s === endSide(tvWall, "lo") || door.s === endSide(tvWall, "hi")) ? (door.s === endSide(tvWall, "lo") ? "lo" : "hi") : door && door.s === OPP[tvWall] ? (door.at < L / 2 ? "lo" : "hi") : "hi";
  const retEnd: "lo" | "hi" = doorEnd === "lo" ? "hi" : "lo";
  const retLen = clampLen(sofaOff * 0.55, 110, 190);
  out.push(item("sofa", inFrom(R, tvWall, retEnd === "lo" ? t0 : t0 + sofaLen - sofaDep, sofaDep, retLen, sofaOff - retLen)));
  // A square coffee table on a light rug, between the TV and the sofa.
  const gapMid = 44 + (sofaOff - 44) / 2;
  // Centred on the sectional's open run, clear of its return.
  const open0 = retEnd === "lo" ? t0 + sofaDep : t0, open1 = retEnd === "lo" ? t0 + sofaLen : t0 + sofaLen - sofaDep;
  const tMid = (open0 + open1) / 2;
  const rugLen = clampLen(sofaLen * 0.85, 140, 260), rugDep = clampLen(sofaOff - 70, 100, 200);
  out.push(item("rug", inFrom(R, tvWall, clampLen(tMid - rugLen / 2, 4, L - rugLen - 4), rugLen, rugDep, gapMid - rugDep / 2)));
  const ct = clampLen(Math.min(open1 - open0 - 30, rugDep * 0.75), 60, 110);
  out.push(item("ctable", inFrom(R, tvWall, tMid - ct / 2, ct, ct, gapMid - ct / 2)));
  // The arc lamp behind the sofa at its return end; the drinks fridge beside the sofa at the other.
  const lampT = retEnd === "lo" ? t0 + 10 : t0 + sofaLen - 10;
  const [lx, ly] = centreOfRect(inFrom(R, tvWall, lampT - 16, 32, 32, Math.min(D - 40, sofaOff + sofaDep + 14)));
  out.push(round("lamp", lx, ly, 32));
  const fT = retEnd === "lo" ? t0 + sofaLen + 12 : t0 - 12 - 46;
  if (fT > 10 && fT + 46 < L - 10) out.push(item("minifridge", inFrom(R, tvWall, fT, 46, 46, sofaOff + 20)));
  // The tall cat tree in the corner by the balcony door, else the corner of the window wall.
  const ctSide: Side = door ? door.s : win;
  const ctEnd: "lo" | "hi" = door ? (door.at < wallLen(R, door.s) / 2 ? "lo" : "hi") : "hi";
  const [cx, cy] = corner(R, ctSide, endSide(ctSide, ctEnd), 40, 40);
  out.push(round("cattree", cx, cy, 64));
  // The projector on the ceiling over the coffee table.
  out.push(item("projector", inFrom(R, tvWall, (L - 34) / 2, 34, 26, gapMid + 20)));
  return out;
}

function studio(R: Rect, p: HavenPlan, doors: Seg[]): PlanItem[] {
  const win = windowWall(R, p);
  const L = wallLen(R, win);
  const out: PlanItem[] = [];
  // The desk along the window wall, centred on its glass.
  const wr = runs(R, win, p.windows);
  const mid = wr.length ? (Math.min(...wr.map((r) => r[0])) + Math.max(...wr.map((r) => r[1]))) / 2 : L / 2;
  const deskLen = clampLen(L * 0.5, 140, 220), dt = clampLen(mid - deskLen / 2, 70, L - deskLen - 70);
  out.push(item("desk", against(R, win, dt, deskLen, 70)));
  // On it: the ultrawide and a second screen, a speaker at either end.
  const uw = deskLen * 0.44, m2 = deskLen * 0.22, s0 = dt + deskLen * 0.13;
  out.push(item("monitor", against(R, win, s0, uw, 8, 10)));
  out.push(item("monitor", against(R, win, s0 + uw + deskLen * 0.03, m2, 8, 14)));
  const spk = Math.min(22, deskLen * 0.09);
  out.push(item("speaker", against(R, win, dt + 3, spk, spk, 12)));
  out.push(item("speaker", against(R, win, dt + deskLen - 3 - spk, spk, spk, 12)));
  const [ox, oy] = centreOfRect(inFrom(R, win, s0 + uw / 2 - 29, 58, 58, 84));
  out.push(round("ochair", ox, oy, 58));
  // The door: where along which wall.
  let door: { s: Side; at: number; a: number; b: number } | null = null;
  for (const s of SIDES) for (const [a, b] of runs(R, s, doors)) door ??= { s, at: (a + b) / 2, a, b };
  // The tall shelf at the desk's end away from the door.
  const shelfLo = !(door && (door.s === endSide(win, "lo") || (door.s === win && door.at < L / 2)));
  out.push(item("shelf", against(R, win, shelfLo ? 4 : L - 54, 50, 40)));
  // The L of two low sofas in the corner farthest from the door, along the back wall and a side wall, short of the
  // door when it is on one of them.
  const back = OPP[win];
  const doorXY = door ? centreOfRect(against(R, door.s, door.at, 1, 1, 0)) : centreOfRect(R);
  const ends: ("lo" | "hi")[] = ["lo", "hi"];
  const far = ends.sort((a, b) => {
    const [ax, ay] = corner(R, back, endSide(back, a), 0, 0), [bx, by] = corner(R, back, endSide(back, b), 0, 0);
    return Math.hypot(bx - doorXY[0], by - doorXY[1]) - Math.hypot(ax - doorXY[0], ay - doorXY[1]);
  })[0]!;
  const side = endSide(back, far), SL = wallLen(R, side);
  const BL = wallLen(R, back), dep = 82;
  const room = (s: Side, from: "lo" | "hi", want: number) => {
    if (!door || door.s !== s) return want;
    const free = from === "lo" ? door.a - 4 - 16 : wallLen(R, s) - door.b - 4 - 16;
    return Math.min(want, free);
  };
  const aLen = room(back, far, clampLen(BL * 0.5, 150, 230));
  const fromBackEnd = back === endSide(side, "lo") ? "lo" : "hi";
  const bLen = room(side, fromBackEnd, clampLen(SL * 0.45, 130, 200) + dep) - dep;
  const aT = far === "lo" ? 4 : BL - 4 - aLen;
  if (aLen >= 100) out.push(item("sofa", against(R, back, aT, aLen, dep)));
  if (bLen >= 90) out.push(item("sofa", against(R, side, fromBackEnd === "lo" ? 4 + dep : SL - 4 - dep - bLen, bLen, dep)));
  // The coffee table on a rug in front of the sofas; the hoop light against the back wall past the sofa's end.
  const cands = (list: PlanItem[][]) => list.find((group) => group.every((it) => fits(R, it) && !clash(out, it))) ?? [];
  const sofaMid = aLen >= 100 ? aT + aLen / 2 : BL / 2;
  out.push(...cands([dep + 34, dep + 70].flatMap((off) => [0, -40, 40, -80, 80, -120, 120].map((d) => [item("rug", inFrom(R, back, sofaMid + d - 80, 160, 120, off - 24)), item("ctable", inFrom(R, back, sofaMid + d - 36, 72, 52, off))]))));
  const [hx, hy] = corner(R, back, side, 22, Math.min(SL - 30, aLen + 26));
  out.push(...cands([[round("lamp", hx, hy, 22)]]));
  // By the door: the DJ deck beside it, the cat tree by it too, wherever the floor is free.
  if (door) {
    const DL = wallLen(R, door.s);
    const along = (t: number, len: number, d: number) => against(R, door.s, clampLen(t, 4, DL - len - 4), len, d, 6);
    out.push(...cands([[item("dj", along(door.b + 12, 80, 46))], [item("dj", along(door.a - 12 - 80, 80, 46))]]));
    const tree = (t: number) => {
      const [tx, ty] = centreOfRect(along(t, 56, 56));
      return [round("cattree", tx, ty, 56)];
    };
    out.push(...cands([tree(door.a - 12 - 56), tree(door.b + 12), tree(door.b + 104), tree(door.a - 104 - 56)]));
  }
  return out;
}

/** The kitchen's additions: the sideboard at the end of the counter run, the espresso machine and shelves on it. */
function kitchen(R: Rect, items: PlanItem[]): PlanItem[] {
  const counters = items.filter((i) => i.k === "counter" && !i.round && inRect(...centreOfRect([i.x, i.y, i.w, i.h]), R));
  if (!counters.length) return [];
  const run = counters.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const along = run.w >= run.h;
  const len = 110, dep = along ? run.h : run.w;
  const taken = items.map(boxOf);
  const fits = (b: Box) => b[0] >= R[0] + 2 && b[1] >= R[1] + 2 && b[2] <= R[0] + R[2] - 2 && b[3] <= R[1] + R[3] - 2 && !taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
  const tries: Box[] = along
    ? [[run.x + run.w + 6, run.y, run.x + run.w + 6 + len, run.y + dep], [run.x - 6 - len, run.y, run.x - 6, run.y + dep]]
    : [[run.x, run.y + run.h + 6, run.x + dep, run.y + run.h + 6 + len], [run.x, run.y - 6 - len, run.x + dep, run.y - 6]];
  const b = tries.find(fits);
  if (!b) return [];
  const sb = item("sideboard", [b[0], b[1], b[2] - b[0], b[3] - b[1]]);
  const [ex, ey] = centreOfRect([b[0], b[1], b[2] - b[0], b[3] - b[1]]);
  return [sb, item("espresso", [ex - 15, ey - 13, 30, 26]), item("upper", along ? [b[0], b[1] - 2, len, 14] : [b[0] - 2, b[1], 14, len])];
}

/** A tub chair in the first free corner of the dining area. */
function tubChair(R: Rect, items: PlanItem[], p: HavenPlan): PlanItem[] {
  const taken = [...items.filter(solid).map(boxOf), ...p.devices.map((d): Box => [d.x - 30, d.y - 30, d.x + 30, d.y + 30])];
  for (const [a, b] of [["s", "e"], ["s", "w"], ["n", "e"], ["n", "w"]] as [Side, Side][]) {
    const [cx, cy] = corner(R, a, b, 40, 40);
    const box: Box = [cx - 32, cy - 32, cx + 32, cy + 32];
    if (!taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) return [round("tubchair", cx, cy, 60)];
  }
  return [];
}

/** Beside a balcony door: a small greenhouse on its solid side, a round cat bed by it, a purifier under the window. */
function nook(R: Rect, p: HavenPlan, s: Side, a: number, b: number): PlanItem[] {
  const L = wallLen(R, s);
  const win = runs(R, s, p.windows);
  const glassBefore = win.filter(([, e]) => e <= a + 1).reduce((n, [x, e]) => n + e - x, 0);
  const glassAfter = win.filter(([x]) => x >= b - 1).reduce((n, [x, e]) => n + e - x, 0);
  const after = glassAfter < glassBefore || (glassAfter === glassBefore && L - b > a);
  const out: PlanItem[] = [];
  const gh = 70;
  const gt = after ? Math.min(L - gh - 4, b + 12) : Math.max(4, a - 12 - gh);
  out.push(item("greenhouse", against(R, s, gt, gh, 50, 6)));
  const [bx, by] = centreOfRect(inFrom(R, s, after ? gt : gt + gh - 46, 46, 46, 70));
  out.push(round("petbed", bx, by, 46));
  const w = win.find(([x, e]) => e - x >= 40);
  if (w) out.push(item("purifier", against(R, s, (w[0] + w[1]) / 2 - 18, 36, 26, 6)));
  return out;
}

/** Standing in a doorway on wall `door`, looking in: the wall on the left. */
const LEFT: Record<Side, Side> = { n: "e", s: "w", w: "n", e: "s" };
/** `t` along wall `s` measured from its end at wall `from` (one of the two walls meeting it). */
const tFrom = (R: Rect, s: Side, from: Side, t: number, len: number) => (from === endSide(s, "lo") ? t : wallLen(R, s) - t - len);

/** The side of R a door is on, and where along it; the longest wall when none is found. */
function doorOf(R: Rect, doors: Seg[]): { s: Side; at: number } {
  for (const s of SIDES) for (const [a, b] of runs(R, s, doors)) return { s, at: (a + b) / 2 };
  return { s: [...SIDES].sort((a, b) => wallLen(R, b) - wallLen(R, a))[0]!, at: 0 };
}

/**
 * A bathroom as seen from its door. The master bath: the glass walk-in shower on the left, the toilet with its mat and
 * a plain litter box by the shower on the back wall with a towel bar, the long vanity on the right (its mirror and
 * bar light come with it), shag mats by the shower and the vanity. The guest bath: the vanity on the left, the toilet
 * on the back wall, the alcove tub in the back right corner with its curtain, a towel bar on the left wall.
 */
function bath(R: Rect, doors: Seg[], master: boolean): PlanItem[] {
  const door = doorOf(R, doors).s;
  const back = OPP[door], left = LEFT[door], right = OPP[left];
  const BL = wallLen(R, back), SL = wallLen(R, left);
  const out: PlanItem[] = [];
  const along = (s: Side, from: Side, t: number, len: number, dep: number, gap = 4) => against(R, s, tFrom(R, s, from, t, len), len, dep, gap);
  if (master) {
    const shLen = clampLen(SL * 0.5, 90, 150), shDep = clampLen(BL * 0.35, 80, 110);
    out.push(item("shower", along(left, back, 2, shLen, shDep, 2)));
    out.push(item("mat", along(left, back, shLen + 8, 60, 44, shDep * 0.3)));
    const vLen = clampLen(SL * 0.7, 100, 240);
    out.push(item("vanity", along(right, door, Math.max(20, (SL - vLen) / 2), vLen, 54)));
    out.push(item("mat", inFrom(R, right, tFrom(R, right, door, Math.max(20, (SL - vLen) / 2) + vLen / 2 - 40, 80), 80, 46, 64)));
    // Back wall, left to right from the shower: the litter box on its mat, the toilet, the towel bar.
    let t = shDep + 10;
    if (t + 46 + 12 + 40 <= BL - 8) {
      out.push(item("mat", along(back, left, t - 4, 56, 54, 2)));
      out.push(item("litterbox", along(back, left, t, 46, 40, 6)));
      t += 60;
    }
    if (t + 40 <= BL - 4) {
      out.push(item("wc", along(back, left, t, 40, 66)));
      out.push(item("mat", along(back, left, t - 6, 52, 40, 74)));
      t += 54;
    }
    if (t + 50 <= BL - 4) out.push(item("towelbar", along(back, left, t, 50, 6, 0)));
  } else {
    const vLen = clampLen(SL * 0.45, 70, 140);
    out.push(item("vanity", along(left, door, 16, vLen, 54)));
    out.push(item("towelbar", along(left, door, 16 + vLen + 14, Math.min(50, SL - vLen - 40), 6, 0)));
    const tubLen = clampLen(wallLen(R, right) * 0.6, 120, 160), tubDep = clampLen(BL * 0.42, 60, 78);
    out.push(item("tub", along(right, back, 2, tubLen, tubDep, 2)));
    out.push(item("mat", inFrom(R, right, tFrom(R, right, back, tubLen * 0.25, 60), 60, 40, tubDep + 6)));
    const wt = clampLen((BL - tubDep - 40) / 2, 10, BL - tubDep - 48);
    out.push(item("wc", along(back, left, wt, 40, 66)));
    out.push(item("mat", along(back, left, wt - 6, 52, 40, 74)));
  }
  return out;
}

/** The front door: a door of the hall whose far side is outside the home; a coat rack and shoes beside it. */
function hall(R: Rect, plan: HavenPlan): PlanItem[] {
  const home = plan.rooms.filter((r) => !r.detached);
  const inside = (x: number, y: number) => home.some((r) => r.parts.some((pt) => inRect(x, y, pt)));
  for (const s of SIDES)
    for (const [a, b] of runs(R, s, plan.doors)) {
      const mid = (a + b) / 2;
      const [px, py] = centreOfRect(against(R, s, mid, 1, 1, -24));
      if (inside(px, py)) continue;
      const L = wallLen(R, s);
      if (b + 12 + 44 <= L - 4) return [item("coatrack", against(R, s, b + 12, 44, 34, 4))];
      if (a - 12 - 44 >= 4) return [item("coatrack", against(R, s, a - 12 - 44, 44, 34, 4))];
      // No room beside it on that wall: on the side wall at the nearer corner.
      const end: "lo" | "hi" = a < L - b ? "lo" : "hi";
      const side = endSide(s, end);
      return [item("coatrack", against(R, side, tFrom(R, side, s, 8, 44), 44, 34, 4))];
    }
  return [];
}

/** The white cat tunnel (two donuts) under the dining area's largest window, else the kitchen's. */
function tunnel(R: Rect, p: HavenPlan, items: PlanItem[]): PlanItem[] {
  let best: { s: Side; a: number; b: number } | null = null;
  for (const s of SIDES) for (const [a, b] of runs(R, s, p.windows)) if (!best || b - a > best.b - best.a) best = { s, a, b };
  if (!best || best.b - best.a < 80) return [];
  const len = 130;
  const box = against(R, best.s, (best.a + best.b) / 2 - len / 2, len, 52, 8);
  const taken = items.filter((i) => KIND_TALL(i)).map(boxOf);
  const b: Box = [box[0], box[1], box[0] + box[2], box[1] + box[3]];
  if (taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1])) return [];
  return [item("tunnel", box)];
}
const KIND_TALL = (i: PlanItem) => !["rug", "mat", "runner", "gmat"].includes(i.k);

/** The raised double bowls on their stand, at the end of the feeding station's row. */
function bowls(p: HavenPlan): PlanItem[] {
  const row = p.devices.filter((d) => d.kind === "fountain" || d.kind === "dry-feeder" || d.kind === "wet-feeder");
  if (!row.length) return [];
  const xs = row.map((d) => d.x), ys = row.map((d) => d.y);
  const flat = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const step = row.length > 1 ? (flat ? (Math.max(...xs) - Math.min(...xs)) : Math.max(...ys) - Math.min(...ys)) / (row.length - 1) : 40;
  const gap = Math.max(36, step);
  const cx = flat ? Math.max(...xs) + gap : row[0]!.x, cy = flat ? row[0]!.y : Math.max(...ys) + gap;
  return [item("bowls", flat ? [cx - 22, cy - 12, 44, 24] : [cx - 12, cy - 22, 24, 44])];
}

/** The plan as drawn: these rooms dressed by the rules above; every other room as the plan has it. */
export function furnish(plan: HavenPlan): HavenPlan {
  let items = [...plan.items];
  const home = plan.rooms.filter((r) => !r.detached);
  const within = (r: PlanRoom, it: PlanItem) => {
    const [cx, cy] = it.round ? [it.x, it.y] : [it.x + it.w / 2, it.y + it.h / 2];
    return r.parts.some((pt) => inRect(cx, cy, pt));
  };
  const relay = (r: PlanRoom, make: (R: Rect) => PlanItem[]) => {
    const R = mainRect(r);
    const fresh = make(R);
    items = [...items.filter((it) => !within(r, it)), ...fresh];
  };
  for (const r of home) {
    if (LIVING.test(r.name)) relay(r, (R) => living(R, plan));
    else if (STUDIO.test(r.name)) relay(r, (R) => studio(R, plan, plan.doors));
  }
  items = [...items, ...bowls(plan)];
  for (const r of home) {
    if (KITCHEN.test(r.name)) items = [...items, ...kitchen(mainRect(r), items)];
    if (DINING.test(r.name) || (KITCHEN.test(r.name) && !home.some((x) => DINING.test(x.name)))) items = [...items, ...tubChair(mainRect(r), items, plan)];
  }
  // The bathrooms: the master (by name, else the largest of two or more) and the guest bath.
  const baths = home.filter((r) => BATH.test(r.name));
  const area = (r: PlanRoom) => r.parts.reduce((n, pt) => n + pt[2] * pt[3], 0);
  const biggest = baths.length > 1 ? baths.reduce((a, b) => (area(b) > area(a) ? b : a)) : null;
  for (const r of baths) {
    const master = /\b(master|primary|en-?suite)\b/i.test(r.name) || (!/\bguest\b/i.test(r.name) && r === biggest);
    relay(r, (R) => bath(R, plan.doors, master));
  }
  for (const r of home) if (HALL.test(r.name)) items = [...items, ...hall(mainRect(r), plan)];
  const dining = home.find((x) => DINING.test(x.name)) ?? home.find((x) => KITCHEN.test(x.name));
  if (dining) items = [...items, ...tunnel(mainRect(dining), plan, items)];
  // The nooks: a balcony door in any room but the living room and the studio.
  for (const seg of plan.balconies ?? []) {
    const r = home.find((x) => !LIVING.test(x.name) && !STUDIO.test(x.name) && SIDES.some((s) => onWall(mainRect(x), s, seg)));
    if (!r) continue;
    const R = mainRect(r);
    const s = SIDES.find((x) => onWall(R, x, seg))!;
    const [a, b] = onWall(R, s, seg)!;
    items = [...items, ...nook(R, plan, s, a, b)];
  }
  return { ...plan, items };
}
