/**
 * The vacuum's live map (#814, the B2 Live run concept Nikita picked): the Roborock's own map, read with get_map_v1
 * while it cleans and the Hall is open, decoded to what the Hall draws: the rooms (the map's segments), the walls, the
 * dock, the robot and its heading, the path it has run, which rooms it was sent to and in what order, and how much of
 * each it has covered. Private: it is the home's floor plan, so it is only ever served behind the passkey session,
 * never stored (no vault, no blob, no log line), and never in the public status.
 *
 * The map blob is the documented Roborock v1 format, as python-roborock and vacuum-map-parser-roborock read it (and
 * Valetudo's RRMapParser before them). Little endian throughout:
 *
 *   header   "rr", header length (u16 @2), data length (u32 @4), version, map index and sequence; blocks follow
 *   block    type (u16 @0), block header length (u16 @2), data length (u32 @4); the data after the block header
 *     1  charger         x, y (i32, mm)
 *     2  image           top, left, height, width (i32, the last 16 bytes of the block header), then one byte a pixel,
 *                        row 0 at the bottom: 0 outside, 1 wall, 255 floor with no room, else low 3 bits 7 and the
 *                        room's segment in the high 5 (0 and 1 in the low bits are walls, grey and black)
 *     3  path            points as u16 x, u16 y (mm), four bytes each
 *     8  robot position  x, y (i32, mm) and, when the block is longer, its angle (i32, degrees)
 *     11 blocks          the segments of the run under way, one byte each, in the order they are cleaned
 *
 * A map pixel is 50 mm. The answer comes back on the RPC channel as protocol 301: a 24-byte header (the request's
 * endpoint, and its id as a u16 at byte 16), then AES-128-CBC under the request's own nonce (a zero IV), gzipped.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createDecipheriv, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const BLOCK = { CHARGER: 1, IMAGE: 2, PATH: 3, ROBOT: 8, BLOCKS: 11 } as const;
/** One map pixel, in mm. */
export const PX_MM = 50;
/** The robot's width in map pixels (about 35 cm), for the cleaned band and the coverage. */
export const ROBOT_PX = 7;

export interface Pt {
  x: number;
  y: number;
}

export interface RawMap {
  image: { top: number; left: number; width: number; height: number; pixels: Uint8Array } | null;
  charger: Pt | null;
  robot: (Pt & { a: number | null }) | null;
  /** The run's path, in mm. */
  path: Pt[];
  /** The segments being cleaned, in order (empty for a whole-home clean). */
  cleaning: number[];
}

const MAX_SIDE = 2048;

/** Parses a map blob; null when it isn't one. Never throws on a short or odd blob: what can't be read is left out. */
export function parseMap(buf: Buffer): RawMap | null {
  if (buf.length < 20 || buf[0] !== 0x72 || buf[1] !== 0x72) return null;
  const out: RawMap = { image: null, charger: null, robot: null, path: [], cleaning: [] };
  let pos = buf.readUInt16LE(2);
  for (let guard = 0; pos + 8 <= buf.length && guard < 256; guard++) {
    const type = buf.readUInt16LE(pos);
    const hlen = buf.readUInt16LE(pos + 2);
    const dlen = buf.readUInt32LE(pos + 4);
    const at = pos + hlen;
    if (hlen < 8 || at + dlen > buf.length) break;
    if ((type === BLOCK.CHARGER || type === BLOCK.ROBOT) && dlen >= 8) {
      const p = { x: buf.readInt32LE(at), y: buf.readInt32LE(at + 4) };
      if (type === BLOCK.CHARGER) out.charger = p;
      else {
        let a: number | null = null;
        if (dlen >= 12) {
          a = buf.readInt32LE(at + 8);
          if (a > 0xff) a = (a & 0xff) - 0x100;
        }
        out.robot = { ...p, a };
      }
    } else if (type === BLOCK.IMAGE && hlen >= 24) {
      const top = buf.readInt32LE(pos + hlen - 16);
      const left = buf.readInt32LE(pos + hlen - 12);
      const height = buf.readInt32LE(pos + hlen - 8);
      const width = buf.readInt32LE(pos + hlen - 4);
      if (width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE && width * height <= dlen) out.image = { top, left, width, height, pixels: new Uint8Array(buf.subarray(at, at + width * height)) };
    } else if (type === BLOCK.PATH) {
      const n = Math.floor(dlen / 4);
      const path: Pt[] = [];
      for (let i = 0; i < n; i++) path.push({ x: buf.readUInt16LE(at + i * 4), y: buf.readUInt16LE(at + i * 4 + 2) });
      out.path = path;
    } else if (type === BLOCK.BLOCKS) {
      out.cleaning = [...buf.subarray(at, at + Math.min(dlen, 32))];
    }
    pos = at + dlen;
  }
  return out;
}

