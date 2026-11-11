import type { HavenPlan, Kind, PlanItem, PlanRoom } from "./data.ts";

/**
 * Filling the Gym (#718): the plan says what stands where, but a gym drawn from a sparse plan read as an empty dark
 * box. Whatever the Gym room is missing of a home gym's kit (a rack, a bench, dumbbells, a treadmill, a bike,
 * kettlebells) is placed in its free floor, against the walls first, never over what the plan already has. Pure and
 * deterministic: the same plan always gets the same gym. Only the drawing uses it; the stored plan is untouched.
 */

/** The kit, in the order it is placed, with its footprint (plan units, about cm): long side first. */
export const GYM_KIT: { k: Kind; len: number; dep: number }[] = [
  { k: "rack", len: 130, dep: 110 },
  { k: "bench", len: 120, dep: 40 },
  { k: "dbrack", len: 160, dep: 45 },
  { k: "treadmill", len: 180, dep: 80 },
  { k: "bike", len: 110, dep: 50 },
  { k: "kettle", len: 90, dep: 30 },
];

const GAP = 20;

type Box = [number, number, number, number];
const boxOf = (it: PlanItem): Box => (it.round ? [it.x - it.w / 2, it.y - it.w / 2, it.x + it.w / 2, it.y + it.w / 2] : [it.x, it.y, it.x + it.w, it.y + it.h]);
const overlaps = (a: Box, b: Box, gap: number) => a[0] < b[2] + gap && a[2] + gap > b[0] && a[1] < b[3] + gap && a[3] + gap > b[1];
const inside = (b: Box, parts: PlanRoom["parts"]) => parts.some(([x, y, w, h]) => b[0] >= x + 6 && b[1] >= y + 6 && b[2] <= x + w - 6 && b[3] <= y + h - 6);
/** How far a box sits from its room's nearest wall: placing against the walls first keeps the middle open. */
function wallGap(b: Box, parts: PlanRoom["parts"]): number {
  let best = Infinity;
  for (const [x, y, w, h] of parts) best = Math.min(best, b[0] - x, b[1] - y, x + w - b[2], y + h - b[3]);
  return Math.max(0, best);
}

/** Floor pieces (mats, rugs) don't take floor space from the kit. */
const FLAT = new Set<Kind>(["gmat", "mat", "rug", "runner"]);

/** The gym's room in the plan: the one whose tab is the Gym. */
export function gymRoom(plan: HavenPlan): PlanRoom | null {
  return plan.rooms.find((r) => r.tab === "gym") ?? null;
}

/** The pieces added to the Gym, in plan units; empty when there's no Gym or it has the whole kit. */
export function gymFill(plan: HavenPlan): PlanItem[] {
  const room = gymRoom(plan);
  if (!room) return [];
  const inRoom = (it: PlanItem) => {
    const [x0, y0, x1, y1] = boxOf(it);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return room.parts.some(([x, y, w, h]) => cx >= x && cx < x + w && cy >= y && cy < y + h);
  };
  const here = plan.items.filter(inRoom);
  const has = new Set(here.map((i) => i.k));
  const taken: Box[] = here.filter((i) => !FLAT.has(i.k)).map(boxOf);
  // The devices standing there keep their floor too.
  for (const d of plan.devices) taken.push([d.x - 20, d.y - 20, d.x + 20, d.y + 20]);
  const out: PlanItem[] = [];
  for (const kit of GYM_KIT) {
    if (has.has(kit.k)) continue;
    let best: { b: Box; score: number } | null = null;
    for (const [px, py, pw, ph] of room.parts)
      for (const [w, h] of [
        [kit.len, kit.dep],
        [kit.dep, kit.len],
      ] as const)
        for (let y = py + 10; y + h <= py + ph - 10; y += 10)
          for (let x = px + 10; x + w <= px + pw - 10; x += 10) {
            const b: Box = [x, y, x + w, y + h];
            if (!inside(b, room.parts) || taken.some((t) => overlaps(b, t, GAP))) continue;
            const score = wallGap(b, room.parts);
            if (!best || score < best.score - 0.5) best = { b, score };
          }
    if (!best) continue;
    const [x0, y0, x1, y1] = best.b;
    const it: PlanItem = { k: kit.k, x: x0, y: y0, w: x1 - x0, h: y1 - y0, round: false };
    out.push(it);
    taken.push(best.b);
  }
  return out;
}

/** The plan as the house draws it: the Gym filled out. */
export function withGym(plan: HavenPlan): HavenPlan {
  const add = gymFill(plan);
  return add.length ? { ...plan, items: [...plan.items, ...add] } : plan;
}

