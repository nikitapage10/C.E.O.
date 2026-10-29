import { beforeEach, describe, expect, it } from "vitest";
import {
  GET,
  KEEP,
  MemoryDeskStore,
  POST,
  cleanLoad,
  forgetLastWrite,
  isDeskTiming,
} from "./deskTiming.ts";

const at = "2026-10-29T10:00:00.000Z";
const post = (body: unknown, now: number, store = new MemoryDeskStore()) =>
  POST(
    new Request("https://x/api/world?timing=desk", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { store, now },
  );

describe("the Desk load timing beacon (#561)", () => {
  beforeEach(() => forgetLastWrite());

  it("answers on its own path and on the rewrite's query", () => {
    expect(isDeskTiming(new Request("https://x/api/desk-timing"))).toBe(true);
    expect(isDeskTiming(new Request("https://x/api/world?timing=desk"))).toBe(
      true,
    );
    expect(isDeskTiming(new Request("https://x/api/world?timing=talk"))).toBe(
      false,
    );
  });

  it("keeps the two numbers only, with the server's own time", () => {
    const c = cleanLoad(
      { firstPaint: 420.6, dataReady: 1800, url: "/secret", ua: "x", name: "n" },
      at,
    );
    expect(c).toEqual({ at, firstPaint: 421, dataReady: 1800 });
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("refuses what isn't a load, and clamps wild numbers", () => {
    expect(cleanLoad(null, at)).toBeNull();
    expect(cleanLoad({ firstPaint: 1 }, at)).toBeNull();
    expect(cleanLoad({ firstPaint: -1, dataReady: 5 }, at)).toBeNull();
    expect(cleanLoad({ firstPaint: "1", dataReady: 5 }, at)).toBeNull();
    expect(cleanLoad({ firstPaint: 1, dataReady: 1e12 }, at)?.dataReady).toBe(
      600_000,
    );
  });

  it("stores newest first, keeps the last KEEP, and slows a flood", async () => {
    const store = new MemoryDeskStore();
    const ok = { firstPaint: 300, dataReady: 900 };
    expect((await post(ok, 10_000, store)).status).toBe(204);
    expect((await post(ok, 10_500, store)).status).toBe(429);
    for (let i = 0; i < KEEP + 5; i++)
      await store.add({ at: String(i), firstPaint: i, dataReady: i });
    expect((await store.read()).length).toBe(KEEP);
    const res = await GET(new Request("https://x/api/desk-timing"), {
      store,
      now: 0,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(((await res.json()) as { loads: unknown[] }).loads.length).toBe(
      KEEP,
    );
  });

  it("is off without a store, and refuses bad bodies", async () => {
    expect(
      (
        await POST(new Request("https://x/", { method: "POST", body: "{}" }), {
          store: null,
          now: 0,
        })
      ).status,
    ).toBe(503);
    expect((await post("nope", 5000)).status).toBe(400);
    expect((await post({ firstPaint: 1 }, 6000)).status).toBe(400);
    expect((await post("x".repeat(2000), 9000)).status).toBe(413);
  });
});
