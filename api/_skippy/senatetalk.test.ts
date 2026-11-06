import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { PhoneTodos } from "../_haven/todos.ts";
import { MemoryStoryStore } from "../_world/story.ts";
import { MemoryChatLedger, chatMonth, skippySpend } from "./budget.ts";
import { roomVoicePost, type RoomRouteDeps } from "./roomroute.ts";
import {
  MemoryTopicStore,
  SENATE_BUDGET_USD,
  SENATE_CEILING_USD,
  SENATE_PART,
  floorReply,
  motionKey,
  newDebate,
  publicSafe,
  readDebate,
  resetGaps,
  type SenateAsk,
  type SenateDeps,
} from "./senatetalk.ts";

/** The Senate's live talk (#910): a new argument every time, under its $10 inside Skippy's month. Every key and line is made up. */

const NOW = Date.parse("2026-11-05T23:30:00Z");
const DESK = "a test desk key, not a real one";
const SEATED = ["foundry", "relay", "exchange", "green", "spire", "archive", "boiler", "breakroom", "workshop", "studio", "annex", "haven"];

/** A model that argues whatever motion it's handed, with the members it was told to use. */
function fakeModel(motion = "that every bridge is secretly a love letter to gravity", over: Partial<Record<string, unknown>> = {}) {
  const asked: { system: string; user: string }[] = [];
  const ask: SenateAsk = async (system, user) => {
    asked.push({ system, user });
    const ids = /by id: ([a-z, ]+)\./.exec(user)![1]!.split(", ");
    const reply = system.includes("from the floor");
    const answer = reply
      ? { lines: [{ by: ids[0]!, text: "You rang? The chair is magnificent and listening." }] }
      : {
          motion,
          lines: [
            { by: ids[0]!, stance: "open", text: "Steel, cable and stubbornness. Best structures ever made." },
            { by: ids[1]!, stance: "aye", text: "For the record, the Romans got there first with arches." },
            { by: ids[2]!, stance: "nay", text: "Every bridge is one storm from a very bad day." },
          ],
          close: "Carried. The chair could hold up a bridge by sheer magnificence.",
          murmurs: ["Hear, hear, the arches", "Not the storm again"],
          ...over,
        };
    return { answer, usage: { input_tokens: 2_000, output_tokens: 400 } };
  };
  return { ask, asked };
}

function deps(over: Partial<SenateDeps> = {}): SenateDeps & { chat: MemoryChatLedger; topics: MemoryTopicStore } {
  return { chat: new MemoryChatLedger(), kernel: new MemoryChatLedger(), topics: new MemoryTopicStore(), ask: fakeModel().ask, budget: 60, now: NOW, rnd: () => 0.3, ...over } as SenateDeps & {
    chat: MemoryChatLedger;
    topics: MemoryTopicStore;
  };
}

beforeEach(() => resetGaps());

