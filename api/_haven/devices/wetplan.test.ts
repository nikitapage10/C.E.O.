/**
 * The wet feeder's plan (wetListV3), read the way the community integration's Polar code reads it (templateName and
 * plan[], each entry's id, plate, label, executionStartTime and executionEndTime), and the private shape diagnostic
 * that tells a plan Petlibro doesn't send to the Haven's account from one the parser drops. Synthetic answers only.
 */
import { describe, expect, it } from "vitest";
import { Home } from "./home.ts";
import { cleanLabel, onOff, petlibroReading, PetlibroClient, planTime, shapeLine, wetMeals, wetPlanShape } from "./petlibro.ts";
import { noPlanWords, traySummary } from "./rails.ts";
import type { BlobBackend } from "../../_blob.ts";
import type { Fetch } from "./http.ts";
import { HomeVault, homeKey } from "./vault.ts";

// 11:00 in Denver (MST) on a made-up Wednesday.
const NOW = Date.parse("2026-11-04T18:00:00Z");
const SEAL = homeKey("test-home-token-key-not-a-real-one-000000", "seal")!;
const ID_KEY = homeKey("test-home-token-key-not-a-real-one-000000", "id")!;

function memoryBlob(): BlobBackend {
  const files = new Map<string, Uint8Array>();
  return {
    kind: "azureblob",
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: "1", contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? "1" : null),
    put: async (path, body) => {
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

/** A plan shaped like the integration's: a template name and three meals, one per bowl. */
const PLAN = {
  templateName: "Made-up plan",
  manualFeedId: null,
  plan: [
    { id: 101, plate: 1, label: "Bowl one", executionStartTime: "07:00", executionEndTime: "09:00" },
    { id: 102, plate: 2, label: "Bowl two", executionStartTime: "10:30", executionEndTime: "12:30" },
    { id: 103, plate: 3, label: "Bowl three", executionStartTime: "18:00", executionEndTime: "20:00" },
  ],
};

describe("wet plan times in every shape the plan may use", () => {
  it("reads HH:MM, HH:MM:SS, 12-hour, dates, minutes since midnight and epochs", () => {
    expect(planTime("18:00")).toBe("18:00");
    expect(planTime("6:30")).toBe("06:30");
    expect(planTime("18:00:00")).toBe("18:00");
    expect(planTime("6:00 PM")).toBe("18:00");
    expect(planTime("12:15am")).toBe("00:15");
    expect(planTime("2026-11-05 18:00:00")).toBe("18:00");
    expect(planTime("2026-11-05T01:00:00Z")).toBe("18:00");
    expect(planTime(1080)).toBe("18:00");
    expect(planTime("420")).toBe("07:00");
    expect(planTime(0)).toBe("00:00");
    expect(planTime(Date.parse("2026-11-04T01:00:00Z"))).toBe("18:00");
    expect(planTime(Date.parse("2026-11-04T01:00:00Z") / 1000)).toBe("18:00");
    expect(planTime(String(Date.parse("2026-11-04T01:00:00Z") / 1000))).toBe("18:00");
  });

  it("refuses what isn't a time", () => {
    expect([planTime("soon"), planTime("25:00"), planTime("13:00 PM"), planTime(-5), planTime(5000), planTime(null), planTime({})]).toEqual([null, null, null, null, null, null, null]);
  });

  it("reads switches as booleans, 1 and 0, or words", () => {
    expect([onOff(true), onOff(1), onOff("1"), onOff("true"), onOff(false), onOff(0), onOff("0"), onOff("false"), onOff(undefined), onOff("maybe")]).toEqual([true, true, true, true, false, false, false, false, undefined, undefined]);
  });
});

describe("wetMeals against the integration's plan shape", () => {
  it("keeps every meal with its bowl, window and label", () => {
    expect(wetMeals(PLAN, NOW)).toEqual([
      { time: "07:00", end: "09:00", plate: 1, label: "Bowl one", status: "done" },
      { time: "10:30", end: "12:30", plate: 2, label: "Bowl two", status: "now" },
      { time: "18:00", end: "20:00", plate: 3, label: "Bowl three", status: "next" },
    ]);
  });

  it("drops a meal switched off as false or 0, and keeps one with enable 1", () => {
    const plan = { plan: [{ plate: 1, executionStartTime: "07:00", enable: 0 }, { plate: 2, executionStartTime: "12:00", enable: "false" }, { plate: 3, executionStartTime: "18:00", enable: 1 }] };
    expect(wetMeals(plan)).toEqual([{ time: "18:00", plate: 3 }]);
  });

  it("shifts a plan that numbers its bowls 0 to 2, and reads plates sent as digits", () => {
    expect(wetMeals({ plan: [{ plate: 0, executionStartTime: "07:00" }, { plate: 2, executionStartTime: "18:00" }] })).toEqual([
      { time: "07:00", plate: 1 },
      { time: "18:00", plate: 3 },
    ]);
    expect(wetMeals({ plan: [{ plate: "2", executionStartTime: "07:00" }] })).toEqual([{ time: "07:00", plate: 2 }]);
  });

  it("reads minutes since midnight and HH:MM:SS windows", () => {
    expect(wetMeals({ plan: [{ plate: 1, executionStartTime: 420, executionEndTime: 540 }, { plate: 2, executionStartTime: "18:00:00", executionEndTime: "20:00:00" }] })).toEqual([
      { time: "07:00", end: "09:00", plate: 1 },
      { time: "18:00", end: "20:00", plate: 2 },
    ]);
  });

  it("cleans and cuts a label", () => {
    expect(cleanLabel("  Two\n  words ")).toBe("Two words");
    expect(cleanLabel("x".repeat(60))).toHaveLength(40);
    expect(cleanLabel(7)).toBe("");
  });
});

describe("the wet plan's shape (private diagnostic)", () => {
  it("counts entries and names keys, never values", () => {
    const s = wetPlanShape({ ...PLAN, plan: [...PLAN.plan, { id: 104, plate: 1, executionStartTime: "later", enable: false }] });
    expect(s).toEqual({ read: "ok", template: true, entries: 4, disabled: 1, badTime: 1, keys: ["enable", "executionEndTime", "executionStartTime", "id", "label", "plate"], top: ["manualFeedId", "plan", "templateName"] });
    const line = shapeLine(s);
    expect(line).toContain("entries=4");
    expect(line).not.toMatch(/Made-up|Bowl one|07:00|101/);
  });

  it("tells an empty plan from a failed read", () => {
    expect(wetPlanShape({ templateName: "", plan: [] })).toMatchObject({ read: "ok", template: false, entries: 0, keys: [] });
    expect(wetPlanShape(null, true)).toMatchObject({ read: "failed", template: false, entries: 0 });
  });

  it("rides on the wet reading with the device list's fallback, and never on the public face", () => {
    const item = { productName: "Test Wet Feeder", nextFeedingTime: "18:00", nextFeedingEndTime: "20:00", enableFeedingPlan: true };
    const empty = petlibroReading("00000000000e", "wet-feeder", item, { online: true, platePosition: 2 }, { wet: { templateName: "", plan: [] } }, NOW);
    expect(empty).toMatchObject({ plate: 2, nextFeed: { time: "18:00", end: "20:00" }, planOn: true, wetPlanShape: { read: "ok", entries: 0 } });
    expect(empty).not.toHaveProperty("meals");
    const full = petlibroReading("00000000000e", "wet-feeder", item, { online: true, platePosition: 3 }, { wet: PLAN }, NOW);
    expect(full.meals).toHaveLength(3);
    expect(full.wetPlanShape).toMatchObject({ entries: 3, template: true });
    const failed = petlibroReading("00000000000e", "wet-feeder", item, { online: true }, { wet: null }, NOW);
    expect(failed.wetPlanShape).toMatchObject({ read: "failed" });
    const pub = Home.publicOf({ vendors: { roborock: "waiting", petlibro: "live", whisker: "waiting", nest: "waiting" }, problems: {}, devices: [full], feedCap: 2 });
    expect(JSON.stringify(pub)).not.toMatch(/wetPlanShape|entries|Bowl|executionStartTime/);
  });

  it("logs the shape once per cold start, counts and key names only", async () => {
    const lines: string[] = [];
    const f = (async (url: string) => {
      if (url.endsWith("/member/auth/login")) return Response.json({ code: 0, data: { token: "t" } });
      if (url.endsWith("/device/device/list")) return Response.json({ code: 0, data: [{ deviceSn: "WET-TEST", productName: "Polar Wet Food Feeder" }] });
      if (url.endsWith("/wetListV3")) return Response.json({ code: 0, data: PLAN });
      return Response.json({ code: 0, data: {} });
    }) as Fetch;
    const c = new PetlibroClient({ fetch: f, vault: new HomeVault(memoryBlob(), SEAL), idKey: ID_KEY, email: "test@example.com", loginDigest: "0".repeat(32), now: () => NOW, log: (l) => lines.push(l) });
    const [found] = await c.status();
    expect(found!.reading.wetPlanShape).toMatchObject({ entries: 3 });
    await c.status();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^petlibro: wet plan read=ok template=true entries=3/);
    expect(lines[0]).not.toMatch(/WET-TEST|Made-up|Bowl/);
  });
});

describe("the tray in words without a plan", () => {
  it("says the Haven's account can't see a schedule, or what the device list says", () => {
    expect(noPlanWords({})).toBe("No schedule visible to the Haven's account.");
    expect(noPlanWords({ nextFeed: { time: "18:00" } })).toBe("No schedule visible to the Haven's account; the feeder says the next meal is at 6pm.");
    expect(noPlanWords({ planOn: false })).toBe("The feeding schedule is switched off in the Petlibro app.");
    const say = traySummary({ online: true, state: "closed", plate: 1, meals: [{ time: "18:00", plate: 2, label: "Bowl two" }] }, { day: "", front: null, served: [] }, NOW);
    expect(say).toContain("6pm (bowl 2, Bowl two)");
  });
});