/** The gap between the home and the Gym when it is drawn beyond it, in plan units (about cm). */
const GYM_GAP = 140;

/**
 * The Gym drawn beyond the home (#729, Nikita: "above, not physically above"): the detached block moves to the far side
 * of the apartment, the top of the screen in the default view, its right edge in line with the home's, so it fills the
 * open dark up and to the right instead of sitting in front. Everything standing in it moves with it (the kit, its
 * devices, its doors and windows); the walk to it is dropped, since it no longer leads there. Then the whole plan is
 * shifted back to start at 0. Drawing only: the stored plan is untouched. A block already beyond the home stays.
 */
export function gymBeyond(plan: HavenPlan): HavenPlan {
  const det = plan.rooms.filter((r) => r.detached);
  const main = plan.rooms.filter((r) => !r.detached);
  if (!det.length || !main.length) return plan;
  const box = (rooms: PlanRoom[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rooms)
      for (const [x, y, w, h] of r.parts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + w);
        y1 = Math.max(y1, y + h);
      }
    return [x0, y0, x1, y1] as const;
  };
  const [, my0, mx1] = box(main);
  const [dx0, dy0, dx1, dy1] = box(det);
  if (dy1 <= my0) return plan;
  const tx = mx1 - dx1, ty = my0 - GYM_GAP - dy1;
  const inDet = (x: number, y: number) => x >= dx0 && x <= dx1 && y >= dy0 && y <= dy1 && det.some((r) => r.parts.some(([px, py, pw, ph]) => x >= px - 1 && x <= px + pw + 1 && y >= py - 1 && y <= py + ph + 1));
  const itemC = (it: PlanItem): [number, number] => (it.round ? [it.x, it.y] : [it.x + it.w / 2, it.y + it.h / 2]);
  // First the move, then the shift that brings the whole plan back to 0, 0.
  const moved = {
    rooms: plan.rooms.map((r) => (r.detached ? { ...r, parts: r.parts.map(([x, y, w, h]) => [x + tx, y + ty, w, h] as PlanRoom["parts"][number]) } : r)),
    items: plan.items.map((it) => (inDet(...itemC(it)) ? { ...it, x: it.x + tx, y: it.y + ty } : it)),
    devices: plan.devices.map((d) => (inDet(d.x, d.y) ? { ...d, x: d.x + tx, y: d.y + ty } : d)),
    doors: plan.doors.map((s) => (inDet((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) ? ([s[0] + tx, s[1] + ty, s[2] + tx, s[3] + ty] as typeof s) : s)),
    windows: plan.windows.map((s) => (inDet((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) ? ([s[0] + tx, s[1] + ty, s[2] + tx, s[3] + ty] as typeof s) : s)),
    balconies: (plan.balconies ?? []).map((s) => (inDet((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) ? ([s[0] + tx, s[1] + ty, s[2] + tx, s[3] + ty] as typeof s) : s)),
    tv: plan.tv ?? [],
  };
  const [ax0, ay0, ax1, ay1] = box(moved.rooms);
  const sx = Math.min(0, ax0), sy = Math.min(0, ay0);
  const S = <T extends number[]>(s: T): T => s.map((v, i) => v - (i % 2 ? sy : sx)) as T;
  return {
    ...plan,
    w: Math.max(plan.w, ax1) - sx,
    h: Math.max(ay1, ...main.flatMap((r) => r.parts.map(([, y, , h]) => y + h))) - sy,
    rooms: moved.rooms.map((r) => ({ ...r, parts: r.parts.map(([x, y, w, h]) => [x - sx, y - sy, w, h] as PlanRoom["parts"][number]) })),
    items: moved.items.map((it) => ({ ...it, x: it.x - sx, y: it.y - sy })),
    devices: moved.devices.map((d) => ({ ...d, x: d.x - sx, y: d.y - sy })),
    doors: moved.doors.map(S),
    windows: moved.windows.map(S),
    balconies: moved.balconies.map(S),
    tv: moved.tv.map(S),
    ...(plan.decks ? { decks: plan.decks.map(S) } : {}),
    ...(plan.tall ? { tall: plan.tall.map(S) } : {}),
    // The lights' spots (#931) hang in the home, which moves with the rest.
    ...(plan.lights ? { lights: plan.lights.map((l) => ({ ...l, x: l.x - sx, y: l.y - sy, ...(l.x2 !== undefined && l.y2 !== undefined ? { x2: l.x2 - sx, y2: l.y2 - sy } : {}) })) } : {}),
    path: [],
  };
}
