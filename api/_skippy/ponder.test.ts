import { describe, expect, it } from "vitest";
import { MemoryRoomLog } from "./log.ts";
import { PONDER_LINES, UNSPOKEN, inCharacter, ponderLine } from "./ponder.ts";
import { SKIPPY_PROMPT } from "./prompt.ts";
import { CALL_REPLY, EARLIER_CALLS_MS, EARLIER_MAX, handle, type RoomSources } from "./toolroute.ts";
import { voicePrompt } from "./voice.ts";
import { ON_AIR, TOOL_DEFS, submindPrompt } from "./voicecrew.ts";
import { MemoryCrewStore, TOOL_HEADER, issueToolToken } from "./voicetoken.ts";

/**
 * Skippy in character when he asks his deeper self (#498): on a call and in the Desk's chat he never says "thread",
 * "hand-off" or "Kernel"; he reaches into the recesses of his magnificent mind, and the line rotates. And check_answers
 * reads back what Nikita asked on his earlier calls too, not only this one.
 */

const NOW = Date.parse("2026-10-27T09:00:00Z");
const DESK = "a test desk key, not a real one";
const SITE = "https://ceo.test";
const HOUR = 60 * 60_000;

describe("the lines (#498)", () => {
  it("rotate, hold steady for one seed, and never name the plumbing", () => {
    expect(PONDER_LINES.length).toBeGreaterThanOrEqual(3);
    for (const l of PONDER_LINES) expect(l).not.toMatch(UNSPOKEN);
    expect(ponderLine("abc")).toBe(ponderLine("abc"));
    expect(new Set(Array.from({ length: 20 }, (_, i) => ponderLine(`turn-${i}`))).size).toBeGreaterThan(2);
    expect(PONDER_LINES.map((l) => l.toLowerCase())).toEqual(expect.arrayContaining(["reaching into the recesses of my magnificent mind…", "consulting the deeper me…", "still pondering…"]));
  });

  it("the banned words are caught however they're spelt, and only those", () => {
    for (const bad of ["my thread", "a hand-off", "the handoff", "I'll hand it off", "handed this off", "the Kernel"]) expect(bad).toMatch(UNSPOKEN);
    for (const fine of ["handing you to the Builder", "hand me the ball", "consulting the deeper me"]) expect(fine).not.toMatch(UNSPOKEN);
  });
});

