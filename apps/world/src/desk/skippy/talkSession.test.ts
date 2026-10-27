import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHolo } from "../hologram/signal.ts";

// The call's own client, faked: the test fires the events ElevenLabs sends (#491).
const fake = vi.hoisted(() => ({ options: null as null | Record<string, (arg: unknown) => void> }));
vi.mock("@elevenlabs/client", () => ({
  Conversation: {
    startSession: async (o: Record<string, (arg: unknown) => void>) => {
      fake.options = o;
      return { getOutputVolume: () => 0, getInputVolume: () => 0, setMicMuted: () => undefined, sendContextualUpdate: () => undefined, endSession: async () => undefined };
    },
  },
}));

const { openCall, speakerTracker, transferTarget } = await import("./talkSession.ts");

// The crew map as /api/skippy-voice's start answer carries it: ElevenLabs agent id → submind id.
const CREW = { agent_turf01: "turf", agent_soot01: "soot", agent_ember1: "ember" };
const transfer = (from: string, to: string) => ({
  tool_name: "transfer_to_agent",
  tool_call_id: "transfer_to_agent_1",
  tool_type: "system",
  is_error: false,
  is_called: true,
  event_id: 7,
  full_tool_result: JSON.stringify({ result_type: "transfer_to_agent_success", status: "success", from_agent: from, to_agent: to, condition: "Nikita names the Boiler Room" }),
});

async function call(onAgent?: (a: string) => void) {
  fake.options = null;
  await openCall({ token: "t".repeat(20), desk: "", crew: CREW, onMessage: () => undefined, onMode: () => undefined, onEnd: () => undefined, onError: () => undefined, onAgent });
  return fake.options!;
}

describe("the hologram follows the mic on a call (#491)", () => {
  beforeEach(() => useHolo.setState({ speaker: null, tools: 0, swappedAt: 0 }));

  it("reads the agent a transfer hands to, and nothing else", () => {
    expect(transferTarget(transfer("agent_skippy", "agent_turf01"))).toBe("agent_turf01");
    expect(transferTarget({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: transfer("agent_turf01", "agent_soot01") })).toBe("agent_soot01");
    expect(transferTarget({ ...transfer("a_skippy", "agent_turf01"), is_error: true })).toBeNull();
    // The plain event (no result) can't say who: ignored rather than guessed.
    expect(transferTarget({ tool_name: "transfer_to_agent", tool_call_id: "x", tool_type: "system", is_error: false })).toBeNull();
    expect(transferTarget({ tool_name: "read_green", full_tool_result: JSON.stringify({ to_agent: "agent_turf01" }) })).toBeNull();
    expect(transferTarget(null)).toBeNull();
  });

  it("swaps the speaker on every agent change and only then", () => {
    const seen: string[] = [];
    const track = speakerTracker(CREW, (a) => seen.push(a));
    track("agent_turf01");
    expect(useHolo.getState().speaker).toBe("green");
    track("agent_turf01");
    track(null);
    expect(seen).toEqual(["agent_turf01"]);
    track("agent_skippy");
    expect(useHolo.getState().speaker).toBeNull();
  });

  it("drives setSpeaker from the call's own events: Skippy → the Commentator → the Pessimist → Skippy", async () => {
    const seen: string[] = [];
    const o = await call((a) => seen.push(a));
    o.onAgentToolRequest!({ tool_name: "transfer_to_agent" });
    o.onAgentToolResponse!(transfer("agent_skippy", "agent_turf01"));
    expect(useHolo.getState().speaker).toBe("green");
    expect(useHolo.getState().tools).toBe(0);
    // The raw socket event comes through onIncomingEvent too: the same change, not a second swap.
    o.onIncomingEvent!({ type: "agent_tool_response_full_payload", agent_tool_response_full_payload: transfer("agent_skippy", "agent_turf01") });
    // A sibling transfer straight to a named room (#491 e).
    o.onAgentToolResponse!(transfer("agent_turf01", "agent_soot01"));
    expect(useHolo.getState().speaker).toBe("boiler");
    // An ordinary lookup changes nobody.
    o.onAgentToolResponse!({ tool_name: "read_boiler", is_error: false, full_tool_result: "{\"read\":\"boiler\",\"text\":\"all healthy\"}" });
    expect(useHolo.getState().speaker).toBe("boiler");
    // Back to Skippy: his own agent isn't in the crew, so the hologram is his can again.
    o.onAgentToolResponse!(transfer("agent_soot01", "agent_skippy"));
    expect(useHolo.getState().speaker).toBeNull();
    expect(seen).toEqual(["agent_turf01", "agent_soot01", "agent_skippy"]);
  });

  it("reads an agent id on a line, should ElevenLabs ever send one", async () => {
    const o = await call();
    o.onIncomingEvent!({ type: "agent_response", agent_response_event: { agent_response: "Builder.", agent_metadata: { agent_id: "agent_ember1" } } });
    expect(useHolo.getState().speaker).toBe("foundry");
  });
});
