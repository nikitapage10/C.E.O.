import type { StationState } from "./pipes.ts";
import type { RoomPipe, RoomSection, V2 } from "./rooms.ts";
import { cardOf, schemGrid, type SchemModel, type SchemNode } from "./schematic.ts";

/**
 * One room's own 3D pipe run on the Boiler Room's Map (#789; Nikita, 2026-11-05 04:27Z: "each individual room's view
 * should be its own animated 3D scene like All rooms… long runs wind"). The room's schematic (boiler/schematic.ts: its
 * parts in the order the data flows, every connection between them) laid on the floor for pipeScene.ts: each part a
 * station, each connection a pipe that runs at right angles through the clear lanes between them. A run too long for
 * the view winds back on itself in bands, a serpentine (left to right, down, right to left), the number of columns a
 * band holds chosen so the whole room fits the map's shape. World units on the floor (x across, z down), centred on
 * the origin. Pure, so the tests read the same numbers the scene draws.
 */

export interface WindNode {
  /** Unique in the room, for its state: `n:<part>`. */
  key: string;
  /** What a hover or pick opens: the pipe's id, or a card of its own (cards). */
  target: string;
  name: string;
  sub: string;
  kind: SchemNode["kind"];
  state: StationState;
  at: V2;
  /** The room itself, the part its pipes hang off. */
  hub: boolean;
}

export interface WindLink {
  /** `l:<a>><b>`. */
  key: string;
  target: string;
  a: string;
  b: string;
  label: string;
  state: StationState;
  planned: boolean;
  /** The run on the floor, corner to corner. */
  path: V2[];
  /** Halfway along it, where a crack or a valve sits. */
  mid: V2;
}

export interface RoomWind {
  room: string;
  nodes: WindNode[];
  links: WindLink[];
  /** Columns in a band, and how many bands the run winds through. */
  per: number;
  bands: number;
  box: [number, number, number, number];
  /** Cards for the parts and links that have no pipe of their own. */
  cards: RoomPipe[];
}

/** Column and row pitch, and the gap between bands where the run turns. */
export const CX = 3.6;
export const RZ = 2.2;
export const GAP = 2.4;
/** The tallest a column stands before it wraps into the next. */
const WRAP = 4;

/** How many columns a band holds, for a room `cols` long and `rows` tall, so it best fills a view of this shape. */
export function bandWidth(cols: number, rows: number, aspect: number): number {
  const bandH = rows * RZ + GAP;
  let best = cols;
  let score = Infinity;
  for (let p = Math.min(cols, 2); p <= cols; p++) {
    const bands = Math.ceil(cols / p);
    const w = p * CX;
    const h = bands * bandH - GAP + RZ;
    const s = Math.abs(Math.log(w / h / aspect));
    if (s < score - 1e-9) {
      score = s;
      best = p;
    }
  }
  return Math.max(1, best);
}

