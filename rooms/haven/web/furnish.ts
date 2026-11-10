import type { HavenPlan, Kind, PlanItem, PlanRoom, Seg } from "./data.ts";
import { KIND_STYLE } from "./style.ts";

/*
 * Dressing the Haven's main rooms (#747, #764). The plan says where the walls, windows and doors are; a sparse or dated
 * furniture list read as a different flat. Each room named here is laid out again from its own walls, the way it is
 * actually lived in, by rules, not by stored positions:
 *
 *   Openings      when the plan saves no window or balcony door for a room, the walls give them (withOpenings): an
 *                 edge of the room with no room on the other side is an outside wall. The living room's balcony runs
 *                 along its longest outside wall, and the TV hangs on its back wall, across the room from the Gym (2026-11-05); the main
 *                 bedroom gets windows; the hall or landing outside the main bedroom gets a balcony over about half its
 *                 outside wall with a big window along the rest, clear of the corner by the bedroom door. A balcony
 *                 wider than a door is glazed like every other room, windows along it with one glass door out (#860),
 *                 and every balcony door is one single door wide, saved or derived (#935).
 *                 Every other wall stays solid. What the plan does save wins. The kitchen and the hall are one open
 *                 space: no wall is drawn where they meet.
 *   Living room   the TV on its back wall across from the Gym (else facing the windows), a long low console under it, an L sectional facing
 *                 it, turned to the east and south walls (#935: the return faces the other one when the TV is on one,
 *                 else the L backs onto both), with a square coffee table on a rug between, an arc lamp behind the sofa (kept in the corner it
 *                 has always stood in when the openings come from the walls), a drinks fridge beside it, and the tall
 *                 cat tree in the corner by the balcony door: the home's only cat tree.
 *   Studio        turned 90° clockwise (2026-11-06, #959): the desk against the east wall (two monitors, an office
 *                 chair, speakers either side, a tall shelf at its other end), two low sofas meeting in an L along the
 *                 south and west walls, a coffee table on a rug in front of them, and the DJ decks in the north-east
 *                 corner (STUDIO_WALLS). No printer.
 *   Kitchen       what the plan has, with the fridge at the left end of the cabinet run (looking at it), the hob
 *                 centre-left on the run, about a third of the way from the fridge's end (#1007), the espresso
 *                 machine on the counter, no sideboard or cabinet of bottles, and on the wall across from the
 *                 cabinets five tall black-and-white canvases side by side, one picture of trees and mountains; a tub
 *                 chair in a free corner of the dining area.
 *   Dining        the coffee station (#860): a low sideboard with the espresso machine on it, against the dining
 *                 room's wall on the TV's side (the back wall, away from the Gym), behind the table; the espresso machine
 *                 leaves the kitchen counter for it. When no stretch of that wall is free, it stays on the counter.
 *   Balcony nook  beside a balcony door anywhere but the living room, the Studio and the main bedroom: a small lit
 *                 greenhouse in the corner on its solid side, a round cat bed by it, and an air purifier under the
 *                 nearest window.
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

/** Where the arc lamp stands for a TV wall: behind the sectional, at its return end. */
function lampSpot(R: Rect, tvWall: Side, retEnd: "lo" | "hi"): [number, number] {
  const L = wallLen(R, tvWall), D = depthTo(R, tvWall);
  const sofaDep = 90, sofaOff = clampLen(D * 0.58, 200, D - sofaDep - 30);
  const sofaLen = clampLen(L * 0.62, 180, 300), t0 = (L - sofaLen) / 2;
  const lampT = retEnd === "lo" ? t0 + 10 : t0 + sofaLen - 10;
  return centreOfRect(inFrom(R, tvWall, lampT - 16, 32, 32, Math.min(D - 40, sofaOff + sofaDep + 14)));
}

/**
 * The living room's TV wall. With a Gym on the plan: the back wall, across the room from the wall nearest the Gym
 * (Nikita, 2026-11-05 21:09Z: the TV goes on the back wall, the whole room turned 180° from the gym side), else the
 * solid wall farthest from the Gym. Without one: the wall the plan names; else across from the windows when that wall
 * is solid, else the longest wall without glass.
 */
function tvWallOf(R: Rect, p: HavenPlan): Side {
  const win = windowWall(R, p);
  const solidSides = SIDES.filter((s) => glass(R, s, p) === 0);
  if (gymAt(p) && solidSides.length) {
    const near = byGym(R, p, SIDES)[0]!;
    return solidSides.includes(OPP[near]) ? OPP[near] : byGym(R, p, solidSides).at(-1)!;
  }
  const named = SIDES.find((s) => runs(R, s, p.tv ?? []).length);
  return named ?? (glass(R, OPP[win], p) === 0 ? OPP[win] : ([...solidSides].sort((a, b) => wallLen(R, b) - wallLen(R, a))[0] ?? OPP[win]));
}

/** The walls the living room's sectional turns to when the plan names none (Nikita, 2026-11-06, #935). */
const SECTIONAL: [Side, Side] = ["e", "s"];

/**
 * How the L sectional sits for a TV wall and the two walls it turns to (one each way). With the TV on one of them,
 * the long run faces it and the return goes at the end across from the other, so it faces that wall. Otherwise the
 * long run backs onto the wall across from the TV (`backed`) and the return onto the other.
 */
function sectionalOf(tvWall: Side, faces: [Side, Side]): { backed: boolean; retEnd: "lo" | "hi" } {
  const axis = faces.find((s) => s === tvWall || s === OPP[tvWall]);
  const other = faces.find((s) => s !== axis);
  if (!axis || !other) return { backed: false, retEnd: "lo" };
  const backed = axis !== tvWall;
  const want = backed ? other : OPP[other];
  return { backed, retEnd: endSide(tvWall, "lo") === want ? "lo" : "hi" };
}

