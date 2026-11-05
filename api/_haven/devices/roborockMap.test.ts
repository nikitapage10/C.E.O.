import { createCipheriv } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { liveMapOf, mapEndpoint, mapPayload, mapRequestPayload, parseMap, pixelOf, PX_MM } from "./roborockMap.ts";
import { devicesMap, type DevicesDeps } from "./route.ts";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";

/* Synthetic fixtures only: an invented 16 x 8 plan with two rooms, never a real map. */

const W = 16;
const H = 8;
const NOW = 1_780_000_000_000;
const DESK = "synthetic-desk-key-synthetic-desk-key";

/** One block: 8-byte header (type, header length, data length) and its data. */
function block(type: number, data: Buffer, extraHeader = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(8 + extraHeader.length, 2);
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, extraHeader, data]);
}

const i32 = (...n: number[]) => {
  const b = Buffer.alloc(n.length * 4);
  n.forEach((v, i) => b.writeInt32LE(v, i * 4));
  return b;
};

/** Row 0 is the bottom. Rooms: segment 16 on the left half, segment 17 on the right half; walls around. */
function pixels(): Buffer {
  const px = Buffer.alloc(W * H);
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W; col++) {
      const edge = row < 2 || row > H - 3 || col < 2 || col > W - 3;
      px[row * W + col] = edge ? 1 : col < W / 2 ? (16 << 3) | 7 : (17 << 3) | 7;
    }
  return px;
}

function mapBlob(opts: { robot?: [number, number, number]; path?: [number, number][]; cleaning?: number[] } = {}): Buffer {
  const header = Buffer.alloc(20);
  header.write("rr", 0, "latin1");
  header.writeUInt16LE(20, 2);
  const parts = [
    block(1, i32(2000, 2000)),
    block(2, pixels(), i32(0, 0, H, W)),
    block(3, Buffer.concat((opts.path ?? []).map(([x, y]) => Buffer.from([x & 255, x >> 8, y & 255, y >> 8]))))
  ];
  if (opts.robot) parts.push(block(8, i32(...opts.robot)));
  if (opts.cleaning) parts.push(block(11, Buffer.from(opts.cleaning)));
  return Buffer.concat([header, ...parts]);
}

describe("parseMap", () => {
  it("reads the charger, the robot, the path, the segments and the image", () => {
    const raw = parseMap(mapBlob({ robot: [3000, 2500, 90], path: [[1000, 1000], [2000, 1000]], cleaning: [16, 17] }))!;
    expect(raw.charger).toEqual({ x: 2000, y: 2000 });
    expect(raw.robot).toEqual({ x: 3000, y: 2500, a: 90 });
    expect(raw.path).toEqual([{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }]);
    expect(raw.cleaning).toEqual([16, 17]);
    expect(raw.image).toMatchObject({ width: W, height: H, top: 0, left: 0 });
    expect(raw.image!.pixels).toHaveLength(W * H);
  });

  it("is null for something that isn't a map and never throws on a short blob", () => {
    expect(parseMap(Buffer.from("not a map at all, nothing here"))).toBeNull();
    expect(parseMap(Buffer.alloc(0))).toBeNull();
    const cut = mapBlob({ robot: [1, 2, 3] }).subarray(0, 40);
    expect(() => parseMap(cut)).not.toThrow();
    expect(parseMap(cut)!.image).toBeNull();
  });
});

describe("pixelOf", () => {
  it("tells walls, floor and rooms apart", () => {
    expect(pixelOf(0)).toEqual({ segment: 0, wall: false, floor: false });
    expect(pixelOf(1).wall).toBe(true);
    expect(pixelOf(255)).toEqual({ segment: 0, wall: false, floor: true });
    expect(pixelOf((18 << 3) | 7)).toEqual({ segment: 18, wall: false, floor: true });
  });
});

