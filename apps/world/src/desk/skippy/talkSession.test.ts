import { beforeEach, describe, expect, it, vi } from "vitest";
import { holoEvents, setCrew, useHolo } from "../hologram/signal.ts";

// The call's own client, faked: the test fires the events ElevenLabs sends (#491, #490).
const fake = vi.hoisted(() => ({ options: null as null | Record<string, (arg: unknown) => void> }));
vi.mock("@elevenlabs/client", () => ({
  Conversation: {
    startSession: async (o: Record<string, (arg: unknown) => void>) => {
      fake.options = o;
      return { getOutputVolume: () => 0, getInputVolume: () => 0, setMicMuted: () => undefined, sendContextualUpdate: () => undefined, endSession: async () => undefined };
    },
  },
}));

const { openCall } = await import("./talkSession.ts");

// The crew map as /api/skippy-voice's start answer carries it: ElevenLabs agent id → submind id.
const CREW = { agent_turf01: "turf", agent_soot01: "soot", agent_ember1: "ember" };
let callN = 0;
/** A transfer's full payload, as every agent sends it since #491 (CLIENT_EVENTS): the result names the agent taking the mic. */
const transfer = (from: string, to: string) => ({
  type: "agent_tool_response_full_payload",
  agent_tool_response_full_payload: {
    tool_name: "transfer_to_agent",
    tool_call_id: `transfer_to_agent_${++callN}`,
    tool_type: "system",
    is_error: false,
    is_called: true,
    event_id: 7,
    full_tool_result: JSON.stringify({ result_type: "transfer_to_agent_success", status: "success", from_agent: from, to_agent: to, condition: "Nikita names the Boiler Room" }),
  },
});

async function call() {
  fake.options = null;
  await openCall({ token: "t".repeat(20), desk: "", onMessage: () => undefined, onMode: () => undefined, onEnd: () => undefined, onError: () => undefined });
  return fake.options!;
}

describe("the hologram follows the mic on a call (#491, #490)", () => {
  beforeEach(() => {
    holoEvents.reset();
    setCrew(CREW);
  });

  it("hands every raw event to the hologram: Skippy → the Commentator → the Pessimist → Skippy", async () => {
    const o = await call();
    o.onAgentToolRequest!({ tool_name: "transfer_to_agent" });
    o.onAgentToolResponse!(transfer("agent_skippy", "agent_turf01").agent_tool_response_full_payload);
    expect(useHolo.getState().tools).toBe(0);
    o.onIncomingEvent!(transfer("agent_skippy", "agent_turf01"));
    expect(useHolo.getState().speaker).toBe("green");
    // A sibling transfer straight to a named room (#491 e).
    o.onIncomingEvent!(transfer("agent_turf01", "agent_soot01"));
    expect(useHolo.getState().speaker).toBe("boiler");
    // An ordinary lookup changes nobody.
    o.onIncomingEvent!({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: { tool_name: "read_boiler", tool_call_id: "r1", is_error: false, full_tool_result: '{"read":"boiler","text":"all healthy"}' } });
    expect(useHolo.getState().speaker).toBe("boiler");
    // Back to Skippy: his own agent isn't in the crew, so the hologram is his can again.
    o.onIncomingEvent!(transfer("agent_soot01", "agent_skippy"));
    expect(useHolo.getState().speaker).toBeNull();
  });

  it("reads an agent id on a line, should ElevenLabs ever send one", async () => {
    const o = await call();
    o.onIncomingEvent!({ type: "agent_response", agent_response_event: { agent_response: "Builder.", agent_metadata: { agent_id: "agent_ember1" } } });
    expect(useHolo.getState().speaker).toBe("foundry");
  });
});
