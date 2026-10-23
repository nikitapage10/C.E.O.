import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import type { Fetcher } from "./polymarket.ts";
import { GET, POSITIONS_PATH, READ_PATHS, US_API, forgetPositions, isPositions, keyFrom, shapePosition, shapeTrade, signedGet, type PositionsDeps, type UsKey } from "./positions.ts";
import type { PmPositions } from "./types.ts";
import { GET as worldGET } from "../world.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DESK_KEY = "test-desk-key-that-is-long-enough-0123456789";
const KEY_ID = "0b4c7f3e-1d2a-4e5f-9a8b-7c6d5e4f3a2b";

/** A throwaway Ed25519 pair: the secret as Polymarket US hands it out (base64 of the 32-byte seed), and the public half. */
function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(-32);
  return { secret: seed.toString("base64"), publicKey };
}
const KEY = testKey();
const usKey = () => keyFrom({ POLYMARKET_US_KEY_ID: KEY_ID, POLYMARKET_US_SECRET_KEY: KEY.secret }) as UsKey;

const amt = (v: string) => ({ value: v, currency: "USD" });

const POSITIONS = {
  positions: {
    "brewers-win-world-series": {
      netPositionDecimal: "40.0000",
      cost: amt("22.00"),
      cashValue: amt("25.20"),
      realized: amt("1.50"),
      expired: false,
      updateTime: "2026-10-21T20:00:00Z",
      marketMetadata: { slug: "brewers-win-world-series", title: "Brewers win the World Series?", outcome: "Yes", eventSlug: "mlb-world-series-2026", icon: "https://x/y.png" },
    },
    "fed-cut-december": {
      netPositionDecimal: "-10",
      cost: amt("6.00"),
      cashValue: amt("4.00"),
      realized: amt("0"),
      expired: false,
      marketMetadata: { title: "Fed cuts in December?", outcome: "Yes", eventSlug: "javascript:alert(1)" },
    },
    "dust-left-over": { netPositionDecimal: "0.001", cost: amt("0"), cashValue: amt("0") },
    "../evil": { netPositionDecimal: "5", cost: amt("1"), cashValue: amt("1") },
  },
  nextCursor: "abc",
  eof: true,
};

const ACTIVITIES = {
  activities: [
    { type: "ACTIVITY_TYPE_TRADE", trade: { id: "t-1", marketSlug: "brewers-win-world-series", state: "TRADE_STATE_CLEARED", price: amt("0.55"), qtyDecimal: "40", costBasis: amt("22"), createTime: "2026-10-20T18:00:00Z" } },
    { type: "ACTIVITY_TYPE_TRADE", trade: { id: "t-2", marketSlug: "fed-cut-december", state: "TRADE_STATE_BUSTED", price: amt("0.40"), qtyDecimal: "3", createTime: "2026-10-21T18:00:00Z" } },
    { type: "ACTIVITY_TYPE_POSITION_RESOLUTION", positionResolution: { marketSlug: "old-market", side: "LONG", tradeId: "t-0", updateTime: "2026-10-19T09:00:00Z" } },
    { type: "ACTIVITY_TYPE_ACCOUNT_DEPOSIT", accountBalanceChange: { transactionId: "d-1", amount: amt("500"), status: "COMPLETED", createTime: "2026-10-18T09:00:00Z" } },
  ],
  eof: true,
};

/** A stand-in for Polymarket US: answers the two portfolio paths, checks every signature, and records each call. */
function fakeUs(over: { positions?: unknown; activities?: unknown; status?: number } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, method: init?.method ?? "GET", headers });
    const u = new URL(url);
    const ts = headers["X-PM-Timestamp"]!;
    const good = verify(null, Buffer.from(`${ts}${init?.method ?? "GET"}${u.pathname}`), KEY.publicKey, Buffer.from(headers["X-PM-Signature"] ?? "", "base64"));
    if (!good || headers["X-PM-Access-Key"] !== KEY_ID) return new Response("Missing required API key headers", { status: 401 });
    if (over.status) return new Response("", { status: over.status });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/v1/portfolio/positions") return ok(over.positions ?? POSITIONS);
    if (u.pathname === "/v1/portfolio/activities") return ok(over.activities ?? ACTIVITIES);
    return new Response("nope", { status: 404 });
  };
  return { fetcher, calls };
}

function deps(fetcher: Fetcher, over: Partial<PositionsDeps> = {}): PositionsDeps & { auth: MemoryAuthStore } {
  const auth = new MemoryAuthStore();
  return { fetcher, key: usKey(), desk: { deskKey: DESK_KEY, store: auth, now: NOW }, now: NOW, auth, ...over } as PositionsDeps & { auth: MemoryAuthStore };
}

const get = (cookie?: string, path = POSITIONS_PATH) => new Request(`https://ceo.test${path}`, { headers: { ...(cookie && { Cookie: cookie }) } });

beforeEach(() => forgetPositions());

