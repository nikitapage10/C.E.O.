import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { cleanText, parseRef, pickTop, shapeMarket, sparkOf, type Fetcher } from "./polymarket.ts";
import { GET, POST, PATH, forgetKept, isExchange, type ExchangeDeps } from "./route.ts";
import { PM_TOP_MAX, PM_WATCH_MAX, type PmBoard } from "./types.ts";
import { MemoryWatchStore, cleanIds } from "./watchlist.ts";
import { GET as worldGET, POST as worldPOST } from "../world.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DESK_KEY = "test-desk-key-that-is-long-enough-0123456789";

function raw(id: number, over: Record<string, unknown> = {}) {
  return {
    id: String(id),
    question: `Market ${id}?`,
    slug: `market-${id}`,
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.42", "0.58"]',
    oneDayPriceChange: 0.03,
    volume24hr: 1000 * id,
    volumeNum: 50_000 + id,
    endDate: "2026-12-01T00:00:00Z",
    active: true,
    closed: false,
    clobTokenIds: `["${id}000111", "${id}000222"]`,
    events: [{ id: `e${id}`, slug: `event-${id}` }],
    description: "Long rules text the board never shows.",
    ...over,
  };
}

/** A stand-in for Polymarket: answers by URL, and counts the calls. */
function fakePolymarket(markets: ReturnType<typeof raw>[]) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.hostname === "clob.polymarket.com") return ok({ history: [{ t: 1, p: 0.4 }, { t: 2, p: 0.45 }] });
    if (u.pathname === "/markets" && u.searchParams.has("id")) return ok(markets.filter((m) => u.searchParams.getAll("id").includes(m.id)));
    if (u.pathname === "/markets" && u.searchParams.has("slug")) return ok(markets.filter((m) => m.slug === u.searchParams.get("slug")));
    if (u.pathname === "/events") return ok(markets.some((m) => m.events[0]!.slug === u.searchParams.get("slug")) ? [{ markets: markets.filter((m) => m.events[0]!.slug === u.searchParams.get("slug")) }] : []);
    if (u.pathname === "/markets") return ok(markets);
    return new Response("nope", { status: 404 });
  };
  return { fetcher, calls };
}

function deps(fetcher: Fetcher, over: Partial<ExchangeDeps> = {}): ExchangeDeps & { auth: MemoryAuthStore; watch: MemoryWatchStore } {
  const auth = new MemoryAuthStore();
  return { fetcher, watch: new MemoryWatchStore(), desk: { deskKey: DESK_KEY, store: auth, now: NOW }, now: NOW, auth, ...over } as ExchangeDeps & { auth: MemoryAuthStore; watch: MemoryWatchStore };
}

