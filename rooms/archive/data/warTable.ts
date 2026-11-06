/**
 * The war table (#826): the Archive as a campaign table, its chart carved with the record's places. Each of the
 * Archive's features is a place on the map, a model you can point at and open. Since #937 the chart is a drowned
 * world in the Tide's look: an archipelago in black water, its places drowned ruins, glass stasis monoliths and
 * glass-lit labs, after the Undertow. Plain maths, no DOM and no three.js
 * (warTable.test.ts): the places, where they stand, and the carved relief they stand on, shared by the scene
 * (web/warTableScene.ts) and the page (web/WarTable.tsx).
 */

/** The Archive's features, each a place on the table. */
export type PlaceId = "today" | "week" | "day" | "bonds" | "shelf" | "told" | "ships" | "tide" | "how";

/** Which miniature stands there. */
export type ModelKind = "beacon" | "hourglass" | "citadel" | "monoliths" | "stacks" | "amphitheatre" | "harbour" | "ghost" | "lab";

export interface Place {
  id: PlaceId;
  /** The feature, as the pin and the panel name it. */
  name: string;
  /** One plain line on what it opens. */
  what: string;
  /** The miniature, in a word or two (shown small on the panel, never on its own). */
  model: string;
  kind: ModelKind;
  /** Where it stands on the map, in table units: x across (-8..8), z from the far edge (-5) to the near one (5). */
  x: number;
  z: number;
}

/** The Tide's silver (#937): the war table and everything it opens wear it in place of the Archive's violet. */
export const WT_SILVER = "#d6dee9";
export const WT_SILVER_RGB = "214,222,234";

/** The map inside the rim: 16 across, 10 deep. */
export const MAP_W = 16;
export const MAP_D = 10;
/** How tall the carved land stands at its highest, in table units. */
export const RELIEF = 0.75;

/** The places in reading order (the legend's and the keyboard's), west to east, far to near. */
export const PLACES: Place[] = [
  {
    id: "today",
    name: "Today in Ilyr",
    what: "The latest edition, read aloud",
    model: "The drowned beacon",
    kind: "beacon",
    x: -6.1,
    z: -0.9,
  },
  {
    id: "week",
    name: "Book of Hours",
    what: "The week as threads, hour by hour",
    model: "The hourglass spire",
    kind: "hourglass",
    x: -1.0,
    z: -2.0,
  },
  {
    id: "day",
    name: "The day",
    what: "Every hour of a day, as it was written",
    model: "The drowned citadel",
    kind: "citadel",
    x: 1.3,
    z: 1.0,
  },
  {
    id: "bonds",
    name: "Bonds",
    what: "Who moved closer, who drifted",
    model: "The twin stasis monoliths",
    kind: "monoliths",
    x: 4.2,
    z: -1.5,
  },
  {
    id: "shelf",
    name: "Past days",
    what: "The days on file",
    model: "The glass stacks",
    kind: "stacks",
    x: -3.7,
    z: 1.9,
  },
  {
    id: "told",
    name: "The week told",
    what: "The cast tells the week, on Sundays",
    model: "The sunken amphitheatre",
    kind: "amphitheatre",
    x: -1.0,
    z: 3.4,
  },
  {
    id: "ships",
    name: "What shipped",
    what: "The Foundry's work, week by week",
    model: "The drowned harbour",
    kind: "harbour",
    x: -3.6,
    z: -2.4,
  },
  {
    id: "tide",
    name: "The Tide",
    what: "The campaign, once its feed is connected",
    model: "The shattered isle",
    kind: "ghost",
    x: 6.0,
    z: -3.2,
  },
  {
    id: "how",
    name: "How it's written",
    what: "Where the record comes from",
    model: "The glass lab",
    kind: "lab",
    x: -6.5,
    z: 3.7,
  },
];

export const placeOf = (id: PlaceId): Place => PLACES.find((p) => p.id === id)!;

// ---- the relief --------------------------------------------------------------------------------------------------

/** A deterministic hash in 0..1. */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in 0..1. */
function noise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise, roughly -0.5..0.5. */
function fbm(x: number, z: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    s += amp * (noise(x * f, z * f) - 0.5);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}

