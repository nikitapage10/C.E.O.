/**
 * The feeders' and the vacuum's adds (#637 scope): dry portions against the cap, the wet tray (turns, the lid, the
 * schedule), the vacuum's mode words, and the phone's words for them. Made-up devices and mocked clouds only.
 */
import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.ts";
import { MemoryRoomLog } from "../../_skippy/log.ts";
import { classify, uncorrected } from "../classify.ts";
import { Home } from "./home.ts";
import type { Fetch } from "./http.ts";
import { PetlibroClient, planTime, wetMeals } from "./petlibro.ts";
import { clockWords, FeedLedger, nextMeal, portionsOf, rotateSteps, TrayLog, traySummary, trayWarning } from "./rails.ts";
import { modeCalls, modeWords } from "./roborock.ts";
import type { DeviceClient, DeviceReading, Found, RunArgs } from "./types.ts";
import { HomeVault, homeKey } from "./vault.ts";

// 11:00 in Denver (MST) on a made-up Wednesday.
const NOW = Date.parse("2026-11-04T18:00:00Z");
const SEAL = homeKey("test-home-token-key-not-a-real-one-000000", "seal")!;
const ID_KEY = homeKey("test-home-token-key-not-a-real-one-000000", "id")!;

function memoryBlob(): BlobBackend {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

function reading(over: Partial<DeviceReading>): DeviceReading {
  return { id: "00000000000a", vendor: "petlibro", kind: "dry-feeder", model: "Test", place: "Kitchen", online: true, state: "idle", alerts: [], ...over };
}

/** A client with fixed devices that records each run and its arguments. */
function stub(readings: DeviceReading[], actions: DeviceClient["actions"], vendor: "petlibro" | "roborock" = "petlibro"): DeviceClient & { ran: { action: string; args: RunArgs }[] } {
  const ran: { action: string; args: RunArgs }[] = [];
  return {
    vendor,
    actions,
    ran,
    connected: async () => true,
    status: async () => readings.map((r): Found => ({ reading: { ...r }, ref: {} })),
    run: async (action, _f, args) => {
      ran.push({ action, args });
      return { ok: true };
    },
  };
}

function homeWith(clients: DeviceClient[], cap = 2) {
  const blob = memoryBlob();
  const council = new MemoryRoomLog();
  return { home: new Home({ blob, clients, feedCap: cap, council, log: () => undefined, now: () => NOW }), blob, council };
}

describe("dry portions count against the feed cap", () => {
  it("reads 1 to 6 portions, 1 when not said", () => {
    expect(portionsOf(undefined)).toBe(1);
    expect(portionsOf(3)).toBe(3);
    expect(portionsOf("2")).toBe(2);
    for (const bad of [0, 7, 1.5, -1, "lots", "12"]) expect(portionsOf(bad), String(bad)).toBeNull();
  });

  it("takes several at once, refuses past the cap and says how many are left", async () => {
    const dry = reading({});
    const client = stub([dry], ["feeder.feed"]);
    const { home, council } = homeWith([client], 3);
    const two = await home.act({ action: "feeder.feed", portions: 2, via: "desk" });
    expect(two).toEqual({ ok: true, say: "2 portions are coming out of the dry food feeder. That's 2 of 3 today." });
    expect(client.ran[0]!.args).toEqual({ portions: 2 });
    const more = await home.act({ action: "feeder.feed", portions: 2, via: "desk" });
    expect(more.ok).toBe(false);
    expect(more.say).toBe("That's 2 portions, and only 1 is left of today's 3. Ask for 1 or fewer.");
    expect(client.ran).toHaveLength(1);
    expect((await home.act({ action: "feeder.feed", via: "desk" })).ok).toBe(true);
    expect((await home.act({ action: "feeder.feed", via: "desk" })).say).toMatch(/already 3 manual feeds/);
    expect((await home.act({ action: "feeder.feed", portions: 9, via: "desk" })).say).toBe("I give 1 to 6 portions at a time.");
    expect((await council.list("kernel", NOW)).map((t) => t.question)).toContain("Feed 2 portions of dry food");
  });

  it("gives every portion back when the feeder fails", async () => {
    const blob = memoryBlob();
    const ledger = new FeedLedger(blob);
    expect(await ledger.reserve("f", 4, NOW, 3)).toEqual({ ok: true, count: 3 });
    await ledger.release("f", NOW, 3);
    expect(await ledger.today(NOW)).toEqual({});
  });

  it("sends grainNum to Petlibro", async () => {
    const calls: unknown[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/member/auth/login")) return Response.json({ code: 0, data: { token: "t" } });
      calls.push(JSON.parse(String(init.body)));
      return Response.json({ code: 0, data: 1 });
    }) as Fetch;
    const c = new PetlibroClient({ fetch: f, vault: new HomeVault(memoryBlob(), SEAL), idKey: ID_KEY, email: "test@example.com", loginDigest: "0".repeat(32), now: () => NOW });
    expect(await c.run("feeder.feed", { reading: reading({}), ref: { serial: "DRY-TEST", plate: 1 } }, { portions: 3 })).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ deviceSn: "DRY-TEST", grainNum: 3 });
  });
});