/** Drop repeated and in-line corners. */
function tidy(pts: V2[]): V2[] {
  const out: V2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    const o = out[out.length - 2];
    if (o && q && ((Math.abs(o[0] - q[0]) < 1e-6 && Math.abs(q[0] - p[0]) < 1e-6) || (Math.abs(o[1] - q[1]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** The point halfway along a run. */
export function midOf(path: V2[]): V2 {
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i]! || i === seg.length - 1) {
      const t = seg[i]! ? Math.min(1, half / seg[i]!) : 0;
      const a = path[i]!;
      const b = path[i + 1]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    half -= seg[i]!;
  }
  return path[0] ?? [0, 0];
}

export function windRoom(section: RoomSection, model: SchemModel, aspect = 1.6): RoomWind {
  const { graph, colOf, rowOf, maxCol, maxRow } = schemGrid(section, model, WRAP);
  const cols = maxCol + 1;
  const rows = maxRow + 1;
  const per = bandWidth(cols, rows, aspect);
  const bands = Math.ceil(cols / per);
  const bandH = rows * RZ + GAP;
  const band = (id: string) => Math.floor(colOf.get(id)! / per);
  const dir = (b: number) => (b % 2 ? -1 : 1);
  const xOf = (id: string) => {
    const c = colOf.get(id)!;
    const b = Math.floor(c / per);
    const i = c % per;
    return (b % 2 ? per - 1 - i : i) * CX;
  };
  const zOf = (id: string) => band(id) * bandH + rowOf.get(id)! * RZ;
  // The lane under band b, where a run turns into the next; and the lanes past either end of the bands.
  const under = (b: number) => b * bandH + (rows - 1) * RZ + GAP / 2 + RZ / 2;
  const right = (per - 1) * CX + CX * 0.75;

  const hub = graph.nodes.some((n) => n.id === section.id) ? section.id : (graph.nodes[0]?.id ?? section.id);
  const at = new Map(graph.nodes.map((n) => [n.id, [xOf(n.id), zOf(n.id)] as V2]));
  const kindOf = new Map(section.pipes.map((p) => [p.id, p.kind]));
  const links: WindLink[] = graph.links.map((l, i) => {
    const [xa, za] = at.get(l.a)!;
    const [xb, zb] = at.get(l.b)!;
    const ba = band(l.a);
    const bb = band(l.b);
    // Runs sharing a lane sit a little apart.
    const off = ((i % 5) - 2) * 0.14;
    const pa = xa + (dir(ba) * CX) / 2 + off * 0.5;
    const pb = xb - (dir(bb) * CX) / 2 + off * 0.5;
    const ca = colOf.get(l.a)!;
    const cb = colOf.get(l.b)!;
    let path: V2[];
    if (ba === bb && cb > ca) {
      if (cb - ca === 1) path = [[xa, za], [pa, za], [pa, zb], [xb, zb]];
      else {
        // Past the next column it runs in the clear lane between rows, beside the part it feeds, then turns in.
        const zc = zb + (za <= zb ? -RZ / 2 : RZ / 2) + off;
        path = [[xa, za], [pa, za], [pa, zc], [pb, zc], [pb, zb], [xb, zb]];
      }
    } else if (bb === ba + 1 || (bb === ba && cb <= ca)) {
      // Into the next band (the serpentine's turn), or back against the flow: round through the lane under the band.
      const h = under(ba) + off;
      path = [[xa, za], [pa, za], [pa, h], [pb, h], [pb, zb], [xb, zb]];
    } else {
      // Further: down the lane past the bands' far end.
      const h1 = under(ba) + off;
      const h2 = (bb > ba ? under(bb - 1) : bb > 0 ? under(bb - 1) : -RZ) + off;
      const xr = right + Math.abs(off);
      path = [[xa, za], [pa, za], [pa, h1], [xr, h1], [xr, h2], [pb, h2], [pb, zb], [xb, zb]];
    }
    path = tidy(path);
    return { key: `l:${l.id}`, target: l.pipe ?? `schem:${section.id}:${l.id}`, a: l.a, b: l.b, label: l.label, state: l.state, planned: !!l.pipe && kindOf.get(l.pipe) === "planned", path, mid: midOf(path) };
  });
  const nodes: WindNode[] = graph.nodes.map((n) => ({ key: `n:${n.id}`, target: n.pipe ?? `schem:${section.id}:${n.id}`, name: n.name, sub: n.sub, kind: n.kind, state: n.state, at: at.get(n.id)!, hub: n.id === hub }));

  // Centre it on the floor.
  const xs = [...nodes.map((n) => n.at[0]), ...links.flatMap((l) => l.path.map((p) => p[0]))];
  const zs = [...nodes.map((n) => n.at[1]), ...links.flatMap((l) => l.path.map((p) => p[1]))];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const mv = (p: V2): V2 => [p[0] - cx, p[1] - cz];
  for (const n of nodes) n.at = mv(n.at);
  for (const l of links) {
    l.path = l.path.map(mv);
    l.mid = mv(l.mid);
  }
  const box: [number, number, number, number] = [Math.min(...xs) - cx - 1.4, Math.min(...zs) - cz - 1.6, Math.max(...xs) - cx + 1.4, Math.max(...zs) - cz + 1.2];

  const cards: RoomPipe[] = [];
  for (const n of graph.nodes) if (!n.pipe) cards.push(cardOf({ node: n }, section, graph.nodes));
  for (const l of graph.links) if (!l.pipe) cards.push(cardOf({ link: l }, section, graph.nodes));
  return { room: section.id, nodes, links, per, bands, box, cards };
}
