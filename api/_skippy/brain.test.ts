import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie, TEST_PASSKEY } from "../_desk/testing.ts";
import { forgetKeptWrite, homeNow, keepLines, type HomeLook } from "../_haven/devices/homeread.ts";
import type { DeviceReading } from "../_haven/devices/types.ts";
import { PhoneKeys } from "../_haven/phones.ts";
import { capture, type HavenDeps } from "../_haven/route.ts";
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
async function world(opts: { steps?: Step[]; liveMs?: number; act?: (req: HomeAsk) => { ok: boolean; say: string }; lightsDown?: boolean } = {}) {
  const blob = memoryBlob();
  const store = new MemoryAuthStore();
  const acts: HomeAsk[] = [];
  /** The lights' switches as they reached the vendors (#1011): [id, on]. Two made-up lights. */
  const switched: [string, boolean][] = [];
  const lightsView = {
    vendors: { switchbot: "live" as const, govee: "live" as const },
    lights: [
      { id: "aaaaaaaaaaaa", vendor: "switchbot" as const, name: "Study", type: "Bot", on: false, online: true },
      { id: "bbbbbbbbbbbb", vendor: "govee" as const, name: "Sofa lamp", type: "H6008", on: false, online: true },
    ],
    scenes: [],
    remotes: [],
  };
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
    lights: {
      view: async () => lightsView,
      byName: async (words) => {
        const want = words.toLowerCase().replace(/\b(?:the|light|lights|lamp)\b/g, " ").trim();
        const hit = lightsView.lights.filter((l) => want && l.name.toLowerCase().includes(want));
        return hit.length === 1 ? { kind: "light" as const, id: hit[0]!.id, name: hit[0]!.name } : null;
      },
      set: async (id, on) => (switched.push([id, on]), opts.lightsDown ? { ok: false as const, code: "vendor" as const, say: "SwitchBot didn't take that just now. Try again in a moment." } : { ok: true as const, say: "Done." }),
      scene: async () => ({ ok: true, say: "Done." }),
    },
  });
  const log = new MemoryRoomLog();
  const pending = new MemoryPending();
  const chatDeps: ChatDeps = { deskKey: DESK, store, ledger: new MemoryChatLedger(), ask, host, pending, log, world: async () => null, desk: async () => deskContext([], [], null, null), now: NOW, env: {} };
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
  return { blob, acts, switched, pending, calls, chatDeps, room, tools, crew, cookie, log, modelMs: () => modelMs, models: () => calls.map((c) => c.model) };
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