describe("a new argument (#910)", () => {
  it("argues a new motion with the given members, counts its cost as the Senate's part of Skippy's month, and remembers it", async () => {
    const d = deps();
    const got = await newDebate({ seated: SEATED, working: ["foundry"], docket: 3 }, d);
    expect("debate" in got).toBe(true);
    if (!("debate" in got)) return;
    expect(got.debate.key).toMatch(/^live-/);
    expect(got.debate.lines[0]!.stance).toBe("open");
    expect(got.debate.murmurs).toEqual(["Hear, hear, the arches", "Not the storm again"]);
    expect(d.topics.list).toEqual(["that every bridge is secretly a love letter to gravity"]);
    const month = chatMonth(d.chat.spend, NOW);
    expect(month.parts?.[SENATE_PART]).toBeGreaterThan(0);
    expect(month.usd).toBeCloseTo(month.parts![SENATE_PART]!);
    const meter = await skippySpend({ chat: d.chat, kernel: d.kernel }, 60, NOW);
    expect(meter.parts.senate).toBeGreaterThan(0);
    expect(meter.parts.talk).toBe(0);
  });

  it("puts every motion already argued in the prompt, and only public-safe facts", async () => {
    const m = fakeModel();
    const d = deps({ ask: m.ask });
    d.topics.list = ["that the gardener is the true hero"];
    await newDebate({ seated: SEATED, working: ["relay"], docket: 2 }, d);
    const { user } = m.asked[0]!;
    expect(user).toContain("<used>\n- that the gardener is the true hero\n</used>");
    expect(user).toContain("items waiting on the docket: 2");
    expect(user).toMatch(/seed: /);
  });

  it("never says a motion twice: one that comes back the same is refused", async () => {
    const d = deps();
    d.topics.list = ["That every bridge is secretly a love letter to gravity."];
    expect(await newDebate({ seated: SEATED }, d)).toEqual({ quiet: "repeat" });
    expect(motionKey("That every bridge, is secretly a love letter to gravity!")).toBe(motionKey("every bridge is secretly a love letter to gravity"));
  });

  it("holds back an answer with anything private or any money in it, whole", async () => {
    for (const bad of ["Call the Steward on 555 867 5309.", "It cost $40 to build.", "Write to sam@example.com about it."]) {
      resetGaps();
      const d = deps({ ask: fakeModel(undefined, { close: bad }).ask });
      expect(await newDebate({ seated: SEATED }, d)).toEqual({ quiet: "held" });
      expect(d.topics.list).toEqual([]);
    }
    expect(publicSafe("Hail Reaper, the arches stand.")).toBe(true);
    expect(publicSafe("Five dollars says it falls")).toBe(true);
    expect(publicSafe("That's 5 dollars")).toBe(false);
  });

  it("takes only the members it named, an opener and a dissent", () => {
    const ok = { motion: "that tea beats coffee", close: "Carried.", murmurs: [], lines: [] as unknown[] };
    const L = (by: string, stance: string) => ({ by, stance, text: "A line." });
    expect(readDebate({ ...ok, lines: [L("foundry", "open"), L("relay", "aye"), L("boiler", "nay")] }, ["foundry", "relay", "boiler"])).not.toBeNull();
    expect(readDebate({ ...ok, lines: [L("foundry", "open"), L("relay", "aye"), L("haven", "nay")] }, ["foundry", "relay", "boiler"])).toBeNull();
    expect(readDebate({ ...ok, lines: [L("foundry", "open"), L("relay", "aye"), L("boiler", "aye")] }, ["foundry", "relay", "boiler"])).toBeNull();
    expect(readDebate({ ...ok, lines: [L("relay", "aye"), L("foundry", "open"), L("boiler", "nay")] }, ["foundry", "relay", "boiler"])).toBeNull();
  });

  it("stops at the Senate's $10, and at Skippy's month, without calling the model", async () => {
    const m = fakeModel();
    const d = deps({ ask: m.ask });
    await d.chat.add(NOW, { input_tokens: 0, output_tokens: 0 }, SENATE_BUDGET_USD - SENATE_CEILING_USD / 2, { [SENATE_PART]: SENATE_BUDGET_USD - SENATE_CEILING_USD / 2 });
    expect(await newDebate({ seated: SEATED }, d)).toEqual({ quiet: "capped" });
    const full = deps({ ask: m.ask });
    await full.kernel!.add(NOW, { input_tokens: 0, output_tokens: 0 }, 60);
    expect(await newDebate({ seated: SEATED }, full)).toEqual({ quiet: "capped" });
    expect(m.asked).toHaveLength(0);
  });

  it("keeps a runaway page to one ask in a while, and is off without a key", async () => {
    const d = deps();
    expect("debate" in (await newDebate({ seated: SEATED }, d))).toBe(true);
    expect(await newDebate({ seated: SEATED }, d)).toEqual({ quiet: "busy" });
    resetGaps();
    expect(await newDebate({ seated: SEATED }, deps({ ask: null }))).toEqual({ quiet: "off" });
  });
});

describe("answering Nikita on the floor (#910)", () => {
  it("answers in kind, in the argument's context, from the seated members or the chair", async () => {
    const m = fakeModel();
    const got = await floorReply({ said: "What do you lot think of bridges?", seated: SEATED, motion: "that bridges are art", lines: [{ by: "foundry", text: "Steel is art." }] }, deps({ ask: m.ask }));
    expect(got).toEqual({ lines: [{ by: "kernel", text: "You rang? The chair is magnificent and listening." }] });
    expect(m.asked[0]!.user).toContain("<said>What do you lot think of bridges?</said>");
    expect(m.asked[0]!.user).toContain("The argument on: that bridges are art");
  });

  it("never sends words that look private", async () => {
    const m = fakeModel();
    expect(await floorReply({ said: "text Sam at 555 867 5309", seated: SEATED }, deps({ ask: m.ask }))).toEqual({ quiet: "held" });
    expect(m.asked).toHaveLength(0);
  });
});

describe("through POST /api/skippy-room (#910)", () => {
  it("is for a signed-in Desk only, and hands back the argument", async () => {
    const store = new MemoryAuthStore();
    const sd = deps();
    const d: RoomRouteDeps = {
      desk: { deskKey: DESK, store, now: NOW },
      blob: null,
      eleven: null,
      ledger: new MemoryStoryStore(),
      skippy: async () => ({ reply: "unused", handedOff: false }),
      todos: (b) => new PhoneTodos(b),
      devices: () => null,
      fetcher: fetch,
      log: () => undefined,
      senate: () => sd,
    };
    const cookie = await signedInCookie(DESK, NOW, store);
    const post = (body: unknown, c = cookie) =>
      new Request("https://ceo.test/api/skippy-room", { method: "POST", headers: { "Content-Type": "application/json", ...(c && { Cookie: c }) }, body: JSON.stringify(body) });
    expect((await roomVoicePost(post({ room: "today", senate: "debate", seated: SEATED }, ""), d)).status).toBe(401);
    const body = (await (await roomVoicePost(post({ room: "today", senate: "debate", seated: SEATED }), d)).json()) as { debate?: { motion: string } };
    expect(body.debate?.motion).toBe("that every bridge is secretly a love letter to gravity");
    expect(await (await roomVoicePost(post({ room: "today", senate: "debate", seated: SEATED }), { ...d, senate: null })).json()).toEqual({ quiet: "off" });
  });
});