/** `pinLamp`: the openings came from the walls, so the arc lamp keeps the spot it had before they did (#764). */
function living(R: Rect, p: HavenPlan, pinLamp = false): PlanItem[] {
  const win = windowWall(R, p);
  const tvWall = tvWallOf(R, p);
  const L = wallLen(R, tvWall), D = depthTo(R, tvWall);
  const out: PlanItem[] = [];
  const conLen = clampLen(L * 0.6, 120, 260);
  out.push(item("console", against(R, tvWall, (L - conLen) / 2, conLen, 40)));
  const tvLen = clampLen(L * 0.5, 110, 220);
  out.push(item("tv", against(R, tvWall, (L - tvLen) / 2, tvLen, 6, 0)));
  // Where the balcony door is on this room, if anywhere: the cat tree's corner.
  let door: { s: Side; at: number } | null = null;
  for (const s of SIDES) for (const [a, b] of runs(R, s, p.balconies ?? [])) door ??= { s, at: (a + b) / 2 };
  // The sectional turns to two walls (Nikita, 2026-11-06, #935: the east and the south unless the plan says otherwise).
  // With the TV on one, the long run faces the TV and the return faces the other; else the L backs onto both, in their
  // corner, still facing the TV: against the walls, unless a balcony door is on the one behind it.
  const turn = sectionalOf(tvWall, p.sectional ?? SECTIONAL);
  const retEnd = turn.retEnd, backed = turn.backed && !runs(R, OPP[tvWall], p.balconies ?? []).length;
  const sofaDep = 90, sofaOff = backed ? D - sofaDep - 6 : clampLen(D * 0.58, 200, D - sofaDep - 30);
  const sofaLen = clampLen(L * 0.62, 180, 300);
  const t0 = backed ? (retEnd === "lo" ? 6 : L - sofaLen - 6) : (L - sofaLen) / 2;
  out.push(item("sofa", inFrom(R, tvWall, t0, sofaLen, sofaDep, sofaOff)));
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
  // The drinks fridge beside the sofa at its open end; the arc lamp behind the sofa at its return end, or, with the
  // sofa against the wall, just past the fridge.
  const fT = retEnd === "lo" ? t0 + sofaLen + 12 : t0 - 12 - 46;
  const fridge = item("minifridge", inFrom(R, tvWall, fT, 46, 46, sofaOff + 20));
  const [lx, ly] = backed ? centreOfRect(inFrom(R, tvWall, retEnd === "lo" ? fT + 46 + 10 : fT - 10 - 32, 32, 32, D - 40)) : lampSpot(R, tvWall, retEnd);
  let lamp = round("lamp", lx, ly, 32);
  if (pinLamp) {
    // Before the walls gave the openings, the room was laid out from its longest wall (glass nowhere): the lamp stood
    // behind the sofa at the start of the wall facing that one. It stays there, else snug in that corner.
    const longest = [...SIDES].sort((a, b) => wallLen(R, b) - wallLen(R, a))[0]!;
    const was = lampSpot(R, OPP[longest], "lo");
    const snug = corner(R, longest, endSide(longest, "lo"), 24, 24);
    lamp = [was, snug].map(([x, y]) => round("lamp", x, y, 32)).find((it) => fits(R, it) && !clash(out, it)) ?? lamp;
  }
  if (!backed || (fits(R, lamp) && !clash(out, lamp))) out.push(lamp);
  if (fT > 10 && fT + 46 < L - 10 && !clash(out, fridge)) out.push(fridge);
  // The tall cat tree in the corner by the balcony door, else the corner of the window wall; another corner when
  // something already stands there.
  const ctSide: Side = door ? door.s : win;
  const ctEnd: "lo" | "hi" = door ? (door.at < wallLen(R, door.s) / 2 ? "lo" : "hi") : "hi";
  const other = (e: "lo" | "hi"): "lo" | "hi" => (e === "lo" ? "hi" : "lo");
  const trees = ([[ctSide, ctEnd], [ctSide, other(ctEnd)], [OPP[ctSide], ctEnd], [OPP[ctSide], other(ctEnd)]] as [Side, "lo" | "hi"][]).map(([s, e]) => {
    const [cx, cy] = corner(R, s, endSide(s, e), 40, 40);
    return round("cattree", cx, cy, 64);
  });
  out.push(trees.find((it) => !clash(out, it)) ?? trees[0]!);
  // The projector on the ceiling over the coffee table.
  out.push(item("projector", inFrom(R, tvWall, (L - 34) / 2, 34, 26, gapMid + 20)));
  return out;
}

/**
 * Where the Studio's pieces go (Nikita, 2026-11-06, #959: the room turned 90° clockwise): the desk and computer
 * against the east wall, the two low sofas along the south and west walls, the DJ decks in the north-east corner.
 * Walls are named as everywhere here: north is the top of the plan (smallest y), east its right-hand side.
 */
export const STUDIO_WALLS: { desk: Side; sofas: [Side, Side]; dj: [Side, Side] } = { desk: "e", sofas: ["s", "w"], dj: ["n", "e"] };

