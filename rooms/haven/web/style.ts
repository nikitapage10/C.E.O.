import type { Floor, Kind } from "./data.ts";

/**
 * How the Haven's house is dressed (#616): the night-interior materials of Nikita's round-6 pick (white walls seen as
 * frosted glass, black furniture, grey wood, warm lamp pools, green LEDs), one entry per generic furniture kind. The
 * plan only says what stands where; how each kind looks lives here.
 *
 *   lift, height   plan units off the floor and tall (about centimetres)
 *   colour         base colour; rough and metal as in MeshStandardMaterial
 *   glow           an emissive colour and its strength (screens, LEDs, lamps)
 */
export interface KindStyle {
  lift: number;
  height: number;
  colour: number;
  rough: number;
  metal?: number;
  glow?: [number, number];
}

const S = (lift: number, height: number, colour: number, rough: number, metal = 0, glow?: [number, number]): KindStyle => ({ lift, height, colour, rough, metal, glow });

export const KIND_STYLE: Record<Kind, KindStyle> = {
  box: S(0, 30, 0x18181b, 0.7),
  counter: S(0, 36, 0x111113, 0.45),
  upper: S(64, 40, 0x111113, 0.6),
  range: S(36, 2, 0x2a2b2e, 0.4, 0.5),
  sink: S(36, 1, 0x9aa0a6, 0.3, 0.8),
  fridge: S(0, 96, 0xa3a8ad, 0.3, 0.7),
  island: S(0, 36, 0xf0efeb, 0.35, 0, [0x39ff7a, 0.18]),
  stool: S(0, 26, 0x141416, 0.5),
  cabinet: S(0, 42, 0x121214, 0.5),
  shelf: S(0, 60, 0x1a1a1c, 0.6),
  jar: S(60, 16, 0xd9c79a, 0.4),
  mat: S(0, 1, 0x202024, 1),
  rug: S(0, 1, 0x5b4d48, 1),
  runner: S(0, 1, 0x4c4a48, 1),
  plant: S(0, 74, 0xcfe9d0, 0.2, 0, [0x6fdc88, 0.55]),
  purifier: S(0, 30, 0xf2f2f0, 0.5),
  petbed: S(0, 8, 0xf4f1ea, 1),
  tunnel: S(0, 14, 0x2b2b30, 0.9),
  table: S(0, 30, 0x0c0c0e, 0.08, 0.3),
  chair: S(0, 36, 0x161618, 0.6),
  armchair: S(0, 28, 0x161618, 0.9),
  console: S(0, 18, 0x111113, 0.5),
  tv: S(38, 32, 0x08090c, 0.2, 0, [0x0c1a2e, 0.6]),
  sofa: S(0, 28, 0x18181b, 0.95),
  ctable: S(0, 16, 0x121214, 0.45),
  lamp: S(0, 84, 0x222224, 0.4, 0.6, [0xffd29a, 0.5]),
  cattree: S(0, 90, 0x1b1b1e, 1),
  minifridge: S(0, 30, 0x1a1c22, 0.4, 0, [0x2a6cff, 0.7]),
  vanity: S(0, 34, 0x131315, 0.5),
  wc: S(0, 16, 0xf1f1ef, 0.3),
  tub: S(0, 22, 0xf1f1ef, 0.25),
  shower: S(0, 80, 0xbfd6e2, 0.05),
  desk: S(0, 30, 0x151517, 0.5),
  monitor: S(30, 24, 0x0a0b10, 0.2, 0, [0x3a7bd5, 0.9]),
  tower: S(0, 42, 0x0f0f12, 0.4, 0, [0x55ff99, 0.25]),
  speaker: S(30, 26, 0x121214, 0.6),
  ochair: S(0, 40, 0x19191c, 0.7),
  dj: S(0, 34, 0x141416, 0.5, 0, [0x39ff7a, 0.45]),
  loveseat: S(0, 28, 0x141417, 0.95),
  printer: S(16, 30, 0xb9bcc0, 0.5, 0.3),
  bed: S(0, 22, 0x3a3b42, 1),
  night: S(0, 22, 0x121214, 0.6),
  dresser: S(0, 36, 0x16120f, 0.6),
  rail: S(0, 72, 0x2a2a2c, 0.5, 0.6),
  rack: S(0, 92, 0x1b1c20, 0.5, 0.6),
  barbell: S(52, 4, 0x9aa0a6, 0.3, 0.9),
  bench: S(0, 18, 0x1d1e22, 0.7),
  dbrack: S(0, 26, 0x1b1c20, 0.5, 0.6),
  kettle: S(0, 12, 0x2a2b2e, 0.5, 0.6),
  treadmill: S(0, 14, 0x141518, 0.6, 0, [0x3a7bd5, 0.3]),
  bike: S(0, 40, 0x141518, 0.6, 0.4),
  gmat: S(0, 1, 0x24262b, 1),
  mirror: S(0, 90, 0xb8c4dd, 0.05, 0.9),
  sideboard: S(0, 36, 0x0e0e10, 0.45),
  espresso: S(37, 40, 0xb9bcc0, 0.25, 0.85, [0xff7a3a, 0.25]),
  tubchair: S(0, 34, 0x111113, 0.85),
  greenhouse: S(0, 120, 0xdff2e4, 0.05, 0, [0x7dff9a, 0.35]),
  coatrack: S(0, 100, 0x111113, 0.5, 0.4),
  litterbox: S(0, 24, 0x8a8d92, 0.6),
  towelbar: S(70, 40, 0x111113, 0.9),
  bowls: S(0, 14, 0x111113, 0.4, 0.6),
  projector: S(104, 10, 0x1a1a1c, 0.4, 0, [0x9fd0ff, 0.4]),
  art: S(48, 80, 0xe8e8e6, 0.8), // top at 128, under the 140 cut-down wall (#892)
  coffeebar: S(0, 36, 0x111113, 0.45),
  cupshelf: S(62, 34, 0x0e0e10, 0.5),
  bin: S(0, 28, 0xb9bcc0, 0.3, 0.85),
  accent: S(0, 28, 0x2a2724, 0.9),
};

/** Floor finishes, drawn into the floor's texture. */
export const FLOOR_PAINT: Record<Floor, { base: string; grain: "planks" | "tiles" | "flat" | "weave" | "rubber" }> = {
  wood: { base: "#7d7975", grain: "planks" },
  tile: { base: "#b7b5b0", grain: "tiles" },
  rubber: { base: "#3a3d44", grain: "rubber" },
  stone: { base: "#5d5e62", grain: "tiles" },
  carpet: { base: "#4a4646", grain: "weave" },
};

/** The light a lit room glows with: lamplight; a room that needs Nikita leans to the accent's warm coral. */
export const LIGHT = { lamp: 0xffd6a0, needs: 0xff9a6a, cool: 0xa9c4ff, gym: 0xeef2ff } as const;
