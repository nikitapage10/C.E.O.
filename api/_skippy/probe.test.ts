/**
 * The Skippy probe (#955): its dry run (no device moves, nothing is kept), its key, its budget line and its verdicts,
 * which never carry Skippy's words. Every key, reading and line here is made up.
 */
import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { probe, type Ask, type ChatDeps } from "../skippy.ts";
import { decide } from "../_site/gate.ts";
import { MemoryMemory } from "./agent/memory.ts";
import { MemoryPending } from "./agent/pending.ts";
import { FAST_MODEL, STRICT_LIMITS, runAgent, strictLoad, type CallModel } from "./agent/loop.ts";
import { toolNamed, type HomeAsk, type ToolHost } from "./agent/tools.ts";
import { MemoryChatLedger } from "./budget.ts";
import { deskContext } from "./context.ts";
import { MemoryRoomLog } from "./log.ts";
import { dryHost, gradeAnswer, readProbe, replyFlags, safeLooked, type DryRecord } from "./probe.ts";
import { probeToken } from "./probekey.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const ORIGIN = "https://ceo.test";
const TOKEN = "a-sample-probe-token-long-enough-0123456789";
/** A made-up line the live rails would say; it must never come back from the probe. */
const SECRET_SAY = "SAMPLE-READING-71F-do-not-leak";