function studio(R: Rect, p: HavenPlan, doors: Seg[]): PlanItem[] {
  const { desk: dw, sofas, dj: djCorner } = STUDIO_WALLS;
  const L = wallLen(R, dw);
  const out: PlanItem[] = [];
  const cands = (list: PlanItem[][]) => list.find((group) => group.every((it) => fits(R, it) && !clash(out, it))) ?? [];
  // The door: where along which wall.
  let door: { s: Side; at: number; a: number; b: number } | null = null;
  for (const s of SIDES) for (const [a, b] of runs(R, s, doors)) door ??= { s, at: (a + b) / 2, a, b };
  // The desk along its wall, centred on that wall's glass when it has some, else on the wall.
  const wr = runs(R, dw, p.windows);
  const mid = wr.length ? (Math.min(...wr.map((r) => r[0])) + Math.max(...wr.map((r) => r[1]))) / 2 : L / 2;
  const deskLen = clampLen(L * 0.5, 140, 220), dt = clampLen(mid - deskLen / 2, 70, L - deskLen - 70);
  out.push(item("desk", against(R, dw, dt, deskLen, 70)));
  // On it: the ultrawide and a second screen, a speaker at either end.
  const uw = deskLen * 0.44, m2 = deskLen * 0.22, s0 = dt + deskLen * 0.13;
  out.push(item("monitor", against(R, dw, s0, uw, 8, 10)));
  out.push(item("monitor", against(R, dw, s0 + uw + deskLen * 0.03, m2, 8, 14)));
  const spk = Math.min(22, deskLen * 0.09);
  out.push(item("speaker", against(R, dw, dt + 3, spk, spk, 12)));
  out.push(item("speaker", against(R, dw, dt + deskLen - 3 - spk, spk, spk, 12)));
  const [ox, oy] = centreOfRect(inFrom(R, dw, s0 + uw / 2 - 29, 58, 58, 84));
  out.push(round("ochair", ox, oy, 58));
  // The DJ decks in their corner: along either wall from the corner, sliding out of it until free.
  const dj = (s: Side, from: Side, t: number) => [item("dj", against(R, s, tFrom(R, s, from, t, 80), 80, 46, 6))];
  const steps = [4, 24, 48, 72, 100, 130];
  const [dA, dB] = djCorner;
  const djAt = cands([...steps.map((t) => dj(dA, dB, t)), ...steps.map((t) => dj(dB, dA, t))]);
  out.push(...djAt);
  // The tall shelf at the desk wall's other end, away from the decks.
  const shelfFrom = dw === dA ? OPP[dB] : dw === dB ? OPP[dA] : endSide(dw, "hi");
  out.push(...cands([4, 24, 48].map((t) => [item("shelf", against(R, dw, tFrom(R, dw, shelfFrom, t, 50), 50, 40))])));
  // The L of two low sofas along their two walls, meeting in that corner, short of the door when it is on one of them.
  // Either may be the long one: the way round that seats the most wins.
  const dep = 82;
  const room = (s: Side, from: "lo" | "hi", want: number) => {
    if (!door || door.s !== s) return want;
    const free = from === "lo" ? door.a - 4 - 16 : wallLen(R, s) - door.b - 4 - 16;
    return Math.min(want, free);
  };
  const lay = (back: Side, side: Side) => {
    const far: "lo" | "hi" = endSide(back, "lo") === side ? "lo" : "hi";
    const BL = wallLen(R, back), SL = wallLen(R, side);
    const aLen = room(back, far, clampLen(BL * 0.5, 150, 230));
    const fromBackEnd = back === endSide(side, "lo") ? "lo" : "hi";
    const bLen = room(side, fromBackEnd, clampLen(SL * 0.45, 130, 200) + dep) - dep;
    const aT = far === "lo" ? 4 : BL - 4 - aLen;
    const free = (it: PlanItem) => fits(R, it) && !clash(out, it);
    const a = aLen >= 100 ? item("sofa", against(R, back, aT, aLen, dep)) : null;
    const b = bLen >= 90 ? item("sofa", against(R, side, fromBackEnd === "lo" ? 4 + dep : SL - 4 - dep - bLen, bLen, dep)) : null;
    const list = [a, b].filter((it): it is PlanItem => it !== null && free(it));
    return { back, side, aLen: a && list.includes(a) ? aLen : 0, aT, BL, SL, list, seats: list.reduce((n, it) => n + Math.max(it.w, it.h), 0) };
  };
  const ways = [lay(sofas[0], sofas[1]), lay(sofas[1], sofas[0])];
  const L2 = ways.reduce((a, b) => (b.list.length > a.list.length || (b.list.length === a.list.length && b.seats > a.seats) ? b : a));
  out.push(...L2.list);
  // The coffee table on a rug in front of the sofas; the hoop light against the back wall past the sofa's end.
  const { back, side, aLen, aT, BL, SL } = L2;
  const sofaMid = aLen ? aT + aLen / 2 : BL / 2;
  out.push(...cands([dep + 34, dep + 70].flatMap((off) => [0, -40, 40, -80, 80, -120, 120].map((d) => [item("rug", inFrom(R, back, sofaMid + d - 80, 160, 120, off - 24)), item("ctable", inFrom(R, back, sofaMid + d - 36, 72, 52, off))]))));
  const [hx, hy] = corner(R, back, side, 22, Math.min(SL - 30, aLen + 26));
  out.push(...cands([[round("lamp", hx, hy, 22)]]));
  return out;
}

/** Kinds that stand on or hang over the cabinet run, and move along with it. */
const RUN_KINDS = new Set<Kind>(["counter", "upper", "range", "sink", "cabinet", "box", "espresso"]);
const mid = (it: PlanItem): [number, number] => (it.round ? [it.x, it.y] : [it.x + it.w / 2, it.y + it.h / 2]);
const inBox = (px: number, py: number, b: Box) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3];

/** The side of R a footprint stands nearest. */
function nearSide(R: Rect, b: Box): Side {
  const g: [Side, number][] = [["n", b[1] - R[1]], ["s", R[1] + R[3] - b[3]], ["w", b[0] - R[0]], ["e", R[0] + R[2] - b[2]]];
  return g.reduce((a, c) => (c[1] < a[1] ? c : a))[0];
}

/**
 * The kitchen as drawn (#764): the fridge at the left end of the cabinet run (looking at the cabinets), the espresso
 * machine on the counter, no sideboard and no cabinet of bottles, and the canvases on the wall across from the run.
 * Takes and returns the whole item list.
 */
