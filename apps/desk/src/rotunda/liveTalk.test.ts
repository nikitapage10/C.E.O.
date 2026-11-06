import { describe, expect, it } from "vitest";
import { DEBATES } from "./debates.ts";
import { CAPPED_WAIT_MS, createRecess, debateMark, fetchFloor, readJoined, readLiveDebate } from "./liveTalk.ts";
import { freshMurmur, MURMURS } from "./rite.ts";

/** The Senate's live talk in the browser (#910): a new argument every time, never one said before, and quiet past the cap. */

const FACTS = { seated: ["foundry", "relay", "boiler", "archive"], working: ["foundry"], docket: 1 };
let n = 0;
const liveOne = () => ({
  key: `live-${++n}`,
  motion: `that topic ${n} is the best topic`,
  lines: [
    { by: "foundry", stance: "open", text: "Opening." },
    { by: "boiler", stance: "nay", text: "Doubtful." },
  ],
  close: "Carried.",
  murmurs: [`murmur ${n}`],
});

function memory() {
  const said = new Set<string>();
  return { heard: (k: string) => said.has(k), hear: (k: string) => void said.add(k), said };
}

describe("the recess's arguments (#910)", () => {
  it("asks for a live one as the chamber opens, with public-safe facts only, and the next as each is taken", async () => {
    const sent: Record<string, unknown>[] = [];
    const fetcher = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ debate: liveOne() });
    }) as typeof fetch;
    const r = createRecess({ facts: () => FACTS, ...memory(), fetch: fetcher });
    const a = (await r.peek())!;
    expect(a.key).toMatch(/^live-/);
    expect(sent[0]).toEqual({ room: "today", senate: "debate", seated: FACTS.seated, working: ["foundry"], docket: 1 });
    expect(await r.peek()).toBe(a);
    r.take(a);
    expect(r.murmur()).toBe(a.murmurs![0]);
    expect(r.murmur()).toBeNull();
    const b = (await r.peek())!;
    expect(b.key).not.toBe(a.key);
    expect(sent).toHaveLength(2);
  });

  it("falls back to a written one not heard yet, each once ever, then keeps quiet", async () => {
    const mem = memory();
    const fetcher = (async () => Response.json({ quiet: "capped" })) as typeof fetch;
    let t = 0;
    const r = createRecess({ facts: () => FACTS, ...mem, fetch: fetcher, now: () => t });
    const seen = new Set<string>();
    for (let i = 0; i < DEBATES.length; i++) {
      const d = (await r.peek())!;
      expect(seen.has(d.key)).toBe(false);
      seen.add(d.key);
      r.take(d);
    }
    expect(await r.peek()).toBeNull();
    expect([...mem.said]).toEqual(DEBATES.map((d) => debateMark(d.key)));
    // A reload remembers them: nothing written is offered again.
    const again = createRecess({ facts: () => FACTS, ...mem, fetch: fetcher, now: () => t });
    expect(await again.peek()).toBeNull();
    t += CAPPED_WAIT_MS + 1;
  });

  it("stops asking once signed out, and never asks while the Desk says so", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response("", { status: 401 });
    }) as typeof fetch;
    const r = createRecess({ facts: () => FACTS, ...memory(), fetch: fetcher });
    expect((await r.peek())!.key).toBe(DEBATES[0]!.key);
    r.take((await r.peek())!);
    await r.peek();
    expect(calls).toBe(1);
    const out = createRecess({ facts: () => FACTS, ...memory(), fetch: fetcher, auth: () => "out" });
    await out.peek();
    expect(calls).toBe(1);
  });

  it("takes only a well-formed argument", () => {
    expect(readLiveDebate(liveOne())).not.toBeNull();
    expect(readLiveDebate({ ...liveOne(), lines: [] })).toBeNull();
    expect(readLiveDebate({ motion: "x" })).toBeNull();
  });

  it("asks the members to answer the floor in kind, in the argument's context", async () => {
    let sent: Record<string, unknown> = {};
    const got = await fetchFloor("What about the eagles?", ["boiler"], { motion: "that the gardener is the hero", lines: [{ by: "boiler", text: "Eagles." }] }, false, (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ lines: [{ by: "boiler", text: "Not one of you mentions the eagles." }] });
    }) as typeof fetch);
    expect(sent).toMatchObject({ room: "today", senate: "reply", said: "What about the eagles?", motion: "that the gardener is the hero" });
    expect(got).toEqual({ lines: [{ by: "boiler", text: "Not one of you mentions the eagles." }] });
    expect(await fetchFloor("hi", [], null, false, (async () => Response.json({ quiet: "capped" })) as typeof fetch)).toBeNull();
  });
});

