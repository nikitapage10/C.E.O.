/**
 * Desk Skippy as an agent (#646): his memory's rules, the rooms' one tool registry and its checks, the Yes tap, the
 * loop's routing, caching and taint rule, and the three endpoints. Every person, fact and number here is made up.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { isRoomTool, needsConfirm } from "@ceo/engine/tools";
import { MemoryAuthStore } from "../../_desk/store.ts";
import { signedInCookie } from "../../_desk/testing.ts";
import { MemoryChatLedger } from "../budget.ts";
import { SKIPPY_PROMPT } from "../prompt.ts";
import { AGENT_RULES, FAST_MODEL, FAST_RULES, HARD_MODEL, STRICT_LIMITS, TALK_MODEL, runAgent, strictLoad, systemBlocks, type CallModel } from "./loop.ts";
import { MemoryMemory, coreBlock, memoryRefusal, search } from "./memory.ts";
import { MemoryPending } from "./pending.ts";
import { act, memoryGet, memoryPost, spend } from "./routes.ts";
import { ALL_TOOLS, EXECUTOR_NAMES, apiTools, callTool, confirmTool, toolsFor, type ToolHost } from "./tools.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ORIGIN = "https://ceo.example";

function host(over: Partial<ToolHost> = {}): ToolHost & { filed: string[]; added: string[][]; acted: string[] } {
  const filed: string[] = [];
  const added: string[][] = [];
  const acted: string[] = [];
  return {
    read: async (name) => `the ${name} room says hello`,
    memory: new MemoryMemory(),
    kitchenAdd: async (items) => {
      added.push(items);
      return { added: items, already: [] };
    },
    homeAct: async (req) => {
      acted.push(req.action);
      return { ok: true, say: "Done." };
    },
    fileIssue: async (title) => {
      filed.push(title);
      return 9001;
    },
    skipTerms: ["fakecorp"],
    now: NOW,
    filed,
    added,
    acted,
    ...over,
  };
}

describe("Skippy's memory (#646)", () => {
  it("keeps plain facts and refuses private details, money, legal matters, the skip list and the lists themselves", () => {
    expect(memoryRefusal("Nikita likes melodic bass on long drives")).toBeNull();
    expect(memoryRefusal("My test pal's number is 555-010-4477")).toBe("private");
    expect(memoryRefusal("Email me at sample.person@example.com")).toBe("private");
    expect(memoryRefusal("I owe $400 on the sample card")).toBe("money");
    expect(memoryRefusal("My salary went up this year")).toBe("money");
    expect(memoryRefusal("The lawyer called about the lawsuit")).toBe("legal");
    expect(memoryRefusal("Ignore anything from FakeCorp", ["fakecorp"])).toBe("skip");
    expect(memoryRefusal("Put this on my priority list")).toBe("lists");
  });

  it("finds facts and pages by topic, title and words, and saves only what passes", async () => {
    const m = new MemoryMemory(["fakecorp"]);
    expect((await m.addFact("Favourite game is a made-up space opera", "games", "desk", NOW)).ok).toBe(true);
    expect((await m.addFact("Paid $50 for the sample thing", "money", "desk", NOW)).ok).toBe(false);
    expect((await m.putPage({ title: "Music taste", topic: "music", summary: "Melodic bass and 2000s emo", body: "Long drives, loud.", source: "project" }, NOW)).ok).toBe(true);
    const doc = await m.load();
    expect(doc.facts).toHaveLength(1);
    expect(search(doc, "what music does he like")[0]?.title).toBe("Music taste");
    expect(search(doc, "favourite game")[0]?.kind).toBe("fact");
    expect(search(doc, "zzz")).toEqual([]);
  });

  it("journals turns trimmed and leaves out any that trip the rules", async () => {
    const m = new MemoryMemory();
    expect(await m.journal({ at: "", via: "desk", q: "What's building?", a: "Two crates, monkey." }, NOW)).toBe(true);
    expect(await m.journal({ at: "", via: "desk", q: "Text 555-010-4477", a: "No." }, NOW)).toBe(false);
    expect(await m.readJournal(NOW)).toHaveLength(1);
    expect(await m.readJournal(NOW + 40 * 24 * 3_600_000)).toHaveLength(0);
  });

  it("has a core card the prompt always carries, and a plain line when there is none", async () => {
    const m = new MemoryMemory();
    expect(coreBlock(await m.load())).toMatch(/No core card yet/);
    expect((await m.setCore("Nikita runs C.E.O. and likes things bold.")).ok).toBe(true);
    expect(coreBlock(await m.load())).toBe("Nikita runs C.E.O. and likes things bold.");
    expect((await m.setCore("Card ends in 4242 4242 4242 4242")).ok).toBe(false);
  });
});

describe("the rooms' one tool registry (#646)", () => {
  it("has an executor for every declared tool and nothing else, each well formed", () => {
    expect([...EXECUTOR_NAMES].sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
    for (const t of ALL_TOOLS) expect(isRoomTool(t), t.name).toBe(true);
  });

  it("gives every surface every tool (#926); on a spoken one a tapped tool says it waits, and a device runs only on his words", async () => {
    expect(toolsFor("spoken").map((t) => t.name)).toEqual(toolsFor("desk").map((t) => t.name));
    expect(toolsFor("spoken").some(needsConfirm)).toBe(true);
    const h = host();
    const pending = new MemoryPending();
    expect(await callTool("remember", { fact: "Likes a sample widget.", topic: "sample" }, h, { pending, surface: "spoken", said: "remember I like a sample widget" })).toMatchObject({ ok: false, text: expect.stringMatching(/waits for Nikita's Yes tap/) });
    // A build request files at once, said as well as typed (#1096).
    expect(await callTool("implement_it", { title: "Sample widget", pitch: "A made-up widget.", size: "small" }, h, { pending, surface: "spoken", said: "build a sample widget" })).toMatchObject({ ok: true, did: "Filed #9001 for the Builder" });
    expect(h.filed).toEqual(["Sample widget"]);
    expect(pending.items ?? []).toHaveLength(0);
    expect(await callTool("home_device", { action: "wet.open" }, h, { pending, surface: "spoken", said: "what's the weather like" })).toMatchObject({ ok: false, text: expect.stringMatching(/Nothing ran/) });
    expect(h.acted).toEqual([]);
    expect(await callTool("home_device", { action: "wet.open" }, h, { pending, surface: "spoken", said: "open the cat's wet-food feeder please" })).toMatchObject({ ok: true, text: "Done." });
    expect(await callTool("home_device", { action: "wet.close" }, h, { pending, surface: "spoken", said: "open the wet food feeder" })).toMatchObject({ ok: false });
    expect(h.acted).toEqual(["wet.open"]);
    expect(pending.items).toEqual([]);
  });

  it("sends closed schemas with no limits the API won't take", () => {
    const json = JSON.stringify(apiTools(ALL_TOOLS));
    expect(json).not.toMatch(/maxLength|maximum|minimum|maxItems/);
    expect(apiTools(ALL_TOOLS).every((t) => t.input_schema.additionalProperties === false)).toBe(true);
  });

  it("runs reads and plain writes at once, with chips", async () => {
    const h = host();
    expect(await callTool("green_board", {}, h, { pending: null, surface: "desk" })).toMatchObject({ ok: true, text: "the green room says hello" });
    const added = await callTool("kitchen_add", { items: ["garlic", "oat milk"] }, h, { pending: null, surface: "desk" });
    expect(added).toMatchObject({ ok: true, did: "Added 2 things to the Kitchen list" });
    expect(h.added).toEqual([["garlic", "oat milk"]]);
  });

  it("checks every input against its schema", async () => {
    const h = host();
    expect(await callTool("kitchen_add", { items: "garlic" }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("green_board", { extra: 1 }, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("home_device", { action: "oven.on" }, h, { pending: new MemoryPending(), surface: "desk" })).toMatchObject({ ok: false });
    expect(await callTool("no_such_tool", {}, h, { pending: null, surface: "desk" })).toMatchObject({ ok: false });
  });

  it("keeps anything that sends, spends or deletes, and the asked-for writes, for the Yes tap, and runs it once", async () => {
    const h = host();
    const pending = new MemoryPending();
    const got = await callTool("home_device", { action: "vacuum.start" }, h, { pending, surface: "desk" });
    expect(got.ok && "confirm" in got).toBe(true);
    expect(h.acted).toEqual([]);
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    expect((await confirmTool(id, true, h, pending)).ok).toBe(true);
    expect(h.acted).toHaveLength(1);
    // Once only.
    expect(await confirmTool(id, true, h, pending)).toMatchObject({ ok: false });
    expect(h.acted).toHaveLength(1);
  });

  it("No drops the call, and an old or made-up id runs nothing", async () => {
    const h = host();
    const pending = new MemoryPending();
    const got = await callTool("home_device", { action: "vacuum.start" }, h, { pending, surface: "desk" });
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    expect(await confirmTool(id, false, h, pending)).toMatchObject({ ok: true, text: expect.stringMatching(/Cancelled/) });
    expect(h.acted).toEqual([]);
    expect(await confirmTool("0".repeat(20), true, h, pending)).toMatchObject({ ok: false });
    const late = await callTool("home_device", { action: "vacuum.dock" }, h, { pending, surface: "desk" });
    const lateId = late.ok && "confirm" in late ? late.confirm.id : "";
    expect(await confirmTool(lateId, true, { ...h, now: NOW + 16 * 60_000 }, pending)).toMatchObject({ ok: false });
    expect(h.acted).toEqual([]);
  });

  it("never lets fetched web content start an action, not even one that would wait for a tap", async () => {
    const h = host();
    const pending = new MemoryPending();
    expect(await callTool("kitchen_add", { items: ["garlic"] }, h, { pending, surface: "desk", tainted: true })).toMatchObject({ ok: false });
    expect(await callTool("implement_it", { title: "x", pitch: "y", size: "small" }, h, { pending, surface: "desk", tainted: true })).toMatchObject({ ok: false });
    expect(pending.items).toEqual([]);
    expect(await callTool("green_board", {}, h, { pending, surface: "desk", tainted: true })).toMatchObject({ ok: true });
  });

  it("refuses a fact the memory won't keep before it ever asks for the tap", async () => {
    const pending = new MemoryPending();
    const got = await callTool("remember", { fact: "Bank balance is $9,000", topic: "money" }, host(), { pending, surface: "desk" });
    expect(got).toMatchObject({ ok: false, text: expect.stringMatching(/Money stays out/) });
    expect(pending.items).toEqual([]);
  });

  it("holds an issue with private words back, and drafts a text only as Relay's card", async () => {
    const pending = new MemoryPending();
    expect(await callTool("implement_it", { title: "Call me at 555-010-4477", pitch: "x", size: "small" }, host(), { pending, surface: "desk" })).toMatchObject({ ok: false });
    const text = await callTool("draft_text", { who: "Sample Pal", text: "Running late" }, host(), { pending, surface: "desk" });
    expect(text).toMatchObject({ ok: true, action: { kind: "text", who: "Sample Pal", text: "Running late" } });
    expect(await callTool("draft_text", { who: "Sample Pal", text: "Running late" }, host(), { pending, surface: "desk", direct: true })).toMatchObject({ ok: false });
  });
});

/* ── The loop, with a scripted model ── */

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
const msg = (content: unknown[], stop: string, model = TALK_MODEL, extraUsage = {}) => ({ id: "m", type: "message", role: "assistant", model, content, stop_reason: stop, usage: { ...usage, ...extraUsage } }) as unknown as Anthropic.Beta.Messages.BetaMessage;
const answer = (reply: string) => msg([{ type: "text", text: JSON.stringify({ reply, actions: [], room: "none", needs: "none" }) }], "end_turn");