/** The segment a map pixel belongs to, 0 when none; whether it is a wall. */
export function pixelOf(v: number): { segment: number; wall: boolean; floor: boolean } {
  if (v === 0) return { segment: 0, wall: false, floor: false };
  if (v === 1) return { segment: 0, wall: true, floor: false };
  if (v === 255) return { segment: 0, wall: false, floor: true };
  const low = v & 7;
  if (low === 7) return { segment: v >> 3, wall: false, floor: true };
  if (low === 0 || low === 1) return { segment: 0, wall: true, floor: false };
  return { segment: 0, wall: false, floor: true };
}

/* ── The answer on the wire ── */

/** The secure request's endpoint, as python-roborock makes it: base64 of md5(rriot.k)[8:14]. */
export const mapEndpoint = (k: string): string => createHash("md5").update(k).digest().subarray(8, 14).toString("base64");

/** A protocol-301 payload for request `id` on `endpoint`, decrypted and unzipped; undefined when it answers something else. */
export function mapPayload(payload: Buffer, id: number, endpoint: string, nonce: Buffer): Buffer | undefined {
  if (payload.length < 24 + 16) return undefined;
  if (!payload.subarray(0, 8).toString("latin1").startsWith(endpoint.slice(0, 8))) return undefined;
  if (payload.readUInt16LE(16) !== (id & 0xffff)) return undefined;
  const d = createDecipheriv("aes-128-cbc", nonce, Buffer.alloc(16));
  const plain = Buffer.concat([d.update(payload.subarray(24)), d.final()]);
  return gunzipSync(plain, { maxOutputLength: 8 * 1024 * 1024 });
}

/** The RPC request for the map: get_map_v1 carries a security block, the endpoint and a fresh 16-byte nonce (lower-case hex). */
export function mapRequestPayload(id: number, endpoint: string, nonce: Buffer, ts: number): Buffer {
  const inner = JSON.stringify({ id, method: "get_map_v1", params: [], security: { endpoint, nonce: nonce.toString("hex") } });
  return Buffer.from(JSON.stringify({ dps: { "101": inner }, t: ts }));
}

/* ── What the Hall draws ── */

export interface LiveRoom {
  segment: number;
  name: string;
  /** Its floor as runs of map pixels: y, x, length, … (y down, in the map box). */
  runs: number[];
  /** Where its label sits. */
  cx: number;
  cy: number;
  /** Its place in the run (1, 2…), or null when it wasn't sent there. */
  order: number | null;
  /** How much of it the path has covered (0–100), or null when nothing says. */
  pct: number | null;
  state: "done" | "now" | "next" | "off";
}

export interface LiveMap {
  /** The map box, in map pixels: width and height (x right, y down). */
  w: number;
  h: number;
  rooms: LiveRoom[];
  /** The walls as runs, like the rooms. */
  walls: number[];
  /** The path, x, y, … in map pixels. */
  path: number[];
  robot: { x: number; y: number; a: number | null } | null;
  charger: { x: number; y: number } | null;
}

const CELL = 2;
const MAX_PATH = 1500;

