import type { PetMode } from "../../pets/types.ts";
import { centreOf, roomAt, type HavenPlan, type Seg } from "./data.ts";
import { KIND_STYLE } from "./style.ts";

/*
 * Myshka in the Haven's house (#729): where he goes and what he does there, without three.js (house.ts draws him,
 * myshkaHouse.ts poses him). He walks the plan's floor on a coarse grid that keeps clear of the walls and goes
 * through the doors, never into the Gym out back, and around the furniture and the pets' devices, never through
 * them (#747). A feed sends him to the feeders, a Litter-Robot cycle to the
 * litter corner to watch, and the rest of the time he wanders, sits, washes, and loafs a long while in the Living
 * room or the Studio. Under reduced motion he loafs and stays put.
 */

/** Plan units a cell; the grid gets coarser on a big plan so it never passes MAX_CELLS. */
export const CELL = 10;
const MAX_CELLS = 20_000;
/** How far from a wall his path keeps, in plan units. */
export const CLEAR = 14;
/** Walking pace, plan units a second. */
export const PACE = 32;
/** A feed counts this long after it happens. */
export const FED_MS = 20 * 60_000;
/** Rooms he loafs in. */
export const LOAF_ROOMS = /\b(living|studio|study)\b/i;
/** How far round the furniture and the devices his path keeps, in plan units (at least half a cell, see navGrid). */
export const MARGIN = 8;

/** [x0, y0, x1, y1] in plan units. */
export type Box = [number, number, number, number];

/** How big a device stands on the floor, half its width: the feeders and the fountain, the Litter-Robot. */
const DEVICE_HALF: Partial<Record<string, number>> = { "dry-feeder": 14, "wet-feeder": 14, fountain: 12, litter: 26 };

/**
 * What he can't walk through (#747): every piece of furniture standing on the floor (not a rug or a mat, not what
 * hangs on a wall or stands on a counter, not a pet bed he lies on) and the pets' devices, as boxes.
 */
export function footprints(plan: HavenPlan): Box[] {
  const out: Box[] = [];
  for (const it of plan.items) {
    const st = KIND_STYLE[it.k];
    if (st.height <= 2 || st.lift >= 20 || it.k === "petbed") continue;
    out.push(it.round ? [it.x - it.w / 2, it.y - it.w / 2, it.x + it.w / 2, it.y + it.w / 2] : [it.x, it.y, it.x + it.w, it.y + it.h]);
  }
  for (const d of plan.devices) {
    const h = DEVICE_HALF[d.kind];
    if (h && d.lift < 20) out.push([d.x - h, d.y - h, d.x + h, d.y + h]);
  }
  return out;
}

/** Whether a point is inside a box grown by `m` on every side. */
export const inBox = (x: number, y: number, b: Box, m = 0) => x > b[0] - m && x < b[2] + m && y > b[1] - m && y < b[3] + m;

export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  open: Uint8Array;
}

type Pt = [number, number];

const segDist = (x: number, y: number, s: Seg) => {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};

/**
 * The floor he can walk: cells inside the home's rooms (not a detached block), clear of every wall, and clear of the
 * furniture and the devices by a margin of at least half a cell, so no point of an open cell (and so of any leg he
 * walks, see `clear`) is ever inside one.
 */
export function navGrid(plan: HavenPlan, walls: Seg[]): NavGrid {
  let cell = CELL;
  while (Math.ceil(plan.w / cell) * Math.ceil(plan.h / cell) > MAX_CELLS) cell *= 1.5;
  const cols = Math.ceil(plan.w / cell), rows = Math.ceil(plan.h / cell);
  const open = new Uint8Array(cols * rows);
  const boxes = footprints(plan), m = Math.max(MARGIN, cell / 2 + 1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cell, y = (r + 0.5) * cell;
      const room = roomAt(plan, x, y);
      if (!room || room.detached) continue;
      if (boxes.some((b) => inBox(x, y, b, m))) continue;
      if (walls.every((s) => segDist(x, y, s) > CLEAR)) open[r * cols + c] = 1;
    }
  return { cell, cols, rows, open };
}

const at = (g: NavGrid, i: number): Pt => [((i % g.cols) + 0.5) * g.cell, (Math.floor(i / g.cols) + 0.5) * g.cell];

/** The open cell nearest a point (a feeder stands against a wall; he stops in front of it), or -1. */
export function nearestOpen(g: NavGrid, x: number, y: number, reach = 8): number {
  const c0 = Math.floor(x / g.cell), r0 = Math.floor(y / g.cell);
  let best = -1, bestD = Infinity;
  for (let r = r0 - reach; r <= r0 + reach; r++)
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols || !g.open[r * g.cols + c]) continue;
      const [px, py] = at(g, r * g.cols + c);
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = r * g.cols + c;
      }
    }
  return best;
}

