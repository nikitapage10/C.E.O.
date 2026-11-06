import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie, TEST_PASSKEY } from "../_desk/testing.ts";
import { forgetKeptWrite, homeNow, keepLines, type HomeLook } from "../_haven/devices/homeread.ts";
import type { DeviceReading } from "../_haven/devices/types.ts";
import { PhoneTodos } from "../_haven/todos.ts";
import { MemoryStoryStore } from "../_world/story.ts";
import { callAnswer, chat, deepAnswer, phoneAnswer, roomAnswer, type Ask, type ChatDeps } from "../skippy.ts";
import { FAST_MODEL, HARD_MODEL, TALK_MODEL, runAgent, type CallModel } from "./agent/loop.ts";
import { MemoryPending } from "./agent/pending.ts";
import type { HomeAsk, ToolHost } from "./agent/tools.ts";
import { MemoryChatLedger } from "./budget.ts";
import { deskContext } from "./context.ts";
import { forgetTaken, respond, type AgentDeps } from "./kernelagent.ts";
import { CALL_MODEL, MemoryRoomLog } from "./log.ts";
import { roomVoicePost, type RoomRouteDeps } from "./roomroute.ts";
import { JOIN_SYSTEM, resetGaps, type SenateAsk } from "./senatetalk.ts";
import { KERNEL_ACT, PATH, handle, readText, type RoomSources, type ToolDeps } from "./toolroute.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";

/**
 * Skippy's one brain on every surface (#926): Nikita's real asks, said where he said them, through the real routes and
 * the real turn (rules, then the fast tier, then the deeper one), down to fake rails and a scripted model. Every key,
 * reading and line here is made up.
 *
 * The latency targets, per tier (the model's time mocked, the rest measured):
 *   rules  (thermostat, a device by plain words): no model call; under 2 s on a Talk call, the live read included.
 *   fast   (Haiku, one direct tool): at most 2 Haiku calls; under 2 s at 700 ms a call.
 *   deeper (Sonnet, or Opus for judgment): starts from what the fast tier found; its answer is pushed into the call
 *          the moment it lands, with one waiting line before it at most.
 */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const NOW = Date.parse("2026-11-06T01:30:00Z");
/** What each tier's call is taken to cost in time (ms), for the latency table. */
const MODEL_MS: Record<string, number> = { [FAST_MODEL]: 700, [TALK_MODEL]: 2_500, [HARD_MODEL]: 6_000 };

const THERMOSTAT: DeviceReading = { id: "t-sample", vendor: "nest", kind: "thermostat", model: "Sample", place: "Sample", online: true, state: "heating", alerts: [], tempF: 71, humidity: 40, mode: "heat", heatF: 70, hvac: "heating" } as DeviceReading;
const HOME: HomeLook = { vendors: { nest: "live" }, devices: [THERMOSTAT] };
/** The members' answers, made up: in kind with no argument on (#910), joined to the one on the floor (#925). */
const FLOOR = { lines: [{ by: "foundry", text: "Bridges are just roads that got ambitious." }] };
const JOIN = { answers: [{ by: "relay", text: "Dry food is the bridge of cat cuisine: reliable, unloved." }], rest: [{ by: "foundry", stance: "nay", text: "Wet food would never hold a span." }], close: "Carried, and the chair prefers his kibble crunchy." };
const CLIMATE = "It's 71°F inside with 40% humidity; the heat is set to 70°F and it's heating now.";

function memoryBlob(): BlobBackend {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Step = (p: Params) => { content: unknown[]; stop: "end_turn" | "tool_use" };
const said = (o: Record<string, unknown>): Step => () => ({ content: [{ type: "text", text: JSON.stringify({ actions: [], room: "none", needs: "none", ...o }) }], stop: "end_turn" });
const uses = (name: string, input: Record<string, unknown>): Step => () => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop: "tool_use" });

/**
 * A whole C.E.O. for one test: the home's rails (the thermostat at 71°F, a wet feeder that opens), the rooms' reads,
 * a scripted model that keeps every call and the time each tier is taken to cost, and the routes' deps around them.
 */
