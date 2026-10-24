import { describe, expect, it } from "vitest";
import { newEvents, readFeed, readPublicFeed } from "./roomFeed.ts";

/** The room feed in the browser (#281): details only from a full view the Desk asked for, never on the Lattice. */

const AT = "2026-10-23T04:00:00.000Z";
const ev = (id: string, room: string, at = AT, detail?: string) => ({ id, at, room, title: `Title ${id}`, ...(detail && { detail }) });

describe("reading the feed", () => {
  it("keeps a detail only from a full view the Desk asked for", () => {
    const body = { view: "full", events: [ev("event-0001", "green", AT, "the detail")] };
    expect(readFeed(body, true)).toEqual({ full: true, events: [ev("event-0001", "green", AT, "the detail")] });
    expect(readFeed(body, false)).toEqual({ full: false, events: [ev("event-0001", "green")] });
    expect(readFeed({ view: "public", events: [ev("event-0001", "green", AT, "slipped in")] }, true)).toEqual({ full: false, events: [ev("event-0001", "green")] });
  });

  it("drops what isn't an event, and refuses what isn't the feed", () => {
    const got = readFeed({ view: "public", events: [ev("a", "relay"), ev("b", "green", "nope"), { id: "c", at: AT, room: "boiler" }, ev("d", "boiler"), null] }, false);
    expect(got?.events.map((e) => e.id)).toEqual(["d"]);
    expect(readFeed({ events: [] }, false)).toBeNull();
    expect(readFeed(null, false)).toBeNull();
  });

  it("the Lattice always asks for the public view, and says off where there is no feed", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ view: "full", events: [ev("event-0001", "green", AT, "secret detail")] }), { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const got = await readPublicFeed(fake);
    expect(urls).toEqual(["/api/room-feed?view=public"]);
    expect(got.events[0]!.detail).toBeUndefined();
    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect((await readPublicFeed(missing)).status).toBe("off");
  });
});

describe("what the Lattice says", () => {
  it("each event once, the newest per room, nothing from before the page opened", () => {
    const seen = new Set<string>();
    const since = Date.parse(AT) - 60_000;
    const events = [ev("n2", "green", "2026-10-23T04:00:30.000Z"), ev("n1", "green"), ev("x1", "boiler"), ev("old", "foundry", "2026-10-23T02:00:00.000Z")].map((e) => ({ ...e, room: e.room as "green" }));
    expect(newEvents(events, seen, since).map((e) => e.id)).toEqual(["n2", "x1"]);
    expect(newEvents(events, seen, since)).toEqual([]);
  });
});