/** The decoded map as the Hall draws it, cropped to the home and coarsened to 10 cm cells for the room shapes. */
export function liveMapOf(raw: RawMap, names: Record<number, string>): LiveMap | null {
  const img = raw.image;
  if (!img) return null;
  const { width: W, height: H, top, left, pixels } = img;
  // The crop: everything that is wall or floor.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W; col++) {
      const v = pixels[row * W + col]!;
      if (v === 0) continue;
      const y = H - 1 - row;
      if (col < x0) x0 = col;
      if (col > x1) x1 = col;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 4);
  y0 = Math.max(0, y0 - 4);
  x1 = Math.min(W - 1, x1 + 4);
  y1 = Math.min(H - 1, y1 + 4);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  /** mm to the box's pixels, y down. */
  const toBox = (p: Pt) => ({ x: +(p.x / PX_MM - left - x0).toFixed(1), y: +(H - 1 - (p.y / PX_MM - top) - y0).toFixed(1) });
  const at = (x: number, y: number) => {
    // x, y in box pixels (y down) to the pixel's value
    const col = x + x0;
    const row = H - 1 - (y + y0);
    return col < 0 || row < 0 || col >= W || row >= H ? 0 : pixels[row * W + col]!;
  };

  // Coarse cells: a cell takes the room most of its pixels are in, else wall when any is.
  const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL);
  const seg = new Int16Array(cw * ch);
  const wall = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const count = new Map<number, number>();
      let walls = 0;
      for (let dy = 0; dy < CELL; dy++)
        for (let dx = 0; dx < CELL; dx++) {
          const p = pixelOf(at(cx * CELL + dx, cy * CELL + dy));
          if (p.wall) walls++;
          if (p.segment) count.set(p.segment, (count.get(p.segment) ?? 0) + 1);
        }
      let best = 0, n = 0;
      for (const [s, c] of count) {
        if (c > n) {
          best = s;
          n = c;
        }
      }
      seg[cy * cw + cx] = best;
      if (!best && walls) wall[cy * cw + cx] = 1;
    }

  // What the path covered, a robot's width wide, in cells.
  const path = raw.path.map(toBox);
  const covered = new Uint8Array(cw * ch);
  const r = ROBOT_PX / 2 / CELL;
  const stamp = (x: number, y: number) => {
    const cx = x / CELL, cy = y / CELL;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || j < 0 || i >= cw || j >= ch) continue;
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) covered[j * cw + i] = 1;
      }
  };
  for (let k = 0; k < path.length; k++) {
    const a = path[k]!, b = path[k + 1] ?? a;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL));
    for (let s = 0; s < steps; s++) stamp(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }

  const robot = raw.robot ? { ...toBox(raw.robot), a: raw.robot.a } : null;
  const robotSeg = robot ? seg[Math.floor(robot.y / CELL) * cw + Math.floor(robot.x / CELL)] ?? 0 : 0;
  const order = raw.cleaning.filter((s, i, all) => s > 0 && all.indexOf(s) === i);
  const nowAt = order.indexOf(robotSeg);

  // Each room: its runs, its centre, its share covered.
  const segs = [...new Set(seg)].filter((s) => s > 0).sort((a, b) => a - b);
  const rooms: LiveRoom[] = segs.map((s) => {
    const runs: number[] = [];
    let sx = 0, sy = 0, cells = 0, hit = 0;
    for (let cy = 0; cy < ch; cy++) {
      let start = -1;
      for (let cx = 0; cx <= cw; cx++) {
        const on = cx < cw && seg[cy * cw + cx] === s;
        if (on) {
          cells++;
          sx += cx;
          sy += cy;
          if (covered[cy * cw + cx]) hit++;
          if (start < 0) start = cx;
        } else if (start >= 0) {
          runs.push(cy * CELL, start * CELL, (cx - start) * CELL);
          start = -1;
        }
      }
    }
    const i = order.indexOf(s);
    const sent = order.length ? i >= 0 : true;
    const state: LiveRoom["state"] = !sent ? "off" : order.length ? (i === nowAt ? "now" : nowAt >= 0 && i < nowAt ? "done" : "next") : s === robotSeg ? "now" : "next";
    return {
      segment: s,
      name: (names[s] ?? "").slice(0, 40) || `Room ${s}`,
      runs,
      cx: +(((sx / cells) + 0.5) * CELL).toFixed(1),
      cy: +(((sy / cells) + 0.5) * CELL).toFixed(1),
      order: i >= 0 ? i + 1 : null,
      pct: path.length && sent ? Math.min(100, Math.round((hit / cells) * 100)) : null,
      state,
    };
  });

  const walls: number[] = [];
  for (let cy = 0; cy < ch; cy++) {
    let start = -1;
    for (let cx = 0; cx <= cw; cx++) {
      const on = cx < cw && wall[cy * cw + cx] === 1;
      if (on && start < 0) start = cx;
      else if (!on && start >= 0) {
        walls.push(cy * CELL, start * CELL, (cx - start) * CELL);
        start = -1;
      }
    }
  }

  // The path, thinned to at most MAX_PATH points (the newest kept whole).
  const step = Math.max(1, Math.ceil(path.length / MAX_PATH));
  const thin = path.filter((_, k) => k % step === 0 || k === path.length - 1);
  return {
    w,
    h,
    rooms,
    walls,
    path: thin.flatMap((p) => [p.x, p.y]),
    robot,
    charger: raw.charger ? toBox(raw.charger) : null,
  };
}