function kitchen(r: PlanRoom, R: Rect, items: PlanItem[], plan: HavenPlan): PlanItem[] {
  const inK = (it: PlanItem) => r.parts.some((pt) => inRect(...mid(it), pt));
  const on = (it: PlanItem, kinds: Kind[]) => items.some((o) => o !== it && kinds.includes(o.k) && inBox(...mid(it), boxOf(o)));
  // Jars stay only where they stand on a counter or the island; loose ones, and the cabinet or shelf under them, go.
  const bottles = new Set(items.filter((it) => inK(it) && it.k === "jar" && !on(it, ["counter", "island"])));
  const under = new Set(items.filter((it) => inK(it) && (it.k === "cabinet" || it.k === "shelf") && [...bottles].some((j) => inBox(...mid(j), boxOf(it)))));
  let list = items.filter((it) => !(inK(it) && (it.k === "sideboard" || bottles.has(it) || under.has(it))));
  const counters = list.filter((i) => i.k === "counter" && !i.round && inRect(...mid(i), R));
  if (!counters.length) return list;
  const run = counters.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const wall = nearSide(R, boxOf(run));
  const along = wall === "n" || wall === "s";
  const A = (b: Box): [number, number] => (along ? [b[0], b[2]] : [b[1], b[3]]);
  const X = (b: Box): [number, number] => (along ? [b[1], b[3]] : [b[0], b[2]]);
  const [r0, r1] = A(boxOf(run)), [c0, c1] = X(boxOf(run));
  // Facing the cabinets (facing wall `wall`), the left hand is toward LEFT[OPP[wall]].
  const left = LEFT[OPP[wall]];
  const leftLow = left === "w" || left === "n";
  // The strip from the wall to a little in front of the run.
  const lo = wall === "n" ? R[1] - 2 : wall === "w" ? R[0] - 2 : c0 - 40;
  const hi = wall === "s" ? R[1] + R[3] + 2 : wall === "e" ? R[0] + R[2] + 2 : c1 + 40;
  const band = (it: PlanItem) => {
    const c = mid(it)[along ? 1 : 0];
    return c >= lo && c <= hi;
  };
  const fridge = list.filter((i) => i.k === "fridge" && inK(i) && band(i)).sort((a, b) => Math.abs(mid(a)[along ? 0 : 1] - (r0 + r1) / 2) - Math.abs(mid(b)[along ? 0 : 1] - (r0 + r1) / 2))[0];
  const ri = list.indexOf(run);
  if (fridge) {
    const [f0, f1] = A(boxOf(fridge)), fL = f1 - f0;
    const s0 = Math.min(r0, f0), s1 = Math.max(r1, f1);
    if (leftLow ? f0 > r0 : f1 < r1) {
      // Swap ends: the fridge to the left end of the run, everything else on the run moved over by its width.
      const gap = clampLen(leftLow ? f0 - r1 : r0 - f1, 0, 20);
      const shift = (fL + gap) * (leftLow ? 1 : -1);
      const nf = leftLow ? s0 : s1 - fL;
      const moves = (it: PlanItem) => {
        const m = mid(it)[along ? 0 : 1];
        return it !== fridge && RUN_KINDS.has(it.k) && band(it) && m >= s0 && m <= s1;
      };
      list = list.map((it) => {
        if (it === fridge) return along ? { ...it, x: Math.round(nf) } : { ...it, y: Math.round(nf) };
        if (!moves(it)) return it;
        return along ? { ...it, x: Math.round(it.x + shift) } : { ...it, y: Math.round(it.y + shift) };
      });
    }
  }
  // The hob centre-left on the run (#1007), about a third of the way along from the fridge's end, leaving the stretch
  // toward the coffee maker clear (the kitchen's backlight glows there, fixtures.ts). A sink in the way moves to the
  // hob's fridge side, or failing that to where the hob was.
  const nr = boxOf(list[ri]!);
  const [n0, n1] = A(nr), xs = X(nr);
  const onRun = (i: PlanItem) => band(i) && inBox(...mid(i), [nr[0] - 2, nr[1] - 2, nr[2] + 2, nr[3] + 2]);
  const hob = list.findIndex((i) => i.k === "range" && onRun(i));
  if (hob >= 0) {
    const h = list[hob]!, [h0, h1] = A(boxOf(h)), hL = h1 - h0;
    const want = clampLen(leftLow ? n0 + (n1 - n0) * 0.36 - hL / 2 : n1 - (n1 - n0) * 0.36 - hL / 2, n0 + 4, n1 - 4 - hL);
    const put = (it: PlanItem, at: number): PlanItem => (along ? { ...it, x: Math.round(at) } : { ...it, y: Math.round(at) });
    list[hob] = put(h, want);
    const sinkAt = list.findIndex((i) => i.k === "sink" && onRun(i));
    if (sinkAt >= 0) {
      const s = list[sinkAt]!, [s0, s1] = A(boxOf(s)), sL = s1 - s0;
      if (s0 < want + hL + 6 && s1 > want - 6) {
        const beside = leftLow ? want - 10 - sL : want + hL + 10;
        list[sinkAt] = put(s, beside >= n0 + 4 && beside + sL <= n1 - 4 ? beside : h0);
      }
    }
  }
  // The espresso machine on the counter, toward the end away from the fridge, clear of the sink and the hob.
  const busy = list.filter((i) => (i.k === "sink" || i.k === "range") && inBox(...mid(i), nr)).map((i) => A(boxOf(i)));
  const len = 30, dep = Math.max(10, Math.min(26, xs[1] - xs[0] - 4));
  const at = wall === "n" || wall === "w" ? xs[0] + 2 : xs[1] - 2 - dep;
  for (let k = 0; 8 + k * 10 + len + 8 <= n1 - n0; k++) {
    const t = leftLow ? n1 - 8 - len - k * 10 : n0 + 8 + k * 10;
    if (busy.some(([a, b]) => t < b + 6 && t + len > a - 6)) continue;
    list.push(item("espresso", along ? [t, at, len, dep] : [at, t, dep, len]));
    break;
  }
  return [...list, ...artWall(r, R, wall, (n0 + n1) / 2, plan)];
}

/**
 * Five tall canvases side by side on the wall across from the cabinet run (the hall's, where the kitchen opens onto
 * it), on the longest stretch there free of doors, as near across from the run as fits.
 */