describe("Skippy hears the floor first (#926)", () => {
  it("brings his own answer back as the chair's, in his voice, with what it changed", async () => {
    const audio = "A".repeat(120);
    const got = await fetchFloor("can you dispense one portion of dry food?", ["haven"], null, true, (async () =>
      Response.json({ lines: [{ by: "kernel", text: "One portion of dry food is out." }], skippy: true, audio, wrote: ["home_device"], did: ["Dispense 1 portion"] })) as typeof fetch);
    expect(got).toEqual({ chair: { say: "One portion of dry food is out.", audio, wrote: ["home_device"], did: ["Dispense 1 portion"] } });
  });

  it("drops audio that isn't audio", async () => {
    const got = await fetchFloor("hi", [], null, false, (async () => Response.json({ lines: [{ by: "kernel", text: "Hi." }], skippy: true, audio: "<script>" })) as typeof fetch);
    expect(got).toEqual({ chair: { say: "Hi." } });
  });
});

describe("joining the argument on the floor (#925)", () => {
  const TOPIC = { motion: "that the gardener is the hero", lines: [{ by: "archive", text: "For the record." }, { by: "floor", text: "What about the eagles?" }], cast: ["archive", "studio"] };

  it("sends his words with the argument, its lines (his own marked as the floor's) and who argues it", async () => {
    let sent: Record<string, unknown> = {};
    const got = await fetchFloor("And the eagles?", ["archive", "studio", "boiler"], TOPIC, true, (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ join: { answers: [{ by: "archive", text: "Footnote twelve: eagles." }], rest: [{ by: "studio", stance: "nay", text: "Cut." }], close: "Carried." } });
    }) as typeof fetch);
    expect(sent).toEqual({ room: "today", senate: "join", said: "And the eagles?", seated: ["archive", "studio", "boiler"], motion: TOPIC.motion, lines: TOPIC.lines, cast: TOPIC.cast });
    expect(got).toEqual({ join: { answers: [{ by: "archive", text: "Footnote twelve: eagles." }], rest: [{ by: "studio", stance: "nay", text: "Cut." }], close: "Carried." } });
  });

  it("is null when it can't come live, so the chair answers him through Skippy's own route", async () => {
    expect(await fetchFloor("hi", [], TOPIC, true, (async () => Response.json({ quiet: "capped" })) as typeof fetch)).toBeNull();
    expect(await fetchFloor("hi", [], TOPIC, true, (async () => new Response("", { status: 401 })) as typeof fetch)).toBeNull();
    expect(readJoined({ answers: [], rest: [], close: "Carried." })).toBeNull();
    expect(readJoined({ answers: [{ by: "archive", text: "Yes." }], close: "" })).toBeNull();
  });
});

describe("the gallery's murmurs (#910)", () => {
  it("says each written murmur once, then none", () => {
    const said = new Set<string>();
    const all = Object.values(MURMURS).flat().length;
    for (let i = 0; i < all; i++) {
      const m = freshMurmur("decision", (t) => said.has(t));
      expect(m).not.toBeNull();
      expect(said.has(m!)).toBe(false);
      said.add(m!);
    }
    expect(freshMurmur("idle", (t) => said.has(t))).toBeNull();
  });
});