describe("the wet tray remembers the schedule", () => {
  const meals = [{ time: "07:00", plate: 1 }, { time: "18:00", plate: 2 }];

  it("reads the plan's times and bowls", () => {
    expect(planTime("18:00")).toBe("18:00");
    expect(planTime("6:30")).toBe("06:30");
    expect(planTime(Date.parse("2026-11-04T01:00:00Z"))).toBe("18:00");
    expect(planTime("soon")).toBeNull();
    expect(wetMeals({ plan: [{ plate: 2, executionStartTime: "18:00" }, { plate: 1, executionStartTime: "07:00" }, { plate: 3, executionStartTime: "12:00", enable: false }] })).toEqual(meals);
    expect(clockWords("18:00")).toBe("6pm");
    expect(clockWords("07:30")).toBe("7:30am");
  });

  it("finds the next meal, today or tomorrow", () => {
    expect(nextMeal(meals, NOW)).toEqual({ time: "18:00", plate: 2, tomorrow: false });
    expect(nextMeal(meals, Date.parse("2026-11-05T04:00:00Z"))).toEqual({ time: "07:00", plate: 1, tomorrow: true });
    expect(nextMeal([], NOW)).toBeNull();
  });

  it("counts the turns to a bowl, one way round", () => {
    expect(rotateSteps(1, undefined)).toBe(1);
    expect(rotateSteps(1, 3)).toBe(2);
    expect(rotateSteps(3, 1)).toBe(1);
    expect(rotateSteps(2, 2)).toBe(0);
    expect(rotateSteps(undefined, 2)).toBeNull();
    expect(rotateSteps(1, 4)).toBeNull();
  });

  it("warns when the next meal would land on the wrong or an empty bowl", () => {
    const tray = { day: "2026-11-04", front: 2, served: [2] };
    expect(trayWarning(3, tray, meals, NOW)).toBe(" Heads up: bowl 3 is in front, but the next scheduled meal at 6pm is set for bowl 2.");
    expect(trayWarning(2, tray, [{ time: "18:00" }], NOW)).toBe(" Heads up: the next scheduled meal at 6pm will open bowl 2, which was already served today.");
    expect(trayWarning(2, { ...tray, served: [] }, meals, NOW)).toBe("");
  });

  it("refuses a turn with the lid open, turns to a bowl, and says what the schedule will do", async () => {
    const open = stub([reading({ kind: "wet-feeder", state: "lid open", plate: 1, meals })], ["wet.rotate"]);
    expect((await homeWith([open]).home.act({ action: "wet.rotate", via: "desk" })).say).toMatch(/lid is open/);
    expect(open.ran).toHaveLength(0);

    const closed = stub([reading({ kind: "wet-feeder", state: "closed", plate: 1, meals })], ["wet.rotate", "wet.open", "wet.status"]);
    const { home, blob } = homeWith([closed]);
    const turned = await home.act({ action: "wet.rotate", plate: 3, via: "phone", said: "switch the wet feeder to bowl 3" });
    expect(turned).toEqual({ ok: true, say: "Bowl 3 is turning to the front of the wet food feeder. Heads up: bowl 3 is in front, but the next scheduled meal at 6pm is set for bowl 2." });
    expect(closed.ran[0]).toEqual({ action: "wet.rotate", args: { steps: 2 } });
    expect((await new TrayLog(blob).read(NOW)).front).toBe(3);
    // A turn serves nothing (the lid is shut), so the cap is untouched.
    expect(await new FeedLedger(blob).today(NOW)).toEqual({});
    expect((await home.act({ action: "wet.rotate", plate: 1, via: "desk" })).say).toBe("Bowl 1 is already at the front of the wet food feeder.");
  });

  it("remembers an opened bowl and answers what's in the wet feeder", async () => {
    const wet = stub([reading({ kind: "wet-feeder", state: "closed", plate: 2, meals })], ["wet.open", "wet.status"]);
    const { home } = homeWith([wet]);
    const opened = await home.act({ action: "wet.open", via: "desk" });
    // Bowl 2 is now served, and the 6pm meal is set for bowl 2: the reply says so.
    expect(opened.say).toBe("The wet food feeder's lid is open. That's 1 of 2 today. Heads up: the next scheduled meal at 6pm will open bowl 2, which was already served today.");
    const said = (await home.act({ action: "wet.status", via: "phone" })).say;
    expect(said).toBe("Bowl 2 is in front, lid closed. Served from here today: bowl 2. Scheduled: 7am (bowl 1), 6pm (bowl 2). Heads up: the next scheduled meal at 6pm will open bowl 2, which was already served today.");
    expect(wet.ran.map((r) => r.action)).toEqual(["wet.open"]);
    expect(traySummary(reading({ kind: "wet-feeder", online: false }), { day: "", front: null, served: [] }, NOW)).toBe("The wet food feeder is offline.");
  });

  it("turns the tray with platePositionChange, a gap between turns, and closes the lid with stopFeedNow", async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/member/auth/login")) return Response.json({ code: 0, data: { token: "t" } });
      calls.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) });
      return Response.json({ code: 0, data: null });
    }) as Fetch;
    const waits: number[] = [];
    const c = new PetlibroClient({ fetch: f, vault: new HomeVault(memoryBlob(), SEAL), idKey: ID_KEY, email: "test@example.com", loginDigest: "0".repeat(32), now: () => NOW, pause: async (ms) => void waits.push(ms) });
    const found = { reading: reading({ kind: "wet-feeder" }), ref: { serial: "WET-TEST", plate: 1, feedId: 42 } };
    expect(await c.run("wet.rotate", found, { steps: 2 })).toEqual({ ok: true });
    expect(calls.map((x) => x.path)).toEqual(["/device/wetFeedingPlan/platePositionChange", "/device/wetFeedingPlan/platePositionChange"]);
    expect(waits).toEqual([2000]);
    expect(await c.run("wet.close", found, {})).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({ path: "/device/wetFeedingPlan/stopFeedNow", body: { deviceSn: "WET-TEST", feedId: 42 } });
    expect(await c.run("wet.close", { ...found, ref: { serial: "WET-TEST", plate: 1 } }, {})).toEqual({ ok: true, say: "The wet food feeder's lid is already closed." });
  });
});