/** Whether the straight line between two points stays on open floor. */
function clear(g: NavGrid, a: Pt, b: Pt): boolean {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g.cell / 3));
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / Math.max(1, n), y = a[1] + ((b[1] - a[1]) * i) / Math.max(1, n);
    const c = Math.floor(x / g.cell), r = Math.floor(y / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.open[r * g.cols + c]) return false;
  }
  return true;
}

/** The way from one point to another over open floor, as few straight legs as see each other; null when none. */
export function pathOn(g: NavGrid, from: Pt, to: Pt): Pt[] | null {
  const s = nearestOpen(g, from[0], from[1]), e = nearestOpen(g, to[0], to[1]);
  if (s < 0 || e < 0) return null;
  const prev = new Int32Array(g.open.length).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let h = 0; h < q.length && prev[e]! < 0; h++) {
    const i = q[h]!, c = i % g.cols, r = Math.floor(i / g.cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (!g.open[j] || prev[j]! >= 0) continue;
      // No cutting a corner past a wall.
      if (dc && dr && (!g.open[r * g.cols + nc] || !g.open[nr * g.cols + c])) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[e]! < 0) return null;
  const cells: Pt[] = [];
  for (let i = e; ; i = prev[i]!) {
    cells.push(at(g, i));
    if (i === s) break;
  }
  cells.reverse();
  // String-pull: from each kept point, go as far along as the floor stays in sight.
  const out: Pt[] = [cells[0]!];
  let k = 0;
  while (k < cells.length - 1) {
    let j = cells.length - 1;
    while (j > k + 1 && !clear(g, cells[k]!, cells[j]!)) j--;
    out.push(cells[j]!);
    k = j;
  }
  return out;
}

export interface CatSpots {
  /** In front of each feeder. */
  feeders: Pt[];
  /** A step back from the litter box, where he watches it. */
  litter: Pt | null;
  /** Where he loafs: by a pet bed or a cat tree anywhere, or a sofa in the Living room or the Studio; else those rooms' middles. */
  loaf: Pt[];
  /** Anywhere he can stand, for a wander. */
  floor: number[];
}

export function spotsOf(plan: HavenPlan, g: NavGrid): CatSpots {
  const snap = (x: number, y: number): Pt | null => {
    const i = nearestOpen(g, x, y);
    return i < 0 ? null : at(g, i);
  };
  const dev = (k: string) => plan.devices.filter((d) => d.kind === k).map((d) => snap(d.x, d.y)).filter((p): p is Pt => p !== null);
  const feeders = [...dev("dry-feeder"), ...dev("wet-feeder")];
  const box = plan.devices.find((d) => d.kind === "litter");
  let litter: Pt | null = null;
  if (box) {
    // Back off toward the room's middle, so he sits and watches rather than climbing in.
    const room = roomAt(plan, box.x, box.y);
    const [cx, cy] = room ? centreOf(room) : [box.x, box.y];
    const d = Math.hypot(cx - box.x, cy - box.y) || 1;
    litter = snap(box.x + ((cx - box.x) / d) * 45, box.y + ((cy - box.y) / d) * 45);
  }
  const rooms = plan.rooms.filter((r) => !r.detached && LOAF_ROOMS.test(r.name));
  const home = (x: number, y: number) => {
    const r = roomAt(plan, x, y);
    return r && !r.detached ? r : null;
  };
  const mid = (i: (typeof plan.items)[number]): Pt => (i.round ? [i.x, i.y] : [i.x + i.w / 2, i.y + i.h / 2]);
  // His loaf spots (#747): the cat beds and cat trees wherever they are, the sofas in the rooms he loafs in; he
  // settles on the free floor nearest each.
  const beds = plan.items.filter((i) => {
    const r = home(...mid(i));
    return r && (i.k === "petbed" || i.k === "cattree" || (i.k === "sofa" && rooms.some((x) => x.id === r.id)));
  });
  let loaf = beds.map((i) => snap(...mid(i))).filter((p): p is Pt => p !== null);
  if (!loaf.length) loaf = rooms.map((r) => snap(...centreOf(r))).filter((p): p is Pt => p !== null);
  const floor: number[] = [];
  for (let i = 0; i < g.open.length; i++) if (g.open[i]) floor.push(i);
  if (!loaf.length && floor.length) loaf = [at(g, floor[Math.floor(floor.length / 2)]!)];
  return { feeders, litter, loaf, floor };
}

export interface CatSignals {
  /** When the cats were last fed (ms), from the dry feeder's last meal or the wet feeder opening. */
  fedAt: number | null;
  /** The Litter-Robot is cycling now. */
  litterCycling: boolean;
}

export interface CatPose {
  x: number;
  y: number;
  /** Facing, radians: 0 along +y in the plan, turning toward +x. */
  heading: number;
  mode: PetMode;
  /** Plan units a second. */
  speed: number;
}

