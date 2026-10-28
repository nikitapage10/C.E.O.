import { describe, expect, it } from "vitest";
import { MemoryRoomLog } from "./log.ts";
import type { GreenBoard } from "../_green/types.ts";
import { ANSWER_FIRST, ONE_WAITING_LINE, PONDER_LINES, UNSPOKEN, inCharacter, ponderLine } from "./ponder.ts";
import { greenLines } from "./rooms.ts";
import { greenText, weekFrame } from "./voicereads.ts";
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
      expect(text, who).toMatch(/never say "thread", "hand-off", "hand off", "handed off", "Kernel", "crew" or "team" out loud/);
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
    expect(got.text.replace(/\(never "thread"[^)]*\)/, "")).not.toMatch(UNSPOKEN);
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
    expect(await answers()).toMatch(/^Nothing asked of your deeper mind/);
    expect(await answers()).not.toMatch(UNSPOKEN);
    for (let i = 0; i < EARLIER_MAX + 3; i++) await log.add({ id: `bbbbbbbbbbbbbbb${i.toString(16)}`, at: new Date(NOW - (i + 1) * 60_000).toISOString(), question: `Ask ${i}`, answer: CALL_REPLY, room: "kernel", model: "voice", needs: "skippy" }, NOW);
    expect((await answers()).match(/Earlier call/g)).toHaveLength(EARLIER_MAX);
  });
});

describe("Nikita's 09:11 call: the answer fast, one waiting line, his own mind (#506)", () => {
  const voices = [{ who: "voice Skippy", text: voicePrompt(true) }, ...ON_AIR.map((s) => ({ who: s.name, text: submindPrompt(s) }))];

  it("every voice puts the answer first and keeps to one waiting line", () => {
    for (const { who, text } of voices) {
      expect(text, who).toContain(ANSWER_FIRST);
      expect(text, who).toContain(ONE_WAITING_LINE);
    }
    expect(ANSWER_FIRST).toMatch(/one or two short spoken sentences/);
    expect(ANSWER_FIRST).toMatch(/No preamble/);
    expect(ANSWER_FIRST).toMatch(/no trailing question/);
    expect(ONE_WAITING_LINE).toMatch(/no "still digging", no "I'll check again", no "want to talk about something else"/);
    expect(ONE_WAITING_LINE).toMatch(/twenty seconds/);
  });

  it("no voice or tool is told to fill the wait, poll, or offer more", () => {
    const tools = TOOL_DEFS.map((t) => ({ who: t.name, text: t.description }));
    for (const { who, text } of [...voices, ...tools]) {
      const rest = text.replace(ONE_WAITING_LINE, "").replace(ANSWER_FIRST, "");
      expect(rest, who).not.toMatch(/keep talking|keep chatting|keep the conversation going|at (?:a|the next) natural pause|so the call never goes quiet|want the rest\?\)|two to four|two or three/i);
    }
  });

  it("there is no crew: he digs into his own mind, and says so in one short line", () => {
    for (const { who, text } of voices) {
      const rest = text.replace(inCharacter(true), "").replace(inCharacter(false), "");
      expect(rest, who).not.toMatch(/\bcrew\b/i);
    }
    expect(voicePrompt(true)).toMatch(/digging into your own mind \("Rummaging through my mainframe\."\)/);
    expect(inCharacter(true)).toMatch(/your own mind, your mainframe/);
    expect(inCharacter(true)).toMatch(/never name a submind \(the Builder, say\) as the one looking it up/);
    expect(PONDER_LINES).toContain("Rummaging through my mainframe…");
    for (const { who, text } of [{ who: "Desk chat Skippy", text: SKIPPY_PROMPT }]) expect(text.replace(inCharacter(true), ""), who).not.toMatch(/\bcrew\b/i);
  });

  it("fewer hops: Skippy hands over only when asked or clearly needed, never to deliver what he has", () => {
    expect(voicePrompt(true)).toMatch(/Hand over only when he names a room or a submind, or clearly wants something in-depth/);
    expect(voicePrompt(true)).toMatch(/never transfer just to deliver an answer or a follow-up you already have; say it yourself/);
  });

  it("answers are pushed into the call, so nobody polls check_answers", () => {
    expect(TOOL_DEFS.find((t) => t.name === "check_answers")!.description).toMatch(/never call it twice in a row to poll/);
    expect(TOOL_DEFS.find((t) => t.name === "hand_to_kernel")!.description).toMatch(/put into the call the moment it lands/);
    expect(voicePrompt(true)).toMatch(/don't poll check_answers for it/);
  });
});

describe("which week the Green is in (#506)", () => {
  const side = (pts: number, proj: number) => ({ team: "x", record: "5-2", pts, proj });
  const board = (over: Record<string, unknown>) =>
    ({ week: 7, matchup: { week: 7, me: side(128.4, 120), them: { ...side(75.2, 110), team: "Turf Burners", record: "3-4" }, win: 1, live: false }, ...over }) as unknown as GreenBoard;

  it("says a finished week as final, with the next one up, never as this week", () => {
    const f = weekFrame(board({ nflWeek: 8 }));
    expect(f.final).toBe(true);
    expect(f.line).toBe("Week 7 is final: 128.4 to 75.2 against Turf Burners (3-4), a win. Week 8 is up next and hasn't started.");
    expect(f.line).not.toMatch(/this week|so far/i);
  });

  it("says a week under way as live, and one not started as upcoming", () => {
    const live = weekFrame(board({ matchup: { week: 8, me: side(30, 120), them: { ...side(12, 110), team: "Turf Burners", record: "3-4" }, win: 0.6, live: true } }));
    expect(live).toMatchObject({ final: false });
    expect(live.line).toMatch(/^Week 8, live now against Turf Burners/);
    const next = weekFrame(board({ week: 8, matchup: { week: 8, me: side(0, 120), them: { ...side(0, 110), team: "Turf Burners", record: "3-4" }, win: 0.6, live: false } }));
    expect(next.line).toMatch(/^Week 8, upcoming against Turf Burners .*: no games yet, projected/);
  });

  it("the Green's read and the Desk's lines both use it", () => {
    const b = { ...board({ nflWeek: 8 }), ok: true, league: { name: "L", teams: 10 }, me: { team: "Mine", record: "5-2", rank: 2 }, sources: { calls: "fp" }, roster: { starters: [], bench: [] }, byes: [], swaps: [], pickups: [] } as unknown as GreenBoard;
    expect(greenText(b)).toMatch(/week 7 \(final\)[\s\S]*Week 7 is final: 128\.4 to 75\.2/);
    expect(greenText(b)).not.toMatch(/This week against/);
    expect(greenLines(b)[0]).toMatch(/Week 7 is final: 128\.4 to 75\.2 .* Week 8 is up next/);
  });
});
