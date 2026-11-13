import { describe, expect, it, vi } from "vitest";
import { needsConfirm } from "@ceo/engine/tools";
import { TOOLS as FOUNDRY_TOOLS } from "../../rooms/foundry/tools.ts";
import { BY_SEARCH, deliverCallAnswer, type DeliverDeps } from "./calldeliver.ts";
import { MemoryRoomLog, cleanFollowUp } from "./log.ts";
import { ONE_WAITING_LINE, ONLY_WHAT_RAN } from "./ponder.ts";
import { CALL_RULES as BRAIN_CALL_RULES } from "./prompt.ts";
import type { CallBrain, RoomSources, ToolDeps } from "./toolroute.ts";
import { PASSED_ON, askedAnywhere } from "./toolroute.ts";
import { SKIP_TURN, VOICE_TURN_TIMEOUT_SECS, agentBody, voicePrompt } from "./voice.ts";
import { ON_AIR, TOOL_DEFS, submindPrompt } from "./voicecrew.ts";
import { STILL_SEARCHING } from "./voicelookups.ts";
import { MemoryCrewStore, TOOL_HEADER, checkToolToken, issueToolToken, noteAsk } from "./voicetoken.ts";

/**
 * Nikita's Talk calls of 2026-11-13 (#1140): a build "filed" that no tool filed, "still with me?" filler while an answer
 * was coming, one question handed to the deeper mind twice from two instances, and no record of which brain answered.
 * Every key, ask and answer here is made up.
 */

const NOW = Date.parse("2026-11-13T18:00:00Z");
const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const PASSKEY = "test-passkey";

describe("only what ran is said (#1140)", () => {
  const voices = [{ who: "voice Skippy", text: voicePrompt(true) }, ...ON_AIR.map((s) => ({ who: s.name, text: submindPrompt(s) }))];

  it("every voice on the call is told to claim nothing a tool didn't return as done", () => {
    for (const { who, text } of voices) expect(text, who).toContain(ONLY_WHAT_RAN);
    expect(ONLY_WHAT_RAN).toMatch(/Never say anything was filed, sent, saved/);
    expect(ONLY_WHAT_RAN).toMatch(/handing the mic to the Builder, files nothing/);
    expect(ONLY_WHAT_RAN).toMatch(/say so plainly/);
  });

  it("a build request goes to the one brain, whose implement_it files it at once on a call", () => {
    expect(voicePrompt(true)).not.toMatch(/can't file ideas/);
    expect(voicePrompt(true)).toMatch(/a build or a fix for the Builder included\), or asks something no tool of yours can answer, pass it to your deeper self with hand_to_kernel/);
    expect(voicePrompt(false)).toMatch(/can't file ideas/);
    const hand = TOOL_DEFS.find((t) => t.name === "hand_to_kernel")!;
    expect(hand.description).toMatch(/filing a build or a fix for the Builder, which it files as a foundry issue/);
    expect(hand.description).toMatch(/a build is filed when it gives the issue's number/);
    expect(BRAIN_CALL_RULES).toMatch(/A build or a fix he asks for is implement_it/);
    const implement = FOUNDRY_TOOLS.find((t) => t.name === "implement_it")!;
    expect(needsConfirm(implement)).toBe(false);
  });
});

describe("no filler while an answer comes (#1140)", () => {
  it("the waiting rule forbids check-ins and answering a silence", () => {
    expect(ONE_WAITING_LINE).toMatch(/no check-ins \("still with me\?"/);
    expect(ONE_WAITING_LINE).toMatch(/just "\.\.\." from him\) you say nothing back/);
    expect(STILL_SEARCHING).not.toMatch(/^Still/);
  });

  it("the agent waits its longest before re-engaging and can skip a turn; the core fallback carries neither", () => {
    const full = agentBody("voice_sample", "full", { toolIds: ["t1"], transfers: null });
    expect(full.conversation_config.turn).toEqual({ silence_end_call_timeout: 120, turn_timeout: VOICE_TURN_TIMEOUT_SECS });
    expect(full.conversation_config.agent.prompt).toMatchObject({ built_in_tools: SKIP_TURN });
    const core = agentBody("voice_sample", "core", { toolIds: ["t1"], transfers: null });
    expect(core.conversation_config).not.toHaveProperty("turn");
    expect(core.conversation_config.agent.prompt).not.toHaveProperty("built_in_tools");
  });
});

/** A fresh copy of the tool route: another Azure instance, with nothing of the first one's memory. */
async function instance() {
  vi.resetModules();
  return import("./toolroute.ts");
}

async function call(route: Awaited<ReturnType<typeof instance>>, token: string, ask: string, deps: ToolDeps) {
  const res = await route.handle(new Request(`${ORIGIN}${route.PATH}?act=${route.KERNEL_ACT}`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ ask }) }), deps);
  return (await res.json()) as { ok?: boolean; answered?: boolean; text: string; turn?: string };
}

