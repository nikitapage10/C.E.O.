import { afterEach, describe, expect, it } from "vitest";
import { SUBMINDS } from "../../packages/simulator/src/subminds.ts";
import { decide, gateRequest, type GateContext } from "./gate.ts";
import { FEED_TOKEN, KEY_LOG_ROOMS, LOG_READS, LOG_TOKEN, MIN_ROOM_KEY, ROOM_FEED_PATH, ROOM_KEY_HEADER, isFeedWrite, isLogRead, readsWithLogKey, roomKeyOf, roomKeyPass, roomKeyValue } from "./roomkeys.ts";
import { MemorySiteStore, forgetCachedState, siteKeys, stateOf } from "./state.ts";

/**
 * The subminds' two room keys (#281): the read key opens exactly the listed GETs, the feed key exactly POST
 * /api/room-feed, and neither opens anything else, through the gate or on its own. Test values only, never real keys.
 */

const NOW = Date.parse("2026-10-23T04:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const ENV = { FOUNDRY_DESK_KEY: DESK, [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED };

const req = (path: string, method = "GET", key?: string, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { ...(key && { Authorization: `Bearer ${key}` }), ...extra }, ...(method === "POST" && { body: "{}" }) });

async function ctx(env: Record<string, string> = ENV): Promise<GateContext> {
  return { state: stateOf({ v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "version-one" }, {}), keys: (await siteKeys({ FOUNDRY_DESK_KEY: DESK }))!, env, now: NOW };
}

/** Every read the read key opens, as a submind thread sends it. */
const READS = ["/api/skippy-log?room=green", "/api/skippy-log?room=exchange", "/api/skippy-log?room=boiler", "/api/skippy-log?room=foundry", "/api/skippy-log?room=green&needs=turf", "/api/skippy-log?room=foundry&needs=any", "/api/green-league", "/api/exchange-markets", "/api/exchange-positions", "/api/world", "/api/world?day=2026-10-22", "/api/foundry-feed", "/api/room-feed", "/api/setup-asks", "/api/setup-asks?room=green"];

/** Requests the read key must never open: other rooms, other routes, other queries, encoded paths and every write. */
const NOT_READS: Array<[string, string]> = [
  ["/api/skippy-log?room=relay", "GET"],
  ["/api/skippy-log?room=archive", "GET"],
  ["/api/skippy-log?room=none", "GET"],
  ["/api/email", "GET"],
  ["/api/email?view=status", "GET"],
  ["/api/skippy-log", "GET"],
  ["/api/skippy-log?room=green&room=exchange", "GET"],
  ["/api/skippy-log?room=green&x=1", "GET"],
  ["/api/skippy-log?room=green&needs=bogus", "GET"],
  ["/api/skippy-log?room=green&needs=turf&needs=any", "GET"],
  ["/api/skippy-answer", "GET"],
  ["/api/skippy-answer", "POST"],
  ["/api/skippy?log=1&room=green", "GET"],
  ["/api/skippy", "GET"],
  ["/api/world?exchange=positions", "GET"],
  ["/api/world?green=analysis", "GET"],
  ["/api/world?day=yesterday", "GET"],
  ["/api/world?day=2026-10-22&day=2026-10-21", "GET"],
  ["/api/green-league?x=1", "GET"],
  ["/api/green-analysis", "GET"],
  ["/api/exchange-positions?exchange=positions&limit=500", "GET"],
  ["/api/email", "GET"],
  ["/api/email?view=status", "GET"],
  ["/api/invoices", "GET"],
  ["/api/site-password", "GET"],
  ["/api/desk-auth?site=password", "GET"],
  ["/api/desk-pings", "GET"],
  ["/api/foundry-usage", "GET"],
  ["/api/foundry-image", "GET"],
  ["/api/security-feed", "GET"],
  ["/api/day-story", "GET"],
  ["/api/world-step", "GET"],
  ["/api/room-feed?view=public&x=1", "GET"],
  ["/api/%77orld", "GET"],
  ["/api//world", "GET"],
  ["/api/world/", "GET"],
  ["/", "GET"],
  ["/desk", "GET"],
  ["/api/world", "HEAD"],
  ["/api/world", "POST"],
  ["/api/exchange-markets", "POST"],
  ["/api/green-analysis", "POST"],
  ["/api/skippy", "POST"],
  ["/api/foundry", "POST"],
  ["/api/site-password", "POST"],
  ["/api/desk-pings", "POST"],
  ["/api/email", "POST"],
  ["/api/invoices", "POST"],
  ["/api/desk-auth?site=password", "POST"],
  ["/api/room-feed", "POST"],
  ["/api/setup-asks", "POST"],
  ["/api/setup-asks?room=relay", "GET"],
  ["/api/setup-asks?room=green&room=boiler", "GET"],
  ["/api/setup-asks?state=open", "GET"],
];