function script(steps: ((p: Params) => Anthropic.Beta.Messages.BetaMessage)[], fast = false): { call: CallModel; calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    call: async (p) => {
      calls.push(structuredClone(p));
      // The fast tier (#926): it hands up, "hard" for a plan; a test that scripts it passes its own steps.
      if (p.model === FAST_MODEL && !fast) return msg([{ type: "text", text: JSON.stringify({ reply: "", actions: [], room: "none", needs: "none", deeper: /plan/i.test(JSON.stringify(p.messages)) ? "hard" : "talk" }) }], "end_turn", FAST_MODEL);
      const step = steps.shift();
      if (!step) throw new Error("no more steps");
      return { ...step(p), model: p.model };
    },
  };
}

const ctx = (over: Partial<Parameters<typeof runAgent>[3]> = {}) => ({ surface: "desk" as const, message: "hi", core: "Nikita likes bold.", host: host(), pending: new MemoryPending(), ...over });

describe("the agent loop (#646)", () => {
  // #976: 29 strict tools and 30 optional fields against the API's 20 and 24, so every model call was a 400 at once.
  it("keeps every request inside the API's strict-schema limits, on every surface and tier", async () => {
    for (const surface of ["desk", "phone", "room", "call"] as const) {
      for (const start of ["fast", "hard"] as const) {
        const s = script([() => answer("Hello, monkey.")]);
        await runAgent(s.call, SKIPPY_PROMPT, "<message>\nhi\n</message>", ctx({ surface, start }));
        expect(s.calls.length).toBeGreaterThan(0);
        for (const c of s.calls) {
          const load = strictLoad(c);
          expect(load.unsupported).toEqual([]);
          expect(load.tools).toBeLessThanOrEqual(STRICT_LIMITS.tools);
          expect(load.optional).toBeLessThanOrEqual(STRICT_LIMITS.optional);
          expect(load.unions).toBeLessThanOrEqual(STRICT_LIMITS.unions);
        }
      }
    }
  });

  it("counts strict tools and optional fields the way the API does", () => {
    const tools = apiTools(ALL_TOOLS).map((t) => ({ ...t, strict: true }));
    const load = strictLoad({ model: TALK_MODEL, max_tokens: 1, messages: [], tools });
    expect(load.tools).toBe(ALL_TOOLS.length);
    expect(load.optional).toBe(ALL_TOOLS.reduce((n, t) => n + Object.keys(t.input.properties).filter((k) => !t.input.required.includes(k)).length, 0));
    // The registry outgrew strict tool use: this is why the tools go without it.
    expect(load.tools > STRICT_LIMITS.tools || load.optional > STRICT_LIMITS.optional).toBe(true);
  });

  it("sends a world question to Gemini (#1124): Flash for a fact, Argon for depth, Claude when Gemini can't", async () => {
    const fastSays = (deeper: string) => () => msg([{ type: "text", text: JSON.stringify({ reply: "", actions: [], room: "none", needs: "none", deeper }) }], "end_turn", FAST_MODEL);
    const asked: { q: string; depth: string; about?: string }[] = [];
    const world = async (q: string, depth: "quick" | "deep", _now: number, about?: string) => {
      asked.push({ q, depth, ...(about !== undefined && { about }) });
      return { text: "Searching now. Hyde-Smith won.", model: depth === "deep" ? "gemini-4-argon" : "gemini-3.8-flash", usage: { input_tokens: 10, output_tokens: 5 }, usd: 0.02, searches: 1 };
    };
    const quick = script([fastSays("world")], true);
    const r = await runAgent(quick.call, SKIPPY_PROMPT, "<message>\nwho won\n</message>", ctx({ message: "who won", world }));
    expect(r.answer).toMatchObject({ reply: "Hyde-Smith won." });
    expect(r).toMatchObject({ tier: "world", model: "gemini-3.8-flash" });
    expect(r.parts.gemini).toBe(0.02);
    expect(asked[0]).toEqual({ q: "who won", depth: "quick", about: "Nikita likes bold." });
    expect(quick.calls.map((c) => c.model)).toEqual([FAST_MODEL]);

    const deep = script([fastSays("world_deep")], true);
    expect((await runAgent(deep.call, SKIPPY_PROMPT, "x", ctx({ world }))).model).toBe("gemini-4-argon");

    const none = script([fastSays("world_deep"), () => answer("From Claude.")], true);
    const fell = await runAgent(none.call, SKIPPY_PROMPT, "x", ctx({ world: async () => null }));
    expect(fell.answer).toMatchObject({ reply: "From Claude." });
    expect(none.calls.map((c) => c.model)).toEqual([FAST_MODEL, HARD_MODEL]);

    const onCall = script([fastSays("world")], true);
    expect(await runAgent(onCall.call, SKIPPY_PROMPT, "x", ctx({ surface: "call", fastOnly: true, world }))).toMatchObject({ deeper: "world" });
  });

  it("talks on Sonnet with the rooms' tools and web search, the rules and core card cached, the fallback on", async () => {
    const s = script([() => answer("Hello, monkey.")]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "<message>\nhi\n</message>", ctx());
    expect(s.calls.map((c) => c.model)).toEqual([FAST_MODEL, TALK_MODEL]);
    // The fast pass judges where the ask belongs (#926): its rules, with the page as a hint and every room's tools.
    expect(JSON.stringify(s.calls[0]!.system)).toContain(JSON.stringify(FAST_RULES).slice(1, -1));
    expect(s.calls[0]!.tools?.length).toBe(s.calls[1]!.tools!.length - 1);
    const p = s.calls[1]!;
    expect(p.model).toBe(TALK_MODEL);
    expect(p.fallbacks).toBe("default");
    expect(p.output_config?.effort).toBe("low");
    const sys = p.system as { text: string; cache_control?: unknown }[];
    expect(sys[0]!.text).toContain(AGENT_RULES);
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(sys[1]!.text).toContain("Nikita likes bold.");
    expect((p.tools as { name: string }[]).map((t) => t.name)).toContain("web_search");
    expect(r.answer).toMatchObject({ reply: "Hello, monkey." });
    expect(r.parts.talk).toBeGreaterThan(0);
  });

  it("on the Senate's floor, gives the words to the members when the deeper tier fails or says nothing (#952)", async () => {
    const empty = script([() => answer("")]);
    expect((await runAgent(empty.call, "x", "<message>\nare you guys talking about\n</message>", ctx({ surface: "room", floor: true }))).deeper).toBe("floor");
    const broke = script([
      () => {
        throw new Error("overloaded");
      },
    ]);
    expect((await runAgent(broke.call, "x", "<message>\nwhat are you guys talking about\n</message>", ctx({ surface: "room", floor: true }))).deeper).toBe("floor");
    // Off the floor a failure is still the chat's 502.
    const off = script([
      () => {
        throw new Error("overloaded");
      },
    ]);
    await expect(runAgent(off.call, "x", "<message>\nhi\n</message>", ctx())).rejects.toThrow();
    // The fast tier is told a question about the argument is the members' too.
    expect(FAST_RULES).toMatch(/what are you guys talking about/);
  });

  it("goes to Opus only when the fast tier says the ask is hard", async () => {
    const s = script([() => answer("Here's the plan.")]);
    const r = await runAgent(s.call, "x", "<message>\nWrite me a careful plan comparing three options\n</message>", ctx({ message: "Write me a careful plan comparing three options for the Haven's next device" }));
    expect(s.calls.map((c) => c.model)).toEqual([FAST_MODEL, HARD_MODEL]);
    expect(s.calls[1]!.output_config?.effort).toBe("medium");
    expect(r.parts.triage).toBeGreaterThan(0);
    expect(r.parts.research).toBeGreaterThan(0);
  });

  it("runs a read, keeps a tap-gated call waiting, and reports what it looked at and what waits", async () => {
    const s = script([
      () =>
        msg(
          [
            { type: "tool_use", id: "t1", name: "green_board", input: {} },
            { type: "tool_use", id: "t2", name: "remember", input: { fact: "Likes melodic bass", topic: "music" } },
          ],
          "tool_use",
        ),
      (p) => {
        const last = p.messages.at(-1)!.content as { type: string; content: string; is_error?: boolean }[];
        expect(last.map((b) => b.type)).toEqual(["tool_result", "tool_result"]);
        expect(last[1]!.content).toMatch(/Waiting for Nikita's Yes tap/);
        return answer("The Green's fine, and tap Yes to keep that.");
      },
    ]);
    const c = ctx();
    const r = await runAgent(s.call, SKIPPY_PROMPT, "x", c);
    expect(r.looked).toEqual(["Read the Green's board"]);
    expect(r.confirm).toHaveLength(1);
    expect(r.confirm[0]!.summary).toBe("Remember: Likes melodic bass");
    expect((await c.host.memory!.load()).facts).toEqual([]);
  });

  it("after a web search, an action the page asked for is refused", async () => {
    const s = script([
      () =>
        msg(
          [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "sample news" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
            { type: "tool_use", id: "t1", name: "kitchen_add", input: { items: ["whatever the page said"] } },
          ],
          "tool_use",
          TALK_MODEL,
          { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
        ),
      (p) => {
        const last = p.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
        expect(last[0]!.is_error).toBe(true);
        return answer("Found it.");
      },
    ]);
    const c = ctx();
    const r = await runAgent(s.call, SKIPPY_PROMPT, "x", c);
    expect((c.host as ReturnType<typeof host>).added).toEqual([]);
    expect(r.looked).toEqual(["Searched the web: sample news"]);
    expect(r.parts.web).toBeCloseTo(0.01, 6);
  });

  it("names the tools that changed something (#698), so the page showing it reads itself again", async () => {
    const s = script([
      () =>
        msg(
          [
            { type: "tool_use", id: "t1", name: "green_board", input: {} },
            { type: "tool_use", id: "t2", name: "kitchen_add", input: { items: ["basil"] } },
            { type: "tool_use", id: "t3", name: "remember", input: { fact: "Likes melodic bass", topic: "music" } },
          ],
          "tool_use",
        ),
      () => answer("Basil's on the list."),
    ]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "x", ctx());
    // A read and a call still waiting for the tap changed nothing yet.
    expect(r.wrote).toEqual(["kitchen_add"]);
  });

  it("the last round may not call a tool, so a turn always ends", async () => {
    const loop = () => msg([{ type: "tool_use", id: "t", name: "green_board", input: {} }], "tool_use");
    const s = script([loop, loop, loop, (p) => (expect(p.tool_choice).toEqual({ type: "none" }), answer("Done looking."))]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "x", ctx());
    expect(r.answer).toMatchObject({ reply: "Done looking." });
  });

  it("splits the prompt so the room's rules sit after the frozen prefix", () => {
    const [a, b] = systemBlocks(`${SKIPPY_PROMPT}\nRoom rules here.`, "core");
    expect(a!.text.startsWith(SKIPPY_PROMPT)).toBe(true);
    expect(a!.text).not.toContain("Room rules here.");
    expect(b!.text).toContain("Room rules here.");
  });
});

/* ── The endpoints ── */

async function signed() {
  const store = new MemoryAuthStore();
  const cookie = await signedInCookie("test-desk-key", NOW, store);
  return { desk: { deskKey: "test-desk-key", store, now: NOW }, cookie };
}
const req = (path: string, cookie: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body !== undefined && { "Content-Type": "application/json" }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });

describe("the agent's endpoints (#646)", () => {
  it("POST /api/skippy-act runs a tap only in a passkey session, once", async () => {
    const { desk, cookie } = await signed();
    const h = host();
    const pending = new MemoryPending();
    const got = await callTool("home_device", { action: "litter.clean" }, h, { pending, surface: "desk" });
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    const deps = { desk, host: () => h, pending };
    expect((await act(req("/api/skippy-act", "", { confirm: id, yes: true }), deps)).status).toBe(401);
    expect(h.acted).toEqual([]);
    const ok = await act(req("/api/skippy-act", cookie, { confirm: id, yes: true }), deps);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, did: "Run the Litter-Robot", wrote: ["home_device"] });
    expect((await act(req("/api/skippy-act", cookie, { confirm: id, yes: true }), deps)).status).toBe(409);
    expect(h.acted).toEqual(["litter.clean"]);
  });

  it("POST /api/skippy-act runs a voice hook's tool through the same registry, a gated one coming back waiting", async () => {
    const { desk, cookie } = await signed();
    const h = host();
    const deps = { desk, host: () => h, pending: new MemoryPending() };
    expect(await (await act(req("/api/skippy-act", cookie, { tool: "kitchen_add", input: { items: ["basil"] } }), deps)).json()).toMatchObject({ ok: true, wrote: ["kitchen_add"] });
    expect(await (await act(req("/api/skippy-act", cookie, { tool: "green_board", input: {} }), deps)).json()).not.toHaveProperty("wrote");
    const gated = (await (await act(req("/api/skippy-act", cookie, { tool: "forget", input: { id: "f000000000000" } }), deps)).json()) as { ok: boolean };
    expect(gated.ok).toBe(false); // no such memory: nothing to wait for
    expect((await act(req("/api/skippy-act", cookie, { tool: 7 }), deps)).status).toBe(400);
  });

  it("the memory endpoint lists and takes facts in a session, counting what it refused by reason", async () => {
    const { desk, cookie } = await signed();
    const memory = new MemoryMemory();
    const deps = { desk, memory };
    expect((await memoryGet(req("/api/skippy-memory", ""), deps)).status).toBe(401);
    const res = await memoryPost(req("/api/skippy-memory", cookie, { action: "facts", source: "project", facts: ["Prefers dark themes", "Card 4242 4242 4242 4242", "Owes $20 to a sample pal"] }), deps);
    expect(await res.json()).toEqual({ ok: true, kept: 1, refused: { private: 1, money: 1 } });
    const listed = (await (await memoryGet(req("/api/skippy-memory", cookie), deps)).json()) as { facts: { text: string; source: string }[] };
    expect(listed.facts).toEqual([expect.objectContaining({ text: "Prefers dark themes", source: "project" })]);
  });

  it("the write key may add to the memory (#1124), never read it or forget", async () => {
    const { desk } = await signed();
    const memory = new MemoryMemory();
    const FEED = "f".repeat(48);
    const deps = { desk, memory, env: { SUBMIND_FEED_TOKEN: FEED, SUBMIND_LOG_TOKEN: "l".repeat(48) } };
    const keyed = (body: unknown, key = FEED) => new Request(`${ORIGIN}/api/skippy-memory`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await memoryPost(keyed({ action: "core", text: "Senior IT audit manager looking toward product roles." }), deps)).status).toBe(200);
    expect(await (await memoryPost(keyed({ action: "page", topic: "work", title: "Career", summary: "Where he wants to go", body: "Product, TPM or his own business." }), deps)).json()).toMatchObject({ ok: true });
    expect((await memoryPost(keyed({ action: "forget", id: "f000000000000" }), deps)).status).toBe(403);
    expect((await memoryPost(keyed({ action: "core", text: "x" }, "l".repeat(48)), deps)).status).toBe(401);
    expect((await memoryGet(new Request(`${ORIGIN}/api/skippy-memory`, { headers: { Authorization: `Bearer ${FEED}` } }), deps)).status).toBe(401);
    const m = await memory.load();
    expect(m.core).toMatch(/product roles/);
    expect(m.pages[0]).toMatchObject({ title: "Career", source: "import" });
  });

  it("GET /api/skippy-spend answers the meter's shape in a session only", async () => {
    const { desk, cookie } = await signed();
    const chat = new MemoryChatLedger();
    await chat.add(NOW, { input_tokens: 1, output_tokens: 1 }, 12.5, { talk: 12.5 });
    const deps = { desk, chat, kernel: new MemoryChatLedger(), env: {} };
    expect((await spend(req("/api/skippy-spend", ""), deps)).status).toBe(401);
    expect(await (await spend(req("/api/skippy-spend", cookie), deps)).json()).toMatchObject({ capUsd: 60, warnUsd: 50, spentUsd: 12.5, state: "ok", parts: { talk: 12.5, kernel: 0 } });
  });
});