function world(brain: CallBrain) {
  const crew = new MemoryCrewStore();
  const log = new MemoryRoomLog();
  const deliver = vi.fn();
  const deps = (now: number): ToolDeps => ({ deskKey: DESK, crew, log, sources: {} as RoomSources, brain, deliver, now, budgetMs: 4_300 });
  return { crew, log, deliver, deps };
}

describe("one hand-off per question across instances (#1140)", () => {
  const ASK = "Who won the sample city council race last night?";
  const AGAIN = "Who won the sample council race last night";

  it("a repeat seven seconds later on another instance is the same question: no second run", async () => {
    const brain = vi.fn<CallBrain>(async () => ({ deeper: "talk" }));
    const w = world(brain);
    const token = (await issueToolToken(w.crew, DESK, "conv_sample_01", NOW + 600_000, NOW, PASSKEY))!;
    const first = await call(await instance(), token, ASK, w.deps(NOW));
    expect(first.turn).toBeTruthy();
    const second = await call(await instance(), token, AGAIN, w.deps(NOW + 7_000));
    expect(second.text).toBe(PASSED_ON);
    expect(brain).toHaveBeenCalledTimes(1);
    expect(w.deliver).toHaveBeenCalledTimes(1);
    expect(await w.log.list("kernel", NOW + 7_000)).toHaveLength(1);
  });

  it("is noted before the quick pass: a repeat while it runs, elsewhere, waits on it", async () => {
    let release: (t: { deeper: "talk" }) => void = () => undefined;
    const brain = vi.fn<CallBrain>(() => new Promise((r) => (release = r)));
    const w = world(brain);
    const token = (await issueToolToken(w.crew, DESK, "conv_sample_02", NOW + 600_000, NOW, PASSKEY))!;
    const a = await instance();
    const firstP = call(a, token, ASK, w.deps(NOW));
    await new Promise((r) => setTimeout(r, 20));
    const second = await call(await instance(), token, AGAIN, w.deps(NOW + 1_500));
    expect(second.text).toBe(PASSED_ON);
    release({ deeper: "talk" });
    expect((await firstP).turn).toBeTruthy();
    expect(brain).toHaveBeenCalledTimes(1);
    expect(w.deliver).toHaveBeenCalledTimes(1);
  });

  it("a question the quick pass answered is taken off, so asking it again is asked again", async () => {
    const brain = vi.fn<CallBrain>(async () => ({ reply: "The sample councillor won." }));
    const w = world(brain);
    const token = (await issueToolToken(w.crew, DESK, "conv_sample_03", NOW + 600_000, NOW, PASSKEY))!;
    expect((await call(await instance(), token, ASK, w.deps(NOW))).answered).toBe(true);
    const check = await checkToolToken(token, DESK, w.crew, NOW + 5_000);
    expect(check.ok && (check.asks ?? [])).toEqual([]);
    expect((await call(await instance(), token, AGAIN, w.deps(NOW + 5_000))).text).toMatch(/The sample councillor won/);
    expect(brain).toHaveBeenCalledTimes(2);
  });

  it("sees the call's kept hand-offs in the log and its noted asks, within the window only", async () => {
    const log = new MemoryRoomLog();
    const at = new Date(NOW).toISOString();
    await log.add({ id: "0123456789abcdef", at, question: ASK, answer: "x", room: "kernel", model: "voice", needs: "skippy" }, NOW);
    const check = { hash: "h-other-instance", handoffs: ["0123456789abcdef"] };
    expect(await askedAnywhere(AGAIN, { log, now: NOW + 7_000 }, check)).toBe(PASSED_ON);
    expect(await askedAnywhere(AGAIN, { log, now: NOW + 200_000 }, check)).toBeNull();
    expect(await askedAnywhere("weather near home tomorrow", { log, now: NOW + 7_000 }, check)).toBeNull();
    expect(await askedAnywhere(AGAIN, { log: null, now: NOW + 7_000 }, { hash: "h2", handoffs: [], asks: [{ ask: ASK, at: NOW }] })).toBe(PASSED_ON);
  });

  it("keeps a call's noted asks with its token, and drops them on request", async () => {
    const crew = new MemoryCrewStore();
    const token = (await issueToolToken(crew, DESK, "conv_sample_04", NOW + 600_000, NOW, PASSKEY))!;
    const first = await checkToolToken(token, DESK, crew, NOW);
    const hash = first.ok ? first.hash : "";
    await noteAsk(crew, hash, ASK, NOW, NOW);
    const noted = await checkToolToken(token, DESK, crew, NOW);
    expect(noted.ok && noted.asks).toEqual([{ ask: ASK, at: NOW }]);
    await noteAsk(crew, hash, ASK, NOW, NOW, true);
    const gone = await checkToolToken(token, DESK, crew, NOW);
    expect(gone.ok && gone.asks).toBeUndefined();
  });
});

