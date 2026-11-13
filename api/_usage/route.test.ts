import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import type { UsageLine } from "./meter.ts";
import { daysOf, usageGet, type UsageReader } from "./route.ts";

/** GET /api/boiler-usage (#1142): the passkey session only. Every figure is made up. */

const NOW = Date.parse("2026-11-13T18:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";

const LINE: UsageLine = { at: NOW - 3_600_000, provider: "anthropic", model: "claude-haiku-5-5", feature: "email.sort", tokensIn: 900, tokensOut: 40, cacheWrite: 0, cacheRead: 0, searches: 0, usd: 0.0003, ms: 700, ok: true };

function reader(): UsageReader & { asked: string[] } {
  const asked: string[] = [];
  return { asked, day: async (d) => (asked.push(d), d === "2026-11-13" ? [LINE] : []), truth: async () => ({}) };
}

describe("GET /api/boiler-usage (#1142)", () => {
  it("answers a signed-in passkey session with the report, never cached", async () => {
    const store = new MemoryAuthStore();
    const r = reader();
    const cookie = await signedInCookie(DESK, NOW, store);
    const res = await usageGet(new Request(`${ORIGIN}/api/boiler-usage?days=7`, { headers: { Cookie: cookie } }), { desk: { deskKey: DESK, store, now: NOW }, reader: r, env: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { days: number; totals: { calls: number }; byFeature: { key: string }[] };
    expect(body.days).toBe(7);
    expect(body.totals.calls).toBe(1);
    expect(body.byFeature[0]!.key).toBe("email.sort");
    // The window and the month so far, each day once.
    expect(r.asked).toHaveLength(13);
  });

  it("refuses everyone else before reading anything", async () => {
    const store = new MemoryAuthStore();
    const r = reader();
    const deps = { desk: { deskKey: DESK, store, now: NOW }, reader: r, env: {} };
    const out = await usageGet(new Request(`${ORIGIN}/api/boiler-usage`), deps);
    expect(out.status).toBe(401);
    const forged = await usageGet(new Request(`${ORIGIN}/api/boiler-usage`, { headers: { Cookie: "ceo_desk_session=forged.token" } }), deps);
    expect(forged.status).toBe(401);
    const cookie = await signedInCookie(DESK, NOW, store);
    const cross = await usageGet(new Request(`${ORIGIN}/api/boiler-usage`, { headers: { Cookie: cookie, Origin: "https://elsewhere.test" } }), deps);
    expect(cross.status).toBe(403);
    expect(r.asked).toEqual([]);
    const unset = await usageGet(new Request(`${ORIGIN}/api/boiler-usage`, { headers: { Cookie: cookie } }), { ...deps, desk: { ...deps.desk, deskKey: "" } });
    expect(unset.status).toBe(503);
    const noStore = await usageGet(new Request(`${ORIGIN}/api/boiler-usage`, { headers: { Cookie: cookie } }), { ...deps, reader: null });
    expect(noStore.status).toBe(503);
  });

  it("takes a window of 1 to 90 days, 30 otherwise", () => {
    expect([null, "", "abc", "0", "-3", "2.5", "7", "500"].map(daysOf)).toEqual([30, 30, 30, 30, 30, 30, 7, 90]);
  });
});