/** The iPhone's "Skippy" shortcut (#627): POST /api/capture with the phone's key, through the real route and turn. */
const PEPPER = Buffer.alloc(32, 7);
async function shortcut(w: World, text: string, key?: string | null) {
  const phones = new PhoneKeys(w.blob, PEPPER);
  const made = key === undefined ? (await phones.add("Sample phone", NOW))!.key : key;
  const deps: HavenDeps = { desk: { deskKey: DESK, store: w.chatDeps.store, now: NOW }, blob: w.blob, pepper: async () => PEPPER, todos: (b) => new PhoneTodos(b), skippy: (t, id, h) => phoneAnswer(t, id, h, w.chatDeps), voice: null, log: () => undefined, random: () => 0 };
  const res = await capture(new Request(`${ORIGIN}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json", ...(made !== null && { "x-ceo-phone-key": made }) }, body: JSON.stringify({ text }) }), deps);
  return { status: res.status, body: (await res.json()) as { say?: string; quiet?: boolean; error?: string } };
}

/** What is waiting for a Yes on the Desk, if anything (a tap that would never come from the phone). */
async function waiting(w: World): Promise<boolean> {
  return w.pending.items.length > 0;
}

/** Skippy's chat on the Desk, typed (POST /api/skippy), signed in unless `cookie` says otherwise. */
async function typed(w: World, message: string, cookie: string | null = w.cookie) {
  const res = await chat(new Request(`${ORIGIN}/api/skippy`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie !== null && { Cookie: cookie }) }, body: JSON.stringify({ message, history: [] }) }), w.chatDeps);
  return { status: res.status, ...((await res.json()) as { reply?: string; confirm?: { summary: string }[]; error?: string; wrote?: string[] }) };
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

  it("the Desk, typed: a device ordered in plain words runs at once, with no Yes tap (#1015)", async () => {
    const w = await world();
    const body = await typed(w, "open the wet food feeder");
    expect(body.confirm).toBeUndefined();
    expect(body.reply).toMatch(/lid is open/);
    expect(w.acts).toEqual([{ action: "wet.open", via: "desk", said: "open the wet food feeder" }]);
    expect(w.pending.items).toEqual([]);
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
    const timed: [string, number][] = [];
    w.tools.timed = (kind, askedAt) => void timed.push([kind, askedAt]);
    const got = await onCall(w, "POST", `act=${KERNEL_ACT}`, { ask: "open the wet food feeder" });
    expect(got.answered).toBe(true);
    expect(w.acts.map((a) => a.action)).toEqual(["wet.open"]);
    // Timed as a quick answer from the question's arrival (#1065).
    expect(timed).toEqual([["quick", NOW]]);
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

describe("a home ask handed on from any surface is answered by the one brain (#952)", () => {
  it("never by the responder that can't read the devices", async () => {
    const w = await world();
    const at = new Date(NOW).toISOString();
    await w.log.add({ id: "a1b2c3d4e5f60718", at, question: "When is the next wet food cycle for my cat?", answer: "Pondering.", room: "kernel", model: "claude-sonnet-5-5", needs: "skippy", via: "phone" }, NOW);
    const kept: { text: string; final: boolean }[] = [];
    const asked: string[] = [];
    const d = { log: w.log, ledger: new MemoryChatLedger(), env: {}, now: NOW, run: null, brief: async () => "", desk: async () => ({ desk: "", rooms: "" }), league: async () => "", fileIssue: async () => null, keep: async (a: { text: string; final: boolean }) => (kept.push(a), true), deep: async (q: string) => (asked.push(q), "The next wet meal is at 6pm, bowl 2.") } satisfies AgentDeps;
    expect(await respond("a1b2c3d4e5f60718", d)).toEqual({ state: "answered", usd: 0 });
    expect(asked).toEqual(["When is the next wet food cycle for my cat?"]);
    expect(kept[0]).toMatchObject({ text: "The next wet meal is at 6pm, bowl 2.", final: true });
  });

  it("answers a schedule question by the rules on the phone, from the wet plan, with no model", async () => {
    const w = await world();
    const turn = await phoneAnswer("When is the next wet food cycle for my cat?", "phone-sample", [], w.chatDeps);
    expect(w.modelMs()).toBe(0);
    expect(turn.error).toBeUndefined();
    expect(turn.tier).toBe("rules");
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

describe("the phone shortcut runs a plain order at once, with no Yes on the Desk (#1011)", () => {
  it("'turn on the lights' switches every light from the phone and says so only after they took it", async () => {
    const w = await world();
    const got = await shortcut(w, "Turn on the lights.");
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ say: "The lights are on.", quiet: true });
    expect(w.switched).toEqual([["aaaaaaaaaaaa", true], ["bbbbbbbbbbbb", true]]);
    expect(got.body.say).not.toMatch(/Desk|Yes|tap/i);
    expect(await waiting(w)).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("a light the model switches on Nikita's words runs too, without a Desk proposal", async () => {
    const w = await world({ steps: [uses("lights_set", { name: "Study", on: true }), said({ reply: "Study's on.", room: "haven", deeper: "no" })] });
    const got = await shortcut(w, "put the study light on for me");
    expect(got.status).toBe(200);
    expect(got.body.say).toBe("Study's on.");
    expect(w.switched).toEqual([["aaaaaaaaaaaa", true]]);
    expect(await waiting(w)).toBe(false);
  });

  it("a failed switch is said out loud, never 'done'", async () => {
    const w = await world({ lightsDown: true });
    const got = await shortcut(w, "turn off the lights");
    expect(got.status).toBe(200);
    expect(got.body.quiet).toBe(false);
    expect(got.body.say).toMatch(/didn't switch off/);
    expect(got.body.say).not.toMatch(/are off|done/i);
  });

  it("a question about the lights never switches them, even when the model reaches for the switch", async () => {
    const w = await world({ steps: [uses("lights_set", { name: "all", on: true }), said({ reply: "Both are off.", room: "haven", deeper: "no" })] });
    const got = await shortcut(w, "are the lights on?");
    expect(got.status).toBe(200);
    expect(w.switched).toEqual([]);
    expect(await waiting(w)).toBe(false);
  });

  it("an unauthenticated caller never runs a device: no key, a wrong key, a revoked one", async () => {
    const w = await world();
    for (const key of [null, "", `skp_${"A".repeat(43)}`, "Bearer nope"]) {
      const got = await shortcut(w, "turn on the lights", key);
      expect(got.status, String(key)).toBe(401);
      expect(got.body).toEqual({ error: "unauthorized" });
    }
    const phones = new PhoneKeys(w.blob, PEPPER);
    const made = (await phones.add("Revoked phone", NOW))!;
    await phones.revoke(made.phone.id, NOW);
    expect((await shortcut(w, "open the wet food feeder", made.key)).status).toBe(401);
    expect(w.switched).toEqual([]);
    expect(w.acts).toEqual([]);
  });
});

describe("the Desk's chat runs a plain device order at once, with no Yes tap (#1015)", () => {
  it("'turn on the lights' typed switches every light and says so only after they took it", async () => {
    const w = await world();
    const body = await typed(w, "turn on the lights");
    expect(body.status).toBe(200);
    expect(body.reply).toBe("The lights are on.");
    expect(body.confirm).toBeUndefined();
    expect(body.wrote).toEqual(["lights_set"]);
    expect(w.switched).toEqual([["aaaaaaaaaaaa", true], ["bbbbbbbbbbbb", true]]);
    expect(w.pending.items).toEqual([]);
    expect(w.calls).toEqual([]);
  });

  it("a switch the model makes on Nikita's typed words runs; a failed one says what failed", async () => {
    const w = await world({ steps: [uses("lights_set", { name: "Study", on: true }), said({ reply: "Study's on.", room: "haven", deeper: "no" })] });
    const body = await typed(w, "put the study light on for me");
    expect(body.reply).toBe("Study's on.");
    expect(body.confirm).toBeUndefined();
    expect(w.switched).toEqual([["aaaaaaaaaaaa", true]]);
    const down = await world({ lightsDown: true });
    const failed = await typed(down, "turn off the lights");
    expect(failed.reply).toMatch(/didn't switch off/);
    expect(failed.reply).not.toMatch(/are off|done/i);
  });

  it("a typed question never runs a device: the model's reach for the switch gets the Yes card at most", async () => {
    const w = await world({ steps: [uses("lights_set", { name: "all", on: true }), said({ reply: "Both are off.", room: "haven", deeper: "no" })] });
    const body = await typed(w, "are the lights on?");
    expect(body.status).toBe(200);
    expect(w.switched).toEqual([]);
    expect(w.acts).toEqual([]);
  });

  it("remember and the other tapped tools still wait for the Yes", async () => {
    const w = await world({ steps: [uses("remember", { fact: "Likes a sample thing.", topic: "sample" }), said({ reply: "Waiting on your Yes.", room: "today", deeper: "no" })] });
    const body = await typed(w, "remember that I like a sample thing");
    expect(body.confirm).toHaveLength(1);
    expect(w.pending.items.map((p) => p.tool)).toEqual(["remember"]);
  });

  it("files a build request at once, with no Yes card (#1096)", async () => {
    const w = await world({ steps: [uses("implement_it", { title: "A sample idea", pitch: "A sample pitch.", size: "small" }), said({ reply: "Filed.", room: "foundry", deeper: "no" })] });
    const body = await typed(w, "implement it: a sample idea");
    expect(body.confirm ?? []).toHaveLength(0);
    expect(w.pending.items).toEqual([]);
  });

  it("signed out, the chat runs nothing: no cookie or a forged one is refused before the body is read", async () => {
    const w = await world();
    for (const cookie of [null, "ceo_session=forged", `${w.cookie.split("=")[0]}=x`]) {
      const body = await typed(w, "turn on the lights", cookie);
      expect(body.status, String(cookie)).toBe(401);
    }
    expect((await typed(w, "open the wet food feeder", null)).status).toBe(401);
    expect(w.switched).toEqual([]);
    expect(w.acts).toEqual([]);
  });
});