async function world(opts: { steps?: Step[]; liveMs?: number; act?: (req: HomeAsk) => { ok: boolean; say: string } } = {}) {
  const blob = memoryBlob();
  const store = new MemoryAuthStore();
  const acts: HomeAsk[] = [];
  const calls: Params[] = [];
  const steps = [...(opts.steps ?? [])];
  let modelMs = 0;
  const call: CallModel = async (p) => {
    calls.push(structuredClone(p));
    modelMs += MODEL_MS[p.model] ?? 0;
    const step = steps.shift();
    if (!step) throw new Error("no model call was scripted for this");
    const { content, stop } = step(p);
    return { id: "m", type: "message", role: "assistant", model: p.model, content, stop_reason: stop, usage: { input_tokens: 900, output_tokens: 60 } } as unknown as Anthropic.Beta.Messages.BetaMessage;
  };
  const ask: Ask = async (system, input, ctx) => {
    if (!ctx) throw new Error("every surface brings the tools");
    return runAgent(call, system, input, ctx);
  };
  const nothing = async () => null;
  const sources: RoomSources = {
    green: nothing,
    exchange: nothing,
    positions: nothing,
    email: nothing,
    foundryBoard: async () => "",
    jobs: async () => ({ jobs: null, open: null }),
    world: nothing,
    bill: nothing,
    home: () => homeNow(async () => (await wait(opts.liveMs ?? 5), HOME), blob, NOW),
  };
  const host = (): ToolHost => ({
    read: (name) => readText(name, sources, NOW),
    memory: null,
    kitchenAdd: null,
    homeAct: async (req) => (acts.push(req), opts.act ? opts.act(req) : { ok: true, say: "The wet food feeder's lid is open. It closes itself at 1 pm." }),
    fileIssue: null,
    skipTerms: [],
    now: NOW,
  });
  const log = new MemoryRoomLog();
  const chatDeps: ChatDeps = { deskKey: DESK, store, ledger: new MemoryChatLedger(), ask, host, pending: new MemoryPending(), log, world: async () => null, desk: async () => deskContext([], [], null, null), now: NOW, env: {} };
  const senateAsk: SenateAsk = async (system) => ({ answer: system === JOIN_SYSTEM ? JOIN : FLOOR, usage: { input_tokens: 500, output_tokens: 40 } });
  const room: RoomRouteDeps = {
    desk: { deskKey: DESK, store, now: NOW },
    blob,
    eleven: null,
    ledger: new MemoryStoryStore(),
    skippy: (text, history, passkey, turn) => roomAnswer(text, history, passkey, turn, chatDeps),
    todos: (b) => new PhoneTodos(b),
    fetcher: fetch,
    log: () => undefined,
    senate: () => ({ chat: new MemoryChatLedger(), kernel: null, topics: null, ask: senateAsk, budget: 60, now: NOW, rnd: () => 0.3 }),
  };
  const crew = new MemoryCrewStore();
  const tools: ToolDeps = { deskKey: DESK, crew, sources, brain: (q, pk) => callAnswer(q, pk, chatDeps), log, now: NOW };
  const cookie = await signedInCookie(DESK, NOW, store);
  return { blob, acts, calls, chatDeps, room, tools, crew, cookie, log, modelMs: () => modelMs, models: () => calls.map((c) => c.model) };
}
type World = Awaited<ReturnType<typeof world>>;

/** Hold Space (or the room's mic) on a Desk page: POST /api/skippy-room. */
async function holdSpace(w: World, body: Record<string, unknown>) {
  const res = await roomVoicePost(new Request(`${ORIGIN}/api/skippy-room`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: w.cookie }, body: JSON.stringify(body) }), w.room);
  return (await res.json()) as { say?: string; kind?: string; lines?: { by: string; text: string }[]; skippy?: boolean; wrote?: string[] };
}