describe("the vacuum's mode words", () => {
  it("maps the words to Roborock's codes, and nothing without a word", () => {
    expect(modeCalls({})).toEqual([]);
    expect(modeCalls({ suction: "quiet", water: "off" })).toEqual([["set_custom_mode", [101]], ["set_water_box_custom_mode", [200]]]);
    expect(modeCalls({ suction: "max", water: "on" })).toEqual([["set_custom_mode", [104]], ["set_water_box_custom_mode", [202]]]);
    expect(modeWords({ suction: "quiet", water: "off" })).toBe(", quietly, vacuum only");
  });

  it("passes the words through the rails to the vacuum", async () => {
    const vac = stub([reading({ vendor: "roborock", kind: "vacuum", state: "docked", rooms: ["Kitchen"] })], ["vacuum.rooms", "vacuum.start"], "roborock");
    const { home, council } = homeWith([vac]);
    await home.act({ action: "vacuum.rooms", rooms: ["kitchen"], suction: "max", water: "nonsense", via: "desk" });
    expect(vac.ran[0]).toEqual({ action: "vacuum.rooms", args: { rooms: ["kitchen"], suction: "max" } });
    await home.act({ action: "vacuum.start", via: "desk" });
    expect(vac.ran[1]).toEqual({ action: "vacuum.start", args: {} });
    expect((await council.list("kernel", NOW)).map((t) => t.question)).toContain("Clean the kitchen (on max)");
  });
});

