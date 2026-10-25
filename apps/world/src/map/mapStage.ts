import { KERNEL_PORT_RADIUS, RING_RADIUS, ROOM_HALF_D, ROOM_HALF_W, ROOM_IDS, gateWorld, kernelPort, roomAngle, worldToRoom, type RoomId } from "@ceo/core";
import { clock } from "../clock.ts";
import { Being } from "../desk/confluence/beings.ts";
import type { FlowLine, Pt } from "../desk/flow/index.ts";
import { HOT, RC, TAU, WHITE, spr } from "../desk/wvCanvas.ts";
import { useCast } from "../cast/castStore.ts";
import { useWorld } from "../store.ts";
import { crewPoint, hexToRgb, type RoomSummary } from "./mapModel.ts";

/**
 * The map's stage (#433): the Lattice drawn in Today's particle-line language. The ten rooms sit on the ring as their
 * subminds' figures (the same shapes as Today's Council, beings.ts), each in its own colour; Skippy's sits at the
 * centre, on the Kernel. Each room's light stream to the Kernel is a particle line: a live room's carries its real
 * work (density from who is there and what runs, pace from the running work, a packet whenever it does something), a
 * room the simulator still plays is a waiting line. The crew are motes of their own colour, where the simulator has
 * them: in their rooms, and riding the streams between rooms. Canvas only, no DOM in a frame (field.ts).
 */

export const GOLD = "232,207,156";
export const rgbOf = (room: RoomId) => RC[room] ?? WHITE;

/** The ring on screen: its centre, its radius and pixels per world unit, and the figures' sizes. */
export interface Ring {
  cx: number;
  cy: number;
  R: number;
  /** Pixels per world unit. */
  s: number;
  /** A room's figure radius, and Skippy's. */
  br: number;
  kr: number;
  /** How far under a room's centre its name sits. */
  lab: number;
  phone: boolean;
}

/**
 * The ring that fits a box (canvas px), leaving room for the names: above the rooms on the far half of the ring, under
 * them on the near half, so the middle stays clear for the streams.
 */
export function ringIn(box: { x: number; y: number; w: number; h: number }, phone: boolean): Ring {
  const k = phone ? 0.16 : 0.17;
  // Half a name's width beside a room at the ring's widest; a name's height (plus a gap) above or under the top and bottom ones.
  const side = phone ? 14 : 70;
  const tall = phone ? 16 : 62;
  const R = Math.max(70, Math.min((box.w / 2 - side) / 0.951, (box.h / 2 - tall) / (1 + k + 0.05), 440));
  const s = R / RING_RADIUS;
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, R, s, br: R * k, kr: Math.max(22, KERNEL_PORT_RADIUS * s * 1.15), lab: R * (k + 0.03), phone };
}

/** Whether a room's name sits above it (the far half of the ring) or under it. */
export const above = (room: RoomId) => Math.cos(roomAngle(room)) < -0.01;

export function nodeOf(g: Ring, room: RoomId): Pt {
  const a = roomAngle(room);
  return [g.cx + Math.sin(a) * g.R, g.cy + Math.cos(a) * g.R];
}

/** World x/z (seen from straight above, +z down) to the screen. */
const toScreen = (g: Ring, x: number, z: number): [number, number] => [g.cx + x * g.s, g.cy + z * g.s];

/** Where a room's stream leaves it, and where it reaches the Kernel, as radii in world units. Each line is drawn from
 * the room's centre (out of its figure, as Today's streams leave theirs), so the stream proper starts a little way in. */
const GATE_R = Math.hypot(gateWorld("foundry")[0], gateWorld("foundry")[2]);
const PORT_R = KERNEL_PORT_RADIUS;
/** Every stream bows the same way, so the ten read as one current turning into the Kernel. */
const BEND = 0.2;

/** A stream on screen, gate to Kernel: a quadratic bowed sideways (`c` its control point). */
interface Bow {
  a: Pt;
  c: Pt;
  b: Pt;
}
const bowAt = (w: Bow, t: number): [number, number] => {
  const u = 1 - t;
  return [u * u * w.a[0] + 2 * u * t * w.c[0] + t * t * w.b[0], u * u * w.a[1] + 2 * u * t * w.c[1] + t * t * w.b[1]];
};
function bowOf(g: Ring, room: RoomId): Bow {
  const gw = gateWorld(room);
  const kp = kernelPort(room);
  const a = toScreen(g, gw[0], gw[2]);
  const b = toScreen(g, kp[0], kp[2]);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  // To the left of travel, by BEND of the length at its middle (a quadratic's control sits twice as far out).
  return { a, b, c: [(a[0] + b[0]) / 2 + dy * BEND * 2, (a[1] + b[1]) / 2 - dx * BEND * 2] };
}

export const spokeId = (room: RoomId) => `s:${room}`;
export const anchorId = (room: RoomId) => `r:${room}`;