/** The Talk call's tools, with the call's token bound to the passkey that started it. */
async function onCall(w: World, method: "GET" | "POST", query: string, body?: unknown, passkey: string | undefined = TEST_PASSKEY.id) {
  const token = await issueToolToken(w.crew, DESK, "conv_sample_01", NOW + 10 * 60_000, NOW, passkey);
  const res = await handle(new Request(`${ORIGIN}${PATH}?${query}`, { method, headers: { [TOOL_HEADER]: token!, "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) }), w.tools);
  return (await res.json()) as { ok?: boolean; answered?: boolean; text: string; turn?: string };
}

beforeEach(() => {
  forgetKeptWrite();
  forgetTaken();
  resetGaps();
});

describe("Nikita's asks, on every surface, through the one brain (#926)", () => {
  it("Haven, hold Space: the apartment's temperature comes from the thermostat, with no model call", async () => {
    const w = await world();
    const got = await holdSpace(w, { room: "haven", text: "what's the current temperature in the apartment?" });
    expect(got.say).toBe(CLIMATE);
    expect(w.calls).toEqual([]);
  });

  it("the phone shortcut: 'Open the wet-food feeder.' opens it, from the phone", async () => {
    const w = await world();
    const turn = await phoneAnswer("Open the wet-food feeder.", "phone-sample", [], w.chatDeps);
    expect(turn.reply).toMatch(/lid is open/);
    expect(turn.reply).not.toMatch(/don't have that ability/i);
    expect(w.acts).toEqual([{ action: "wet.open", via: "phone", said: "Open the wet-food feeder." }]);
    expect(w.calls).toEqual([]);
  });

  it("the Desk, hold Space on any page: the Haven, the Green and Today all open the wet feeder", async () => {
    const w = await world();
    for (const room of ["haven", "green", "today"]) {
      const got = await holdSpace(w, { room, text: "open the wet food feeder" });
      expect(got.say, room).toMatch(/lid is open/);
    }
    expect(w.acts.map((a) => a.action)).toEqual(["wet.open", "wet.open", "wet.open"]);
    expect(w.calls).toEqual([]);
  });

  it("the Desk, typed: a device waits for the Yes tap, as it always has", async () => {
    const w = await world();
    const res = await chat(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: w.cookie }, body: JSON.stringify({ message: "open the wet food feeder", history: [] }) }), w.chatDeps);
    const body = (await res.json()) as { reply: string; confirm?: unknown[] };
    expect(body.confirm).toHaveLength(1);
    expect(body.reply).toMatch(/^Tap Yes/);
    expect(w.acts).toEqual([]);
  });

  it("the Senate, hold Space: 'can you dispense one portion of dry food?' is Skippy's, and the feeder runs", async () => {
    const w = await world();
    const got = await holdSpace(w, { room: "today", senate: "reply", said: "can you dispense one portion of dry food?", seated: ["foundry", "relay"], motion: "that bridges are art", lines: [{ by: "foundry", text: "Steel is art." }] });
    expect(w.acts).toEqual([{ action: "feeder.feed", via: "desk", said: "can you dispense one portion of dry food?" }]);
    expect(got.skippy).toBe(true);
    expect(got.lines).toEqual([{ by: "kernel", text: expect.stringMatching(/lid is open|feeder/i) }]);
    expect(got.wrote).toEqual(["home_device"]);
  });

  it("the Senate: a remark on the debate is judged by the fast pass, with the page as context, and goes to the members", async () => {
    const w = await world({ steps: [said({ reply: "", deeper: "floor" })] });
    const got = await holdSpace(w, { room: "today", senate: "reply", said: "honestly the bridges side is winning this", seated: ["foundry", "relay"], motion: "that bridges are art", lines: [{ by: "relay", text: "Bridges are overrated." }] });
    expect(got.lines).toEqual([{ by: "foundry", text: "Bridges are just roads that got ambitious." }]);
    expect(got.skippy).toBeUndefined();
    expect(w.models()).toEqual([FAST_MODEL]);
    const input = JSON.stringify(w.calls[0]!.messages);
    expect(input).toContain("The Senate is in session");
    expect(input).toContain("that bridges are art");
    // The page is a hint, never a filter: the fast pass has every room's tools on the floor too.
    expect(w.calls[0]!.tools?.map((t) => (t as { name: string }).name)).toEqual(expect.arrayContaining(["home_device", "home_status"]));
  });

  it("the Senate: a food remark inside the debate stays in the debate, by the fast pass's judgment, not by its words", async () => {
    const w = await world({ steps: [said({ reply: "", deeper: "floor" })] });
    const got = (await holdSpace(w, { room: "today", senate: "join", said: "dry food is basically a bridge for cats", seated: ["foundry", "relay"], motion: "that bridges are art", lines: [{ by: "relay", text: "Bridges are overrated." }] })) as { join?: unknown };
    expect(got.join).toEqual(JOIN);
    expect(w.acts).toEqual([]);
    expect(w.models()).toEqual([FAST_MODEL]);
    // An ask in the same words ("dispense …") runs the feeder instead, and comes back as the chair's line.
    const ask = await world();
    const done = await holdSpace(ask, { room: "today", senate: "join", said: "dispense one portion of dry food", seated: ["foundry", "relay"], motion: "that bridges are art", lines: [{ by: "relay", text: "Bridges are overrated." }] });
    expect(done.skippy).toBe(true);
    expect(ask.acts.map((a) => a.action)).toEqual(["feeder.feed"]);
  });

  it("the page goes with a spoken ask, so 'this' resolves, and the fast pass can act on another room from it", async () => {
    const w = await world({ steps: [uses("home_device", { action: "wet.open" }), said({ reply: "Done, the wet bowl's open for the cat.", deeper: "no" })] });
    const got = await holdSpace(w, { room: "green", text: "could you get the wet bowl open for the cat", page: "The Green: the waiver board, three claims pending." });
    expect(got.say).toBe("Done, the wet bowl's open for the cat.");
    expect(w.acts).toEqual([{ action: "wet.open", via: "desk", said: "could you get the wet bowl open for the cat" }]);
    expect(w.models()).toEqual([FAST_MODEL, FAST_MODEL]);
    expect(JSON.stringify(w.calls[0]!.messages)).toContain("three claims pending");
  });

  it("a failed or unset device says what failed, never that the ability is missing", async () => {
    const down = await world({ act: () => ({ ok: false, say: "The feeders' cloud (Petlibro) isn't answering right now." }) });
    const got = await holdSpace(down, { room: "haven", text: "open the wet food feeder" });
    expect(got.say).toBe("The feeders' cloud (Petlibro) isn't answering right now.");
    const unset = await world();
    const bare: ToolHost = { read: async () => "", memory: null, kitchenAdd: null, homeAct: null, fileIssue: null, skipTerms: [], now: NOW };
    const none = await phoneAnswer("open the wet food feeder", "phone-sample", [], { ...unset.chatDeps, host: () => bare });
    expect(none.reply).not.toMatch(/don't have (that|the) ability|can't do that/i);
    expect(none.reply).toMatch(/aren't set up|not set up|didn't answer|failed/i);
  });
});

describe("a Talk call (#926): the passkey's own turn, quick on the call", () => {
  it("answers the apartment's temperature in one line, well inside 2 s, with no model call", async () => {
    const w = await world({ liveMs: 300 });
    const t0 = performance.now();
    const got = await onCall(w, "POST", `act=${KERNEL_ACT}`, { ask: "what's the current temperature in my apartment?" });
    const ms = performance.now() - t0;
    expect(got).toMatchObject({ ok: true, answered: true });
    expect(got.text).toContain(CLIMATE);
    expect(ms).toBeLessThan(2_000);
    expect(w.calls).toEqual([]);
    expect(await w.log.list("kernel", NOW)).toEqual([]);
  });

  it("opens the wet feeder on the call", async () => {
    const w = await world();
    const got = await onCall(w, "POST", `act=${KERNEL_ACT}`, { ask: "open the wet food feeder" });
    expect(got.answered).toBe(true);
    expect(w.acts.map((a) => a.action)).toEqual(["wet.open"]);
  });

  it("files a call that wasn't started from a signed-in Desk the old way: never answered as anyone", async () => {
    const w = await world();
    const got = await onCall(w, "POST", `act=${KERNEL_ACT}`, { ask: "open the wet food feeder" }, "");
    expect(got.answered).toBeUndefined();
    expect(w.acts).toEqual([]);
  });

  it("reads the home on the call from the kept lines when the clouds are slow", async () => {
    const w = await world();
    await keepLines(w.blob, HOME, NOW - 5 * 60_000);
    w.tools.sources = { ...w.tools.sources, home: () => homeNow(() => new Promise<HomeLook>(() => undefined), w.blob, NOW, 50) };
    const got = await onCall(w, "GET", "read=haven");
    expect(got.text).toBe(`As of 5 minutes ago:\n${CLIMATE}`);
  });

  it("hands up what no tool covers: one waiting line, and the deeper run's answer kept final for the call", async () => {
    const w = await world({ steps: [said({ reply: "", deeper: "talk" })] });
    const got = await onCall(w, "POST", `act=${KERNEL_ACT}`, { ask: "compare this week's waiver targets for me" });
    expect(got.ok).toBe(true);
    expect(got.answered).toBeUndefined();
    expect(got.text).toMatch(/one short in-character line/);
    expect(got.text).toMatch(/never "thread", "hand-off", "Kernel" or "crew"/);
    const [turn] = await w.log.list("kernel", NOW);
    expect(turn).toMatchObject({ model: CALL_MODEL, needs: "skippy" });
    const kept: { text: string; final: boolean }[] = [];
    const d = { log: w.log, ledger: new MemoryChatLedger(), env: {}, now: NOW, run: null, brief: async () => "", desk: async () => ({ desk: "", rooms: "" }), league: async () => "", fileIssue: async () => null, keep: async (a: { text: string; final: boolean }) => (kept.push(a), true), deep: async () => "Your top waiver target is the sample tight end." } satisfies AgentDeps;
    expect(await respond(turn!.id, d)).toEqual({ state: "answered", usd: 0 });
    expect(kept).toEqual([{ id: turn!.id, text: "Your top waiver target is the sample tight end.", final: true }]);
  });
});

describe("the tiers' latency (#926), the model's time mocked", () => {
  it("rules: no model at all", async () => {
    const w = await world();
    await phoneAnswer("what's the temperature in the apartment", "phone-sample", [], w.chatDeps);
    expect(w.modelMs()).toBe(0);
  });

  it("fast: one direct tool in at most two Haiku calls, under 2 s, and no Sonnet", async () => {
    const w = await world({ steps: [uses("home_status", { about: "climate" }), said({ reply: "71 in here, toasty.", deeper: "no" })] });
    const turn = await phoneAnswer("is the apartment comfy for the cat right now", "phone-sample", [], w.chatDeps);
    expect(turn.reply).toBe("71 in here, toasty.");
    expect(w.models()).toEqual([FAST_MODEL, FAST_MODEL]);
    expect(w.modelMs()).toBeLessThan(2_000);
  });

  it("deeper: Sonnet carries on from what the fast tier read, and a plan goes to Opus", async () => {
    const w = await world({ steps: [uses("home_status", { about: "all" }), said({ reply: "", deeper: "talk" }), said({ reply: "The apartment's fine; nothing needs you.", needs: "none" })] });
    const turn = await phoneAnswer("walk me through how the apartment is doing overall", "phone-sample", [], w.chatDeps);
    expect(turn.reply).toBe("The apartment's fine; nothing needs you.");
    expect(w.models()).toEqual([FAST_MODEL, FAST_MODEL, TALK_MODEL]);
    // The deeper tier starts with the fast tier's read in hand, not from scratch.
    expect(JSON.stringify(w.calls[2]!.messages)).toContain("71°F");
    expect(w.modelMs()).toBe(2 * 700 + 2_500);

    const call = await world({ steps: [said({ reply: "", deeper: "hard" })] });
    expect(await callAnswer("plan the cat's feeding for next week", TEST_PASSKEY.id, call.chatDeps)).toEqual({ deeper: "hard" });
    expect(call.modelMs()).toBe(700);
    const deep = await world({ steps: [said({ reply: "Three meals a day, bowl two at noon.", needs: "none" })] });
    expect(await deepAnswer("plan the cat's feeding for next week", "hard", deep.chatDeps)).toBe("Three meals a day, bowl two at noon.");
    expect(deep.models()).toEqual([HARD_MODEL]);
  });
});