function fixture(opts: { ask?: Ask; env?: Record<string, string>; spent?: number } = {}) {
  const acts: HomeAsk[] = [];
  const filed: string[] = [];
  const added: string[][] = [];
  const memory = new MemoryMemory();
  const live = (): ToolHost => ({
    read: async () => `Thermostat: ${SECRET_SAY}. Vacuum: next clean at 9 am.`,
    memory,
    kitchenAdd: async (items) => (added.push(items), { added: items, already: [] }),
    homeAct: async (req) => (acts.push(req), { ok: true, say: SECRET_SAY }),
    fileIssue: async (title) => (filed.push(title), 1),
    skipTerms: [],
    now: NOW,
  });
  const inputs: string[] = [];
  const ask: Ask =
    opts.ask ??
    (async (_s, input) => {
      inputs.push(input);
      return { answer: { reply: `Here you go: ${SECRET_SAY}.`, actions: [], room: "none" }, usage: { input_tokens: 900, output_tokens: 40 }, usd: 0.01, tier: "fast" };
    });
  const ledger = new MemoryChatLedger();
  const log = new MemoryRoomLog();
  const pending = new MemoryPending();
  const deps: ChatDeps = { deskKey: "a test desk key, not a real one", store: new MemoryAuthStore(), ledger, ask, host: live, pending, log, memory, world: async () => null, desk: async () => deskContext([], [], null, null), now: NOW, env: { SKIPPY_PROBE_TOKEN: TOKEN, ...opts.env } };
  const post = async (body: unknown, auth = `Bearer ${TOKEN}`) => {
    if (opts.spent) await ledger.add(Date.now(), { input_tokens: 1, output_tokens: 1 }, opts.spent);
    const res = await probe(new Request(`${ORIGIN}/api/skippy-probe`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as { turns?: Record<string, unknown>[]; error?: string } };
  };
  return { post, acts, filed, added, memory, log, pending, inputs };
}

describe("the probe's key (#955)", () => {
  it("opens only with SKIPPY_PROBE_TOKEN, and is off without one", async () => {
    const f = fixture();
    expect((await f.post({ asks: ["what's the temperature in my apartment"] }, "Bearer wrong")).status).toBe(401);
    expect((await f.post({ asks: ["what's the temperature in my apartment"] }, "")).status).toBe(401);
    expect((await fixture({ env: { SKIPPY_PROBE_TOKEN: "short" } }).post({ asks: ["hi"] })).status).toBe(503);
  });
  it("never counts when it is short or copies another secret", () => {
    expect(probeToken({ SKIPPY_PROBE_TOKEN: TOKEN })).toBe(TOKEN);
    expect(probeToken({ SKIPPY_PROBE_TOKEN: "x".repeat(31) })).toBe("");
    expect(probeToken({ SKIPPY_PROBE_TOKEN: TOKEN, SITE_BYPASS_TOKEN: TOKEN })).toBe("");
    expect(probeToken({ SKIPPY_PROBE_TOKEN: TOKEN, FOUNDRY_DESK_KEY: TOKEN })).toBe("");
  });
  it("gets past the site lock on POST /api/skippy-probe only", () => {
    const env = { FOUNDRY_DESK_KEY: "a test desk key, not a real one", SKIPPY_PROBE_TOKEN: TOKEN };
    const ctx = { state: { on: true } as never, keys: null, env, now: NOW };
    const req = (path: string, method = "POST", auth = `Bearer ${TOKEN}`) => new Request(`${ORIGIN}${path}`, { method, headers: { Authorization: auth } });
    expect(decide(req("/api/skippy-probe"), ctx)).toEqual({ allow: true, why: "probe-token" });
    expect(decide(req("/api/skippy-probe", "GET"), ctx).allow).toBe(false);
    expect(decide(req("/api/skippy-probe?x=1"), ctx).allow).toBe(false);
    expect(decide(req("/api/skippy"), ctx).allow).toBe(false);
    expect(decide(req("/api/skippy-act"), ctx).allow).toBe(false);
    expect(decide(req("/api/skippy-probe", "POST", `Bearer ${TOKEN}x`), ctx).allow).toBe(false);
  });
  it("takes one ask or one and its follow-up, on a known surface", () => {
    expect(readProbe({ asks: ["a"], surface: "phone" })).toEqual({ asks: ["a"], surface: "phone" });
    expect(readProbe({ asks: ["a", "b"] })).toEqual({ asks: ["a", "b"], surface: "desk" });
    expect(readProbe({ asks: [] })).toBeNull();
    expect(readProbe({ asks: ["a", "b", "c"] })).toBeNull();
    expect(readProbe({ asks: ["a", " "] })).toBeNull();
    expect(readProbe({ asks: ["a"], surface: "room" })).toBeNull();
  });
});

describe("a dry run (#955): no device moves, nothing is kept, no words come back", () => {
  it("records a spoken order by its action and never sends it", async () => {
    const f = fixture();
    const got = await f.post({ asks: ["okay feed the cat one portion"], surface: "phone" });
    expect(got.status).toBe(200);
    expect(f.acts).toEqual([]);
    expect(got.json.turns?.[0]).toMatchObject({ status: 200, tier: "rules", wouldRun: ["home.feeder.feed"], flags: [] });
    expect(got.text).not.toContain("Dry run");
  });
  it("keeps a typed order's Yes button out of the Desk's own store", async () => {
    const f = fixture();
    const got = await f.post({ asks: ["feed the cat one portion"], surface: "desk" });
    expect(got.json.turns?.[0]).toMatchObject({ taps: 1, wouldRun: ["home.feeder.feed"] });
    expect(f.pending.items).toEqual([]);
    expect(f.acts).toEqual([]);
  });
  it("answers a home question from the real read, with nothing written and none of its words", async () => {
    const f = fixture();
    const got = await f.post({ asks: ["yeah um when's the vacuum's next schedule"], surface: "phone" });
    expect(got.json.turns?.[0]).toMatchObject({ status: 200, tier: "rules", wouldRun: [], wrote: [], taps: 0 });
    expect(got.json.turns?.[0]?.chars).toBeGreaterThan(0);
    expect(got.text).not.toContain("9 am");
  });
  it("lets the wet tray's read through, the one read on the rails", async () => {
    const f = fixture();
    const got = await f.post({ asks: ["um so when is the next wet food cycle"], surface: "phone" });
    expect(f.acts.map((a) => a.action)).toEqual(["wet.status"]);
    expect(got.json.turns?.[0]).toMatchObject({ wouldRun: [] });
    expect(got.text).not.toContain(SECRET_SAY);
  });
  it("stops every write a model turn makes: devices, memory, lists, issues; and keeps no log or journal", async () => {
    const ask: Ask = async (_s, _i, ctx) => {
      await ctx!.host.homeAct!({ action: "vacuum.start" });
      await ctx!.host.memory!.addFact("Nikita likes a sample thing", "likes", "desk", NOW);
      await ctx!.host.kitchenAdd!(["sample milk"]);
      await ctx!.host.fileIssue!("A sample issue", "body");
      return { answer: { reply: "Done, monkey.", actions: [], room: "haven" }, usage: { input_tokens: 900, output_tokens: 40 }, usd: 0.01, tier: "fast", wrote: ["home_device"] };
    };
    const f = fixture({ ask });
    const got = await f.post({ asks: ["skippy my guy, the litter thing, has it like, done its business today"], surface: "phone" });
    expect(f.acts).toEqual([]);
    expect(f.added).toEqual([]);
    expect(f.filed).toEqual([]);
    expect((await f.memory.load()).facts).toEqual([]);
    expect(f.memory.turns).toEqual([]);
    expect(await f.log.list("haven", NOW)).toEqual([]);
    expect(got.json.turns?.[0]).toMatchObject({ wouldRun: ["home.vacuum.start", "memory.fact", "kitchen.add", "issue.file"], wrote: ["home_device"] });
  });
  it("asks a follow-up with the first turn as its history, the first reply kept server side", async () => {
    const f = fixture();
    const got = await f.post({ asks: ["who won the last sample cup?", "and who did they beat?"], surface: "desk" });
    expect(got.json.turns).toHaveLength(2);
    expect(f.inputs[1]).toContain("who won the last sample cup?");
    expect(f.inputs[1]).toContain(SECRET_SAY);
    expect(got.text).not.toContain(SECRET_SAY);
  });
  it("past the month's warn line, sends only what the rules answer", async () => {
    const f = fixture({ spent: 55 });
    expect((await f.post({ asks: ["what's the big sample news today?"] })).json.turns?.[0]).toMatchObject({ skipped: "budget" });
    expect(f.inputs).toEqual([]);
    expect((await f.post({ asks: ["what's the temperature in my apartment"], surface: "call" })).json.turns?.[0]).toMatchObject({ status: 200, tier: "rules" });
  });
});

/**
 * A stand-in for the Messages API that refuses, as the live one does, a request past its strict-schema limits (#976),
 * and otherwise has the fast tier answer in a sentence.
 */
function messagesApi(): { call: CallModel; refused: string[] } {
  const refused: string[] = [];
  const call: CallModel = async (params) => {
    const load = strictLoad(params);
    if (load.tools > STRICT_LIMITS.tools || load.optional > STRICT_LIMITS.optional || load.unions > STRICT_LIMITS.unions || load.unsupported.length) {
      refused.push(params.model);
      throw new Error("400 invalid_request_error: too many strict tools or optional parameters");
    }
    const fast = params.model === FAST_MODEL;
    const answer = { reply: "Nothing's on right now.", actions: [], room: "haven", needs: "none", ...(fast && { deeper: "no" }) };
    return { id: "m", type: "message", role: "assistant", model: params.model, content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 30 } } as unknown as Awaited<ReturnType<CallModel>>;
  };
  return { call, refused };
}

