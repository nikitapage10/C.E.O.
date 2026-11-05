import type { Flow, FlowId, GEdge, GKind, GNode, GState } from "../systemsGraph.ts";
import type { StationState } from "./pipes.ts";
import type { RoomPipe, RoomSection } from "./rooms.ts";

/**
 * One room's own schematic on the Boiler Room's Map (#751; Nikita, 2026-11-05: "each room should get its own
 * schematic, a real data-flow and architecture diagram"): every part the room's data passes through (its APIs and
 * outside services, the functions on Azure, storage, the schedules, the Desk, the hub on the MacBook) and every
 * connection between them with its live state, laid out left to right in the order the data flows. Nothing here is
 * drawn by hand: the parts and links are systemsGraph's (the room's whole flow and its connections), each one's state
 * the worse of the link's own and its pipe's (boiler/rooms.ts), and every pipe the room has that the graph doesn't
 * (a scheduled job, a planned connection) hangs off the room as its own link, so nothing on the pipe map goes missing.
 */

export interface SchemNode {
  id: string;
  name: string;
  sub: string;
  kind: GKind | "job" | "planned";
  state: StationState;
  /** The pipe that tells everything about it (its card), when the room has one. */
  pipe: string | null;
  rank: number;
  row: number;
  x: number;
  y: number;
}

export interface SchemLink {
  id: string;
  a: string;
  b: string;
  label: string;
  state: StationState;
  pipe: string | null;
  how: string | null;
  auth: string | null;
  when: string | null;
  kinds: string[];
  /** Runs against the flow (back to an earlier column), drawn round the bottom. */
  back: boolean;
  d: string;
  mid: [number, number];
}

export interface Schematic {
  room: string;
  nodes: SchemNode[];
  links: SchemLink[];
  w: number;
  h: number;
  dir: "lr" | "tb";
}

export const NODE_W = 172;
export const NODE_H = 54;
const PAD = 28;

const FROM_G: Record<GState, StationState> = { ok: "ok", run: "ok", wait: "dry", bad: "leak" };
const WORST: StationState[] = ["leak", "shut", "late", "dry", "ok"];
const worse = (a: StationState, b: StationState): StationState => (WORST.indexOf(a) <= WORST.indexOf(b) ? a : b);

export interface SchemModel {
  nodes: Record<string, GNode>;
  over: GEdge[];
  flows: Record<FlowId, Flow>;
}

