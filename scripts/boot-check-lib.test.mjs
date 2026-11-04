import { describe, expect, it } from "vitest";
import { API_PROBES, apiDown, probeApi } from "./boot-check-lib.mjs";

describe("the live watch's API probe (#704)", () => {
  it("counts a missing route, a server error or no answer as down", () => {
    for (const s of [404, 500, 502, 503, 504, undefined, Number.NaN]) expect(apiDown(s)).toBe(true);
  });

  it("counts any answer from a function as up, a key or session wanted included", () => {
    for (const s of [200, 204, 301, 304, 401, 403, 405, 429]) expect(apiDown(s)).toBe(false);
  });

  it("asks real routes, not a /api/health that Azure doesn't have", () => {
    expect(API_PROBES.length).toBeGreaterThanOrEqual(2);
    for (const p of API_PROBES) expect(p).toMatch(/^\/api\/[a-z-]+$/);
    expect(API_PROBES).not.toContain("/api/health");
  });

  it("passes when every probe answers, even with a 401", async () => {
    const seen = [];
    const misses = await probeApi("https://site.example", async (url) => (seen.push(url), url.endsWith("/api/world") ? 200 : 401));
    expect(misses).toEqual([]);
    expect(seen).toEqual(API_PROBES.map((p) => `https://site.example${p}`));
  });

  it("names each probe that found the API down, this morning's 404s included", async () => {
    expect(await probeApi("https://site.example", async () => 404)).toEqual(API_PROBES.map((p) => `${p} answered 404`));
    const misses = await probeApi("https://site.example", async (url) => {
      if (url.endsWith("/api/world")) throw new Error("The operation was aborted due to timeout");
      return 503;
    });
    expect(misses).toEqual(["/api/world answered nothing (The operation was aborted due to timeout)", "/api/foundry-feed answered 503"]);
  });
});
