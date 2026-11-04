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
