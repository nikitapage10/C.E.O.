import type { HavenPlan, Kind, PlanDevice, PlanItem, PlanRoom, Seg } from "./data.ts";
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
 *                 space: no wall is drawn where they meet; nor between the kitchen, the dining room and the living
 *                 room, one open room (#1022, openSeams).
 *   Living room   the TV on its back wall across from the Gym (else facing the windows), a long low console under it, an L sectional facing
 *                 it, turned to the east and south walls (#935: the return faces the other one when the TV is on one,
 *                 else the L backs onto both), narrow (#1022) so the way to the balcony door stays clear, with a square
 *                 coffee table on a rug between and two round accent chairs facing it, an arc lamp snug behind the sofa
 *                 (kept in the corner it has always stood in when the openings come from the walls), a drinks fridge
 *                 beside it, and the cat tower flat against the wall by the balcony door, out of the doorway with room
 *                 to walk past: the home's only cat tree.
 *   Studio        turned 90° clockwise (2026-11-06, #959): the desk against the east wall (two monitors, an office
 *                 chair, speakers either side, a tall shelf at its other end), two low, narrow sofas meeting in an L
 *                 along the south and west walls, a coffee table on a rug in front of them, and the DJ decks against
 *                 the north wall by the north-east corner, whose very corner is the floor lamp's (STUDIO_WALLS). No
 *                 printer. Three tall windows on its east wall, its wall by the litter box straight with its door
 *                 beside the box (#1022).
 *   Kitchen       what the plan has, with the fridge at the left end of the cabinet run (looking at it), the hob
 *                 centre-left on the run, about a third of the way from the fridge's end (#1007), no sideboard or
 *                 cabinet of bottles, and on the wall across from the cabinets five tall black-and-white canvases side
 *                 by side, one picture of trees and mountains. The coffee station (#1022) just past the run's
 *                 right-hand end: a black cabinet, the espresso machine on its left, black cup shelves over it; the sink
 *                 at the run's right-hand end. A steel bin by the island's east end; only the island's stools.
 *   Baths         the guest bath a little bigger, the tub on its west wall, the toilet about the middle of its south
 *                 wall with the vanity beside it; the master bath with its shower on the north wall and the vanity on
 *                 the south (#1022).
 *   Hall          the coat rack on its east wall, no rugs and no stray pieces, the docked vacuum on its west wall by
 *                 the plant cabinet or the hall's light (#1022).
 *   Main bedroom  its door at the far end of its wall, the bed moved west of it, three tall windows on its west wall;
 *                 the closet with clothes rails along its north and south walls (#1022).
 *   Balcony nook  beside a balcony door anywhere but the living room, the Studio and the main bedroom: a small lit
 *                 greenhouse in the corner on its solid side and an air purifier under the nearest window.
 *
 * Pure and deterministic, and only the drawing uses it: the stored plan is untouched. Devices stay where they are, but
 * the docked vacuum.
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
const grow = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/** Whether a piece would stand in another's footprint (a rug only clashes with another rug). */
const clash = (list: PlanItem[], it: PlanItem) => list.some((o) => (solid(it) ? solid(o) : o.k === it.k) && overlaps(boxOf(o), boxOf(it)));
const fits = (R: Rect, it: PlanItem) => {
  const b = boxOf(it);
  return b[0] >= R[0] && b[1] >= R[1] && b[2] <= R[0] + R[2] && b[3] <= R[1] + R[3];
};

/* ── the rooms ── */

/** Where the arc lamp stands for a TV wall: behind the sectional, at its return end. */
function lampSpot(R: Rect, tvWall: Side, retEnd: "lo" | "hi", sofaDep = SOFA_DEP, back = 2): [number, number] {
  const L = wallLen(R, tvWall), D = depthTo(R, tvWall);
  const sofaOff = clampLen(D * 0.58, 200, D - sofaDep - 30);
  const sofaLen = clampLen(L * 0.62, 180, 300), t0 = (L - sofaLen) / 2;
  const lampT = retEnd === "lo" ? t0 + 10 : t0 + sofaLen - 10;
  // Snug behind the sofa (#1022), so the way along its back stays open past the lamp.
  return centreOfRect(inFrom(R, tvWall, lampT - 16, 32, 32, Math.min(D - 40, sofaOff + sofaDep + back)));
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

/** How deep the living room's sofas are (#1022, Nikita: narrower, so the way to the balcony door stays clear). */
const SOFA_DEP = 66;

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

/** Whether a piece stands in front of the doorway [a, b] on wall s (within a door's swing of it). */
function onDoorway(R: Rect, s: Side, a: number, b: number, it: PlanItem): boolean {
  const door = against(R, s, a - 10, b - a + 20, 90, 0);
  return overlaps(boxOf(it), [door[0], door[1], door[0] + door[2], door[1] + door[3]]);
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
  const sofaDep = SOFA_DEP, sofaOff = backed ? D - sofaDep - 6 : clampLen(D * 0.58, 200, D - sofaDep - 30);
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
    // (The sofas were 90 deep then.)
    const was = lampSpot(R, OPP[longest], "lo", 90, 14);
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
  // Flat and shallow against the wall (#1022, Nikita: a square block stood in the way to the balcony).
  // Into the corner by the door, else just beside the door on that wall, else the other corners.
  const tw = 80, td = 28;
  const drun = door ? runs(R, door.s, p.balconies ?? [])[0] : undefined;
  const beside = door && drun ? [drun[0] - 12 - tw, drun[1] + 12].filter((t) => t >= 4 && t + tw <= wallLen(R, door.s) - 4).map((t) => item("cattree", against(R, door.s, t, tw, td, 0))) : [];
  const corners = ([[ctSide, ctEnd], [ctSide, other(ctEnd)], [OPP[ctSide], ctEnd], [OPP[ctSide], other(ctEnd)]] as [Side, "lo" | "hi"][]).map(([s, e]) =>
    item("cattree", against(R, s, e === "lo" ? 4 : wallLen(R, s) - 4 - tw, tw, td, 0)),
  );
  const trees = [corners[0]!, ...beside, ...corners.slice(1)];
  const inDoorway = (it: PlanItem) => !!door && runs(R, door.s, p.balconies ?? []).some(([a, b]) => onDoorway(R, door.s, a, b, it));
  // Room to walk past it: nothing else standing within a way's width (45) of it.
  const roomy = (it: PlanItem) => !out.some((o) => solid(o) && overlaps(boxOf(o), grow(boxOf(it), 45)));
  out.push(trees.find((it) => !clash(out, it) && !inDoorway(it) && roomy(it)) ?? trees.find((it) => !clash(out, it) && !inDoorway(it)) ?? trees[0]!);
  // Two round accent chairs on the coffee table's open side, facing it (#1022): the first side, not the TV's, where
  // both stand clear of the sofas and the walls.
  const table = out.find((it) => it.k === "ctable")!;
  const tb = boxOf(table);
  for (const s of SIDES.filter((x) => x !== tvWall)) {
    const d = 52, off = 20, hz = s === "n" || s === "s";
    const c = hz ? (tb[0] + tb[2]) / 2 : (tb[1] + tb[3]) / 2;
    const at = s === "n" ? tb[1] - off - d / 2 : s === "s" ? tb[3] + off + d / 2 : s === "w" ? tb[0] - off - d / 2 : tb[2] + off + d / 2;
    const pair = [-1, 1].map((k) => (hz ? round("accent", c + k * (d / 2 + 8), at, d) : round("accent", at, c + k * (d / 2 + 8), d)));
    if (pair.every((it) => fits(R, it) && !clash(out, it))) {
      out.push(...pair);
      break;
    }
  }
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
/** The DJ setup's length along its wall (#1022): two decks and the mixer between, on one stand. */
const DJ_LEN = 130;

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
  // Against the wall (#1022), a little out of the corner, which the floor lamp has (fixtures.ts studioLampSpots).
  const dj = (s: Side, from: Side, t: number) => [item("dj", against(R, s, tFrom(R, s, from, t, DJ_LEN), DJ_LEN, 52, 0))];
  const steps = [44, 60, 80, 104, 130];
  const [dA, dB] = djCorner;
  const djAt = cands([...steps.map((t) => dj(dA, dB, t)), ...steps.map((t) => dj(dB, dA, t))]);
  out.push(...djAt);
  // The tall shelf at the desk wall's other end, away from the decks.
  const shelfFrom = dw === dA ? OPP[dB] : dw === dB ? OPP[dA] : endSide(dw, "hi");
  out.push(...cands([4, 24, 48].map((t) => [item("shelf", against(R, dw, tFrom(R, dw, shelfFrom, t, 50), 50, 40))])));
  // The L of two low sofas along their two walls, meeting in that corner, short of the door when it is on one of them.
  // Either may be the long one: the way round that seats the most wins.
  // Low and narrow (#1022, Nikita: much narrower).
  const dep = 58;
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
  // The coffee station (#1022, Nikita): its own small cabinet just past the run's right-hand end (away from the
  // fridge), the espresso machine on its left, black wall shelves with cups over it; the sink at the run's right-hand
  // end, where the machine stood on the counter. With no room past the run, the machine stays on the counter there.
  const len = 30, dep = Math.max(10, Math.min(26, xs[1] - xs[0] - 4));
  const runDep = xs[1] - xs[0];
  const at = wall === "n" || wall === "w" ? xs[0] : xs[1] - runDep;
  const put = (k: Kind, t: number, l: number, d: number, off = 0): PlanItem => {
    const across = wall === "n" || wall === "w" ? at + off : at + runDep - d - off;
    return item(k, along ? [t, across, l, d] : [across, t, d, l]);
  };
  const open = plan.rooms.filter((x) => !x.detached && OPEN_ROOM.test(x.name));
  const inOpen = (it: PlanItem) => {
    const b = boxOf(it);
    const inside = (x: number, y: number) => open.some((r) => r.parts.some((pt) => inRect(x, y, pt)));
    return inside(b[0] + 1, b[1] + 1) && inside(b[2] - 1, b[1] + 1) && inside(b[0] + 1, b[3] - 1) && inside(b[2] - 1, b[3] - 1);
  };
  const others = list.filter((it) => solid(it) && !onRun(it) && it.k !== "fridge");
  let station: PlanItem[] = [];
  for (const sl of [72, 56]) {
    const t = leftLow ? n1 + 2 : n0 - 2 - sl;
    const bar = put("coffeebar", t, sl, runDep);
    if (!inOpen(bar) || clash(others, bar)) continue;
    const mt = leftLow ? t + 4 : t + sl - 4 - len;
    station = [bar, put("espresso", mt, len, dep, 2), put("cupshelf", t, sl, 16)];
    break;
  }
  const endT = leftLow ? n1 - 8 - len : n0 + 8;
  if (station.length) list.push(...station);
  else list.push(put("espresso", endT, len, dep, 2));
  const sinkAt = list.findIndex((i) => i.k === "sink" && onRun(i));
  if (sinkAt >= 0) {
    const sk = list[sinkAt]!, [s0, s1] = A(boxOf(sk)), sL = s1 - s0;
    const t = station.length ? (leftLow ? n1 - 8 - sL : n0 + 8) : leftLow ? endT - 8 - sL : endT + len + 8;
    const hobs = list.filter((i) => i.k === "range" && onRun(i)).map((i) => A(boxOf(i)));
    if (!hobs.some(([a, b]) => t < b + 6 && t + sL > a - 6)) list[sinkAt] = along ? { ...sk, x: Math.round(t) } : { ...sk, y: Math.round(t) };
  }
  // A brushed-steel bin by the island's east end (#1022).
  const isl = list.find((i) => i.k === "island" && inK(i));
  if (isl) {
    const ib = boxOf(isl), bin = item("bin", [ib[2] + 6, (ib[1] + ib[3]) / 2 - 16, 24, 32]);
    if (inOpen(bin) && !clash(list, bin)) list.push(bin);
  }
  // Only the island's stools: a loose one elsewhere goes (#1022).
  if (isl) {
    const ib = boxOf(isl);
    list = list.filter((i) => i.k !== "stool" || !inK(i) || overlaps(boxOf(i), [ib[0] - 50, ib[1] - 50, ib[2] + 50, ib[3] + 50]));
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
  // Not on an open seam of the open room (#1022): no wall stands there to hang them on.
  const seams = openSeams(home.filter((r) => OPEN_ROOM.test(r.name)).flatMap((r) => r.parts));
  for (const [a, b] of runs(P, opp, [...plan.doors, ...seams])) free = cutIv(free, [a - 10, b + 10]);
  const spots = free.filter(([a, b]) => b - a >= 130).sort((x, y) => (t >= x[0] && t <= x[1] ? -1 : 0) - (t >= y[0] && t <= y[1] ? -1 : 0) || Math.min(Math.abs(t - x[0]), Math.abs(t - x[1])) - Math.min(Math.abs(t - y[0]), Math.abs(t - y[1])));
  const spot = spots[0];
  if (!spot) return [];
  const len = Math.min(210, spot[1] - spot[0] - 20);
  const t0 = clampLen(t - len / 2, spot[0] + 10, spot[1] - 10 - len);
  return [item("art", against(P, opp, t0, len, 4, 1))];
}




/**
 * Beside a balcony door: a small greenhouse in the corner on its solid side and a purifier under the window (no cat
 * bed, #1022). The greenhouse takes the first spot that is not in what is `taken` already.
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
  const out: PlanItem[] = [];
  const along = (s: Side, from: Side, t: number, len: number, dep: number, gap = 4) => against(R, s, tFrom(R, s, from, t, len), len, dep, gap);
  const W = wallLen(R, "n"), Hh = wallLen(R, "w");
  const free = (s: Side, t: number, len: number) => !runs(R, s, doors).some(([a, b]) => t < b + 6 && t + len > a - 6);
  if (master) {
    // Turned 180° (#1022, Nikita): the glass shower on the north wall, the long vanity on the south wall.
    const from: Side = door === "w" ? "e" : "w";
    const shLen = clampLen(W * 0.5, 90, 150), shDep = clampLen(Hh * 0.35, 80, 110);
    out.push(item("shower", along("n", from, 2, shLen, shDep, 2)));
    out.push(item("mat", inFrom(R, "n", tFrom(R, "n", from, shLen * 0.2, 60), 60, 44, shDep + 6)));
    const vLen = clampLen(W * 0.7, 100, 240);
    let vt = Math.max(20, (W - vLen) / 2);
    if (!free("s", vt, vLen)) vt = runs(R, "s", doors).some(([a]) => a > W / 2) ? 8 : W - vLen - 8;
    out.push(item("vanity", against(R, "s", vt, vLen, 54)));
    out.push(item("mat", inFrom(R, "s", vt + vLen / 2 - 40, 80, 46, 64)));
    // The side wall away from the door, from the shower down: the litter box on its mat, the toilet, the towel bar.
    const side: Side = door === "e" ? "w" : door === "w" ? "e" : OPP[from];
    const stop = Hh - 62;
    let t = shDep + 10;
    if (t + 46 + 12 + 40 <= stop) {
      out.push(item("mat", along(side, "n", t - 4, 56, 54, 2)));
      out.push(item("litterbox", along(side, "n", t, 46, 40, 6)));
      t += 60;
    }
    if (t + 40 <= stop) {
      out.push(item("wc", along(side, "n", t, 40, 66)));
      t += 54;
    }
    if (t + 50 <= stop) out.push(item("towelbar", along(side, "n", t, 50, 6, 0)));
  } else {
    // The guest bath (#1022, Nikita): the tub and shower against the west wall, the toilet about the middle of the
    // south wall facing north, the vanity beside it; a towel bar on the east wall.
    const tubLen = clampLen(Hh * 0.6, 120, 160), tubDep = clampLen(W * 0.4, 60, 78);
    const tub = item("tub", along("w", "n", 2, tubLen, tubDep, 2));
    out.push(tub, item("mat", inFrom(R, "w", tubLen * 0.25, 60, 40, tubDep + 6)));
    const vLen = clampLen(W * 0.35, 60, 120);
    const clear = (t: number, len: number, dep: number) => t >= 4 && t + len <= W - 4 && free("s", t, len) && !overlaps(boxOf(item("box", against(R, "s", t, len, dep))), boxOf(tub));
    // The toilet from the middle outward, the first spot with the vanity fitting beside it (east first), else alone.
    const mids = Array.from({ length: 13 }, (_, k) => W / 2 - 20 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10);
    let wc: number | null = null, vt: number | null = null;
    for (const t of mids) {
      if (!clear(t, 40, 66)) continue;
      const v = [t + 48, t - 8 - vLen].find((u) => clear(u, vLen, 54));
      if (v !== undefined) {
        [wc, vt] = [t, v];
        break;
      }
      wc ??= t;
    }
    if (wc !== null) out.push(item("wc", against(R, "s", wc, 40, 66)));
    if (vt !== null) out.push(item("vanity", against(R, "s", vt, vLen, 54)));
    if (door !== "e") out.push(item("towelbar", against(R, "e", Hh / 2 - 25, 50, 6, 0)));
  }
  return out;
}

/** The front door: a door of the hall whose far side is outside the home; a coat rack and shoes beside it. */
function hall(R: Rect, plan: HavenPlan): PlanItem[] {
  // The coat rack against the hall's east wall (#1022, Nikita), on its longest stretch clear of doors and glass.
  let free: [number, number][] = [[4, wallLen(R, "e") - 4]];
  for (const [a, b] of [...runs(R, "e", plan.doors), ...runs(R, "e", plan.windows), ...runs(R, "e", plan.balconies ?? [])]) free = cutIv(free, [a - 12, b + 12]);
  const spot = free.filter(([a, b]) => b - a >= 52).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
  return spot ? [item("coatrack", against(R, "e", (spot[0] + spot[1]) / 2 - 22, 44, 34, 4))] : [];
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
  const opened = withOpenings(masterDoor(straightenStudio(biggerGuestBath(stored))));
  const derivedLiving = opened.derivedLiving;
  const plan = tallWindows(opened.plan);
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
  // The coffee station is by the counter now (#1022), and no tub chair: Nikita has neither in the dining area.
  // The bathrooms: the master (by name, else the largest of two or more) and the guest bath.
  const baths = home.filter((r) => BATH.test(r.name));
  const biggest = baths.length > 1 ? baths.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a)) : null;
  for (const r of baths) {
    const master = /\b(master|primary|en-?suite)\b/i.test(r.name) || (!/\bguest\b/i.test(r.name) && r === biggest);
    relay(r, (R) => bath(R, plan.doors, master));
  }
  for (const r of home) if (HALL.test(r.name)) items = [...items.filter((it) => !(it.k === "coatrack" && within(r, it))), ...hall(mainRect(r), plan)];
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
  // The hall (#1022, Nikita): no rugs, and none of the strays that stood in the way, drawn as plain cylinders and
  // boxes (a cat bed, a purifier, loose jars and stools, a drinks fridge or a projector left over from another room).
  for (const r of home) if (HALL.test(r.name)) items = items.filter((it) => !(within(r, it) && (HALL_GONE.has(it.k) || (it.round && HALL_STRAYS.has(it.k)))));
  // The open room keeps no tub chair (#1022: Nikita has none in the dining area).
  for (const r of home) if (OPEN_ROOM.test(r.name)) items = items.filter((it) => !(it.k === "tubchair" && within(r, it)));
  // The closet (#1022): clothes rails along its north and south walls, nothing else.
  for (const r of home) if (CLOSET.test(r.name)) relay(r, (R) => closet(R, plan.doors));
  // The main bedroom: with its door at the east end of a north or south wall, the bed and its nightstands move west,
  // leaving a way in (#1022).
  if (bed) items = bedWest(bed, plan.doors, items, within);
  // Kitchen, dining room and living room are one open room (#1022, Nikita: no walls between them): their shared edges
  // are openings, so no wall is drawn there. Added after the layout, which still sees each room's own edges.
  const edges = openSeams(home.filter((r) => OPEN_ROOM.test(r.name)).flatMap((r) => r.parts));
  return { ...plan, items, devices: docked(plan, items), doors: [...plan.doors, ...edges] };
}

/**
 * Every seam between two parts of the open room (#1022), each part's own edge where it meets another, so no wall is
 * drawn there: between two rooms or two parts of one, meeting exactly or a hair apart (up to 4).
 */
export function openSeams(parts: PlanRoom["parts"]): Seg[] {
  const out: Seg[] = [];
  const NEAR = 4;
  for (const p of parts)
    for (const q of parts) {
      if (p === q) continue;
      const [px0, py0, px1, py1] = [p[0], p[1], p[0] + p[2], p[1] + p[3]];
      const [qx0, qy0, qx1, qy1] = [q[0], q[1], q[0] + q[2], q[1] + q[3]];
      const y0 = Math.max(py0, qy0), y1 = Math.min(py1, qy1);
      if (y1 - y0 > 1) {
        if (Math.abs(px1 - qx0) <= NEAR) out.push([px1, y0, px1, y1]);
        if (Math.abs(px0 - qx1) <= NEAR) out.push([px0, y0, px0, y1]);
      }
      const x0 = Math.max(px0, qx0), x1 = Math.min(px1, qx1);
      if (x1 - x0 > 1) {
        if (Math.abs(py1 - qy0) <= NEAR) out.push([x0, py1, x1, py1]);
        if (Math.abs(py0 - qy1) <= NEAR) out.push([x0, py0, x1, py0]);
      }
    }
  return out;
}

const CLOSET = /\b(closet|wardrobe|walk-?in)\b/i;
/** What never stands in the hall (#1022), and the round strays drawn there as plain cylinders. */
const HALL_GONE = new Set<Kind>(["rug", "runner", "mat", "petbed", "minifridge", "projector"]);
const HALL_STRAYS = new Set<Kind>(["purifier", "jar", "stool", "tubchair", "box", "plant"]);

/** Clothes rails along the closet's north and south walls, clear of a door on either (#1022). */
function closet(R: Rect, doors: Seg[]): PlanItem[] {
  const out: PlanItem[] = [];
  for (const s of ["n", "s"] as Side[]) {
    let free: [number, number][] = [[4, wallLen(R, s) - 4]];
    for (const [a, b] of runs(R, s, doors)) free = cutIv(free, [a - 8, b + 8]);
    for (const [a, b] of free) if (b - a >= 40) out.push(item("rail", against(R, s, a, b - a, Math.min(34, depthTo(R, s) / 3), 2)));
  }
  return out;
}

/** The bed and the nightstands moved west, up to 60, when the bedroom's door is at the east end of its north or south wall. */
function bedWest(bed: PlanRoom, doors: Seg[], items: PlanItem[], within: (r: PlanRoom, it: PlanItem) => boolean): PlanItem[] {
  const R = mainRect(bed);
  const d = SIDES.flatMap((s) => runs(R, s, doors).map(([a, b]) => ({ s, a, b })))[0];
  if (!d || (d.s !== "n" && d.s !== "s") || d.a < wallLen(R, d.s) / 2) return items;
  const group = items.filter((it) => within(bed, it) && (it.k === "bed" || it.k === "night"));
  if (!group.some((it) => it.k === "bed")) return items;
  const x0 = Math.min(...group.map((it) => boxOf(it)[0]));
  const by = Math.max(0, Math.min(60, x0 - R[0] - 6));
  return by ? items.map((it) => (group.includes(it) ? { ...it, x: it.x - by } : it)) : items;
}

/**
 * The robot vacuum drawn at its dock (#1022, Nikita: it showed mid-hall while docked; the dock is in the Hall on its
 * left side, by the hall light, near the plant cabinet). In a hall: against its west wall, beside the plant cabinet
 * (the greenhouse) when one stands there, else level with the hall's light, else level with where the plan has it;
 * clear of doors and of what stands there. In another room: beside a greenhouse there, else where the plan has it.
 */
function docked(plan: HavenPlan, items: PlanItem[]): PlanDevice[] {
  return plan.devices.map((d) => {
    if (d.kind !== "vacuum") return d;
    const room = plan.rooms.find((r) => !r.detached && r.parts.some((pt) => inRect(d.x, d.y, pt)));
    if (!room) return d;
    const R = mainRect(room);
    const taken = items.filter(solid);
    const DOCK = 38;
    const ok = (s: Side, t: number) => {
      const dock = item("box", against(R, s, t, DOCK, DOCK, 2));
      return fits(R, dock) && !clash(taken, dock) && !runs(R, s, [...plan.doors, ...(plan.balconies ?? [])]).some(([a, e]) => t < e + 10 && t + DOCK > a - 10);
    };
    const at = (s: Side, t: number): PlanDevice => {
      const [x, y] = centreOfRect(against(R, s, t, DOCK, DOCK, 2));
      return { ...d, x: Math.round(x), y: Math.round(y) };
    };
    const cands: [Side, number][] = [];
    const gh = items.find((it) => it.k === "greenhouse" && inRect(...mid(it), R));
    if (gh) {
      const b = boxOf(gh), s = nearSide(R, b), hz = s === "n" || s === "s";
      const t0 = hz ? b[0] - R[0] : b[1] - R[1], t1 = hz ? b[2] - R[0] : b[3] - R[1];
      // On a north or south wall, its west side first.
      cands.push([s, t0 - 6 - DOCK], [s, t1 + 6]);
    }
    if (HALL.test(room.name)) {
      const light = (plan.lights ?? []).find((l) => inRect(l.x, l.y, R));
      const want = (light ? light.y : d.y) - R[1] - DOCK / 2;
      const L = wallLen(R, "w");
      for (let k = 0; k <= 24; k++) {
        const t = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 12;
        if (t >= 4 && t + DOCK <= L - 4) cands.push(["w", t]);
      }
    }
    const hit = cands.find(([s, t]) => ok(s, t));
    return hit ? at(...hit) : d;
  });
}

/**
 * The main bedroom's door at the far end of its wall (#1022, Nikita: all the way to the right, not the centre): on a
 * north or south wall its east end, on a west or east wall the right-hand end seen from inside; kept on the stretch
 * the bedroom shares with the room it opens to.
 */
function masterDoor(plan: HavenPlan): HavenPlan {
  const home = plan.rooms.filter((r) => !r.detached);
  const bed = masterBed(home);
  if (!bed) return plan;
  const R = mainRect(bed);
  for (const s of SIDES)
    for (const door of plan.doors) {
      const on = onWall(R, s, door);
      if (!on) continue;
      const len = on[1] - on[0];
      const [px, py] = centreOfRect(against(R, s, (on[0] + on[1]) / 2, 1, 1, -12));
      // Its way in: the door from the hall, a landing or the open room, not one to its bath, closet or another room.
      const next = home.find((r) => r !== bed && r.parts.some((pt) => inRect(px, py, pt)));
      if (!next || !(LANDING.test(next.name) || OPEN_ROOM.test(next.name))) continue;
      const edge = sharedEdges(bed, next).map((g) => onWall(R, s, g)).find((v): v is [number, number] => v !== null && v[0] <= on[0] + 1 && v[1] >= on[1] - 1);
      if (!edge) return plan;
      const toHigh = s === "n" || s === "s" || s === "e";
      const a = toHigh ? edge[1] - 6 - len : edge[0] + 6;
      if (a < edge[0] || Math.abs(a - on[0]) < 2) return plan;
      return { ...plan, doors: plan.doors.map((d) => (d === door ? segOn(R, s, a, a + len) : d)) };
    }
  return plan;
}

/** Three tall windows on the main bedroom's west wall and the Studio's east wall (#1022), clear of doors and balcony doors. */
function tallWindows(plan: HavenPlan): HavenPlan {
  const home = plan.rooms.filter((r) => !r.detached);
  const want: [PlanRoom | null | undefined, Side][] = [[masterBed(home), "w"], [home.find((r) => STUDIO.test(r.name)), "e"]];
  let windows = plan.windows;
  const tall: Seg[] = [];
  for (const [room, s] of want) {
    if (!room) continue;
    const R = mainRect(room), L = wallLen(R, s);
    let free: [number, number][] = [[14, L - 14]];
    for (const [a, b] of [...runs(R, s, plan.doors), ...runs(R, s, plan.balconies ?? [])]) free = cutIv(free, [a - 14, b + 14]);
    const best = free.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
    if (!best || best[1] - best[0] < 120) continue;
    windows = windows.filter((w) => !onWall(R, s, w));
    const gap = 16, wl = (best[1] - best[0] - 2 * gap) / 3;
    for (let i = 0; i < 3; i++) {
      const a = best[0] + i * (wl + gap);
      const seg = segOn(R, s, a, a + wl);
      windows = [...windows, seg];
      tall.push(seg);
    }
  }
  return tall.length ? { ...plan, windows, tall } : plan;
}

/**
 * The Studio's wall by the litter box, straight (#1022, Nikita: a flat wall, the Studio's door right beside the litter
 * box). When the litter box stands just outside the Studio, the Studio's side facing it becomes one straight line (the
 * Studio's edge nearest the box): the jogs along it are squared off, the rooms across it meet it, and the Studio's door
 * on that side moves to stand beside the box, on the side it was on.
 */
export function straightenStudio(plan: HavenPlan): HavenPlan {
  const home = plan.rooms.filter((r) => !r.detached);
  const studio = home.find((r) => STUDIO.test(r.name));
  const box = plan.devices.find((d) => d.kind === "litter");
  if (!studio || !box || studio.parts.some((pt) => inRect(box.x, box.y, pt))) return plan;
  const xs = studio.parts.flatMap((p) => [p[0], p[0] + p[2]]), ys = studio.parts.flatMap((p) => [p[1], p[1] + p[3]]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // The side facing the box: the box beside that side's span, nearest it.
  const cand: [Side, number][] = [];
  if (box.y >= y0 - 40 && box.y <= y1 + 40) cand.push(["w", x0 - box.x], ["e", box.x - x1]);
  if (box.x >= x0 - 40 && box.x <= x1 + 40) cand.push(["n", y0 - box.y], ["s", box.y - y1]);
  const near = cand.filter(([, d]) => d > -200).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
  if (!near || Math.abs(near[1]) > 160) return plan;
  const s = near[0], hz = s === "n" || s === "s";
  // The axis across the wall (x for a west or east side) and along it.
  const lo = s === "w" || s === "n";
  const edgeOf = (p: [number, number, number, number]) => (hz ? (lo ? p[1] : p[1] + p[3]) : lo ? p[0] : p[0] + p[2]);
  const boxAcross = hz ? box.y : box.x, boxAlong = hz ? box.x : box.y;
  const edges = studio.parts.map(edgeOf);
  const line = edges.reduce((a, e) => (Math.abs(e - boxAcross) < Math.abs(a - boxAcross) ? e : a));
  const span: [number, number] = hz ? [x0, x1] : [y0, y1];
  const JOG = 80;
  const setEdge = (p: [number, number, number, number], near: boolean): [number, number, number, number] => {
    // `near`: the part's edge facing the line from the Studio's side (the Studio's own), else the far side's.
    const [px, py, pw, ph] = p;
    if (hz) {
      const top = near === lo;
      return top ? [px, line, pw, py + ph - line] : [px, py, pw, line - py];
    }
    const left = near === lo;
    return left ? [line, py, px + pw - line, ph] : [px, py, line - px, ph];
  };
  const alongOf = (p: [number, number, number, number]): [number, number] => (hz ? [p[0], p[0] + p[2]] : [p[1], p[1] + p[3]]);
  const hits = (p: [number, number, number, number]) => {
    const [a, b] = alongOf(p);
    return b > span[0] && a < span[1];
  };
  const rooms = plan.rooms.map((r) => {
    if (r.detached) return r;
    const parts = r.parts.map((p) => {
      if (!hits(p)) return p;
      if (r === studio) {
        const e = edgeOf(p);
        return e !== line && Math.abs(e - line) <= JOG ? setEdge(p, true) : p;
      }
      // A room across the line: its edge facing the Studio meets the line.
      const far = hz ? (lo ? p[1] + p[3] : p[1]) : lo ? p[0] + p[2] : p[0];
      return far !== line && Math.abs(far - line) <= JOG ? setEdge(p, false) : p;
    });
    return parts.every((p) => p[2] > 20 && p[3] > 20) ? { ...r, parts } : r;
  });
  // The door: off the jogs, beside the box on the side it stood on.
  const onSide = (d: Seg) => (hz ? d[1] === d[3] && Math.abs(d[1] - line) <= JOG : d[0] === d[2] && Math.abs(d[0] - line) <= JOG) && (hz ? Math.max(d[0], d[2]) > span[0] && Math.min(d[0], d[2]) < span[1] : Math.max(d[1], d[3]) > span[0] && Math.min(d[1], d[3]) < span[1]);
  const old = plan.doors.filter(onSide);
  const len = old.length ? Math.max(...old.map((d) => Math.abs(hz ? d[2] - d[0] : d[3] - d[1]))) : 80;
  const was = old.length ? (hz ? (old[0]![0] + old[0]![2]) / 2 : (old[0]![1] + old[0]![3]) / 2) : (span[0] + span[1]) / 2;
  const side = was >= boxAlong ? 1 : -1;
  let a = side > 0 ? boxAlong + 38 : boxAlong - 38 - len;
  a = Math.max(span[0] + 6, Math.min(span[1] - 6 - len, a));
  const door: Seg = hz ? [a, line, a + len, line] : [line, a, line, a + len];
  return { ...plan, rooms, doors: [...plan.doors.filter((d) => !old.includes(d)), door] };
}

/** How much the guest bath grows (#1022). */
const GUEST_GROW = 30;

/** The guest bath: by name, else the smaller of two or more baths, else the only one. */
function guestBath(home: PlanRoom[]): PlanRoom | null {
  const baths = home.filter((r) => BATH.test(r.name));
  if (!baths.length) return null;
  const named = baths.find((r) => /\bguest\b/i.test(r.name));
  if (named) return named;
  const notMaster = baths.filter((r) => !/\b(master|primary|en-?suite)\b/i.test(r.name));
  if (!notMaster.length) return null;
  return notMaster.length === baths.length && baths.length > 1 ? baths.reduce((a, b) => (areaOf(b) < areaOf(a) ? b : a)) : notMaster[0]!;
}

/**
 * The guest bath a little bigger (#1022, Nikita): its main part grows GUEST_GROW into empty floor beside it (inside the
 * home's outline, no room there), else takes it from a hall, closet or other side room across that wall that stays
 * deep enough. Doors on the wall it moves move with it. Drawing only.
 */
export function biggerGuestBath(plan: HavenPlan): HavenPlan {
  const home = plan.rooms.filter((r) => !r.detached);
  const bath = guestBath(home);
  if (!bath) return plan;
  const R = mainRect(bath);
  const all = home.flatMap((r) => r.parts);
  const hx0 = Math.min(...all.map((p) => p[0])), hx1 = Math.max(...all.map((p) => p[0] + p[2]));
  const hy0 = Math.min(...all.map((p) => p[1])), hy1 = Math.max(...all.map((p) => p[1] + p[3]));
  const G = GUEST_GROW;
  const [x, y, w, h] = R;
  const strip: Record<Side, Rect> = { n: [x, y - G, w, G], s: [x, y + h, w, G], w: [x - G, y, G, h], e: [x + w, y, G, h] };
  const hits = (a: Rect, b: Rect) => a[0] < b[0] + b[2] - 0.5 && a[0] + a[2] > b[0] + 0.5 && a[1] < b[1] + b[3] - 0.5 && a[1] + a[3] > b[1] + 0.5;
  const inHome = (q: Rect) => q[0] >= hx0 && q[1] >= hy0 && q[0] + q[2] <= hx1 && q[1] + q[3] <= hy1;
  const glassOn = (s: Side) => [...plan.windows, ...(plan.balconies ?? [])].some((g) => onWall(R, s, g));
  let side: Side | null = null;
  let donor: { room: PlanRoom; part: number } | null = null;
  for (const s of SIDES) {
    if (glassOn(s) || !inHome(strip[s]) || all.some((p) => hits(p, strip[s]))) continue;
    side = s;
    break;
  }
  if (!side)
    for (const s of SIDES) {
      if (glassOn(s)) continue;
      const q = strip[s];
      const owners = home.flatMap((r) => r.parts.map((p, i) => ({ r, p, i }))).filter(({ p }) => hits(p, q));
      if (owners.length !== 1) continue;
      const { r, p, i } = owners[0]!;
      if (r === bath || OPEN_ROOM.test(r.name) || BED.test(r.name) || STUDIO.test(r.name) || BATH.test(r.name)) continue;
      // It spans the whole wall, and stays at least 110 deep.
      const spans = s === "n" || s === "s" ? p[0] <= x && p[0] + p[2] >= x + w : p[1] <= y && p[1] + p[3] >= y + h;
      const deep = s === "n" || s === "s" ? p[3] : p[2];
      // No other room's door opens onto the strip it would lose.
      const lands = plan.doors.some((d) => {
        if (onWall(R, s, d)) return false;
        const [a0, b0, a1, b1] = [Math.min(d[0], d[2]), Math.min(d[1], d[3]), Math.max(d[0], d[2]), Math.max(d[1], d[3])];
        return a0 <= q[0] + q[2] && a1 >= q[0] && b0 <= q[1] + q[3] && b1 >= q[1] && Math.max(a1 - a0, b1 - b0) > 1 && (a1 - a0 > 1 ? Math.min(a1, q[0] + q[2]) - Math.max(a0, q[0]) > 1 : Math.min(b1, q[1] + q[3]) - Math.max(b0, q[1]) > 1);
      });
      if (!spans || deep - G < 110 || lands) continue;
      side = s;
      donor = { room: r, part: i };
      break;
    }
  if (!side) return plan;
  const s = side;
  const grown: Rect = s === "n" ? [x, y - G, w, h + G] : s === "s" ? [x, y, w, h + G] : s === "w" ? [x - G, y, w + G, h] : [x, y, w + G, h];
  const rooms = plan.rooms.map((r) => {
    if (r === bath) return { ...r, parts: r.parts.map((p) => (p === R ? grown : p)) };
    if (donor && r === donor.room)
      return {
        ...r,
        parts: r.parts.map((p, i): Rect => {
          if (i !== donor!.part) return p;
          return s === "n" ? [p[0], p[1], p[2], p[3] - G] : s === "s" ? [p[0], p[1] + G, p[2], p[3] - G] : s === "w" ? [p[0], p[1], p[2] - G, p[3]] : [p[0] + G, p[1], p[2] - G, p[3]];
        }),
      };
    return r;
  });
  const shift: [number, number] = s === "n" ? [0, -G] : s === "s" ? [0, G] : s === "w" ? [-G, 0] : [G, 0];
  const doors = plan.doors.map((d): Seg => (onWall(R, s, d) ? [d[0] + shift[0], d[1] + shift[1], d[2] + shift[0], d[3] + shift[1]] : d));
  return { ...plan, rooms, doors };
}

/** The rooms of the one open space (#1022): the kitchen, the dining room and the living room. */
export const OPEN_ROOM = /\b(kitchen|dining|living)\b/i;

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
