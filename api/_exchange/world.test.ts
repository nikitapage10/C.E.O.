import { beforeEach, describe, expect, it } from "vitest";
import { isOffTopic, pickWorld, readWorld, tagsOf, WORLD_MIN_VOL, WORLD_TAGS, worldUrl, type Fetcher } from "./polymarket.ts";
import { GET, forgetKept, type ExchangeDeps } from "./route.ts";
import { PM_WORLD_MAX, type PmBoard } from "./types.ts";
import { MemoryWatchStore } from "./watchlist.ts";
import { MemoryAuthStore } from "../_desk/store.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function raw(id: number, over: Record<string, unknown> = {}) {
  return {
    id: String(id),
    question: `World market ${id}?`,
    slug: `world-${id}`,
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.30", "0.70"]',
    oneDayPriceChange: 0.02,
    volume24hr: 100_000 + id,
    volumeNum: 900_000,
    endDate: "2026-12-31T00:00:00Z",
    active: true,
    closed: false,
    clobTokenIds: `["${id}0001", "${id}0002"]`,
    events: [{ id: `e${id}`, slug: `world-event-${id}` }],
    tags: [{ slug: "politics" }],
    ...over,
  };
}

beforeEach(() => forgetKept());

describe("world-moving markets for the Bookie's asides (#345)", () => {
  it("reads Polymarket by topic, GET only, tags included", () => {
    expect(WORLD_TAGS.map((t) => t.kind)).toEqual(["geopolitics", "politics", "culture"]);
    const u = new URL(worldUrl("2"));
    expect(u.origin).toBe("https://gamma-api.polymarket.com");
    expect(u.searchParams.get("tag_id")).toBe("2");
    expect(u.searchParams.get("include_tag")).toBe("true");
    expect(u.searchParams.get("closed")).toBe("false");
  });

  it("leaves out sports, by tag or by league, and tweet-count noise", () => {
    expect(isOffTopic("Will the Chiefs win?", ["sports", "nfl"])).toBe(true);
    expect(isOffTopic("Super Bowl LXI winner?", [])).toBe(true);
    expect(isOffTopic("Will Elon post 200 tweets?", ["pop-culture", "tweets-markets"])).toBe(true);
    expect(isOffTopic("NATO x Russia military clash by December 31?", ["geopolitics", "nato"])).toBe(false);
    expect(tagsOf({ tags: [{ slug: "politics" }, { slug: "<b>" }, "x"] })).toEqual(["politics"]);
  });

  it("picks open, live, busy markets, one per event, every topic first, best moves next", () => {
    const geo = [raw(1, { oneDayPriceChange: -0.14, tags: [{ slug: "geopolitics" }] }), raw(2, { events: [{ id: "e1", slug: "world-event-1" }] }), raw(3, { tags: [{ slug: "sports" }] })];
    const pol = [raw(1), raw(4, { oneDayPriceChange: 0.001 }), raw(5, { outcomePrices: '["0.995", "0.005"]' }), raw(6, { volume24hr: WORLD_MIN_VOL - 1 }), raw(7, { endDate: "2026-10-01T00:00:00Z" })];
    const cul = [raw(8, { oneDayPriceChange: 0.3, tags: [{ slug: "pop-culture" }] }), raw(9, { question: "NBA Finals champion?", tags: [{ slug: "pop-culture" }] })];
    const got = pickWorld([geo, pol, cul], NOW);
    expect(got.map((m) => [m.id, m.kind])).toEqual([
      ["1", "geopolitics"],
      ["4", "politics"],
      ["8", "culture"],
    ]);
    expect(JSON.stringify(got)).not.toMatch(/"tags"|sports/);
  });

  it("caps the asides, and a topic that didn't answer just sits out", () => {
    const many = Array.from({ length: 20 }, (_, i) => raw(100 + i));
    expect(pickWorld([null, many, null], NOW)).toHaveLength(PM_WORLD_MAX);
    expect(pickWorld([null, null, null], NOW)).toEqual([]);
  });

  it("throws only when no topic answers, and sends no tags or tokens on", async () => {
    const down: Fetcher = async () => new Response("no", { status: 503 });
    await expect(readWorld(down, NOW)).rejects.toThrow();
    const some: Fetcher = async (url) => {
      const u = new URL(url);
      if (u.hostname === "clob.polymarket.com") return Response.json({ history: [{ p: 0.2 }, { p: 0.3 }] });
      if (u.searchParams.get("tag_id") === "2") return Response.json([raw(11)]);
      return new Response("no", { status: 500 });
    };
    const got = await readWorld(some, NOW);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: "11", kind: "politics", spark: [0.2, 0.3] });
    expect(Object.keys(got[0]!)).not.toContain("token");
    expect(Object.keys(got[0]!)).not.toContain("tags");
  });

  it("the board carries them, and says nothing made up when the read fails", async () => {
    const deps = (fetcher: Fetcher): ExchangeDeps => ({ fetcher, watch: new MemoryWatchStore(), desk: { deskKey: "k".repeat(40), store: new MemoryAuthStore(), now: NOW }, now: NOW });
    const ok: Fetcher = async (url) => {
      const u = new URL(url);
      if (u.hostname === "clob.polymarket.com") return Response.json({ history: [] });
      if (u.searchParams.has("tag_id")) return Response.json(u.searchParams.get("tag_id") === "100265" ? [raw(21, { tags: [{ slug: "geopolitics" }] })] : []);
      return Response.json([raw(31)]);
    };
    const b = (await (await GET(new Request("https://ceo.test/api/exchange-markets"), deps(ok))).json()) as PmBoard;
    expect(b.world.map((m) => [m.id, m.kind])).toEqual([["21", "geopolitics"]]);
    forgetKept();
    const noWorld: Fetcher = async (url) => (new URL(url).searchParams.has("tag_id") ? new Response("no", { status: 502 }) : ok(url));
    const res = await GET(new Request("https://ceo.test/api/exchange-markets"), deps(noWorld));
    expect(res.status).toBe(200);
    const b2 = (await res.json()) as PmBoard;
    expect(b2.world).toEqual([]);
    expect(b2.top.length).toBeGreaterThan(0);
  });
});