describe("what the phone hears for them", () => {
  it("reads portions, bowls and the wet feeder's questions", () => {
    expect(classify("feed the cat 2 portions")).toEqual({ kind: "device", action: "feeder.feed", portions: 2 });
    expect(classify("give the cat three scoops")).toEqual({ kind: "device", action: "feeder.feed", portions: 3 });
    expect(classify("feed the cat")).toEqual({ kind: "device", action: "feeder.feed" });
    expect(classify("next bowl")).toEqual({ kind: "device", action: "wet.rotate" });
    expect(classify("switch the wet feeder to tray 2")).toEqual({ kind: "device", action: "wet.rotate", plate: 2 });
    expect(classify("rotate the cat's bowl to bowl three")).toEqual({ kind: "device", action: "wet.rotate", plate: 3 });
    expect(classify("give the cat wet food")).toEqual({ kind: "device", action: "wet.open" });
    expect(classify("what's in the wet feeder")).toEqual({ kind: "device", action: "wet.status" });
    expect(classify("close the wet feeder")).toEqual({ kind: "device", action: "wet.close" });
  });

  it("reads the vacuum's mode words and keeps the rooms clean of them", () => {
    expect(classify("clean the kitchen on max")).toEqual({ kind: "device", action: "vacuum.rooms", rooms: ["kitchen"], suction: "max" });
    expect(classify("vacuum the hall quietly, vacuum only")).toEqual({ kind: "device", action: "vacuum.rooms", rooms: ["hall"], suction: "quiet", water: "off" });
    expect(classify("vacuum and mop the kitchen")).toEqual({ kind: "device", action: "vacuum.rooms", rooms: ["kitchen"], water: "on" });
    expect(classify("start the vacuum")).toEqual({ kind: "device", action: "vacuum.start" });
  });
});

describe("corrections land on the Kitchen list (#641)", () => {
  it("drops a leading correction", () => {
    expect(uncorrected("No I meant like can you just add garlic")).toBe("add garlic");
    expect(uncorrected("no")).toBe("no");
  });

  it("puts an item on the list however the correction is said", () => {
    expect(classify("No I meant like can you just add garlic to the list don't add that add as a task add it as a item for my grocery")).toEqual({ kind: "shopping", items: ["garlic"] });
    expect(classify("Actually add basil to my grocery list")).toEqual({ kind: "shopping", items: ["basil"] });
    expect(classify("no, put shallots and limes on the shopping list")).toEqual({ kind: "shopping", items: ["shallots", "limes"] });
    expect(classify("add cumin as an item for my groceries")).toEqual({ kind: "shopping", items: ["cumin"] });
    expect(classify("remind me to call the vet tomorrow")).toMatchObject({ kind: "todo" });
  });

  it("moves the last to-do when it says not as a task", () => {
    expect(classify("no not as a task, put it on the grocery list", "todo")).toEqual({ kind: "shopping", items: [], fromLastTodo: true });
    expect(classify("no not as a task, put it on the grocery list", null)).not.toMatchObject({ fromLastTodo: true });
  });
});
