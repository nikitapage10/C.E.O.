/**
 * The print farm's facts (#827), with no three.js: the bays on the bench, the check piece on the turntable, and the
 * pre-print check that measures it against the plate. The scene (farmScene.ts) draws from these and the page
 * (Workshop.tsx) words them. Nothing here is made up: the farm has one printer, not yet on the LAN, and nothing is
 * printing; the turntable checks the Workshop's own test piece until Meshy hands over a real design.
 */

/** The printer's build volume in mm, the usual Bambu Lab size, until the printer reports its own over the LAN. */
export const PLATE_MM = { x: 256, y: 256, z: 256 } as const;

/** The steepest overhang (degrees from vertical) that prints clean without supports. */
export const OVERHANG_LIMIT = 45;

export type BayState = "waiting" | "open";

export interface Bay {
  /** "1". */
  n: number;
  /** What stands in it. */
  name: string;
  state: BayState;
  /** Its one-line state, as the tag and the chamber say it. */
  line: string;
  /** Inside its chamber. */
  inside: string;
}

/** The bench: the one real printer, then the open bays the farm keeps for more. */
export const BAYS: readonly Bay[] = [
  {
    n: 1,
    name: "The Bambu Lab printer",
    state: "waiting",
    line: "Waits on its serial and LAN code",
    inside: "Nothing is printing. Once the hub on the Mac reaches it over the LAN, the job, its layers and the chamber camera show here.",
  },
  { n: 2, name: "Open bay", state: "open", line: "Room for a second printer", inside: "An open bay: nothing stands here yet. A second printer would take this place on the bench." },
  { n: 3, name: "Open bay", state: "open", line: "Room for a third", inside: "An open bay, kept for the farm to grow into." },
  { n: 4, name: "Open bay", state: "open", line: "Room for a fourth", inside: "An open bay, kept for the farm to grow into." },
];

/** Where the camera is: over the farm, at the turntable, or inside a bay's chamber. */
export type FarmView = { k: "farm" } | { k: "table" } | { k: "bay"; n: number };

export const viewKey = (v: FarmView) => (v.k === "bay" ? `bay-${v.n}` : v.k);

/** A turned piece's profile: [radius, height] in mm, bottom to top, starting and ending on the axis or the base. */
export type Profile = readonly (readonly [number, number])[];

/**
 * The check piece: a 40 mm pawn, turned from one profile (the scene lathes it). Drawn so it prints without
 * supports: the collar flares at 45 degrees and the head starts where its curve is no steeper than that.
 */
export const PAWN: Profile = (() => {
  const p: [number, number][] = [
    [0, 0],
    [14, 0],
    [14, 3],
    [12.5, 4.5],
    [12.5, 6],
    [10, 8],
    [7, 12],
    [5.5, 18],
    [5, 22],
    [8, 25],
    [8, 26],
    [5, 27.5],
  ];
  // The head: a 6.5 mm ball from 45 degrees below its middle to the top.
  const R = 6.5, cy = 33.1;
  for (let k = 0; k <= 9; k++) {
    const a = (-45 + k * 15) * (Math.PI / 180);
    p.push([+(R * Math.cos(a)).toFixed(3), +(cy + R * Math.sin(a)).toFixed(3)]);
  }
  p[p.length - 1] = [0, +(cy + R).toFixed(3)];
  return p;
})();

export interface Check {
  id: "plate" | "height" | "base" | "supports";
  label: string;
  ok: boolean;
  /** The measurement, in a few words. */
  detail: string;
}

export interface Measure {
  /** Footprint across, mm. */
  w: number;
  /** Height, mm. */
  h: number;
  /** The flat base's radius, mm. */
  base: number;
  /** The steepest overhang going up, degrees from vertical. */
  overhang: number;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** A profile's measurements: the widest radius, the top, the flat base, and its steepest outward step going up. */
export function measure(p: Profile): Measure {
  let r = 0, h = 0, over = 0;
  for (const [x, y] of p) {
    r = Math.max(r, x);
    h = Math.max(h, y);
  }
  // The base: the outermost point on the floor.
  const base = p.filter(([, y]) => y === 0).reduce((m, [x]) => Math.max(m, x), 0);
  for (let i = 1; i < p.length; i++) {
    const [r0, y0] = p[i - 1]!, [r1, y1] = p[i]!;
    const dr = r1 - r0, dy = y1 - y0;
    // Only a step that goes up and out hangs over air.
    if (dy > 0 && dr > 0) over = Math.max(over, (Math.atan2(dr, dy) * 180) / Math.PI);
    // Flat and outward, above the floor: a shelf.
    if (dy === 0 && dr > 0 && y0 > 0) over = 90;
  }
  return { w: r * 2, h, base, overhang: over };
}

/** The pre-print check: does it fit the plate, clear the ceiling, stand on its base, and print without supports? */
export function preflight(p: Profile, plate: { x: number; y: number; z: number } = PLATE_MM): Check[] {
  const m = measure(p);
  const share = m.w > 0 ? (m.base * m.base) / ((m.w / 2) * (m.w / 2)) : 0;
  return [
    { id: "plate", label: "Fits the plate", ok: m.w <= Math.min(plate.x, plate.y), detail: `${fmt(m.w)} × ${fmt(m.w)} mm of ${plate.x} × ${plate.y}` },
    { id: "height", label: "Clears the ceiling", ok: m.h <= plate.z, detail: `${fmt(m.h)} mm of ${plate.z}` },
    { id: "base", label: "Stands on its base", ok: m.base > 0 && share >= 0.25, detail: m.base <= 0 ? "no flat foot" : share >= 0.999 ? `a ${fmt(m.base * 2)} mm foot, as wide as the piece` : `a ${fmt(m.base * 2)} mm foot, ${Math.round(share * 100)}% of its width` },
    { id: "supports", label: "Prints without supports", ok: m.overhang <= OVERHANG_LIMIT + 0.01, detail: `steepest overhang ${Math.round(m.overhang)}°, limit ${OVERHANG_LIMIT}°` },
  ];
}