/** What the stage reads each frame; changed in place by the page, never through React. */
export interface StageState {
  g: Ring | null;
  rooms: Map<RoomId, RoomSummary>;
  hover: RoomId | null;
  /** Lattice time and the simulator step here (the page passes its heartbeat). */
  tick: () => void;
  /** The crew as drawn this frame, for hover and the tests. */
  drawn: { id: string; x: number; y: number; room: RoomId }[];
  frames: number;
}

/** A live room's stream: density from who is there and what runs, pace from the running work. */
export function spokeOf(s: RoomSummary): Pick<FlowLine, "density" | "rate" | "waiting" | "bright" | "bed"> {
  if (!s.live) return { waiting: true, bright: 0.8, bed: 0.08 };
  return { density: Math.min(1, 0.62 + 0.1 * Math.min(s.running, 3) + 0.03 * Math.min(s.here, 6)), rate: 22 + 14 * Math.min(s.running, 4), bright: 1, bed: 0.1 };
}

/** A room's figure: its submind's shape, steady (Today's figures turn into Skippy on a cycle; on the map they keep their own). */
class Figure extends Being {
  key = "";
  override cycle() {
    return 0;
  }
}

function names() {
  const profiles = useCast.getState().cast.profiles;
  return (id: string) => profiles[id]?.look.accent;
}