describe("who answered a call's question is kept (#1140)", () => {
  function deps(over: Partial<DeliverDeps> = {}) {
    const kept: { text: string; by?: string }[] = [];
    const lines: string[] = [];
    const d: DeliverDeps = { keep: async (_id, text, by) => (kept.push({ text, ...(by && { by }) }), true), now: Date.now, log: (l) => lines.push(l), ...over };
    return { d, kept, lines };
  }

  it("names the deeper run's model, or the search, on the kept answer and in the log line", async () => {
    const deep = deps({ deep: async () => ({ text: "The sample answer.", by: "sample-model-1" }) });
    expect(await deliverCallAnswer({ id: "t1", ask: "q", depth: "talk" }, deep.d)).toBe("deep");
    expect(deep.kept).toEqual([{ text: "The sample answer.", by: "sample-model-1" }]);
    expect(deep.lines[0]).toMatch(/^skippy-call answer deep by=sample-model-1 ms=\d+$/);

    const search = deps();
    expect(await deliverCallAnswer({ id: "t2", ask: "q", depth: "talk", search: Promise.resolve('Web search for "q": The sample result.') }, search.d)).toBe("search");
    expect(search.kept).toEqual([{ text: "The sample result.", by: BY_SEARCH }]);
    expect(search.lines[0]).toMatch(/answer search by=search/);

    const plain = deps({ deep: async () => "No model named." });
    await deliverCallAnswer({ id: "t3", ask: "q", depth: "talk" }, plain.d);
    expect(plain.kept).toEqual([{ text: "No model named." }]);
  });

  it("round-trips `by` on the kept follow-up, and drops one that isn't plain", async () => {
    const at = new Date(NOW).toISOString();
    expect(cleanFollowUp({ from: "kernel-agent", text: "An answer.", at, by: "sample-model-1" })).toEqual({ from: "kernel-agent", text: "An answer.", at, by: "sample-model-1" });
    expect(cleanFollowUp({ from: "kernel-agent", text: "An answer.", at, by: "bad <by>" })).toEqual({ from: "kernel-agent", text: "An answer.", at });
    const log = new MemoryRoomLog();
    await log.add({ id: "0123456789abcdef", at, question: "q", answer: "x", room: "kernel", model: "voice", needs: "skippy" }, NOW);
    await log.answer("0123456789abcdef", { from: "kernel-agent", text: "An answer.", at, by: "search" }, NOW);
    const [turn] = await log.list("kernel", NOW);
    expect(turn?.followUp).toMatchObject({ text: "An answer.", by: "search" });
  });
});