function artWall(k: PlanRoom, R: Rect, wall: Side, c: number, plan: HavenPlan): PlanItem[] {
  const home = plan.rooms.filter((r) => !r.detached);
  const opp = OPP[wall];
  const along = wall === "n" || wall === "s";
  let P = R, room = k;
  for (let n = 0; n < 4; n++) {
    const t = c - (along ? P[0] : P[1]);
    if (t < 0 || t > wallLen(P, opp)) break;
    const [ex, ey] = pointOn(P, opp, t);
    const px = ex + (opp === "e" ? 8 : opp === "w" ? -8 : 0), py = ey + (opp === "s" ? 8 : opp === "n" ? -8 : 0);
    // Across an open edge: from the kitchen into the hall, or back.
    const next = home.find((r) => r !== room && ((KITCHEN.test(room.name) && HALL.test(r.name)) || (HALL.test(room.name) && KITCHEN.test(r.name))) && r.parts.some((q) => inRect(px, py, q)));
    if (!next) break;
    const q = next.parts.find((pt) => inRect(px, py, pt))!;
    if (!sharedEdges(room, next).length) break;
    P = q;
    room = next;
  }
  const L = wallLen(P, opp), t = clampLen(c - (along ? P[0] : P[1]), 0, L);
  let free: [number, number][] = [[0, L]];
  for (const [a, b] of runs(P, opp, plan.doors)) free = cutIv(free, [a - 10, b + 10]);
  const spots = free.filter(([a, b]) => b - a >= 130).sort((x, y) => (t >= x[0] && t <= x[1] ? -1 : 0) - (t >= y[0] && t <= y[1] ? -1 : 0) || Math.min(Math.abs(t - x[0]), Math.abs(t - x[1])) - Math.min(Math.abs(t - y[0]), Math.abs(t - y[1])));
  const spot = spots[0];
  if (!spot) return [];
  const len = Math.min(210, spot[1] - spot[0] - 20);
  const t0 = clampLen(t - len / 2, spot[0] + 10, spot[1] - 10 - len);
  return [item("art", against(P, opp, t0, len, 4, 1))];
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

/**
 * The dining table and its chairs step out from wall s far enough for the coffee station and a way past it behind
 * them (Nikita 2026-11-05 21:09Z: the coffee station on the back wall, behind the table), when the room is deep enough.
 */
function clearForStation(R: Rect, items: PlanItem[], s: Side): PlanItem[] {
  const set = items.filter((it) => (it.k === "table" || it.k === "chair") && inRect(...mid(it), R));
  if (!set.some((it) => it.k === "table")) return items;
  const bs = set.map(boxOf);
  const [x0, y0, x1, y1] = [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
  const need = 42 + 56;
  const gap = s === "n" ? y0 - R[1] : s === "s" ? R[1] + R[3] - y1 : s === "w" ? x0 - R[0] : R[0] + R[2] - x1;
  const room = s === "n" ? R[1] + R[3] - 10 - y1 : s === "s" ? y0 - R[1] - 10 : s === "w" ? R[0] + R[2] - 10 - x1 : x0 - R[0] - 10;
  const by = Math.min(need - gap, room);
  if (by <= 0 || gap + by < need) return items;
  const [dx, dy] = s === "n" ? [0, by] : s === "s" ? [0, -by] : s === "w" ? [by, 0] : [-by, 0];
  return items.map((it) => (set.includes(it) ? { ...it, x: it.x + dx, y: it.y + dy } : it));
}

/**
 * The coffee station (#860): a low sideboard with the espresso machine on it, against the dining room's wall on the
 * living room TV's side (`first`), else its other walls nearest the Gym first; clear of doors, windows when it can be,
 * the table and chairs, and the cat's feeding station. Empty when no stretch is free.
 */
function coffee(R: Rect, p: HavenPlan, items: PlanItem[], first: Side | null): PlanItem[] {
  const taken: PlanItem[] = [...items.filter((it) => solid(it) && inRect(...mid(it), R)), ...p.devices.map((d) => round("box", d.x, d.y, 56))];
  const sides = byGym(R, p, SIDES);
  const order = first ? [first, ...sides.filter((s) => s !== first)] : sides;
  for (const avoidGlass of [true, false])
    for (const s of order) {
      const L = wallLen(R, s);
      let free: [number, number][] = [[6, L - 6]];
      for (const [a, b] of runs(R, s, p.doors)) free = cutIv(free, [a - 14, b + 14]);
      if (avoidGlass) for (const [a, b] of [...runs(R, s, p.windows), ...runs(R, s, p.balconies ?? [])]) free = cutIv(free, [a - 6, b + 6]);
      for (const len of [150, 120, 96]) {
        // From the middle of each free stretch outward, the first spot nothing stands in.
        const ts = free.filter(([a, b]) => b - a >= len).flatMap(([a, b]) => {
          const c = (a + b) / 2 - len / 2;
          return Array.from({ length: Math.floor((b - a - len) / 10) + 1 }, (_, k) => c + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10).filter((t) => t >= a && t + len <= b);
        });
        for (const t of ts) {
          const board = item("sideboard", against(R, s, t, len, 42));
          if (!fits(R, board) || clash(taken, board)) continue;
          return [board, item("espresso", against(R, s, t + len / 2 - 17, 34, 26, 12))];
        }
      }
    }
  return [];
}

/**
 * Beside a balcony door: a small greenhouse in the corner on its solid side, a round cat bed by it, a purifier under
 * the window. The greenhouse and the bed take the first spot that is not in what is `taken` already.
 */
function nook(R: Rect, p: HavenPlan, s: Side, a: number, b: number, taken: PlanItem[] = []): PlanItem[] {
  const L = wallLen(R, s);
  const win = runs(R, s, p.windows);
  const glassBefore = win.filter(([, e]) => e <= a + 1).reduce((n, [x, e]) => n + e - x, 0);
  const glassAfter = win.filter(([x]) => x >= b - 1).reduce((n, [x, e]) => n + e - x, 0);
  const after = glassAfter < glassBefore || (glassAfter === glassBefore && L - b > a);
  const out: PlanItem[] = [];
  const free = (it: PlanItem) => fits(R, it) && !clash([...taken, ...out], it);
  const gh = 70;
  // Into the corner on the solid side first, then toward the door, then right by it; the first that is free, else the
  // one right by it.
  const corner0 = after ? L - gh - 4 : 4, toDoor = after ? -1 : 1, near = after ? Math.min(L - gh - 4, b + 12) : Math.max(4, a - 12 - gh);
  const ts = [...Array.from({ length: 8 }, (_, k) => corner0 + toDoor * k * 12).filter((t) => (after ? t > near : t < near)), near];
  const ghs = ts.map((t) => item("greenhouse", against(R, s, t, gh, 50, 6)));
  const house = ghs.find(free) ?? ghs[ghs.length - 1]!;
  out.push(house);
  const gt = s === "n" || s === "s" ? house.x - R[0] : house.y - R[1];
  const beds = [after ? gt : gt + gh - 46, after ? gt + gh - 46 : gt].map((t) => {
    const [bx, by] = centreOfRect(inFrom(R, s, t, 46, 46, 70));
    return round("petbed", bx, by, 46);
  });
  out.push(beds.find(free) ?? beds[0]!);
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

/** The plan as drawn: its openings as the walls give them, these rooms dressed by the rules above, the rest as stored. */
export function furnish(stored: HavenPlan): HavenPlan {
  const { plan, derivedLiving } = withOpenings(stored);
  let items = [...plan.items];
  const home = plan.rooms.filter((r) => !r.detached);
  const within = (r: PlanRoom, it: PlanItem) => {
    const [cx, cy] = mid(it);
    return r.parts.some((pt) => inRect(cx, cy, pt));
  };
  const relay = (r: PlanRoom, make: (R: Rect) => PlanItem[]) => {
    const R = mainRect(r);
    const fresh = make(R);
    items = [...items.filter((it) => !within(r, it)), ...fresh];
  };
  for (const r of home) {
    if (LIVING.test(r.name)) relay(r, (R) => living(R, plan, derivedLiving));
    else if (STUDIO.test(r.name)) relay(r, (R) => studio(R, plan, plan.doors));
  }
  // The cat tree stands in the living room only.
  const lounge = home.find((r) => LIVING.test(r.name));
  if (lounge) items = items.filter((it) => it.k !== "cattree" || within(lounge, it));
  items = [...items, ...bowls(plan)];
  for (const r of home) if (KITCHEN.test(r.name)) items = kitchen(r, mainRect(r), items, plan);
  // The coffee station behind the dining table, on the TV's side; the espresso machine moves off the counter to it.
  const diner = home.find((x) => DINING.test(x.name));
  if (diner) {
    const tvSide = lounge ? tvWallOf(mainRect(lounge), plan) : null;
    if (tvSide) items = clearForStation(mainRect(diner), items, tvSide);
    const station = coffee(mainRect(diner), plan, items, tvSide);
    if (station.length) items = [...items.filter((it) => it.k !== "espresso"), ...station];
  }
  for (const r of home) if (DINING.test(r.name) || (KITCHEN.test(r.name) && !diner)) items = [...items, ...tubChair(mainRect(r), items, plan)];
  // The bathrooms: the master (by name, else the largest of two or more) and the guest bath.
  const baths = home.filter((r) => BATH.test(r.name));
  const biggest = baths.length > 1 ? baths.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a)) : null;
  for (const r of baths) {
    const master = /\b(master|primary|en-?suite)\b/i.test(r.name) || (!/\bguest\b/i.test(r.name) && r === biggest);
    relay(r, (R) => bath(R, plan.doors, master));
  }
  for (const r of home) if (HALL.test(r.name)) items = [...items, ...hall(mainRect(r), plan)];
  const dining = home.find((x) => DINING.test(x.name)) ?? home.find((x) => KITCHEN.test(x.name));
  if (dining) items = [...items, ...tunnel(mainRect(dining), plan, items)];
  // The nooks: a balcony door in any room but the living room, the studio and the main bedroom.
  const bed = masterBed(home);
  for (const seg of plan.balconies ?? []) {
    const r = home.find((x) => !LIVING.test(x.name) && !STUDIO.test(x.name) && x !== bed && SIDES.some((s) => onWall(mainRect(x), s, seg)));
    if (!r) continue;
    const R = mainRect(r);
    const s = SIDES.find((x) => onWall(R, x, seg))!;
    const [a, b] = onWall(R, s, seg)!;
    items = [...items, ...nook(R, plan, s, a, b, items)];
  }
  return { ...plan, items };
}

/* ── openings from the walls (#764) ── */

const MASTER = /\b(master|primary)\b/i;
const BED = /\bbed/i;
const LANDING = /\b(hall|landing|passage|corridor|entry|foyer)\b/i;
const OUTDOOR = /\b(balcony|terrace|patio|loggia)\b/i;
const GYM = /\bgym\b/i;

/** The main bedroom: by name, else the largest bedroom. */
function masterBed(home: PlanRoom[]): PlanRoom | null {
  const beds = home.filter((r) => BED.test(r.name) && !BATH.test(r.name));
  if (!beds.length) return null;
  return beds.find((r) => MASTER.test(r.name)) ?? beds.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a));
}
const areaOf = (r: PlanRoom) => r.parts.reduce((n, pt) => n + pt[2] * pt[3], 0);