afterEach(() => forgetCachedState());

describe("which room key a request carries", () => {
  it("matches each key, in constant time, and nothing else", () => {
    expect(roomKeyOf(req("/api/world", "GET", LOG), ENV)).toBe("log");
    expect(roomKeyOf(req("/api/world", "GET", FEED), ENV)).toBe("feed");
    expect(roomKeyOf(req("/api/world", "GET", `${LOG}x`), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world", "GET", LOG.slice(0, -1)), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world", "GET", DESK), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world"), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world", "GET", undefined, { Authorization: LOG }), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world", "GET", undefined, { Authorization: `Basic ${LOG}` }), ENV)).toBeNull();
    expect(roomKeyOf(req("/api/world", "GET", undefined, { "x-ceo-site-bypass": LOG }), ENV)).toBeNull();
    // Its own header works too (the Static Web App's proxy may keep Authorization), and wins over a bearer token.
    expect(roomKeyOf(req("/api/world", "GET", undefined, { [ROOM_KEY_HEADER]: LOG }), ENV)).toBe("log");
    expect(roomKeyOf(req("/api/world", "GET", undefined, { [ROOM_KEY_HEADER]: ` ${FEED} ` }), ENV)).toBe("feed");
    expect(roomKeyOf(req("/api/world", "GET", LOG, { [ROOM_KEY_HEADER]: "wrong-key-but-long-enough-0123456789abcdef" }), ENV)).toBeNull();
  });

  it("opens nothing while a key is unset, short, the same as the other, or a copy of one of the site's secrets", () => {
    expect(roomKeyOf(req("/api/world", "GET", LOG), {})).toBeNull();
    const short = "x".repeat(MIN_ROOM_KEY - 1);
    expect(roomKeyValue({ [LOG_TOKEN]: short }, "log")).toBeNull();
    expect(roomKeyValue({ [LOG_TOKEN]: "x".repeat(MIN_ROOM_KEY) }, "log")).toBe("x".repeat(MIN_ROOM_KEY));
    expect(roomKeyValue({ [LOG_TOKEN]: LOG, [FEED_TOKEN]: LOG }, "log")).toBeNull();
    expect(roomKeyValue({ [LOG_TOKEN]: LOG, [FEED_TOKEN]: ` ${LOG}\n` }, "feed")).toBeNull();
    for (const other of ["FOUNDRY_DESK_KEY", "SITE_BYPASS_TOKEN", "SITE_SESSION_SECRET", "DESK_PINGS_SECRET", "GMAIL_TOKEN_KEY"]) {
      expect(roomKeyValue({ [FEED_TOKEN]: FEED, [other]: FEED }, "feed")).toBeNull();
      expect(roomKeyOf(req(ROOM_FEED_PATH, "POST", FEED), { [FEED_TOKEN]: FEED, [other]: FEED })).toBeNull();
    }
  });
});