const get = (path = PATH) => new Request(`https://ceo.test${path}`);
const post = (body: unknown, cookie?: string) =>
  new Request(`https://ceo.test${PATH}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: "https://ceo.test", ...(cookie && { Cookie: cookie }) } });

beforeEach(() => forgetKept());

describe("Polymarket's answers, trimmed and checked", () => {
  it("keeps only the board's fields", () => {
    const m = shapeMarket(raw(7))!;
    expect(m).toMatchObject({ id: "7", question: "Market 7?", outcome: "Yes", prob: 0.42, change24h: 0.03, volume24h: 7000, volume: 50007, url: "https://polymarket.com/event/event-7", closed: false });
    expect(JSON.stringify(m)).not.toContain("rules text");
  });

  it("refuses markets it can't read, and odd numbers", () => {
    expect(shapeMarket(raw(1, { id: "1; drop" }))).toBeNull();
    expect(shapeMarket(raw(1, { outcomePrices: '["1.7"]' }))).toBeNull();
    expect(shapeMarket(raw(1, { question: "" }))).toBeNull();
    expect(shapeMarket("nope")).toBeNull();
    expect(shapeMarket(raw(1, { oneDayPriceChange: 9 }))!.change24h).toBeNull();
    expect(shapeMarket(raw(1, { volume24hr: -5 }))!.volume24h).toBe(0);
  });

  it("strips control and direction characters, and cuts long text", () => {
    expect(cleanText("a\u202eb\u0000c\n\nd")).toBe("a b c d");
    expect(cleanText("x".repeat(500)).length).toBe(160);
    expect(cleanText(42)).toBe("");
  });

  it("only links to polymarket.com, from a checked slug", () => {
    expect(shapeMarket(raw(2, { events: [{ slug: "javascript:alert(1)" }], slug: "../../evil" }))!.url).toBeNull();
    expect(shapeMarket(raw(2, { events: [] }))!.url).toBe("https://polymarket.com/event/market-2");
  });

  it("picks the busiest open markets, skips decided and past-due ones, two per event at most", () => {
    const ms = [
      raw(1),
      raw(2, { outcomePrices: '["0.001", "0.999"]' }),
      raw(3, { endDate: "2026-10-01T00:00:00Z" }),
      raw(4, { closed: true }),
      raw(5, { events: [{ id: "same", slug: "same" }] }),
      raw(6, { events: [{ id: "same", slug: "same" }] }),
      raw(8, { events: [{ id: "same", slug: "same" }] }),
    ];
    expect(pickTop(ms, NOW).map((m) => m!.id)).toEqual(["8", "6", "1"]);
    expect(pickTop(Array.from({ length: 40 }, (_, i) => raw(i + 1)), NOW)).toHaveLength(PM_TOP_MAX);
    expect(pickTop({ not: "a list" }, NOW)).toEqual([]);
  });

  it("thins a day of prices for the sparkline", () => {
    expect(sparkOf({ history: [{ p: 0.1 }, { p: "x" }, { p: 2 }, { p: 0.2 }] })).toEqual([0.1, 0.2]);
    expect(sparkOf({ history: Array.from({ length: 200 }, (_, i) => ({ p: i / 200 })) })).toHaveLength(48);
    expect(sparkOf(null)).toEqual([]);
  });

  it("reads a pin as an id, a slug or a polymarket.com link, and nothing else", () => {
    expect(parseRef("562831")).toEqual({ id: "562831" });
    expect(parseRef("https://polymarket.com/event/fed-decision-in-october")).toEqual({ slug: "fed-decision-in-october" });
    expect(parseRef("https://polymarket.com/event/fed/fed-50-bps")).toEqual({ slug: "fed-50-bps" });
    expect(parseRef("fed-decision")).toEqual({ slug: "fed-decision" });
    expect(parseRef("https://evil.example/event/fed")).toBeNull();
    expect(parseRef("a b")).toBeNull();
    expect(parseRef(7)).toBeNull();
  });

  it("keeps a watchlist of ids only, without repeats, capped", () => {
    expect(cleanIds(["1", "1", "x", 3, "2"])).toEqual(["1", "2"]);
    expect(cleanIds(Array.from({ length: 20 }, (_, i) => String(i)))).toHaveLength(PM_WATCH_MAX);
  });
});

describe("GET /api/exchange-markets", () => {
  it("answers the board, cached at the edge for a minute, and reads Polymarket once a minute", async () => {
    const pm = fakePolymarket([raw(1), raw(2)]);
    const d = deps(pm.fetcher);
    d.watch.ids = ["2"];
    const res = await GET(get(), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
    const b = (await res.json()) as PmBoard;
    expect(b.top.map((m) => m.id)).toEqual(["2", "1"]);
    expect(b.watch.map((m) => m.id)).toEqual(["2"]);
    expect(b.watchlist).toEqual(["2"]);
    expect(b.canPin).toBe(true);
    expect(b.top[0]!.spark).toEqual([0.4, 0.45]);
    expect(JSON.stringify(b)).not.toMatch(/000111|description|clobTokenIds/);
    const n = pm.calls.length;
    await GET(get(), { ...d, now: NOW + 30_000 });
    expect(pm.calls.length).toBe(n);
    await GET(get(), { ...d, now: NOW + 61_000 });
    expect(pm.calls.length).toBeGreaterThan(n);
  });

  it("sends any query back to the bare address, except the rewrite's own", async () => {
    const pm = fakePolymarket([raw(1)]);
    const res = await GET(get(`${PATH}?z=1`), deps(pm.fetcher));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(PATH);
    expect(pm.calls).toEqual([]);
    expect((await GET(get("/api/world?exchange=markets"), deps(pm.fetcher))).status).toBe(200);
  });

  it("serves the last good read when Polymarket stops answering, then says so", async () => {
    const pm = fakePolymarket([raw(1)]);
    await GET(get(), deps(pm.fetcher));
    const down: Fetcher = async () => new Response("", { status: 500 });
    const res = await GET(get(), deps(down, { now: NOW + 120_000 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as PmBoard).stale).toBe(true);
    forgetKept();
    expect((await GET(get(), deps(down))).status).toBe(502);
  });

  it("works without a store, with pins off", async () => {
    const b = (await (await GET(get(), deps(fakePolymarket([raw(1)]).fetcher, { watch: null }))).json()) as PmBoard;
    expect(b.canPin).toBe(false);
    expect(b.watch).toEqual([]);
  });

  it("is routed through the world function on Vercel", async () => {
    expect(isExchange(get("/api/world?exchange=markets"))).toBe(true);
    expect(isExchange(get(PATH))).toBe(true);
    expect(isExchange(get("/api/world"))).toBe(false);
    expect((await worldPOST(new Request("https://ceo.test/api/world", { method: "POST" }))).status).toBe(405);
    expect(typeof worldGET).toBe("function");
  });
});

describe("POST /api/exchange-markets (pins)", () => {
  it("needs the Desk passkey session", async () => {
    const d = deps(fakePolymarket([raw(1)]).fetcher);
    const res = await POST(post({ action: "pin", ref: "1" }), d);
    expect(res.status).toBe(401);
    expect(d.watch.ids).toEqual([]);
  });

  it("refuses another site", async () => {
    const d = deps(fakePolymarket([raw(1)]).fetcher);
    const cookie = await signedInCookie(DESK_KEY, NOW, d.auth);
    const req = new Request(`https://ceo.test${PATH}`, { method: "POST", body: JSON.stringify({ action: "pin", ref: "1" }), headers: { Origin: "https://evil.example", Cookie: cookie } });
    expect((await POST(req, d)).status).toBe(403);
  });

  it("pins by id, slug or link, unpins, and answers the fresh board", async () => {
    const d = deps(fakePolymarket([raw(1), raw(2), raw(3)]).fetcher);
    const cookie = await signedInCookie(DESK_KEY, NOW, d.auth);
    let res = await POST(post({ action: "pin", ref: "1" }, cookie), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toContain("__Host-ceo-desk=");
    await POST(post({ action: "pin", ref: "market-2" }, cookie), d);
    res = await POST(post({ action: "pin", ref: "https://polymarket.com/event/event-3" }, cookie), d);
    expect(((await res.json()) as PmBoard).watch.map((m) => m.id)).toEqual(["1", "2", "3"]);
    await POST(post({ action: "pin", ref: "1" }, cookie), d);
    expect(d.watch.ids).toEqual(["1", "2", "3"]);
    res = await POST(post({ action: "unpin", id: "2" }, cookie), d);
    expect(((await res.json()) as PmBoard).watchlist).toEqual(["1", "3"]);
  });

  it("refuses what it can't find, a full list and a bad body", async () => {
    const d = deps(fakePolymarket(Array.from({ length: 10 }, (_, i) => raw(i + 1))).fetcher);
    const cookie = await signedInCookie(DESK_KEY, NOW, d.auth);
    expect((await POST(post({ action: "pin", ref: "999" }, cookie), d)).status).toBe(404);
    expect((await POST(post({ action: "pin", ref: "https://evil.example/x" }, cookie), d)).status).toBe(404);
    expect((await POST(post({ action: "trade", id: "1" }, cookie), d)).status).toBe(400);
    expect((await POST(post({ action: "unpin", id: "../x" }, cookie), d)).status).toBe(400);
    d.watch.ids = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect((await POST(post({ action: "pin", ref: "9" }, cookie), d)).status).toBe(409);
  });
});