export function makeStage(S: StageState) {
  const figs = new Map<RoomId, Figure>();
  let skippy: Being | null = null;
  const trails = new Map<string, number[]>();
  const bows = new Map<RoomId, Bow>();

  /** The figures for this layout: made again only when a room's kind or pace changes, otherwise just moved. */
  const place = (g: Ring) => {
    for (const [i, r] of ROOM_IDS.entries()) {
      const s = S.rooms.get(r);
      const live = !!s?.live;
      const act = live ? 0.45 + 0.12 * Math.min(s!.running, 3) : 0.12;
      const key = `${live}|${act.toFixed(2)}|${g.phone}`;
      let f = figs.get(r);
      if (!f || f.key !== key) {
        f = new Figure(r, rgbOf(r), act, (live ? 1 : 0.6) * (g.phone ? 0.6 : 1), (i * 0.381 + 0.17) % 1);
        f.key = key;
        figs.set(r, f);
      }
      const [x, y] = nodeOf(g, r);
      f.x = x;
      f.y = y;
      f.r = g.br;
    }
    skippy ??= new Being("kernel", GOLD, 0.8, 1, 0.5);
    skippy.x = g.cx;
    skippy.y = g.cy;
    skippy.r = g.kr;
  };

  /** The page's flow layout: one stream per room, gate to Kernel. */
  const lines = (g: Ring): { lines: FlowLine[]; anchors: Record<string, Pt> } => {
    place(g);
    const anchors: Record<string, Pt> = { kernel: [g.cx, g.cy - g.kr * 1.3] };
    const out: FlowLine[] = ROOM_IDS.map((r) => {
      const s = S.rooms.get(r);
      const [x, y] = nodeOf(g, r);
      const w = bowOf(g, r);
      bows.set(r, w);
      anchors[anchorId(r)] = [x, y - g.br * 1.1];
      return {
        id: spokeId(r),
        // Out of the room's figure, straight to its gate, then bowed into the Kernel.
        path: { via: [[x, y], ...Array.from({ length: 25 }, (_, i) => bowAt(w, i / 24))], smooth: false },
        rgb: rgbOf(r),
        spread: g.phone ? 2.6 : 4.6,
        ...(s ? spokeOf(s) : { waiting: true }),
      };
    });
    return { lines: out, anchors };
  };

  /** Where a mote is on screen: in a room, as the floor plan has it; on a stream, on that stream as it is drawn. */
  const at = (g: Ring, x: number, z: number, stream: boolean): [number, number] => {
    const r = Math.hypot(x, z);
    if (stream && r <= GATE_R && r >= PORT_R) {
      let a = Math.atan2(x, z);
      if (a < 0) a += TAU;
      const w = bows.get(ROOM_IDS[Math.round((a / TAU) * ROOM_IDS.length) % ROOM_IDS.length]!);
      if (w) return bowAt(w, (GATE_R - r) / (GATE_R - PORT_R));
    }
    return toScreen(g, x, z);
  };

  const ringLine = (c: CanvasRenderingContext2D, g: Ring) => {
    // The ring itself: a gold hairline from room to room, broken where each figure sits.
    const gap = (g.br * 1.45) / g.R;
    c.globalCompositeOperation = "source-over";
    c.lineWidth = 1;
    c.strokeStyle = `rgba(${GOLD},.11)`;
    c.beginPath();
    for (const r of ROOM_IDS) {
      // Canvas angles run from +x; a room at bearing a (from +z, toward +x) sits at canvas angle π/2 - a.
      const a = Math.PI / 2 - roomAngle(r);
      const step = TAU / ROOM_IDS.length;
      c.moveTo(g.cx + Math.cos(a - gap) * g.R, g.cy + Math.sin(a - gap) * g.R);
      c.arc(g.cx, g.cy, g.R, a - gap, a - step + gap, true);
    }
    c.stroke();
    // Bearings round the outside, every six degrees, longer at each room.
    c.strokeStyle = `rgba(${WHITE},.07)`;
    c.beginPath();
    const r0 = g.R + g.br * 1.9;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const r1 = r0 + (i % 6 === 0 ? 7 : 3);
      c.moveTo(g.cx + Math.sin(a) * r0, g.cy + Math.cos(a) * r0);
      c.lineTo(g.cx + Math.sin(a) * r1, g.cy + Math.cos(a) * r1);
    }
    c.stroke();
    c.globalCompositeOperation = "lighter";
  };

  const overlay = (c: CanvasRenderingContext2D, t: number, dt: number) => {
    const g = S.g;
    if (!g) return;
    if (dt) S.tick();
    S.frames++;
    ringLine(c, g);
    const hover = S.hover;

    // The figures: a live room bright, a simulated one faint; a ring round one with something waiting on Nikita.
    for (const [r, f] of figs) {
      const s = S.rooms.get(r);
      const on = hover === r;
      f.a = (s?.live ? 0.95 : 0.42) * (hover && !on ? 0.55 : 1);
      f.hl = on ? 1 : 0;
      f.draw(c, t, dt);
      if (s?.waiting) f.need(c, t, HOT);
    }
    if (skippy) {
      skippy.a = 1;
      skippy.draw(c, t, dt);
    }

    // The crew: a mote each in their own colour, a short trail behind anyone moving, a comet on a stream.
    const { lattice, selectedAgent } = useWorld.getState();
    const accent = names();
    const now = clock.sim;
    const r0 = g.phone ? 1.5 : Math.max(1.6, Math.min(2.4, g.s * 0.24));
    S.drawn.length = 0;
    for (const rt of Object.values(lattice.agents)) {
      const id = rt.agent.id;
      const p = crewPoint(rt, now);
      const stream = p.kind === "stream";
      const [x, y] = at(g, p.x, p.z, stream);
      const rgb = hexToRgb(accent(id) ?? "#eceef3");
      const sp = spr(rgb);
      let tr = trails.get(id);
      if (!tr) trails.set(id, (tr = []));
      if (p.kind !== "still" && dt) {
        tr.push(x, y);
        if (tr.length > (stream ? 36 : 20)) tr.splice(0, 2);
      } else if (tr.length && dt) tr.splice(0, 2);
      const n = tr.length / 2;
      for (let k = 0; k < n; k++) {
        c.globalAlpha = ((k + 1) / n) * (stream ? 0.55 : 0.28);
        const sz = stream ? 2 + (k / n) * 3 : 2.4;
        c.drawImage(sp, tr[k * 2]! - sz, tr[k * 2 + 1]! - sz, sz * 2, sz * 2);
      }
      const lit = hover === p.room || stream || selectedAgent === id;
      const glow = r0 * (stream ? 5.5 : lit ? 4.4 : 3.6);
      c.globalAlpha = hover && !lit ? 0.5 : 0.9;
      c.drawImage(sp, x - glow, y - glow, glow * 2, glow * 2);
      c.globalAlpha = hover && !lit ? 0.6 : 1;
      const core = r0 * (stream ? 0.95 : 0.8);
      c.drawImage(spr(WHITE), x - core * 1.6, y - core * 1.6, core * 3.2, core * 3.2);
      if (selectedAgent === id) {
        c.globalAlpha = 0.8;
        c.strokeStyle = `rgba(${WHITE},.8)`;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x, y, r0 * 4, 0, TAU);
        c.stroke();
      }
      S.drawn.push({ id, x, y, room: p.room });
    }
    c.globalAlpha = 1;
  };

  /** The room under a canvas point: near its figure, or on its floor plate. */
  const roomAt = (x: number, y: number): RoomId | null => {
    const g = S.g;
    if (!g) return null;
    let best: RoomId | null = null;
    let d = (g.br * 1.6) ** 2;
    for (const r of ROOM_IDS) {
      const [nx, ny] = nodeOf(g, r);
      const dd = (nx - x) ** 2 + (ny - y) ** 2;
      if (dd < d) {
        d = dd;
        best = r;
      }
    }
    if (best) return best;
    const wx = (x - g.cx) / g.s;
    const wz = (y - g.cy) / g.s;
    for (const r of ROOM_IDS) {
      const [lx, lz] = worldToRoom(r, wx, wz);
      if (Math.abs(lx) <= ROOM_HALF_W && Math.abs(lz) <= ROOM_HALF_D) return r;
    }
    return null;
  };

  const crewAt = (x: number, y: number) => {
    let best: StageState["drawn"][number] | null = null;
    let d = 10 * 10;
    for (const p of S.drawn) {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < d) {
        d = dd;
        best = p;
      }
    }
    return best;
  };

  return {
    lines,
    overlay,
    roomAt,
    crewAt,
  };
}
