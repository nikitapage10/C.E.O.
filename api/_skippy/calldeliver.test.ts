import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { CALL_ANSWER_MS, DEEP_MIN_MS, NO_ANSWER, UNFIT, deliverCallAnswer, searchAnswer, type DeliverDeps } from "./calldeliver.ts";
import { MemoryRoomLog } from "./log.ts";
import { PASSED_ON, WEB_ACT, handle, type RoomSources } from "./toolroute.ts";
import { STILL_SEARCHING, VOICE_SEARCH_RESUMES, claudeSearch, forgetSearches, forgetWaitingLines, searchParams, type WebDeps } from "./voicelookups.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";

/** #1054: a call's slow question always gets one final answer, fast when its search is in, honest when nothing is. */

const NOW = Date.parse("2026-11-12T08:00:00Z");
const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function deps(over: Partial<DeliverDeps> = {}) {
  const kept: { id: string; text: string }[] = [];
  const d: DeliverDeps = { keep: async (id, text) => (kept.push({ id, text }), true), now: Date.now, ...over };
  return { d, kept };
}

describe("deliverCallAnswer", () => {
  it("keeps the call's own search as the answer the moment it is in, with no deeper run", async () => {
    const deep = vi.fn(async () => "deeper words");
    const { d, kept } = deps({ deep });
    const how = await deliverCallAnswer({ id: "t1", ask: "q", depth: "talk", search: later(20, 'Web search for "q": The sample measure passed on Tuesday, results certified Friday.') }, d);
    expect(how).toBe("search");
    expect(kept).toEqual([{ id: "t1", text: "The sample measure passed on Tuesday, results certified Friday." }]);
    expect(deep).not.toHaveBeenCalled();
  });

  it("goes deeper when the search found nothing or failed, and keeps that answer", async () => {
    for (const search of [Promise.resolve('The web search for "q" found nothing reliable; hand it to hand_to_kernel.'), Promise.reject(new Error("x"))]) {
      const { d, kept } = deps({ deep: async () => "The deeper answer." });
      expect(await deliverCallAnswer({ id: "t2", ask: "q", depth: "talk", search }, d)).toBe("deep");
      expect(kept).toEqual([{ id: "t2", text: "The deeper answer." }]);
    }
  });

  it("stops waiting on a slow search and gives the deeper run the time left", async () => {
    const deep = vi.fn(async () => "Deeper, in time.");
    const { d, kept } = deps({ deep });
    const how = await deliverCallAnswer({ id: "t3", ask: "q", depth: "hard", search: new Promise(() => undefined) }, d, { totalMs: DEEP_MIN_MS + 200, searchMs: 50 });
    expect(how).toBe("deep");
    expect(deep).toHaveBeenCalledWith("q", "hard");
    expect(kept[0]!.text).toBe("Deeper, in time.");
  });

  it("says plainly it couldn't get it when nothing lands by the deadline: one final line, never silence", async () => {
    const { d, kept } = deps({ deep: () => new Promise(() => undefined) });
    const t0 = Date.now();
    expect(await deliverCallAnswer({ id: "t4", ask: "q", depth: "talk", search: new Promise(() => undefined) }, d, { totalMs: DEEP_MIN_MS + 100, searchMs: 50 })).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(DEEP_MIN_MS + 1_000);
    expect(kept).toEqual([{ id: "t4", text: NO_ANSWER }]);
  });

  it("an empty or failing deeper run and no search end in the honest line too; a private answer is never kept", async () => {
    const empty = deps({ deep: async () => "  " });
    expect(await deliverCallAnswer({ id: "t5", ask: "q", depth: "talk" }, empty.d)).toBe("timeout");
    expect(empty.kept[0]!.text).toBe(NO_ANSWER);
    const thrown = deps({ deep: async () => Promise.reject(new Error("model")) });
    expect(await deliverCallAnswer({ id: "t6", ask: "q", depth: "talk" }, thrown.d)).toBe("timeout");
    const priv = deps({ deep: async () => "Write to someone@example.com for it." });
    expect(await deliverCallAnswer({ id: "t7", ask: "q", depth: "talk" }, priv.d)).toBe("unfit");
    expect(priv.kept[0]!.text).toBe(UNFIT);
  });

  it("times each answer from the question's arrival, after it is kept, by kind only (#1065)", async () => {
    const timed: [string, number][] = [];
    const order: string[] = [];
    const clock = { t: 1_000 };
    const { d } = deps({ now: () => clock.t, keep: async () => (order.push("kept"), (clock.t += 500), true), timed: (kind, ms) => void (order.push("timed"), timed.push([kind, ms])) });
    expect(await deliverCallAnswer({ id: "t8", ask: "q", depth: "talk", asked: 0, search: Promise.resolve('Web search for "q": Done.') }, d)).toBe("search");
    expect(timed).toEqual([["search", 1_500]]);
    expect(order).toEqual(["kept", "timed"]);
    const priv = deps({ deep: async () => "Write to someone@example.com for it.", timed: (kind) => void timed.push([kind, 0]) });
    await deliverCallAnswer({ id: "t9", ask: "q", depth: "talk" }, priv.d);
    expect(timed.at(-1)![0]).toBe("deeper");
    const thrown = deps({ timed: () => Promise.reject(new Error("store")) });
    expect(await deliverCallAnswer({ id: "t10", ask: "q", depth: "talk" }, thrown.d)).toBe("timeout");
  });

  it("reads a search's text as an answer: label off, nothing for a wait or an empty lookup", () => {
    expect(searchAnswer('Web search for "x": Done on Tuesday.')).toBe("Done on Tuesday.");
    expect(searchAnswer(STILL_SEARCHING)).toBe("");
    expect(searchAnswer(null)).toBe("");
    expect(searchAnswer('The web search for "x" failed; hand the question to hand_to_kernel.')).toBe("");
  });
});