describe("the read key (SUBMIND_LOG_TOKEN)", () => {
  it("lists exactly the room data Nikita approved", () => {
    expect(Object.keys(LOG_READS).sort()).toEqual(["/api/exchange-markets", "/api/exchange-positions", "/api/foundry-feed", "/api/green-league", "/api/room-feed", "/api/setup-asks", "/api/skippy-log", "/api/world"]);
    expect([...KEY_LOG_ROOMS]).toEqual(["green", "exchange", "boiler", "foundry"]);
  });

  it("covers the rooms whose submind is active, and no other, except Relay's asks, which stay Desk-only", () => {
    // The Messenger is active since the inbox went live (#322), but Relay's asks can touch messages, so the key never
    // reads them (docs/SECURITY.md, docs/SKIPPY.md). Opening them is Nikita's call, not a side effect of going active.
    const active = SUBMINDS.filter((m) => m.active && m.room !== "relay").map((m) => m.room).sort();
    expect([...KEY_LOG_ROOMS].sort()).toEqual(active);
  });

  it("passes the locked gate for each of its reads", async () => {
    const c = await ctx();
    for (const path of READS) {
      expect(isLogRead(req(path)), path).toBe(true);
      const d = decide(req(path, "GET", LOG), c);
      expect(d, path).toEqual({ allow: true, why: "room-log" });
    }
  });

  it("opens nothing else: no other route, query, method or encoded path", async () => {
    const c = await ctx();
    for (const [path, method] of NOT_READS) {
      expect(roomKeyPass(req(path, method, LOG), ENV), `${method} ${path}`).toBeNull();
      const d = decide(req(path, method, LOG), c);
      expect(d.allow, `${method} ${path}`).toBe(false);
    }
  });

  it("is refused on the feed's write, and the feed key is refused on every read", async () => {
    const c = await ctx();
    expect(decide(req(ROOM_FEED_PATH, "POST", LOG, { "Content-Type": "application/json" }), c).allow).toBe(false);
    for (const path of READS) expect(decide(req(path, "GET", FEED), c).allow, path).toBe(false);
  });

  it("refuses its reads without the key, with a wrong one, and with an unset one", async () => {
    for (const path of READS) {
      expect(decide(req(path), await ctx()).allow).toBe(false);
      expect(decide(req(path, "GET", "not-the-key-but-long-enough-0123456789"), await ctx()).allow).toBe(false);
      expect(decide(req(path, "GET", LOG), await ctx({ FOUNDRY_DESK_KEY: DESK })).allow).toBe(false);
    }
  });

  it("is what a handler asks about: a GET with the read key only", () => {
    expect(readsWithLogKey(req("/api/exchange-positions", "GET", LOG), ENV)).toBe(true);
    expect(readsWithLogKey(req("/api/exchange-positions", "GET", FEED), ENV)).toBe(false);
    expect(readsWithLogKey(req("/api/exchange-positions", "POST", LOG), ENV)).toBe(false);
    expect(readsWithLogKey(req("/api/exchange-positions"), ENV)).toBe(false);
    expect(readsWithLogKey(req("/api/exchange-positions", "GET", LOG), {})).toBe(false);
  });
});

describe("the feed key (SUBMIND_FEED_TOKEN)", () => {
  it("passes the locked gate for POST /api/room-feed only", async () => {
    const c = await ctx();
    expect(isFeedWrite(req(ROOM_FEED_PATH, "POST"))).toBe(true);
    expect(decide(req(ROOM_FEED_PATH, "POST", FEED), c)).toEqual({ allow: true, why: "room-feed" });
    expect(decide(req(ROOM_FEED_PATH, "POST", undefined, { [ROOM_KEY_HEADER]: FEED }), c)).toEqual({ allow: true, why: "room-feed" });
    // A setup ask (#324): posting one or closing it is the same one write.
    expect(decide(req("/api/setup-asks", "POST", FEED), c)).toEqual({ allow: true, why: "room-feed" });
    for (const [path, method] of [
      [`${ROOM_FEED_PATH}?view=public`, "POST"],
      [ROOM_FEED_PATH, "GET"],
      [`${ROOM_FEED_PATH}/`, "POST"],
      ["/api/room%2Dfeed", "POST"],
      ["/api/exchange-markets", "POST"],
      ["/api/green-analysis", "POST"],
      ["/api/skippy", "POST"],
      ["/api/foundry", "POST"],
      ["/api/site-password", "POST"],
      ["/api/desk-pings", "POST"],
      ["/api/email", "POST"],
      ["/api/invoices", "POST"],
      ["/api/desk-auth?site=password", "POST"],
      ["/api/world", "POST"],
      ["/api/setup-asks?room=green", "POST"],
      ["/api/setup-asks", "GET"],
      ["/api/setup-asks/", "POST"],
    ] as const) {
      expect(roomKeyPass(req(path, method, FEED), ENV), `${method} ${path}`).toBeNull();
      expect(decide(req(path, method, FEED), c).allow, `${method} ${path}`).toBe(false);
    }
  });

  it("is refused without the key or with the read key", async () => {
    expect(decide(req(ROOM_FEED_PATH, "POST"), await ctx()).allow).toBe(false);
    expect(decide(req(ROOM_FEED_PATH, "POST", LOG), await ctx()).allow).toBe(false);
  });
});

describe("through the whole gate", () => {
  it("answers a refused key like any locked API call, and never sets a site cookie for a key", async () => {
    const store = new MemorySiteStore();
    store.record = { v: 1, passkey: true, locked: "2026-10-22T00:00:00.000Z", sv: "version-one" };
    const deps = { env: ENV, store, now: NOW };
    const ok = await gateRequest(req("/api/green-league", "GET", LOG), deps);
    expect(ok).toEqual({ allow: true, why: "room-log" });
    const no = await gateRequest(req("/api/green-analysis", "GET", LOG), deps);
    expect(no.allow).toBe(false);
    if (!no.allow) {
      expect(no.response.status).toBe(401);
      expect(await no.response.json()).toEqual({ error: "site-locked" });
    }
  });
});