/** The room's parts and links, from the model and its pipes, before they are placed. */
export function roomGraph(section: RoomSection, model: SchemModel): { nodes: Omit<SchemNode, "rank" | "row" | "x" | "y">[]; links: Omit<SchemLink, "back" | "d" | "mid">[] } {
  const room = section.id;
  const pipeOf = (id: string): RoomPipe | null => section.pipes.find((p) => p.id === `${room}:${id}`) ?? null;
  const flow = (model.flows as Record<string, Flow | undefined>)[room];
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  // A room's flow draws its parts already; a connection edge from the room node to a part the flow has only repeats it.
  const inFlow = new Set((flow?.edges ?? []).flatMap((e) => [e.a, e.b]));
  const over = model.over.filter((x) => x.room === room && !((x.a === room && inFlow.has(x.b)) || (x.b === room && inFlow.has(x.a))));
  for (const e of [...(flow?.edges ?? []), ...over]) {
    const k = `${e.a}>${e.b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }
  const ids: string[] = [];
  for (const e of edges) for (const id of [e.a, e.b]) if (!ids.includes(id)) ids.push(id);
  // The room itself is the hub its extra pipes hang off; when its flow has no node for it, its first part is.
  const hub = ids.includes(room) ? room : (ids[0] ?? room);
  if (!ids.includes(hub)) ids.push(hub);

  const nodes = ids.map((id) => {
    const n = model.nodes[id];
    const p = pipeOf(id);
    const own = n ? FROM_G[n.state] : "dry";
    return { id, name: n?.l ?? p?.name ?? section.name, sub: n?.s ?? p?.what ?? section.sub, kind: (n?.k ?? "room") as SchemNode["kind"], state: p ? worse(own, p.state) : own, pipe: p?.id ?? null };
  });
  const links: Omit<SchemLink, "back" | "d" | "mid">[] = edges.map((e) => {
    // A link is the pipe of the part it feeds; a link back into the room is the pipe of the part it comes from.
    const p = e.b === hub ? pipeOf(e.a) : pipeOf(e.b);
    const own = FROM_G[e.state];
    return { id: `${e.a}>${e.b}`, a: e.a, b: e.b, label: e.label ?? "", state: p ? worse(own, p.state) : own, pipe: p?.id ?? null, how: e.how ?? null, auth: e.auth ?? null, when: e.when ?? null, kinds: e.kinds ?? [] };
  });

  // Every pipe the graph doesn't already show: a scheduled job, a planned or graph-less connection.
  const shown = new Set(nodes.map((n) => n.pipe).filter(Boolean));
  for (const p of section.pipes) {
    if (shown.has(p.id)) continue;
    const id = `pipe:${p.id}`;
    nodes.push({ id, name: p.name, sub: p.what, kind: p.kind === "job" ? "job" : p.kind === "planned" ? "planned" : "service", state: p.state, pipe: p.id });
    links.push({ id: `${hub}>${id}`, a: hub, b: id, label: p.kind === "job" ? "on its schedule" : p.kind === "planned" ? "planned" : "", state: p.state, pipe: p.id, how: p.facts?.how ?? null, auth: p.facts?.auth ?? null, when: p.facts?.when ?? null, kinds: p.facts?.kinds ?? [] });
  }
  return { nodes, links };
}

/** Columns by how far along the flow a part sits (the longest path to it), rows ordered to keep links short. */
export function rank(ids: string[], links: { a: string; b: string }[]): Map<string, number> {
  const r = new Map(ids.map((id) => [id, 0]));
  // Longest path, at most one pass per part, so a loop can't run forever.
  for (let i = 0; i < ids.length; i++) {
    let moved = false;
    for (const l of links) {
      const next = (r.get(l.a) ?? 0) + 1;
      if (next > (r.get(l.b) ?? 0) && next < ids.length) {
        r.set(l.b, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return r;
}

/** Longest a column runs before it wraps into a second one beside it: a room that fans out to a dozen devices stays a grid. */
const WRAP = { lr: 6, tb: 2 } as const;

/** The room's parts on a grid: a column for each step along the flow (a tall step wrapped into several), a row across it. */
export interface SchemGrid {
  graph: ReturnType<typeof roomGraph>;
  rankOf: Map<string, number>;
  colOf: Map<string, number>;
  rowOf: Map<string, number>;
  maxCol: number;
  maxRow: number;
}

export function schemGrid(section: RoomSection, model: SchemModel, wrap: number): SchemGrid {
  const g = roomGraph(section, model);
  const ids = g.nodes.map((n) => n.id);
  // Links that close a loop are left out of the ranking, so the flow still reads one way.
  const r0 = rank(ids, g.links);
  const fwd = g.links.filter((l) => (r0.get(l.b) ?? 0) > (r0.get(l.a) ?? 0));
  const r = rank(ids, fwd);
  const ranks = [...new Set(ids.map((id) => r.get(id)!))].sort((a, b) => a - b);
  const layer = new Map(ranks.map((k) => [k, ids.filter((id) => r.get(id) === k)]));

  // Order each rank by where its neighbours sit, a few sweeps each way, so links cross as little as they can.
  const pos = new Map<string, number>();
  const place = () => layer.forEach((list) => list.forEach((id, i) => pos.set(id, list.length > 1 ? i / (list.length - 1) : 0.5)));
  place();
  const near = (id: string, back: boolean) => {
    const xs = g.links.filter((l) => (back ? l.a === id : l.b === id)).map((l) => pos.get(back ? l.b : l.a)!);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : pos.get(id)!;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const back = sweep % 2 === 1;
    for (const k of back ? [...ranks].reverse() : ranks) {
      const list = layer.get(k)!;
      const score = new Map(list.map((id) => [id, near(id, back)]));
      list.sort((a, b) => score.get(a)! - score.get(b)!);
      place();
    }
  }

  // Columns and rows on one grid, a tall rank wrapped into several columns, so the channels between rows stay clear.
  const colOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  const tallest = Math.min(wrap, Math.max(...[...layer.values()].map((l) => l.length)));
  let col = 0;
  for (const k of ranks) {
    const list = layer.get(k)!;
    const subs = Math.ceil(list.length / wrap);
    for (let s = 0; s < subs; s++) {
      const part = list.slice(s * wrap, (s + 1) * wrap);
      const off = Math.floor((tallest - part.length) / 2);
      part.forEach((id, i) => {
        colOf.set(id, col + s);
        rowOf.set(id, i + off);
      });
    }
    col += subs;
  }
  const maxCol = Math.max(0, ...colOf.values());
  const maxRow = Math.max(0, ...rowOf.values());
  return { graph: g, rankOf: r, colOf, rowOf, maxCol, maxRow };
}

export function schematic(section: RoomSection, model: SchemModel, dir: "lr" | "tb" = "lr"): Schematic {
  const { graph: g, rankOf: r, colOf, rowOf, maxCol, maxRow } = schemGrid(section, model, WRAP[dir]);

  // Laid out along the flow (u) and across it (v), then turned for the screen: u is x on a desk, y on a phone.
  const su = dir === "lr" ? NODE_W : NODE_H;
  const sv = dir === "lr" ? NODE_H : NODE_W;
  const colStep = dir === "lr" ? NODE_W + 112 : NODE_H + 72;
  const rowStep = dir === "lr" ? NODE_H + 30 : NODE_W + 24;
  const gap = colStep - su;
  const uv = (id: string): [number, number] => [PAD + su / 2 + colOf.get(id)! * colStep, PAD + sv / 2 + rowOf.get(id)! * rowStep];
  const xy = (u: number, v: number): [number, number] => (dir === "lr" ? [u, v] : [v, u]);
  const P = (u: number, v: number) => xy(u, v).join(" ");

  const nodes: SchemNode[] = g.nodes.map((n) => {
    const [x, y] = xy(...uv(n.id));
    return { ...n, rank: r.get(n.id)!, row: rowOf.get(n.id)!, x, y };
  });
  const lenU = PAD * 2 + su + maxCol * colStep;
  const lenV = PAD * 2 + sv + maxRow * rowStep + 40;
  const [w, h] = xy(lenU, lenV);

  // Links between the same two parts fan out a little.
  const twins = new Map<string, number>();
  const links: SchemLink[] = g.links.map((l) => {
    const [au, av0] = uv(l.a);
    const [bu, bv0] = uv(l.b);
    const key = [l.a, l.b].sort().join("|");
    const k = twins.get(key) ?? 0;
    twins.set(key, k + 1);
    const back = r.get(l.b)! <= r.get(l.a)!;
    let d: string;
    let mid: [number, number];
    if (!back) {
      const av = av0 + k * 8;
      const bv = bv0 + k * 8;
      const u1 = au + su / 2;
      const u2 = bu - su / 2;
      if (colOf.get(l.b)! - colOf.get(l.a)! <= 1) {
        const cu = (u1 + u2) / 2;
        d = `M${P(u1, av)}C${P(cu, av)} ${P(cu, bv)} ${P(u2, bv)}`;
        mid = xy(cu, (av + bv) / 2);
      } else {
        // Past the next column it runs in the clear channel between rows, beside the part it feeds, then turns in.
        const cv = bv + (av <= bv ? -rowStep / 2 : rowStep / 2);
        const m1 = u1 + gap / 2;
        const m2 = u2 - gap / 2;
        d = `M${P(u1, av)}C${P(m1, av)} ${P(m1, cv)} ${P(u1 + gap, cv)}L${P(u2 - gap, cv)}C${P(m2, cv)} ${P(m2, bv)} ${P(u2, bv)}`;
        mid = xy(m2, (cv + bv) / 2);
      }
    } else {
      const v = Math.max(av0, bv0) + sv / 2 + 22 + k * 10;
      d = `M${P(au, av0 + sv / 2)}C${P(au, v)} ${P(bu, v)} ${P(bu, bv0 + sv / 2)}`;
      mid = xy((au + bu) / 2, v - 6);
    }
    return { ...l, back, d, mid: mid as [number, number] };
  });
  return { room: section.id, nodes, links, w, h, dir };
}

/** A card for a part or link that has no pipe of its own: what it is and its state, from the model's own words. */
export function cardOf(t: { node: Pick<SchemNode, "id" | "name" | "sub" | "state"> } | { link: Omit<SchemLink, "back" | "d" | "mid"> }, section: RoomSection, nodes: Pick<SchemNode, "id" | "name">[]): RoomPipe {
  const STATE_WHY: Record<StationState, string> = { ok: "Flowing.", late: "Running late.", shut: "Valve shut.", leak: "Broken: it stopped answering.", dry: "Not connected yet." };
  if ("node" in t) {
    const n = t.node;
    return { id: `schem:${section.id}:${n.id}`, room: section.id, name: n.name, what: n.sub, kind: "part", state: n.state, why: STATE_WHY[n.state], body: "", since: "", lastOk: null, facts: null, needs: null, fix: null, steps: [], cap: null };
  }
  const l = t.link;
  const a = nodes.find((n) => n.id === l.a)?.name ?? l.a;
  const b = nodes.find((n) => n.id === l.b)?.name ?? l.b;
  return {
    id: `schem:${section.id}:${l.id}`,
    room: section.id,
    name: l.label ? `${l.label}` : `${a} to ${b}`,
    what: `${a} → ${b}`,
    kind: "link",
    state: l.state,
    why: STATE_WHY[l.state],
    body: "",
    since: "",
    lastOk: null,
    facts: l.how || l.auth || l.when ? { how: l.how ?? "", auth: l.auth ?? "", when: l.when ?? "", kinds: l.kinds as never } : null,
    needs: null,
    fix: null,
    steps: [],
    cap: null,
  };
}