describe("the Polymarket US key", () => {
  it("is optional, and refuses what isn't a key id and an Ed25519 secret", () => {
    expect(keyFrom({})).toEqual({ error: "no-key" });
    expect(keyFrom({ POLYMARKET_US_KEY_ID: " ", POLYMARKET_US_SECRET_KEY: "" })).toEqual({ error: "no-key" });
    expect(keyFrom({ POLYMARKET_US_KEY_ID: "nope", POLYMARKET_US_SECRET_KEY: KEY.secret })).toEqual({ error: "bad-key" });
    expect(keyFrom({ POLYMARKET_US_KEY_ID: KEY_ID, POLYMARKET_US_SECRET_KEY: "c2hvcnQ=" })).toEqual({ error: "bad-key" });
    expect(keyFrom({ POLYMARKET_US_KEY_ID: KEY_ID })).toEqual({ error: "bad-key" });
    expect("secret" in usKey()).toBe(true);
    // A 64-byte secret (seed and public half) reads the same.
    const full = Buffer.concat([Buffer.from(KEY.secret, "base64"), Buffer.alloc(32)]).toString("base64");
    expect("secret" in (keyFrom({ POLYMARKET_US_KEY_ID: KEY_ID, POLYMARKET_US_SECRET_KEY: full }) as UsKey)).toBe(true);
  });

  it("signs timestamp + GET + path (no query) with Ed25519, as the docs and the SDK do", async () => {
    const us = fakeUs();
    await signedGet(us.fetcher, usKey(), "/v1/portfolio/positions", new URLSearchParams({ limit: "5" }), NOW);
    const c = us.calls[0]!;
    expect(c.method).toBe("GET");
    expect(c.url).toBe(`${US_API}/v1/portfolio/positions?limit=5`);
    expect(c.headers["X-PM-Timestamp"]).toBe(String(NOW));
    expect(verify(null, Buffer.from(`${NOW}GET/v1/portfolio/positions`), KEY.publicKey, Buffer.from(c.headers["X-PM-Signature"]!, "base64"))).toBe(true);
  });
});

describe("read-only by construction: the key never reaches an order endpoint", () => {
  it("signs only GETs to the two portfolio paths", async () => {
    expect([...READ_PATHS]).toEqual(["/v1/portfolio/positions", "/v1/portfolio/activities"]);
    const us = fakeUs();
    for (const path of ["/v1/orders", "/v1/order", "/v1/orders/close-position", "/v1/order/preview", "/v1/account/balances", "/v1/portfolio/positions/../../orders", "/v1/portfolio/positions?x=1", ""]) {
      await expect(signedGet(us.fetcher, usKey(), path, new URLSearchParams(), NOW)).rejects.toThrow("not a read path");
    }
    expect(us.calls).toEqual([]);
  });

  it("every call a full read makes is a GET to a read path", async () => {
    const us = fakeUs();
    const d = deps(us.fetcher);
    await GET(get(await signedInCookie(DESK_KEY, NOW, d.auth)), d);
    expect(us.calls.length).toBe(2);
    for (const c of us.calls) {
      expect(c.method).toBe("GET");
      expect((READ_PATHS as readonly string[]).includes(new URL(c.url).pathname)).toBe(true);
    }
  });

  it("nothing in the repo's server code names an order, account or WebSocket path of Polymarket US", () => {
    const root = new URL("../", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mjs|js)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (!text.includes("polymarket.us")) continue;
      expect(text, f).not.toMatch(/\/v1\/orders?\b|\/v1\/account\/|\/v1\/ws\/|\/v1\/rfqs?\b|\/v1\/combos?\b|method:\s*"(POST|PUT|PATCH|DELETE)"/);
    }
  });
});

describe("Polymarket US's answers, trimmed and checked", () => {
  it("keeps only the board's fields", () => {
    const p = shapePosition("brewers-win-world-series", POSITIONS.positions["brewers-win-world-series"])!;
    expect(p).toEqual({ market: "Brewers win the World Series?", outcome: "Yes", url: "https://polymarket.us/event/mlb-world-series-2026", short: false, contracts: 40, avgPrice: 0.55, value: 25.2, cost: 22, pnl: 3.2, pnlPct: 14.5, realized: 1.5, expired: false });
    const s = shapePosition("fed-cut-december", POSITIONS.positions["fed-cut-december"])!;
    expect(s).toMatchObject({ short: true, contracts: 10, url: null, pnl: -2 });
    expect(shapePosition("dust-left-over", POSITIONS.positions["dust-left-over"])).toBeNull();
    expect(shapePosition("../evil", POSITIONS.positions["../evil"])).toBeNull();
    expect(shapePosition("x", "nope")).toBeNull();
  });

  it("reads fills and settlements, marks a busted fill, and never keeps a deposit or an id", () => {
    const titles = new Map([["brewers-win-world-series", { market: "Brewers win the World Series?", url: null }]]);
    const rows = ACTIVITIES.activities.map((a) => shapeTrade(a, titles));
    expect(rows[0]).toEqual({ at: "2026-10-20T18:00:00.000Z", kind: "trade", market: "Brewers win the World Series?", url: null, contracts: 40, price: 0.55 });
    expect(rows[1]).toMatchObject({ kind: "voided", market: "Fed cut december" });
    expect(rows[2]).toMatchObject({ kind: "settled", market: "Old market", price: null });
    expect(rows[3]).toBeNull();
    expect(JSON.stringify(rows)).not.toMatch(/t-1|d-1|500/);
  });
});

