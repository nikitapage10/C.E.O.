import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FAKE_PLAN } from "./plan.fixture.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { PLAN_BODY_MAX, PLAN_PATH, placeLight, planGet, planPost, PlanStore, planPut, readPlan, spotIn, type PlanDeps } from "./plan.ts";

/** The Haven's floor plan (#616): the shape it takes, and the passkey-only store. The plan here is made up. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const NOW = Date.parse("2026-11-04T18:00:00Z");

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: "1", contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? "1" : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch) throw new BlobPreconditionError("unused");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

function deps(blob = memoryBlob(), store = new MemoryAuthStore()): PlanDeps & { lines: string[]; blob: ReturnType<typeof memoryBlob>; store: MemoryAuthStore } {
  const lines: string[] = [];
  return { desk: { deskKey: DESK, store, now: NOW }, blob, env: { [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED }, log: (l) => lines.push(l), lines, store };
}

const post = (body: unknown, cookie = "") =>
  new Request(`${ORIGIN}/api/haven-plan`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("readPlan", () => {
  it("keeps a good plan as it is", () => {
    expect(readPlan(JSON.parse(JSON.stringify(FAKE_PLAN)))).toEqual(FAKE_PLAN);
  });

  it("refuses anything that isn't a plan", () => {
    for (const v of [null, 1, "plan", [], {}, { v: 2, w: 100, h: 100, rooms: [] }, { ...FAKE_PLAN, rooms: [] }]) expect(readPlan(v)).toBeNull();
  });

  it("strips markup from names, drops bad ids, clamps numbers and closes the sets", () => {
    const got = readPlan({
      ...FAKE_PLAN,
      rooms: [
        { id: "ok", name: '<img src=x onerror="1">Den', parts: [[0, 0, 9e9, 50]], floor: "lava", tab: "attic" },
        { id: "Bad ID", name: "x", parts: [[0, 0, 10, 10]] },
        { id: "ok", name: "twice", parts: [[0, 0, 10, 10]] },
        { id: "noparts", name: "x", parts: [[0, 0, -1, 4]] },
      ],
      items: [{ k: "rocket", x: 1, y: 2, w: 3 }, { k: "sofa", x: "1" }],
      devices: [{ kind: "camera", x: 1, y: 1 }, { kind: "thermostat", x: 5, y: 5, lights: "nowhere" }],
      doors: [[0, 0, 10, 10], [0, 0, 10, 0]],
    });
    expect(got?.rooms).toEqual([{ id: "ok", name: "img src=x onerror=1Den", parts: [[0, 0, 5000, 50]], floor: "wood", tab: null, vacuum: null, detached: false }]);
    expect(got?.items).toEqual([{ k: "box", x: 1, y: 2, w: 3, h: 3, round: false }]);
    expect(got?.devices).toEqual([{ kind: "thermostat", x: 5, y: 5, lift: 0, lights: null }]);
    expect(got?.doors).toEqual([[0, 0, 10, 0]]);
  });

  it("keeps the sectional's two walls only when they meet at a corner (#935)", () => {
    expect(readPlan({ ...FAKE_PLAN, sectional: ["e", "s"] })?.sectional).toEqual(["e", "s"]);
    for (const bad of [["e", "w"], ["n"], ["e", "x"], "es", ["s", "s"]]) expect(readPlan({ ...FAKE_PLAN, sectional: bad })).not.toHaveProperty("sectional");
  });

  it("caps the lists", () => {
    const many = Array.from({ length: 900 }, (_, i) => ({ k: "box", x: i, y: i, w: 5, h: 5 }));
    expect(readPlan({ ...FAKE_PLAN, items: many })?.items).toHaveLength(400);
  });
});

describe("/api/haven-plan", () => {
  it("answers nobody without a passkey session", async () => {
    const d = deps();
    expect((await planGet(new Request(`${ORIGIN}/api/haven-plan`), d)).status).toBe(401);
    expect((await planPost(post({ action: "save", plan: FAKE_PLAN }), d)).status).toBe(401);
    expect(d.blob.files.size).toBe(0);
  });

  it("is null until a plan is saved, then serves it back, and forgets it on clear", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    const read = async () => (await (await planGet(new Request(`${ORIGIN}/api/haven-plan`, { headers: { Cookie: cookie } }), d)).json()) as { plan: unknown };
    expect((await read()).plan).toBeNull();
    const saved = await planPost(post({ action: "save", plan: FAKE_PLAN }, cookie), d);
    expect(saved.status).toBe(200);
    expect(d.blob.files.has(PLAN_PATH)).toBe(true);
    expect((await read()).plan).toEqual(FAKE_PLAN);
    // The log line holds counts, never a room's name.
    expect(d.lines.join("\n")).not.toMatch(/Kitchen|Hall|Gym/);
    expect((await planPost(post({ action: "clear" }, cookie), d)).status).toBe(200);
    expect((await read()).plan).toBeNull();
  });

  it("refuses a bad plan, a bad action, a non-JSON body and an outsized one", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    expect((await planPost(post({ action: "save", plan: { v: 1 } }, cookie), d)).status).toBe(400);
    expect((await planPost(post({ action: "drop" }, cookie), d)).status).toBe(400);
    expect((await planPost(post("{nope", cookie), d)).status).toBe(400);
    const big = new Request(`${ORIGIN}/api/haven-plan`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ action: "save", pad: "x".repeat(PLAN_BODY_MAX) }) });
    expect((await planPost(big, d)).status).toBe(413);
    const form = new Request(`${ORIGIN}/api/haven-plan`, { method: "POST", headers: { "Content-Type": "text/plain", Cookie: cookie }, body: "{}" });
    expect((await planPost(form, d)).status).toBe(415);
    expect(d.blob.files.size).toBe(0);
  });
});

describe("PUT /api/haven-plan with the feed key (#655)", () => {
  const put = (body: unknown, key?: string, type = "application/json") =>
    new Request(`${ORIGIN}/api/haven-plan`, { method: "PUT", headers: { "Content-Type": type, ...(key && { Authorization: `Bearer ${key}` }) }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("saves a good plan and answers counts only", async () => {
    const d = deps();
    const res = await planPut(put(FAKE_PLAN, FEED), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rooms: FAKE_PLAN.rooms.length, pieces: FAKE_PLAN.items.length });
    expect(d.blob.files.has(PLAN_PATH)).toBe(true);
    expect(d.lines.join("\n")).toMatch(/\d+ rooms, \d+ pieces/);
    expect(d.lines.join("\n")).not.toContain(FAKE_PLAN.rooms[0]!.name);
    // And a passkey session reads it back.
    const cookie = await signedInCookie(DESK, NOW, d.store);
    const back = await planGet(new Request(`${ORIGIN}/api/haven-plan`, { headers: { Cookie: cookie } }), d);
    expect(((await back.json()) as { plan: unknown }).plan).toEqual(FAKE_PLAN);
  });

  it("refuses no key, the read key and a passkey session alone, and saves nothing", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    const withCookie = new Request(`${ORIGIN}/api/haven-plan`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(FAKE_PLAN) });
    for (const r of [put(FAKE_PLAN), put(FAKE_PLAN, LOG), put(FAKE_PLAN, "wrong-key-wrong-key-wrong-key-wrong-key"), withCookie]) expect((await planPut(r, d)).status).toBe(401);
    expect(d.blob.files.size).toBe(0);
  });

  it("refuses a bad plan, a non-JSON body and an outsized one", async () => {
    const d = deps();
    expect((await planPut(put({ v: 1 }, FEED), d)).status).toBe(400);
    expect((await planPut(put("{nope", FEED), d)).status).toBe(400);
    expect((await planPut(put(FAKE_PLAN, FEED, "text/plain"), d)).status).toBe(415);
    expect((await planPut(put(" ".repeat(PLAN_BODY_MAX + 1), FEED), d)).status).toBe(413);
    expect(d.blob.files.size).toBe(0);
  });

  it("is never readable with either room key", async () => {
    const d = deps();
    await new PlanStore(d.blob).write(FAKE_PLAN);
    for (const key of [LOG, FEED]) {
      const res = await planGet(new Request(`${ORIGIN}/api/haven-plan`, { headers: { Authorization: `Bearer ${key}`, "x-ceo-room-key": key } }), d);
      expect([401, 403]).toContain(res.status);
      expect(await res.text()).not.toContain(FAKE_PLAN.rooms[0]!.name);
    }
  });
});

describe("placing a light on the plan (#974)", () => {
  it("sets, moves and takes off one light's spot, matched by name whatever its case", () => {
    const a = placeLight(FAKE_PLAN, "Test Lamp", { x: 100, y: 200 })!;
    expect(a.lights).toEqual([{ name: "Test Lamp", x: 100, y: 200 }]);
    const b = placeLight(a, "test lamp", { x: 5000, y: 300 })!;
    expect(b.lights).toEqual([{ name: "test lamp", x: FAKE_PLAN.w, y: 300 }]);
    expect(placeLight(b, "TEST LAMP", null)!.lights).toBeUndefined();
    expect(placeLight(FAKE_PLAN, "  ", { x: 1, y: 1 })).toBeNull();
  });

  it("says where in a room by its name: the middle, a wall or a corner, a little in from the walls", () => {
    const [x, y, w, h] = FAKE_PLAN.rooms.find((r) => r.id === "bedroom")!.parts[0]!;
    expect(spotIn(FAKE_PLAN, "the bedroom", "middle")).toEqual({ x: x + w / 2, y: y + h / 2 });
    const sw = spotIn(FAKE_PLAN, "Bedroom", "sw")!;
    expect(sw.x).toBeGreaterThan(x);
    expect(sw.x).toBeLessThan(x + w / 4);
    expect(sw.y).toBeGreaterThan(y + (h * 3) / 4);
    expect(sw.y).toBeLessThan(y + h);
    expect(spotIn(FAKE_PLAN, "Garage", "middle")).toBeNull();
  });

  it("saves a tap's spot to the stored plan for a passkey session, and logs no name or spot", async () => {
    const d = deps();
    const cookie = await signedInCookie(DESK, NOW, d.store);
    expect((await planPost(post({ action: "light", name: "Test Lamp", x: 10, y: 20 }, cookie), d)).status).toBe(409);
    await planPost(post({ action: "save", plan: FAKE_PLAN }, cookie), d);
    expect((await planPost(post({ action: "light", name: "Test Lamp", x: 10, y: 20 }), d)).status).toBe(401);
    const res = await planPost(post({ action: "light", name: "Test Lamp", x: 10, y: 20 }, cookie), d);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plan: { lights: unknown } }).plan.lights).toEqual([{ name: "Test Lamp", x: 10, y: 20 }]);
    expect((await new PlanStore(d.blob).read())!.lights).toEqual([{ name: "Test Lamp", x: 10, y: 20 }]);
    expect((await planPost(post({ action: "light", name: "Test Lamp", clear: true }, cookie), d)).status).toBe(200);
    expect((await new PlanStore(d.blob).read())!.lights).toBeUndefined();
    expect((await planPost(post({ action: "light", name: "Test Lamp" }, cookie), d)).status).toBe(400);
    expect(d.lines.join("\n")).not.toMatch(/Test Lamp|\b10\b|\b20\b/);
  });
});