/** The Gym's centre (the building's gym, by name), when the plan has one. */
function gymAt(p: HavenPlan): [number, number] | null {
  const g = p.rooms.find((r) => GYM.test(r.name));
  return g ? centreOfRect(mainRect(g)) : null;
}

/** Sides of R ordered nearest the Gym first (by the middle of each wall); in their given order without a Gym. */
function byGym(R: Rect, p: HavenPlan, sides: Side[]): Side[] {
  const g = gymAt(p);
  if (!g) return sides;
  const d = (s: Side) => {
    const [x, y] = pointOn(R, s, wallLen(R, s) / 2);
    return Math.hypot(x - g[0], y - g[1]);
  };
  return [...sides].sort((a, b) => d(a) - d(b));
}

/** Interval list minus one interval. */
function cutIv(list: [number, number][], [c0, c1]: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of list) {
    if (c1 <= a || c0 >= b) out.push([a, b]);
    else {
      if (c0 > a) out.push([a, c0]);
      if (c1 < b) out.push([c1, b]);
    }
  }
  return out;
}

/**
 * The outside stretches of wall `s` of P (from its start): where no part of any room of the home (an outdoor one
 * aside) lies just across it, and no door is cut into it.
 */
function outsideRuns(P: Rect, s: Side, home: PlanRoom[], doors: Seg[]): [number, number][] {
  const [x, y, w, h] = P;
  let free: [number, number][] = [[0, wallLen(P, s)]];
  const probe = 8;
  for (const r of home) {
    if (OUTDOOR.test(r.name)) continue;
    for (const q of r.parts) {
      if (q[0] === x && q[1] === y && q[2] === w && q[3] === h) continue;
      if (s === "n" || s === "s") {
        const py = s === "n" ? y - probe : y + h + probe;
        if (py >= q[1] && py <= q[1] + q[3]) free = cutIv(free, [q[0] - x, q[0] + q[2] - x]);
      } else {
        const px = s === "w" ? x - probe : x + w + probe;
        if (px >= q[0] && px <= q[0] + q[2]) free = cutIv(free, [q[1] - y, q[1] + q[3] - y]);
      }
    }
  }
  for (const [a, b] of runs(P, s, doors)) free = cutIv(free, [a - 14, b + 14]);
  return free.filter(([a, b]) => b - a >= 1);
}