describe("liveMapOf", () => {
  it("draws the rooms, the order, the robot and the share covered", () => {
    // Both rooms sent (16 then 17); the robot is in the first and has swept across its middle row.
    const path: [number, number][] = [];
    for (let x = 3; x <= 7; x++) path.push([x * PX_MM, 3 * PX_MM], [x * PX_MM, 4 * PX_MM]);
    const raw = parseMap(mapBlob({ robot: [5 * PX_MM, 4 * PX_MM, 0], path, cleaning: [16, 17] }))!;
    const map = liveMapOf(raw, { 16: "Test room A", 17: "Test room B" })!;
    expect(map.rooms.map((r) => [r.segment, r.name, r.order, r.state])).toEqual([
      [16, "Test room A", 1, "now"],
      [17, "Test room B", 2, "next"],
    ]);
    expect(map.rooms[0]!.pct).toBeGreaterThan(0);
    expect(map.rooms[0]!.pct!).toBeGreaterThan(map.rooms[1]!.pct!);
    expect(map.rooms[0]!.runs.length % 3).toBe(0);
    expect(map.robot).not.toBeNull();
    expect(map.charger).not.toBeNull();
    expect(map.path.length).toBe(path.length * 2);
    expect(map.walls.length).toBeGreaterThan(0);
  });

  it("marks rooms it wasn't sent to off, and the earlier ones done", () => {
    const raw = parseMap(mapBlob({ robot: [12 * PX_MM, 4 * PX_MM, 0], path: [[12 * PX_MM, 4 * PX_MM]], cleaning: [16, 17] }))!;
    const map = liveMapOf(raw, {})!;
    expect(map.rooms.map((r) => r.state)).toEqual(["done", "now"]);
    expect(map.rooms[0]!.name).toBe("Room 16");
    const only = liveMapOf(parseMap(mapBlob({ robot: [12 * PX_MM, 4 * PX_MM, 0], cleaning: [17] }))!, {})!;
    expect(only.rooms.map((r) => [r.order, r.state])).toEqual([[null, "off"], [1, "now"]]);
  });

  it("is null when the map has no image", () => {
    expect(liveMapOf({ image: null, charger: null, robot: null, path: [], cleaning: [] }, {})).toBeNull();
  });
});

describe("the wire", () => {
  it("builds the secure request and opens the answer", () => {
    const nonce = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const endpoint = mapEndpoint("synthetic-k");
    expect(endpoint).toMatch(/^[A-Za-z0-9+/=]{8}$/);
    const req = JSON.parse(mapRequestPayload(12345, endpoint, nonce, 1700000000).toString("utf8")) as { dps: Record<string, string> };
    const inner = JSON.parse(req.dps["101"]!) as { id: number; method: string; security: { endpoint: string; nonce: string } };
    expect(inner).toMatchObject({ id: 12345, method: "get_map_v1", security: { endpoint, nonce: "00112233445566778899aabbccddeeff" } });

    const blob = mapBlob({ cleaning: [16] });
    const cipher = createCipheriv("aes-128-cbc", nonce, Buffer.alloc(16));
    const body = Buffer.concat([cipher.update(gzipSync(blob)), cipher.final()]);
    const head = Buffer.alloc(24);
    head.write(endpoint, 0, "latin1");
    head.writeUInt16LE(12345, 16);
    const out = mapPayload(Buffer.concat([head, body]), 12345, endpoint, nonce)!;
    expect(out.equals(blob)).toBe(true);
    // Another request's answer, or another endpoint, is not ours.
    expect(mapPayload(Buffer.concat([head, body]), 999, endpoint, nonce)).toBeUndefined();
    expect(mapPayload(Buffer.concat([head, body]), 12345, "ZZZZZZZZ", nonce)).toBeUndefined();
  });
});

describe("GET /api/haven/devices/map", () => {
  const ORIGIN = "https://example.test";
  const DEVICE = "0123456789ab";
  async function setup(liveMap: DevicesDeps["liveMap"]) {
    const store = new MemoryAuthStore();
    const deps = { desk: { deskKey: DESK, store, now: NOW }, blob: null, pepper: async () => Buffer.alloc(32), home: () => null, vault: null, fetch: async () => new Response("{}"), log: () => undefined, liveMap } as DevicesDeps;
    return { deps, cookie: await signedInCookie(DESK, NOW, store) };
  }
  const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers: { Origin: ORIGIN, ...headers } });

  it("is for a passkey session only: signed out, a bearer and a phone key all get 401", async () => {
    const { deps } = await setup(async () => ({ state: "idle" }));
    const url = `/api/haven/devices/map?device=${DEVICE}`;
    expect((await devicesMap(get(url), deps)).status).toBe(401);
    expect((await devicesMap(get(url, { Authorization: "Bearer skp_synthetic" }), deps)).status).toBe(401);
    expect((await devicesMap(get(url, { "x-ceo-phone-key": "skp_synthetic" }), deps)).status).toBe(401);
  });

  it("answers idle, a map, a bad device and no map", async () => {
    const asked: string[] = [];
    let answer: { state: "idle" } | { map: unknown } | null = { state: "idle" };
    const { deps, cookie } = await setup(async (d) => (asked.push(d), answer));
    const url = `/api/haven/devices/map?device=${DEVICE}`;
    const idle = await devicesMap(get(url, { Cookie: cookie }), deps);
    expect(idle.status).toBe(200);
    expect(idle.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await idle.json()).toEqual({ state: "idle" });
    answer = { map: { w: 1, h: 1, rooms: [] } };
    expect(((await (await devicesMap(get(url, { Cookie: cookie }), deps)).json()) as { map: unknown }).map).toBeTruthy();
    expect((await devicesMap(get("/api/haven/devices/map?device=nope", { Cookie: cookie }), deps)).status).toBe(400);
    answer = null;
    expect((await devicesMap(get(url, { Cookie: cookie }), deps)).status).toBe(404);
    expect(asked).toEqual([DEVICE, DEVICE, DEVICE]);
  });
});
