/** mulberry32: tiny, fast, seedable. Same seed, same Lattice. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    range: (min: number, max: number) => min + next() * (max - min),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)]!;
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
