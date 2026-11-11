/**
 * Skippy sees what Nikita is looking at (#1027): look_at_screen asks the browser for a picture only where it can take
 * one, the picture leads the next pass, and a Foundry issue carries only the screenshot's opaque id and the screen's
 * scrubbed metadata. Everything here is made up.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SKIPPY_PROMPT, chatInput, publicScreen, readChat, readScreen } from "../prompt.ts";
import { FAST_MODEL, TALK_MODEL, runAgent, type CallModel } from "./loop.ts";
import { MemoryMemory } from "./memory.ts";
import { MemoryPending } from "./pending.ts";
import { callTool, confirmTool, implementIssue, shotLines, type ToolHost } from "./tools.ts";

const NOW = Date.parse("2026-11-10T18:00:00Z");
const SHOT = "shot-0123456789abcdef0123";

function host(over: Partial<ToolHost> = {}): ToolHost & { bodies: string[] } {
  const bodies: string[] = [];
  return {
    read: async (name) => `the ${name} room says hello`,
    memory: new MemoryMemory(),
    kitchenAdd: null,
    homeAct: null,
    fileIssue: async (_title, body) => {
      bodies.push(body);
      return 4242;
    },
    skipTerms: [],
    now: NOW,
    bodies,
    ...over,
  };
}

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
const msg = (content: unknown[], stop: string, model = FAST_MODEL) => ({ id: "m", type: "message", role: "assistant", model, content, stop_reason: stop, usage }) as unknown as Anthropic.Beta.Messages.BetaMessage;
const look = () => msg([{ type: "tool_use", id: "t1", name: "look_at_screen", input: {} }], "tool_use");
const fastAnswer = (reply: string) => msg([{ type: "text", text: JSON.stringify({ reply, actions: [], room: "none", needs: "none", deeper: "no" }) }], "end_turn");

function script(steps: Array<() => Anthropic.Beta.Messages.BetaMessage>): { call: CallModel; calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    call: async (p) => {
      calls.push(structuredClone(p));
      const step = steps.shift();
      if (!step) throw new Error("no more steps");
      return step();
    },
  };
}

const ctx = (over: Partial<Parameters<typeof runAgent>[3]> = {}) => ({ surface: "desk" as const, message: "what's wrong here?", core: "", host: host(), pending: new MemoryPending(), ...over });

describe("screen context (#1027)", () => {
  it("reads the browser's metadata cleanly, capped, with key-like values dropped and the private part scrubbed for issues", () => {
    const s = readScreen(JSON.stringify({ room: "haven", tab: "Kitchen", stage: "cooking", fields: { step: 3, token: "x" }, private: { meal: "Sample tacos", note: "sk-live_abcdefghijklmnopqrstuv" } }));
    expect(s).toEqual({ room: "haven", tab: "Kitchen", stage: "cooking", fields: { step: 3 }, private: { meal: "Sample tacos" } });
    expect(publicScreen(s)).toBe('{"room":"haven","tab":"Kitchen","stage":"cooking","fields":{"step":3}}');
    expect(readScreen("not json")).toBeNull();
    const big = readScreen({ room: "annex", fields: Object.fromEntries(Array.from({ length: 24 }, (_, k) => [`f${k}`, "x".repeat(200)])) });
    expect(JSON.stringify(big).length).toBeLessThanOrEqual(2_048);
    const said = readChat({ message: "add it here", screen: s, shot: SHOT });
    expect(said).toMatchObject({ shot: SHOT, look: true });
    expect(readChat({ message: "hi", shot: "shot-nope" })?.shot).toBe("");
    expect(chatInput("", [], "add it here", "", "", '{"room":"haven"}')).toContain('<screen>\n{"room":"haven"}\n</screen>');
    expect(SKIPPY_PROMPT).toContain("<screen> is what Nikita is looking at");
  });

  it("asks the browser for the picture when Skippy looks and the surface can capture it", async () => {
    const s = script([look]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "<message>\nwhat's wrong here?\n</message>", ctx({ canLook: true }));
    expect(r.needScreen).toBe(true);
    expect(r.answer).toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it("puts the picture first in the turn once it's back, and never asks again", async () => {
    const s = script([look, () => fastAnswer("That box overlaps the header, monkey.")]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "<message>\nwhat's wrong here?\n</message>", ctx({ image: { data: "AAAA", type: "image/jpeg" } }));
    expect(r.needScreen).toBeUndefined();
    expect(r.answer).toMatchObject({ reply: "That box overlaps the header, monkey." });
    const first = s.calls[0]!.messages[0]!.content as Array<{ type: string }>;
    expect(first[0]!.type).toBe("image");
    expect(JSON.stringify(s.calls[1]!.messages)).toContain("is his screen");
    expect(r.looked).toContain("Looked at the screen");
  });

  it("has no screen to look at on the phone or a call", async () => {
    const s = script([look, () => fastAnswer("Going on the page's details.")]);
    const r = await runAgent(s.call, SKIPPY_PROMPT, "<message>\nfix this\n</message>", ctx({ surface: "phone" }));
    expect(r.needScreen).toBeUndefined();
    expect(JSON.stringify(s.calls[1]!.messages)).toContain("no screen to look at");
    expect(s.calls.map((c) => c.model)).toEqual([FAST_MODEL, FAST_MODEL]);
    expect(TALK_MODEL).not.toBe(FAST_MODEL);
  });

  it("files the issue with only the screenshot's id and the scrubbed metadata, even after the Yes tap", async () => {
    const attach = { shot: SHOT, screen: '{"room":"haven","tab":"Kitchen","stage":"cooking"}' };
    const h = host({ attach });
    const pending = new MemoryPending();
    const got = await callTool("implement_it", { title: "Fix the overlapping box", pitch: "A box overlaps the Kitchen header in cook mode.", size: "small" }, h, { pending, surface: "desk" });
    expect(got.ok && "confirm" in got && got.confirm.summary).toContain("screenshot (kept private)");
    const id = got.ok && "confirm" in got ? got.confirm.id : "";
    // The tap comes later, from a fresh host: the shot waited with the call.
    const later = host();
    expect(await confirmTool(id, true, later, pending)).toMatchObject({ ok: true });
    const body = later.bodies[0]!;
    expect(body).toContain(`**Screenshot:** ${SHOT} (private;`);
    expect(body).toContain("/api/foundry-shot?id=");
    expect(body).toContain('"stage":"cooking"');
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("leaves out a bad shot id and metadata that trips the privacy check", () => {
    expect(shotLines({ shot: "shot-../../etc" })).toEqual([]);
    expect(shotLines({ screen: '{"room":"relay","fields":{"from":"sample.person@example.com"}}' })).toEqual([]);
    expect(implementIssue("t", "p", "small").body).not.toContain("Screenshot");
  });
});
