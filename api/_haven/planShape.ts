/**
 * The Haven's floor plan, its shape (#616): what a plan is and how one read from anywhere is checked. No server
 * imports, so the Desk reads plans with the same code the endpoint does (api/_haven/plan.ts). Generic: the repo holds
 * only this shape; a home's own rooms, walls and furniture are data in the private store.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** The largest plan body taken (bytes). A home with a few hundred pieces of furniture is well under it. */
export const PLAN_BODY_MAX = 96 * 1024;
/** Plan units: about a centimetre each; the whole drawing fits in this square. */
export const PLAN_MAX = 5000;

export const FLOORS = ["wood", "tile", "rubber", "stone", "carpet"] as const;
export type Floor = (typeof FLOORS)[number];
/** The Haven's content tabs a room can open. */
export const TABS = ["kitchen", "hall", "pets", "gym"] as const;
export type Tab = (typeof TABS)[number];
/** Where a device stands. `thermostat` is the climate's wall unit; `lights` names the room its climate lights. */
export const SPOTS = ["vacuum", "dry-feeder", "wet-feeder", "fountain", "litter", "thermostat"] as const;
export type Spot = (typeof SPOTS)[number];
/**
 * The furniture the renderer knows how to draw (rooms/haven/web/style.ts). Generic pieces only; anything
 * else becomes a plain `box`.
 */
export const KINDS = [
  "box", "counter", "upper", "range", "sink", "fridge", "island", "stool", "cabinet", "shelf", "jar",
  "mat", "rug", "runner", "plant", "purifier", "petbed", "tunnel", "table", "chair", "armchair",
  "console", "tv", "sofa", "ctable", "lamp", "cattree", "minifridge", "vanity", "wc", "tub", "shower",
  "desk", "monitor", "tower", "speaker", "ochair", "dj", "loveseat", "printer", "bed", "night", "dresser", "rail",
  "rack", "barbell", "bench", "dbrack", "kettle", "treadmill", "bike", "gmat", "mirror",
  // #747: a sideboard with an espresso machine on it, a tub chair, a small plant greenhouse, a coat rack, a plain litter
  // box, a towel bar, raised double bowls and a ceiling projector.
  "sideboard", "espresso", "tubchair", "greenhouse", "coatrack", "litterbox", "towelbar", "bowls", "projector",
  // #764: wall art, a run of tall canvases side by side making one picture.
  "art",
] as const;
export type Kind = (typeof KINDS)[number];

/** [x, y, width, depth] in plan units, from the top left. */
export type Rect = [number, number, number, number];
/** [x1, y1, x2, y2]: a straight run along a wall (doors, windows and balcony doors). */
export type Seg = [number, number, number, number];

export interface PlanRoom {
  id: string;
  name: string;
  parts: Rect[];
  floor: Floor;
  /** The content tab tapping it opens, or null for the room's own sheet. */
  tab: Tab | null;
  /** Its name on the vacuum's map, when the vacuum knows it (so the room's sheet can send the vacuum there). */
  vacuum: string | null;
  /** A block apart from the home (the building's gym), joined by `path`. */
  detached: boolean;
}

export interface PlanItem {
  k: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A round piece: (x, y) is its centre and w its diameter. */
  round: boolean;
}

export interface PlanDevice {
  kind: Spot;
  x: number;
  y: number;
  /** How high it hangs, in plan units (a thermostat on the wall). */
  lift: number;
  /** The room its activity lights, when it isn't the room it stands in (the climate lights the living room). */
  lights: string | null;
}

export interface HavenPlan {
  v: 1;
  w: number;
  h: number;
  rooms: PlanRoom[];
  doors: Seg[];
  /** Windows, wall by wall: only where a wall really has them; a wall with none is solid (#747). */
  windows: Seg[];
  /** Glass doors out to a balcony, each on an outside wall (#747): drawn as a glass door with the balcony beyond. */
  balconies: Seg[];
  /** The wall a room's TV hangs on (#747), as a run along it; the living room is laid out facing it. */
  tv: Seg[];
  /** True once the openings were set in the wall editor: then windows, balcony doors and TV above are exactly what is drawn. */
  openings?: true;
  items: PlanItem[];
  devices: PlanDevice[];
  /** The walk from the front door to a detached block, as points. */
  path: [number, number][];
}