describe("GET /api/exchange-positions", () => {
  it("needs the Desk passkey session", async () => {
    const us = fakeUs();
    const res = await GET(get(), deps(us.fetcher));
    expect(res.status).toBe(401);
    expect(us.calls).toEqual([]);
  });

  it("waits, without calling Polymarket, until the key is set", async () => {
    const us = fakeUs();
    const d = deps(us.fetcher, { key: { error: "no-key" } });
    const res = await GET(get(await signedInCookie(DESK_KEY, NOW, d.auth)), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: "waiting", reason: "no-key" });
    expect(us.calls).toEqual([]);
  });

  it("answers the positions, largest first, with totals; private, never cached", async () => {
    const us = fakeUs();
    const d = deps(us.fetcher);
    const res = await GET(get(await signedInCookie(DESK_KEY, NOW, d.auth)), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toContain("__Host-ceo-desk=");
    const b = (await res.json()) as Extract<PmPositions, { state: "live" }>;
    expect(b.state).toBe("live");
    expect(b.positions.map((p) => p.market)).toEqual(["Brewers win the World Series?", "Fed cuts in December?"]);
    expect(b.totals).toEqual({ open: 2, value: 29.2, cost: 28, pnl: 1.2 });
    expect(b.activity.map((a) => a.kind)).toEqual(["voided", "trade", "settled"]);
    expect(b.more).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(new RegExp(`${KEY_ID}|icon|y\\.png|t-1|d-1`));
  });

  it("reads Polymarket US at most once a minute, and stands in the last good read when it stops answering", async () => {
    const us = fakeUs();
    const d = deps(us.fetcher);
    const cookie = await signedInCookie(DESK_KEY, NOW, d.auth);
    await GET(get(cookie), d);
    await GET(get(cookie), { ...d, now: NOW + 30_000 });
    expect(us.calls.length).toBe(2);
    const down = fakeUs({ status: 500 });
    const res = await GET(get(cookie), { ...d, fetcher: down.fetcher, now: NOW + 120_000 });
    expect(((await res.json()) as { stale?: boolean }).stale).toBe(true);
    forgetPositions();
    expect((await GET(get(cookie), { ...d, fetcher: down.fetcher })).status).toBe(502);
  });

  it("refuses a query, and is routed through the world function on Vercel", async () => {
    const d = deps(fakeUs().fetcher);
    const cookie = await signedInCookie(DESK_KEY, NOW, d.auth);
    expect((await GET(get(cookie, `${POSITIONS_PATH}?user=x`), d)).status).toBe(400);
    expect((await GET(get(cookie, "/api/world?exchange=positions"), d)).status).toBe(200);
    expect(isPositions(get(undefined, "/api/world?exchange=positions"))).toBe(true);
    expect(isPositions(get(undefined, "/api/world?exchange=markets"))).toBe(false);
    expect(typeof worldGET).toBe("function");
  });
});

describe("the subminds' read key (#281)", () => {
  const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
  const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
  const env = { SUBMIND_LOG_TOKEN: LOG, SUBMIND_FEED_TOKEN: FEED };
  const keyed = (key: string, path = POSITIONS_PATH) => new Request(`https://ceo.test${path}`, { headers: { Authorization: `Bearer ${key}` } });

  it("reads the same board with the read key: GETs to the read paths only, never cached, no cookie", async () => {
    const us = fakeUs();
    const res = await GET(keyed(LOG), deps(us.fetcher, { env }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(us.calls.length).toBeGreaterThan(0);
    for (const c of us.calls) {
      expect(c.method).toBe("GET");
      expect((READ_PATHS as readonly string[]).includes(new URL(c.url).pathname)).toBe(true);
    }
    expect(JSON.stringify(await (await GET(keyed(LOG), deps(us.fetcher, { env }))).json())).not.toContain(KEY_ID);
  });

  it("is refused with the feed key, a wrong key, no key set, or an extra query", async () => {
    const us = fakeUs();
    expect((await GET(keyed(FEED), deps(us.fetcher, { env }))).status).toBe(401);
    expect((await GET(keyed("wrong-key-but-long-enough-0123456789abcdef"), deps(us.fetcher, { env }))).status).toBe(401);
    expect((await GET(keyed(LOG), deps(us.fetcher))).status).toBe(401);
    expect(us.calls).toEqual([]);
    expect((await GET(keyed(LOG, `${POSITIONS_PATH}?limit=500`), deps(us.fetcher, { env }))).status).toBe(400);
  });
});
