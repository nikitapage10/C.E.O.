/**
 * The Workshop's flow (#989), with no three.js: Nikita has one printer, so the room is a line, not a farm. Four stages,
 * left to right: the design (an image made in ChatGPT), the mesh (the image turned into a 3D model by Meshy), the slicer
 * (the model made physically ready to print: oriented on the plate, supports if it needs them, cut into layers), and the
 * print, on the one Bambu Lab printer. The scene (flowScene.ts) draws from these and the page (Workshop.tsx) words them.
 * Nothing here is made up: no stage is connected yet, so the design and the mesh stand idle, the printer waits with its
 * plate empty, and the slicer holds the Workshop's own check piece until a real model comes through.
 */

/** The printer's build volume in mm, the usual Bambu Lab size, until the printer reports its own over the LAN. */
export const PLATE_MM = { x: 256, y: 256, z: 256 } as const;

/** The steepest overhang (degrees from vertical) that prints clean without supports. */
export const OVERHANG_LIMIT = 45;

/** The slicer's default layer height, mm (Bambu Studio's standard 0.20 mm profile). */
export const LAYER_MM = 0.2;

/**
 * Where a stage stands: idle (nothing has reached it), checking (holding the Workshop's own test piece), or waiting
 * (its machine is there but not yet connected). A live job would add "working"; nothing is, so nothing says so.
 */
export type StageState = "idle" | "check" | "waiting";

export interface Stage {
  /** 1 to 4, left to right. */
  n: 1 | 2 | 3 | 4;
  id: "design" | "mesh" | "slice" | "print";
  /** "Design". */
  name: string;
  /** What does the work at this stage. */
  tool: string;
  state: StageState;
  /** What stands there now, in a few words. */
  now: string;
  /** What it waits on, in a few words. */
  wait: string;
  /** What happens here, and what's here today. */
  inside: string;
}

export const STAGES: readonly Stage[] = [
  {
    n: 1,
    id: "design",
    name: "Design",
    tool: "An image, made in ChatGPT",
    state: "idle",
    now: "No design yet",
    wait: "Waits on OpenAI images",
    inside: "Every piece starts as a picture, designed in ChatGPT. The easel is blank: once the image model is wired in, the design for the next job shows here.",
  },
  {
    n: 2,
    id: "mesh",
    name: "Mesh",
    tool: "Image to 3D, meshed by Meshy",
    state: "idle",
    now: "No model yet",
    wait: "Waits on a Meshy key",
    inside: "The picture becomes a 3D model, its mesh formed by Meshy. The cage is empty until a Meshy key is in and a design comes through.",
  },
  {
    n: 3,
    id: "slice",
    name: "Slice",
    tool: "Bambu Studio or OrcaSlicer, on the Mac",
    state: "check",
    now: "The check piece, sliced",
    wait: "Sending waits on the hub",
    inside: "The model is made physically ready: stood on the plate, checked for supports, cut into layers. The Workshop's own test piece stands here until a real model comes through; every check is measured from its shape.",
  },
  {
    n: 4,
    id: "print",
    name: "Print",
    tool: "The Bambu Lab printer",
    state: "waiting",
    now: "Plate empty, head parked",
    wait: "Waits on its serial and LAN code",
    inside: "The one printer. Nothing is printing: once the hub on the Mac reaches it over the LAN, the job, its layers and the chamber camera show here. Nothing ever prints without your tap.",
  },
];

/** Where the camera is: over the whole flow, or at one stage. */
export type FlowView = { k: "flow" } | { k: "stage"; n: Stage["n"] };

export const viewKey = (v: FlowView) => (v.k === "stage" ? `stage-${v.n}` : v.k);

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

/** A profile's outer radius at a height, mm (0 above the top). Profiles run bottom to top. */
export function radiusAt(p: Profile, y: number): number {
  let r = 0;
  for (let i = 1; i < p.length; i++) {
    const [r0, y0] = p[i - 1]!, [r1, y1] = p[i]!;
    if (y1 === y0) {
      if (y === y0) r = Math.max(r, r0, r1);
      continue;
    }
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) r = Math.max(r, r0 + ((r1 - r0) * (y - y0)) / (y1 - y0));
  }
  return r;
}

export interface Sliced {
  /** How many layers at this height. */
  layers: number;
  layer: number;
  /** One radius per layer, mm, at the layer's middle: what the slicer's layer preview draws. */
  rings: number[];
}

/** Cut a turned piece into layers, the way the slicer does. */
export function slice(p: Profile, layer = LAYER_MM): Sliced {
  const h = measure(p).h;
  const layers = Math.ceil(h / layer - 1e-9);
  const rings = Array.from({ length: layers }, (_, i) => radiusAt(p, Math.min(h, (i + 0.5) * layer)));
  return { layers, layer, rings };
}