describe("the call's web search (#1054)", () => {
  const msg = (stop: Anthropic.Message["stop_reason"], text: string, searches = 1) =>
    ({ content: text ? [{ type: "text", text, citations: null }] : [], stop_reason: stop, usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: searches } } }) as unknown as Anthropic.Message;

  it("resumes a paused search instead of reading it as nothing found", async () => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const replies = [msg("pause_turn", ""), msg("end_turn", "It passed on Tuesday.")];
    const search = claudeSearch("unused", async (p) => (calls.push(p), replies.shift()!));
    const got = await search("sample measure result");
    expect(got.text).toBe("It passed on Tuesday.");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.messages.at(-1)!.role).toBe("assistant");
    expect(got.usage.input_tokens).toBe(200);
    expect(got.usd).toBeGreaterThan(0);
  });

  it("gives up after a bounded number of pauses", async () => {
    const create = vi.fn(async () => msg("pause_turn", ""));
    expect((await claudeSearch("unused", create)("q")).text).toBe("");
    expect(create).toHaveBeenCalledTimes(VOICE_SEARCH_RESUMES + 1);
  });

  it("runs speed first: thinking off between searches, low effort, the current web search tool", () => {
    const p = searchParams("q");
    expect(p.thinking).toEqual({ type: "between_tools" });
    expect(p.output_config).toMatchObject({ effort: "low" });
    expect(p.tools).toEqual([expect.objectContaining({ type: "web_search_20260209", name: "web_search" })]);
  });
});

describe("the route hands the still-running search to the answerer (#1054)", () => {
  afterEach(() => {
    forgetSearches();
    forgetWaitingLines();
  });

  it("files a slow search once and the search's late answer is kept on the call's turn, fast", async () => {
    const crew = new MemoryCrewStore();
    const log = new MemoryRoomLog();
    const DESK = "a test desk key, not a real one";
    const token = (await issueToolToken(crew, DESK, "conv_live_1054", NOW + 12 * 60_000, NOW))!;
    const web: WebDeps = { search: () => later(150, { text: "Results certified Friday.", usage: { input_tokens: 1, output_tokens: 1 }, usd: 0.01 }), canSpend: async () => true, addSpend: async () => undefined };
    const delivered: Promise<unknown>[] = [];
    const deep = vi.fn(async () => "should not run");
    const d = {
      deskKey: DESK,
      crew,
      log,
      sources: { web } as unknown as RoomSources,
      now: NOW,
      budgetMs: 1_000, // the search answers after the tool's own wait
      deliver: (job: Parameters<typeof deliverCallAnswer>[0]) => {
        delivered.push(deliverCallAnswer(job, { keep: async (id, text) => (await log.answer(id, { from: "kernel-agent", text, at: new Date(NOW).toISOString() }, NOW)).ok, deep, now: Date.now }));
      },
    };
    const post = () => new Request("https://ceo.test/api/skippy-tools?act=" + WEB_ACT, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: "sample measure result" }) });
    const first = (await (await handle(post(), d)).json()) as { escalated?: boolean };
    expect(first.escalated).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(await delivered[0]).toBe("search");
    const [turn] = await log.list("kernel", NOW);
    expect(turn!.followUp?.text).toContain("Results certified Friday.");
    expect(turn!.followUp?.from).toBe("kernel-agent");
    expect(deep).not.toHaveBeenCalled();
    // Asking again is silence, and nothing is filed or answered twice.
    expect(((await (await handle(post(), d)).json()) as { text: string }).text).toBe(PASSED_ON);
    expect(delivered).toHaveLength(1);
  });
});

describe("the deadline (#1054)", () => {
  it("is well inside two minutes", () => {
    expect(CALL_ANSWER_MS).toBeLessThanOrEqual(45_000);
  });
});
