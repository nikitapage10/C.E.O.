import { describe, expect, it } from "vitest";
import { agentOfEvent, readCrew, roomOfAgent } from "./crew.ts";

const CREW = readCrew({ agent_turf01: "turf", agent_ember1: "ember", "bad id!": "soot", agent_nobody: "nobody" });

describe("who has the mic on a call (#481, #479)", () => {
  it("keeps only well-formed agents that are known subminds", () => {
    expect(CREW).toEqual({ agent_turf01: "turf", agent_ember1: "ember" });
    expect(readCrew(null)).toEqual({});
    expect(readCrew(["x"])).toEqual({});
  });

  it("maps a submind's agent to its room, and anyone else (Skippy) to null", () => {
    expect(roomOfAgent("agent_turf01", CREW)).toBe("green");
    expect(roomOfAgent("agent_ember1", CREW)).toBe("foundry");
    expect(roomOfAgent("agent_skippy", CREW)).toBeNull();
  });

  it("reads the agent from a line's metadata or a transfer's result", () => {
    expect(agentOfEvent({ type: "agent_response", agent_response_event: { agent_response: "hi", agent_metadata: { agent_id: "agent_turf01" } } })).toBe("agent_turf01");
    expect(agentOfEvent({ agent_metadata: { agent_id: "agent_ember1" } })).toBe("agent_ember1");
    expect(
      agentOfEvent({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: { tool_name: "transfer_to_agent", is_error: false, full_tool_result: JSON.stringify({ to_agent: "agent_ember1" }) } }),
    ).toBe("agent_ember1");
    expect(agentOfEvent({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: { tool_name: "read_relay", full_tool_result: "{}" } })).toBeNull();
    expect(agentOfEvent({ type: "ping" })).toBeNull();
    expect(agentOfEvent("nope")).toBeNull();
  });
});