/** The room's longest outside stretch on its main rectangle, if one is at least `min` long. */
function longestOutside(R: Rect, home: PlanRoom[], doors: Seg[], min: number): { s: Side; a: number; b: number } | null {
  let best: { s: Side; a: number; b: number } | null = null;
  for (const s of SIDES) for (const [a, b] of outsideRuns(R, s, home, doors)) if (b - a >= min && (!best || b - a > best.b - best.a)) best = { s, a, b };
  return best;
}

/** A segment on wall `s` of R from `a` to `b` along it. */
function segOn(R: Rect, s: Side, a: number, b: number): Seg {
  const [x, y, w, h] = R;
  const A = Math.round(a), B = Math.round(b);
  if (s === "n") return [x + A, y, x + B, y];
  if (s === "s") return [x + A, y + h, x + B, y + h];
  if (s === "w") return [x, y + A, x, y + B];
  return [x + w, y + A, x + w, y + B];
}

/** A point `t` along wall `s` of R. */
const pointOn = (R: Rect, s: Side, t: number): [number, number] => {
  const [x, y, w, h] = R;
  return s === "n" ? [x + t, y] : s === "s" ? [x + t, y + h] : s === "w" ? [x, y + t] : [x + w, y + t];
};

/** Which end of the stretch [a, b] on wall s lies nearer a point. */
function nearEnd(R: Rect, s: Side, a: number, b: number, to: [number, number] | null): "lo" | "hi" {
  if (!to) return "hi";
  const pa = pointOn(R, s, a), pb = pointOn(R, s, b);
  return Math.hypot(pa[0] - to[0], pa[1] - to[1]) <= Math.hypot(pb[0] - to[0], pb[1] - to[1]) ? "lo" : "hi";
}

/**
 * A stretch dressed with a balcony door at one end (`skip` in from that end) and windows along the rest. Returns the
 * door and the windows as [from, to] along the wall.
 */
function glaze(a: number, b: number, end: "lo" | "hi", skip: number, doorW: number, winMax = Infinity): { door: [number, number]; win: [number, number] | null } {
  const END = 12, GAP = 14;
  const dw = Math.min(doorW, Math.max(BALCONY_DOOR, (b - a) * 0.5));
  const d0 = end === "lo" ? a + skip : b - skip - dw;
  const door: [number, number] = [d0, d0 + dw];
  let win: [number, number] = end === "lo" ? [door[1] + GAP, b - END] : [a + END, door[0] - GAP];
  if (win[1] - win[0] > winMax) win = end === "lo" ? [win[0], win[0] + winMax] : [win[1] - winMax, win[1]];
  return { door, win: win[1] - win[0] >= 40 ? win : null };
}

/**
 * A balcony door's width (plan units): one single door, never a pair (Nikita, 2026-11-05/06, #935). Any balcony run
 * wider than this, saved or derived, is drawn as this one door with wall or windows along the rest; the plan keeps
 * whatever width it saved.
 */
export const BALCONY_DOOR = 60;
/** Big enough to hold any plan's walls as a bare line. */
const PLAN_W = 100000;

/** The middle of the door into R nearest its centre, if it has one. */
function nearDoor(R: Rect, doors: Seg[]): [number, number] | null {
  const c = centreOfRect(R);
  let best: [number, number] | null = null;
  for (const s of SIDES)
    for (const [a, b] of runs(R, s, doors)) {
      const pt = pointOn(R, s, (a + b) / 2);
      if (!best || Math.hypot(pt[0] - c[0], pt[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1])) best = pt;
    }
  return best;
}

/** Shared edges of two rooms, as wall segments. */
function sharedEdges(a: PlanRoom, b: PlanRoom): Seg[] {
  const out: Seg[] = [];
  for (const p of a.parts)
    for (const q of b.parts) {
      for (const [px, qx] of [[p[0] + p[2], q[0]], [p[0], q[0] + q[2]]] as [number, number][])
        if (px === qx) {
          const y0 = Math.max(p[1], q[1]), y1 = Math.min(p[1] + p[3], q[1] + q[3]);
          if (y1 - y0 > 1) out.push([px, y0, px, y1]);
        }
      for (const [py, qy] of [[p[1] + p[3], q[1]], [p[1], q[1] + q[3]]] as [number, number][])
        if (py === qy) {
          const x0 = Math.max(p[0], q[0]), x1 = Math.min(p[0] + p[2], q[0] + q[2]);
          if (x1 - x0 > 1) out.push([x0, py, x1, py]);
        }
    }
  return out;
}
const segMid = (s: Seg): [number, number] => [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2];
const onSeg = (d: Seg, s: Seg) => (s[0] === s[2] ? d[0] === s[0] && d[2] === s[0] && Math.max(d[1], d[3]) > Math.min(s[1], s[3]) && Math.min(d[1], d[3]) < Math.max(s[1], s[3]) : d[1] === s[1] && d[3] === s[1] && Math.max(d[0], d[2]) > Math.min(s[0], s[2]) && Math.min(d[0], d[2]) < Math.max(s[0], s[2]));

/** The hall or landing just outside the main bedroom: one sharing a wall with it, the one with the door first. */
function landingOf(home: PlanRoom[], bed: PlanRoom | null, doors: Seg[]): { room: PlanRoom; door: [number, number] | null } | null {
  if (!bed) return null;
  const cands = home
    .filter((r) => r !== bed && LANDING.test(r.name) && !KITCHEN.test(r.name))
    .map((r) => {
      const edges = sharedEdges(r, bed);
      const d = doors.find((dd) => edges.some((e) => onSeg(dd, e)));
      return { room: r, edges, door: d ? segMid(d) : null };
    })
    .filter((c) => c.edges.length);
  cands.sort((a, b) => Number(!!b.door) - Number(!!a.door) || areaOf(a.room) - areaOf(b.room));
  const c = cands[0];
  return c ? { room: c.room, door: c.door ?? segMid(c.edges[0]!) } : null;
}