/** What he is doing: `stay` is how long he stays once there, `until` when that ends (Infinity while walking). */
type Task = { why: "eat" | "litter" | "loaf" | "wander" | "rest"; mode: PetMode; stay: number; until: number };

/** What he does next, and where; one per house. */
export class CatBrain {
  private x: number;
  private y: number;
  private heading = 0;
  private path: Pt[] = [];
  private task: Task;
  private speed = 0;
  private signals: CatSignals = { fedAt: null, litterCycling: false };
  /** The feed he has already been to, and whether he has watched this cycle. */
  private ateFor: number | null = null;
  private watched = false;
  readonly spots: CatSpots;

  constructor(
    private g: NavGrid,
    plan: HavenPlan,
    private reduce: boolean,
    private rnd: () => number = Math.random,
  ) {
    this.spots = spotsOf(plan, g);
    const start = this.spots.loaf[0] ?? [plan.w / 2, plan.h / 2];
    [this.x, this.y] = start;
    this.heading = this.rnd() * Math.PI * 2;
    // He starts in his loaf; its clock starts on the first frame.
    this.task = { why: "loaf", mode: "nap", stay: 20_000 + this.rnd() * 30_000, until: reduce ? Infinity : NaN };
  }

  setSignals(s: CatSignals) {
    if (!s.litterCycling) this.watched = false;
    this.signals = s;
  }

  /** Called every frame with the page clock (ms) and the frame's seconds. */
  update(now: number, dt: number): CatPose {
    if (this.reduce) return { x: this.x, y: this.y, heading: this.heading, mode: "nap", speed: 0 };
    if (Number.isNaN(this.task.until)) this.task.until = now + this.task.stay;
    const urge = this.urge(now);
    if (urge) this.go(urge.to, urge.why, urge.mode, urge.stay, now);
    else if (!this.path.length && now > this.task.until) this.next(now);

    if (this.path.length) {
      const [tx, ty] = this.path[0]!;
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      const step = PACE * dt;
      if (d <= step) {
        this.x = tx;
        this.y = ty;
        this.path.shift();
        // Arrived: the stay starts now.
        if (!this.path.length) this.task.until = now + this.task.stay;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
      }
      const want = Math.atan2(dx, dy);
      let turn = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      turn = Math.max(-dt * 4, Math.min(dt * 4, turn));
      this.heading += turn;
      this.speed = PACE;
    } else this.speed = 0;
    return { x: this.x, y: this.y, heading: this.heading, mode: this.path.length ? "walk" : this.task.mode, speed: this.speed };
  }

  /** A feed, or a cycle he hasn't watched yet, comes before anything else. */
  private urge(now: number): { why: Task["why"]; to: Pt; mode: PetMode; stay: number } | null {
    const fed = this.signals.fedAt;
    if (fed !== null && now - fed < FED_MS && fed !== this.ateFor && this.spots.feeders.length) {
      const to = this.spots.feeders[Math.floor(this.rnd() * this.spots.feeders.length)]!;
      this.ateFor = fed;
      return { why: "eat", to, mode: "sit", stay: 25_000 };
    }
    if (this.signals.litterCycling && !this.watched && this.spots.litter) {
      this.watched = true;
      return { why: "litter", to: this.spots.litter, mode: "sit", stay: 20_000 };
    }
    return null;
  }

  private stayOf(why: Task["why"]) {
    const r = this.rnd();
    return why === "loaf" ? 40_000 + r * 50_000 : why === "eat" ? 25_000 : why === "litter" ? 20_000 : 5_000 + r * 9_000;
  }

  private next(now: number) {
    const r = this.rnd();
    if (r < 0.3 && this.spots.loaf.length) {
      const to = this.spots.loaf[Math.floor(this.rnd() * this.spots.loaf.length)]!;
      return this.go(to, "loaf", "nap", 0, now);
    }
    if (r < 0.8 && this.spots.floor.length) {
      const i = this.spots.floor[Math.floor(this.rnd() * this.spots.floor.length)]!;
      return this.go(at(this.g, i), "wander", this.rnd() < 0.5 ? "idle" : "groom", 0, now);
    }
    this.task = { why: "rest", mode: this.rnd() < 0.5 ? "sit" : "groom", stay: 0, until: now + this.stayOf("rest") };
  }

  private go(to: Pt, why: Task["why"], mode: PetMode, stay: number, now: number) {
    const p = pathOn(this.g, [this.x, this.y], to);
    this.path = p ? p.slice(1) : [];
    const s = stay || this.stayOf(why);
    this.task = { why, mode, stay: s, until: this.path.length ? Infinity : now + s };
    // Nowhere to go from here (a plan with no way through): stay put a while instead.
    if (!p) this.task = { why: "rest", mode: "sit", stay: 0, until: now + 8_000 };
  }
}
