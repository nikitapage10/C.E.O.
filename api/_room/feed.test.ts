import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, LOG_TOKEN } from "../_site/roomkeys.ts";
import { FEED_PER_HOUR, MemoryFeedStore, handleGet, handlePost, keepEvents, publicTitle, type FeedDeps, type RoomEvent } from "./feed.ts";

/**
 * The room feed (#281): only the feed key writes, it reads nothing back, private-looking events are refused, and the
 * public view is titles scrubbed of money and links, never a detail. Test keys only.
 */

const NOW = Date.parse("2026-10-23T04:00:00Z");
const ORIGIN = "https://ceo.test";
const DESK = "test-desk-key";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const ENV = { FOUNDRY_DESK_KEY: DESK, [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED };

async function setup(over: Partial<FeedDeps> = {}) {
  const auth = new MemoryAuthStore();
  const feed = new MemoryFeedStore();
  let n = 0;
  const deps: FeedDeps = { env: ENV, feed, desk: { deskKey: DESK, store: auth, now: NOW }, now: NOW, newId: () => `event-${String(++n).padStart(4, "0")}`, ...over };
  const cookie = await signedInCookie(DESK, NOW, auth);
  const post = (body: unknown, key: string | null = FEED, init: { type?: string; path?: string; cookie?: string } = {}) =>
    handlePost(
      new Request(`${ORIGIN}${init.path ?? "/api/room-feed"}`, {
        method: "POST",
        headers: { "Content-Type": init.type ?? "application/json", ...(key && { Authorization: `Bearer ${key}` }), ...(init.cookie && { Cookie: init.cookie }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      deps,
    );
  const get = (path = "/api/room-feed", headers: Record<string, string> = {}) => handleGet(new Request(`${ORIGIN}${path}`, { headers }), deps);
  return { deps, feed, cookie, post, get };
}

const EVENT = { room: "green", title: "The waiver call is in: grab the Bears D", detail: "Week 8 bye cover. Drop the backup TE; FAAB bid $14." };

describe("posting a room event (the feed key)", () => {
  it("keeps it and says only that it was kept", async () => {
    const { post, feed } = await setup();
    const res = await post(EVENT);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, id: "event-0001" });
    expect(await feed.all(NOW)).toEqual([{ id: "event-0001", at: new Date(NOW).toISOString(), ...EVENT }]);
  });

  it("is refused without the feed key: none, the read key, a wrong one, or a Desk session alone", async () => {
    const { post, feed, cookie } = await setup();
    for (const key of [null, LOG, "wrong-key-but-long-enough-0123456789abcdef", DESK]) expect((await post(EVENT, key)).status).toBe(401);
    expect((await post(EVENT, null, { cookie })).status).toBe(401);
    // No feed key set at all: nothing opens it.
    expect((await (await setup({ env: { FOUNDRY_DESK_KEY: DESK } })).post(EVENT)).status).toBe(401);
    expect(feed.events).toEqual([]);
  });

  it("refuses a bad shape, the wrong content type, a query, and too much", async () => {
    const { post, feed } = await setup();
    expect((await post(EVENT, FEED, { type: "text/plain" })).status).toBe(415);
    expect((await post(EVENT, FEED, { path: "/api/room-feed?view=public" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post([EVENT])).status).toBe(400);
    expect((await post({ ...EVENT, room: "relay" })).status).toBe(400);
    expect((await post({ ...EVENT, room: "spire" })).status).toBe(400);
    expect((await post({ ...EVENT, title: "" })).status).toBe(400);
    expect((await post({ ...EVENT, title: 42 })).status).toBe(400);
    expect((await post({ ...EVENT, action: "lock" })).status).toBe(400);
    expect((await post({ ...EVENT, title: "x".repeat(300) })).status).toBe(413);
    expect((await post({ ...EVENT, detail: "x".repeat(5000) })).status).toBe(413);
    expect(feed.events).toEqual([]);
  });

  it("refuses anything that looks private, or a copy of either room key", async () => {
    const { post, feed } = await setup();
    for (const [body, kind] of [
      [{ ...EVENT, title: "Mail sam@example.com about the trade" }, "email"],
      [{ ...EVENT, detail: "Call (555) 867-5309 tonight" }, "phone"],
      [{ ...EVENT, detail: "Key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz" }, "key"],
      [{ ...EVENT, detail: `the feed key is ${FEED}` }, "key"],
      [{ ...EVENT, title: `log ${LOG}` }, "key"],
    ] as const) {
      const res = await post(body);
      expect(res.status).toBe(422);
      const got = (await res.json()) as { error: string; kinds: string[] };
      expect(got.error).toBe("private");
      expect(got.kinds).toContain(kind);
      expect(JSON.stringify(got)).not.toContain(FEED);
    }
    expect(feed.events).toEqual([]);
  });

  it("allows 20 events per room an hour, then 429", async () => {
    const { post } = await setup();
    for (let i = 0; i < FEED_PER_HOUR; i++) expect((await post({ room: "boiler", title: `Pipe ${i} holds` })).status).toBe(201);
    const over = await post({ room: "boiler", title: "One more" });
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("600");
    expect((await post({ room: "foundry", title: "Another room is fine" })).status).toBe(201);
  });

  it("says when there is no store", async () => {
    const { post } = await setup({ feed: null });
    expect((await post(EVENT)).status).toBe(503);
  });
});

describe("reading the feed", () => {
  it("gives a Desk session every event with its detail", async () => {
    const { post, get, cookie } = await setup();
    await post(EVENT);
    const res = await get("/api/room-feed", { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__Host-ceo-desk=");
    expect(await res.json()).toEqual({ view: "full", events: [{ id: "event-0001", at: new Date(NOW).toISOString(), ...EVENT }] });
  });

  it("gives the read key every event with its detail, and no cookie", async () => {
    const { post, get } = await setup();
    await post(EVENT);
    const res = await get("/api/room-feed", { Authorization: `Bearer ${LOG}` });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(((await res.json()) as { view: string }).view).toBe("full");
  });

  it("takes both headers the proxy sends on every request (#361): the Bearer feed key posts, the read key header decides reads", async () => {
    const { deps, get, feed } = await setup();
    const both = { Authorization: `Bearer ${FEED}`, "x-ceo-room-key": LOG };
    const post = (headers: Record<string, string>) =>
      handlePost(new Request(`${ORIGIN}/api/room-feed`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(EVENT) }), deps);
    expect((await post(both)).status).toBe(201);
    // The read key alone, or in the extra header beside a wrong Bearer, never posts.
    expect((await post({ "x-ceo-room-key": LOG })).status).toBe(401);
    expect((await post({ Authorization: `Bearer ${LOG}`, "x-ceo-room-key": LOG })).status).toBe(401);
    expect((await feed.all(NOW)).length).toBe(1);
    const full = await get("/api/room-feed", both);
    expect(((await full.json()) as { view: string }).view).toBe("full");
    const pub = await get("/api/room-feed", { Authorization: `Bearer ${FEED}` });
    expect(((await pub.json()) as { view: string }).view).toBe("public");
  });

  it("gives everyone else, the feed key and ?view=public the scrubbed titles only", async () => {
    const { post, get, cookie } = await setup();
    await post(EVENT);
    await post({ room: "exchange", title: "Took $250 off the table at https://polymarket.us/x", detail: "Sold 40 shares." });
    for (const [path, headers] of [
      ["/api/room-feed", {}],
      ["/api/room-feed", { Authorization: `Bearer ${FEED}` }],
      ["/api/room-feed", { Cookie: "__Host-ceo-desk=forged.token" }],
      ["/api/room-feed?view=public", { Cookie: cookie }],
      ["/api/room-feed?view=public", { Authorization: `Bearer ${LOG}` }],
    ] as const) {
      const res = await get(path, headers);
      const body = (await res.json()) as { view: string; events: RoomEvent[] };
      expect(body.view, path).toBe("public");
      expect(body.events.map((e) => e.title)).toEqual(["Took … off the table at …", "The waiver call is in: grab the Bears D"]);
      expect(body.events.every((e) => !("detail" in e))).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/\$|Sold|polymarket/);
    }
  });

  it("refuses any other query, and says when there is no store", async () => {
    const { get } = await setup();
    for (const q of ["?view=full", "?view=public&view=public", "?room=green", "?view=public&x=1"]) expect((await get(`/api/room-feed${q}`)).status).toBe(400);
    expect((await (await setup({ feed: null })).get()).status).toBe(503);
  });
});

describe("the public title", () => {
  it("drops money and links, whatever the spelling", () => {
    expect(publicTitle("Up $1,200.50 on the week")).toBe("Up … on the week");
    expect(publicTitle("Bought YES at 62¢, 3.5k USD in")).toBe("Bought YES at …, … in");
    expect(publicTitle("40 dollars and 12 bucks and €9 and £3")).toBe("… and … and … and …");
    expect(publicTitle("See www.example.com or https://x.test/a?b=1")).toBe("See … or …");
    expect(publicTitle("Week 8: 3 starters on bye")).toBe("Week 8: 3 starters on bye");
  });
});

describe("what is kept", () => {
  it("drops bad, too old and future events, and keeps the last 200", () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const raw = [
      { id: "old-event-1", at: at(NOW - 15 * 86_400_000), room: "green", title: "old" },
      { id: "future-evt", at: at(NOW + 3_600_000), room: "green", title: "future" },
      { id: "bad-room-1", at: at(NOW), room: "relay", title: "relay" },
      { id: "BAD ID", at: at(NOW), room: "green", title: "bad id" },
      ...Array.from({ length: 210 }, (_, i) => ({ id: `keep-${String(i).padStart(4, "0")}`, at: at(NOW - (210 - i) * 1000), room: "foundry", title: `t${i}` })),
    ];
    const kept = keepEvents(raw, NOW);
    expect(kept).toHaveLength(200);
    expect(kept[0]!.id).toBe("keep-0010");
    expect(kept.at(-1)!.id).toBe("keep-0209");
  });
});