const LIMITS = { rooms: 24, parts: 6, doors: 80, windows: 80, balconies: 12, tv: 4, items: 400, devices: 16, path: 24 } as const;

const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const n = (v: unknown, lo = 0, hi = PLAN_MAX): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)) : null);
const ID = /^[a-z][a-z0-9-]{0,23}$/;
/** A room's name: plain words, no markup, at most 32 characters. */
const name = (v: unknown): string => (typeof v === "string" ? v.replace(/[<>&"'`\\{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 32) : "");
const pick = <T extends string>(v: unknown, set: readonly T[], fallback: T): T => (set.includes(v as T) ? (v as T) : fallback);

function rect(v: unknown): Rect | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [x, y, w, h] = v.map((x) => n(x));
  return x === null || y === null || w === null || h === null || w! < 1 || h! < 1 ? null : [x!, y!, w!, h!];
}

function seg(v: unknown): Seg | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [a, b, c, d] = v.map((x) => n(x));
  if (a === null || b === null || c === null || d === null) return null;
  // Along a wall: horizontal or vertical only.
  return a === c || b === d ? [a!, b!, c!, d!] : null;
}

/** A plan read from anywhere (a paste, the store), checked and cleaned; null when it isn't one. */
export function readPlan(v: unknown): HavenPlan | null {
  const b = o(v);
  if (b.v !== 1) return null;
  const w = n(b.w, 100), h = n(b.h, 100);
  if (w === null || h === null) return null;
  const seen = new Set<string>();
  const rooms: PlanRoom[] = [];
  for (const r of arr(b.rooms, LIMITS.rooms).map(o)) {
    if (typeof r.id !== "string" || !ID.test(r.id) || seen.has(r.id)) continue;
    const parts = arr(r.parts, LIMITS.parts).map(rect).filter((p): p is Rect => p !== null);
    if (!parts.length) continue;
    seen.add(r.id);
    rooms.push({
      id: r.id,
      name: name(r.name) || r.id,
      parts,
      floor: pick(r.floor, FLOORS, "wood"),
      tab: TABS.includes(r.tab as Tab) ? (r.tab as Tab) : null,
      vacuum: typeof r.vacuum === "string" && name(r.vacuum) ? name(r.vacuum) : null,
      detached: r.detached === true,
    });
  }
  if (!rooms.length) return null;
  const items: PlanItem[] = [];
  for (const it of arr(b.items, LIMITS.items).map(o)) {
    const x = n(it.x), y = n(it.y), iw = n(it.w, 1, 2000), ih = n(it.h ?? it.w, 1, 2000);
    if (x === null || y === null || iw === null || ih === null) continue;
    items.push({ k: pick(it.k, KINDS, "box"), x, y, w: iw, h: ih, round: it.round === true });
  }
  const devices: PlanDevice[] = [];
  for (const d of arr(b.devices, LIMITS.devices).map(o)) {
    const x = n(d.x), y = n(d.y);
    if (x === null || y === null || !SPOTS.includes(d.kind as Spot)) continue;
    devices.push({ kind: d.kind as Spot, x, y, lift: n(d.lift, 0, 300) ?? 0, lights: typeof d.lights === "string" && seen.has(d.lights) ? d.lights : null });
  }
  const path: [number, number][] = [];
  for (const p of arr(b.path, LIMITS.path)) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const x = n(p[0]), y = n(p[1]);
    if (x !== null && y !== null) path.push([x, y]);
  }
  return {
    v: 1,
    w,
    h,
    rooms,
    doors: arr(b.doors, LIMITS.doors).map(seg).filter((s): s is Seg => s !== null),
    windows: arr(b.windows, LIMITS.windows).map(seg).filter((s): s is Seg => s !== null),
    balconies: arr(b.balconies, LIMITS.balconies).map(seg).filter((s): s is Seg => s !== null),
    tv: arr(b.tv, LIMITS.tv).map(seg).filter((s): s is Seg => s !== null),
    ...(b.openings === true ? { openings: true as const } : {}),
    items,
    devices,
    path,
  };
}

