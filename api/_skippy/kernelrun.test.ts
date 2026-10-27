import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

import { claudeAgent } from "./kernelrun.ts";
import type { AgentRequest } from "./kernelagent.ts";

const usage = { input_tokens: 100, output_tokens: 10 };
const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({ model: "claude-haiku-5-5", system: [{ text: "rules" }, { text: "brief", cache: true }], user: "q", fileBuild: async () => 1, league: async () => "Week 5: sample lines", ...over });

beforeEach(() => create.mockReset());

describe("the responder's Claude loop (#507)", () => {
  it("runs the league tool, then takes the deliver call", async () => {
    create
      .mockResolvedValueOnce({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t1", name: "sleeper_league", input: { read: "week", week: 5 } }] })
      .mockResolvedValueOnce({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t2", name: "deliver", input: { mode: "answer", text: "Won week 5." } }] });
    const league = vi.fn(async () => "Week 5: sample lines");
    const run = await claudeAgent("test-not-a-key")(req({ league }));
    expect(league).toHaveBeenCalledWith({ read: "week", week: 5 });
    expect(run.out).toEqual({ mode: "answer", text: "Won week 5." });
    expect(run.usage.input_tokens).toBe(200);
    const second = create.mock.calls[1]![0];
    expect(second.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: "Week 5: sample lines" });
    expect(create.mock.calls[0]![0].system[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(create.mock.calls[0]![0].tools.map((t: { name: string }) => t.name)).toContain("sleeper_league");
  });

  it("uses the model's own text when it answers without calling deliver", async () => {
    create.mockResolvedValueOnce({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "Won week 5, monkey." }] });
    const run = await claudeAgent("test-not-a-key")(req());
    expect(run.out).toEqual({ mode: "answer", text: "Won week 5, monkey." });
  });

  it("stops at five calls and gives nothing when the model never delivers", async () => {
    create.mockResolvedValue({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t", name: "sleeper_league", input: { read: "standings" } }] });
    const run = await claudeAgent("test-not-a-key")(req());
    expect(create).toHaveBeenCalledTimes(5);
    expect(run.out).toBeNull();
  });
});