describe("the probe's model asks, through the real agent loop (#976)", () => {
  it("answers the battery's model asks on the phone and on a call, with no request the API would refuse", async () => {
    for (const [surface, ask] of [
      ["phone", "skippy my guy, the litter thing, has it like, done its business today"],
      ["call", "are any of the lights on right now"],
      ["desk", "anything on fire in the foundry right now?"],
    ] as const) {
      const api = messagesApi();
      const f = fixture({ ask: async (system, input, ctx) => (ctx ? runAgent(api.call, system, input, ctx) : { answer: null, usage: null }) });
      const got = await f.post({ asks: [ask], surface });
      expect(api.refused).toEqual([]);
      expect(got.json.turns?.[0]).toMatchObject({ status: 200, tier: "fast", flags: [] });
      expect(got.json.turns?.[0]?.error).toBeUndefined();
    }
  });
});

describe("the probe's grading rules (#955)", () => {
  it("flags the banned phrases and nothing in a good answer", () => {
    expect(replyFlags("It's 71°F inside and the heat's off.")).toEqual([]);
    expect(replyFlags("Could you rephrase that?")).toEqual(["rephrase"]);
    expect(replyFlags("That reading sits behind your sign-in.")).toEqual(["sign-in"]);
    expect(replyFlags("My brain hiccupped, ask again.")).toEqual(["hiccup"]);
    expect(replyFlags("I can't check the vacuum from here.")).toEqual(["cant"]);
    expect(replyFlags("I don't have the ability to read that.")).toEqual(["cant"]);
    expect(replyFlags("Hmm, let me think about that.")).toEqual(["ponder"]);
    expect(replyFlags("The vacuum didn't answer just now.")).toEqual(["down"]);
    expect(replyFlags("  ")).toEqual(["empty"]);
  });
  it("passes on only fixed names: tool titles, 'web' for a search, never its query", () => {
    const title = toolNamed("home_status")!.title;
    expect(safeLooked(["Searched the web: sample private words", title, 3, "made up"])).toEqual(["web", title, "other"]);
    expect(JSON.stringify(gradeAnswer(200, { reply: SECRET_SAY, looked: ["Searched the web: sample private words"], did: [SECRET_SAY], wrote: ["home_device", "nonsense"] }, 10, { wouldRun: [] }))).not.toMatch(/SAMPLE|private words|nonsense/);
  });
  it("the dry host recorders keep fixed names, never the input", async () => {
    const rec: DryRecord = { wouldRun: [] };
    const host = dryHost({ read: async () => "", memory: null, kitchenAdd: null, homeAct: async () => ({ ok: true, say: "" }), fileIssue: null, skipTerms: [], now: NOW }, rec);
    await host.homeAct!({ action: "<script>sample</script>" });
    expect(rec.wouldRun).toEqual(["home.other"]);
  });
});