/**
 * The land masses: x, z, radius, height. A drowned world's archipelago (#937): a broken western shelf, a scatter of
 * isles to the east, and the Tide's corner left open sea in the eye of a storm: its chart isn't drawn yet.
 */
const LAND: [number, number, number, number][] = [
  [-6.0, -0.8, 1.0, 1.0],
  [-5.0, 0.6, 1.25, 0.9],
  [-3.6, -1.4, 0.85, 0.7],
  [-3.4, 1.9, 1.15, 0.9],
  [-1.0, -1.7, 1.2, 0.95],
  [-0.3, 0.3, 0.85, 0.65],
  [1.3, 1.0, 1.0, 0.6],
  [-1.0, 3.3, 0.9, 0.8],
  [2.7, -0.6, 0.6, 0.6],
  [3.8, -1.5, 0.55, 0.95],
  [4.7, -1.45, 0.5, 0.95],
  [4.1, 2.2, 0.45, 0.7],
  [5.5, 0.9, 0.3, 0.6],
  [2.6, 2.9, 0.35, 0.55],
  [-2.2, -3.6, 0.4, 0.6],
  [0.8, -3.3, 0.5, 0.6],
  [6.6, 0.2, 0.3, 0.5],
];

/** Open water kept clear: the storm's eye round the Tide, and the lab's anchorage. */
const DEEP: [number, number, number][] = [
  [6.0, -3.2, 1.7],
  [-6.5, 3.7, 1.1],
];

/** Where the places are levelled: a flat plinth of ground for each model. */
const FLAT = 0.62;

/**
 * The carved height at a point, in -1..1 (below 0 is sea). Land is a few soft masses round the places, roughened by
 * noise; each place stands on a level patch; the map falls away to sea at the rim.
 */
export function heightAt(x: number, z: number): number {
  let h = -0.36;
  for (const [lx, lz, r, a] of LAND) {
    const d2 = ((x - lx) ** 2 + (z - lz) ** 2) / (r * r * 1.7);
    h += a * Math.exp(-d2);
  }
  h += fbm(x * 0.55 + 3.1, z * 0.55 - 1.7) * 0.85;
  // Ragged, drowned coasts: a finer layer, so the shores break into reefs and islets.
  h += fbm(x * 1.9 - 5.3, z * 1.9 + 2.2) * 0.42;
  for (const [dx, dz, r] of DEEP) h -= 0.7 * Math.exp(-((x - dx) ** 2 + (z - dz) ** 2) / (r * r));
  // The rim: everything sinks to sea within a unit of the edge.
  const ex = Math.max(0, Math.abs(x) - (MAP_W / 2 - 1.1));
  const ez = Math.max(0, Math.abs(z) - (MAP_D / 2 - 1.0));
  h -= (ex + ez) * 0.9;
  h = Math.max(-1, Math.min(1, h));
  // The places' plinths (the harbour and the citadel stand at the waterline, half drowned; the isle and the lab sit on the sea).
  for (const p of PLACES) {
    if (p.kind === "ghost" || p.kind === "lab") continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < FLAT * 1.6) {
      const k = d < FLAT ? 1 : 1 - (d - FLAT) / (FLAT * 0.6);
      const s = k * k * (3 - 2 * k);
      h = h + (plinthOf(p) - h) * s;
    }
  }
  return h;
}

/** The level a place's plinth is carved to. */
function plinthOf(p: Place): number {
  return p.kind === "harbour" || p.kind === "citadel" ? 0.06 : p.kind === "beacon" ? 0.3 : 0.22;
}

/** The ground a place's model stands on, in table units above the sea. */
export const groundOf = (p: Place): number => (p.kind === "ghost" || p.kind === "lab" ? 0 : Math.max(0, plinthOf(p)) * RELIEF);

/** The carved surface's height in table units: land rises, the sea is cut a little below the waterline. */
export const surfaceAt = (x: number, z: number): number => {
  const h = heightAt(x, z);
  return h > 0 ? h * RELIEF : h * 0.06;
};

/** A place's key from the keyboard: the next or previous in reading order. */
export function stepPlace(id: PlaceId, by: 1 | -1): PlaceId {
  const i = PLACES.findIndex((p) => p.id === id);
  return PLACES[(i + by + PLACES.length) % PLACES.length]!.id;
}