/**
 * The plan as drawn. Openings set in the wall editor (`plan.openings`) are drawn as saved, every other wall solid.
 * Otherwise (#764, #799) the stored ones are ignored and only these defaults are drawn, by room and side: an edge of its main rectangle with no room on the other side is an outside wall, and
 *   the living room    gets its balcony along its longest outside wall, and the TV on its solid wall nearest the Gym
 *                      (#860; across from the balcony when there is no Gym);
 *   the main bedroom   gets windows and a balcony door on its longest outside wall;
 *   the hall outside   (the hall or landing sharing a wall with the main bedroom) gets a tall glass balcony door with a
 *     the bedroom      big window beside it on its outside wall, leaving the corner by the bedroom door for the nook;
 * every other wall stays solid. Where the kitchen meets the hall there is no wall: the shared edge is drawn open.
 * A balcony wider than a door, set or derived, is glazed like the other rooms (#860): windows along it and one glass
 * door out, at the end nearest the room's way in (the Studio for the living room, the bedroom door for the hall); the
 * balcony itself, the slab outside, still runs its whole width (`decks`).
 * Drawing only; the stored plan is untouched.
 */
export function withOpenings(plan: HavenPlan): { plan: HavenPlan; derivedLiving: boolean } {
  const home = plan.rooms.filter((r) => !r.detached);
  // Openings saved from the wall editor are exactly what is drawn. Without them, only the defaults below are: whatever
  // an import carried is not trusted, so a wall nobody set is solid.
  const set = plan.openings === true;
  const windows = set ? [...plan.windows] : [], balconies = set ? [...(plan.balconies ?? [])] : [], tv = set ? [...(plan.tv ?? [])] : [], doors = [...plan.doors];
  const bed = masterBed(home);
  const landing = landingOf(home, bed, plan.doors);
  let derivedLiving = false;
  // Balcony runs to glaze at the end: each with the point its door goes nearest.
  const wide: { seg: Seg; to: [number, number] | null }[] = [];
  const put = (R: Rect, s: Side, g: { door: [number, number]; win: [number, number] | null }, to: [number, number] | null) => {
    wide.push({ seg: segOn(R, s, ...g.door), to });
    if (g.win) windows.push(segOn(R, s, ...g.win));
  };
  // Nikita, 2026-11-05 (#806): the living room's balcony runs the whole length of its outside wall; the main bedroom has
  // windows only; the hall's balcony runs about half its outside wall, with a big window along the rest; the gym has
  // windows all along one side.
  for (const r of home) {
    if (!LIVING.test(r.name) || set) continue;
    const R = mainRect(r);
    const o = longestOutside(R, home, plan.doors, 120);
    if (!o) continue;
    derivedLiving = true;
    const studio = home.find((x) => STUDIO.test(x.name));
    wide.push({ seg: segOn(R, o.s, o.a + 12, o.b - 12), to: studio ? centreOfRect(mainRect(studio)) : nearDoor(R, plan.doors) });
    // The TV on the back wall, across the room from the Gym (Nikita 2026-11-05 21:09Z), else across from the balcony.
    const near = byGym(R, plan, SIDES)[0]!;
    const tvSide = !gymAt(plan) ? OPP[o.s] : OPP[near] !== o.s ? OPP[near] : byGym(R, plan, SIDES.filter((s) => s !== o.s)).at(-1)!;
    if (!SIDES.some((s) => runs(R, s, tv).length)) tv.push(segOn(R, tvSide, 0, wallLen(R, tvSide)));
  }
  if (bed && !set) {
    const R = mainRect(bed);
    const o = longestOutside(R, home, plan.doors, 120);
    if (o) windows.push(segOn(R, o.s, o.a + 12, o.b - 12));
  }
  if (landing && !set) {
    const R = mainRect(landing.room);
    const o = longestOutside(R, home, plan.doors, 110);
    if (o) {
      // From the corner by the bedroom door: room for the greenhouse, the balcony over about half the wall, then the window.
      const end = nearEnd(R, o.s, o.a, o.b, landing.door);
      const skip = o.b - o.a >= 96 + 90 + 80 ? 96 : 12;
      put(R, o.s, glaze(o.a, o.b, end, skip, (o.b - o.a) / 2), landing.door);
    }
  }
  for (const r of plan.rooms) {
    if (!GYM.test(r.name) || set) continue;
    const R = mainRect(r);
    const others = r.detached ? [] : home;
    const o = longestOutside(R, others, plan.doors, 120);
    if (o) windows.push(segOn(R, o.s, o.a + 12, o.b - 12));
  }
  // Saved balcony doors wider than a door are glazed too, the door at the end nearest the room's own door.
  const kept = balconies.splice(0);
  for (const g of kept) {
    const r = home.find((x) => x.parts.some((pt) => SIDES.some((s) => onWall(pt, s, g))));
    wide.push({ seg: g, to: r ? nearDoor(mainRect(r), plan.doors) : null });
  }
  const decks: Seg[] = [];
  for (const { seg, to } of wide) {
    decks.push(seg);
    const hz = seg[1] === seg[3];
    const a = hz ? Math.min(seg[0], seg[2]) : Math.min(seg[1], seg[3]), b = hz ? Math.max(seg[0], seg[2]) : Math.max(seg[1], seg[3]);
    if (b - a <= BALCONY_DOOR) {
      balconies.push(seg);
      continue;
    }
    // On a bare line: windows along it, one door at the end nearest `to`.
    const line: Rect = hz ? [0, seg[1], PLAN_W, 0] : [seg[0], 0, 0, PLAN_W];
    const s: Side = hz ? "n" : "w";
    const g = glaze(a, b, nearEnd(line, s, a, b, to), 0, BALCONY_DOOR);
    balconies.push(segOn(line, s, ...g.door));
    if (g.win) windows.push(segOn(line, s, ...g.win));
  }
  // The kitchen and the hall are one open space.
  for (const k of home.filter((r) => KITCHEN.test(r.name)))
    for (const h of home.filter((r) => HALL.test(r.name) && !KITCHEN.test(r.name))) doors.push(...sharedEdges(k, h));
  return { plan: { ...plan, windows, balconies, tv, doors, decks }, derivedLiving };
}