describe("the prompts say it in character (#498)", () => {
  const prompts = [
    { who: "voice Skippy", text: voicePrompt(true), skippy: true },
    { who: "Desk chat Skippy", text: SKIPPY_PROMPT, skippy: true },
    ...ON_AIR.map((s) => ({ who: s.name, text: submindPrompt(s), skippy: false })),
  ];

  it("every voice and the Desk's chat carry the rule, with the rotating lines for Skippy", () => {
    for (const { who, text, skippy } of prompts) {
      expect(text, who).toContain(inCharacter(skippy));
      expect(text, who).toMatch(/never say "thread", "hand-off", "hand off", "handed off" or "Kernel" out loud/);
      if (skippy) expect(text, who).toMatch(/"reaching into the recesses of my magnificent mind", "consulting the deeper me", "still pondering"/);
    }
  });

  it("no prompt calls his deeper self a thread or the Kernel, so there's nothing to echo", () => {
    for (const { who, text } of prompts) {
      // The rule quotes the banned words once; the Kernel is also the room his can floats over, a place, not the plumbing.
      const rest = text.replace(inCharacter(true), "").replace(inCharacter(false), "").replace(/floating over the Kernel/g, "");
      expect(rest, who).not.toMatch(/own thread|the Kernel|Skippy's thread/);
    }
  });

  it("the tools' descriptions never prime the words either", () => {
    for (const t of TOOL_DEFS) expect(t.description.replace(/\(never this tool's name[^)]*\)/, ""), t.name).not.toMatch(UNSPOKEN);
  });
});

describe("the call's tool answers (#498)", () => {
  const setup = async (conv = "conv_live_now") => {
    const crew = new MemoryCrewStore();
    const log = new MemoryRoomLog();
    const token = (await issueToolToken(crew, DESK, conv, NOW + 12 * 60_000, NOW))!;
    const deps = { deskKey: DESK, crew, log, sources: {} as RoomSources, now: NOW };
    const ask = async (text: string) => (await (await handle(new Request(`${SITE}/api/skippy-tools?act=kernel`, { method: "POST", headers: { [TOOL_HEADER]: token, "Content-Type": "application/json" }, body: JSON.stringify({ ask: text }) }), deps)).json()) as { ok: boolean; turn: string; text: string };
    const answers = async () => ((await (await handle(new Request(`${SITE}/api/skippy-tools?read=answers`, { headers: { [TOOL_HEADER]: token } }), deps)).json()) as { text: string }).text;
    return { log, ask, answers };
  };

  it("hand_to_kernel's answer and the kept turn say it in character", async () => {
    const { ask, log } = await setup();
    const got = await ask("Start a build for a waiver alarm");
    expect(got.ok).toBe(true);
    expect(got.text.replace(/never "thread", "hand-off" or "Kernel"/, "")).not.toMatch(UNSPOKEN);
    expect(PONDER_LINES.some((l) => got.text.includes(l.replace(/…$/, "")))).toBe(true);
    expect(CALL_REPLY).not.toMatch(UNSPOKEN);
    expect((await log.list("kernel", NOW))[0]!.answer).toBe(CALL_REPLY);
  });

  it("check_answers reads back what Nikita asked on his recent calls too, newest first, this call's first", async () => {
    const { log, ask, answers } = await setup();
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    // Two earlier calls: one answered after it hung up, one still pondering; one too old; one typed in the chat.
    await log.add({ id: "aaaaaaaaaaaaaaa1", at: at(3 * HOUR), question: "Is Lamar playing Sunday?", answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, NOW);
    await log.answer("aaaaaaaaaaaaaaa1", { from: "skippy", text: "Lamar is a full go.", at: at(2 * HOUR) }, NOW);
    await log.add({ id: "aaaaaaaaaaaaaaa2", at: at(1 * HOUR), question: "Build a waiver alarm", answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, NOW);
    await log.add({ id: "aaaaaaaaaaaaaaa3", at: at(EARLIER_CALLS_MS + HOUR), question: "Something from last week", answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, NOW);
    await log.add({ id: "aaaaaaaaaaaaaaa4", at: at(HOUR / 2), question: "Typed in the chat", answer: "On it.", room: "kernel", model: "claude-sonnet-5-5", needs: "skippy" }, NOW);
    const before = await answers();
    expect(before).toMatch(/Earlier call, "Build a waiver alarm": no answer yet\.[\s\S]*Earlier call, "Is Lamar playing Sunday\?": answered: Lamar is a full go\./);
    expect(before).not.toMatch(/last week|Typed in the chat/);
    expect(before).not.toMatch(UNSPOKEN);
    const mine = await ask("How did the Exchange do today?");
    const after = await answers();
    expect(after.startsWith(`"How did the Exchange do today?": no answer yet.`)).toBe(true);
    expect(after).not.toMatch(new RegExp(`Earlier call, "How did the Exchange`));
    expect(mine.ok).toBe(true);
  });

  it("caps the earlier calls it reads back, and says so plainly when there's nothing", async () => {
    const { log, answers } = await setup();
    expect(await answers()).toMatch(/^Nothing asked of the deeper Skippy/);
    expect(await answers()).not.toMatch(UNSPOKEN);
    for (let i = 0; i < EARLIER_MAX + 3; i++) await log.add({ id: `bbbbbbbbbbbbbbb${i.toString(16)}`, at: new Date(NOW - (i + 1) * 60_000).toISOString(), question: `Ask ${i}`, answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, NOW);
    expect((await answers()).match(/Earlier call/g)).toHaveLength(EARLIER_MAX);
  });
});
