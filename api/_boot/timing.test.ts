import { beforeEach, describe, expect, it } from "vitest";
import { GET, KEEP, MemoryTimingStore, POST, cleanTiming, forgetLastWrite, isTiming } from "./timing.ts";

const good = { kind: "warmed", trip: 1, firstFrame: 412.4, curtain: 412, fps: 58, worstFrame: 40, draws: 900, triangles: 2_000_000, programs: 230 };
const post = (body: unknown, now: number, store = new MemoryTimingStore()) =>
  POST(new Request("https://x/api/world?timing=lattice", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { store, now });

describe("the Lattice's boot-timing beacon (#373)", () => {
  beforeEach(() => forgetLastWrite());

  it("answers on its own path and on the rewrite's query", () => {
    expect(isTiming(new Request("https://x/api/lattice-timing"))).toBe(true);
    expect(isTiming(new Request("https://x/api/world?timing=lattice"))).toBe(true);
    expect(isTiming(new Request("https://x/api/world"))).toBe(false);
  });

  it("keeps timings and counts only, rounded, with the server's own time", () => {
    const t = cleanTiming({ ...good, name: "Nikita", url: "/lattice?room=spire", at: "1999-01-01" }, "2026-10-24T04:00:00.000Z");
    expect(t).toEqual({ ...good, firstFrame: 412, at: "2026-10-24T04:00:00.000Z" });
    expect(Object.keys(t!)).not.toContain("name");
  });

  it("refuses anything that isn't a timing", () => {
    const at = "2026-10-24T04:00:00.000Z";
    expect(cleanTiming({ ...good, kind: "sneaky" }, at)).toBeNull();
    expect(cleanTiming({ ...good, fps: -1 }, at)).toBeNull();
    expect(cleanTiming({ ...good, draws: "lots" }, at)).toBeNull();
    expect(cleanTiming(null, at)).toBeNull();
    expect(cleanTiming({ ...good, curtain: 1e12 }, at)?.curtain).toBe(600_000);
  });

  it("stores a good one, newest first, keeping the last KEEP", async () => {
    const store = new MemoryTimingStore();
    for (let i = 0; i < KEEP + 5; i++) {
      forgetLastWrite();
      expect((await post({ ...good, trip: i + 1 }, 1_000_000 + i, store)).status).toBe(204);
    }
    expect(store.list).toHaveLength(KEEP);
    expect(store.list[0]!.trip).toBe(KEEP + 5);
    const res = await GET(new Request("https://x/api/lattice-timing"), { store, now: 0 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const view = (await res.json()) as { ok: boolean; timings: unknown[] };
    expect(view.ok).toBe(true);
    expect(view.timings).toHaveLength(KEEP);
  });

  it("turns away bad bodies, big bodies and a flood", async () => {
    expect((await post("not json", 1)).status).toBe(400);
    expect((await post({ ...good, kind: "x" }, 1)).status).toBe(400);
    expect((await post("x".repeat(2000), 1)).status).toBe(413);
    const store = new MemoryTimingStore();
    expect((await post(good, 10_000, store)).status).toBe(204);
    expect((await post(good, 10_100, store)).status).toBe(429);
    expect(store.list).toHaveLength(1);
  });

  it("says so when no store is set up", async () => {
    const res = await POST(new Request("https://x/api/lattice-timing", { method: "POST", body: JSON.stringify(good) }), { store: null, now: 0 });
    expect(res.status).toBe(503);
  });
});
