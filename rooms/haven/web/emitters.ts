/**
 * The devices' particle emitters (#729): devices that stand together (the pets' feeders, fountain and litter box by one
 * wall) used to each raise their own column and swarm, piling into one dense cloud. Devices within `reach` of each
 * other share one emitter at their middle, wider and calmer, so a corner of three devices draws about as much as one
 * and a half. Pure, for house.ts.
 */

export interface EmitterIn {
  x: number;
  y: number;
  lift: number;
  /** It needs Nikita (its room is flagged): the cluster swarms. */
  needs: boolean;
}

export interface Emitter {
  x: number;
  y: number;
  lift: number;
  /** How many devices share it. */
  n: number;
  /** Its spread in plan units: wider for a cluster. */
  spread: number;
  needs: boolean;
  /** Its share of the particles: one device 1, a cluster at most 1.5. */
  weight: number;
}

/** Devices closer than this (plan units, about cm) share an emitter. */
export const REACH = 110;

export function emittersOf(list: EmitterIn[], reach = REACH): Emitter[] {
  const group: number[] = list.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) if (Math.hypot(list[i]!.x - list[j]!.x, list[i]!.y - list[j]!.y) <= reach) group[root(j)] = root(i);
  const by = new Map<number, EmitterIn[]>();
  list.forEach((d, i) => by.set(root(i), [...(by.get(root(i)) ?? []), d]));
  return [...by.values()].map((g) => {
    const n = g.length;
    const x = g.reduce((a, d) => a + d.x, 0) / n, y = g.reduce((a, d) => a + d.y, 0) / n;
    const spread = n === 1 ? 0 : Math.max(...g.map((d) => Math.hypot(d.x - x, d.y - y)));
    return { x, y, lift: Math.max(...g.map((d) => d.lift)), n, spread, needs: g.some((d) => d.needs), weight: Math.min(1.5, 1 + (n - 1) * 0.25) };
  });
}
