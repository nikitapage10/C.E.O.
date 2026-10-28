import { beforeEach, describe, expect, it, vi } from "vitest";
import { holoEvents, setCrew, useHolo } from "../hologram/signal.ts";

// The call's own client, faked: the test fires the events ElevenLabs sends (#491, #490).
const fake = vi.hoisted(() => ({ options: null as null | Record<string, (arg: unknown) => void>, sent: [] as string[] }));
vi.mock("@elevenlabs/client", () => ({
  Conversation: {
    startSession: async (o: Record<string, (arg: unknown) => void>) => {
      fake.options = o;
      return {
        getOutputVolume: () => 0,
        getInputVolume: () => 0,
        setMicMuted: () => undefined,
        sendContextualUpdate: (t: string) => fake.sent.push(`context: ${t}`),
        sendUserMessage: (t: string) => fake.sent.push(`user: ${t}`),
        endSession: async () => undefined,
      };
    },
  },
}));

const { openCall, SPEAK_NOW } = await import("./talkSession.ts");

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

async function call(onMessage: (who: string, text: string) => void = () => undefined) {
  fake.options = null;
  const session = await openCall({ token: "t".repeat(20), desk: "", onMessage, onMode: () => undefined, onEnd: () => undefined, onError: () => undefined });
  return Object.assign(fake.options!, { session });
}

describe("an answer that lands is said at once (#506)", () => {
  it("puts the note in and asks for the turn now, and never shows that ask in the chat", async () => {
    const said: string[] = [];
    const o = await call((who, text) => said.push(`${who}: ${text}`));
    fake.sent.length = 0;
    o.session.speakNow("The answer from the deeper you just landed: Lamar is a full go.");
    expect(fake.sent).toEqual(["context: The answer from the deeper you just landed: Lamar is a full go.", `user: ${SPEAK_NOW}`]);
    o.onMessage!({ message: SPEAK_NOW, role: "user" });
    o.onMessage!({ message: "Lamar's a full go, monkey.", role: "agent" });
    expect(said).toEqual(["skippy: Lamar's a full go, monkey."]);
    expect(SPEAK_NOW).not.toMatch(/thread|kernel|crew|hand-?off/i);
  });
});

describe("an answer interrupts an agent mid-sentence and goes in once (#537)", () => {
  it("sends the note and one turn at once while an agent is speaking, never the answer as a user message", async () => {
    const o = await call();
    fake.sent.length = 0;
    o.onModeChange!({ mode: "speaking" });
    o.session.speakNow("The answer from the deeper you just landed: five percent.");
    expect(fake.sent).toEqual(["context: The answer from the deeper you just landed: five percent.", `user: ${SPEAK_NOW}`]);
    o.onModeChange!({ mode: "listening" });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent.filter((x) => x.startsWith("user:") && x.includes("five percent"))).toEqual([]);
  });
});

describe("a reconnect does not replay the greeting (#537)", () => {
  const init = { type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c" } };
  it("keeps the opener once and drops it when the link comes back", async () => {
    const said: string[] = [];
    const o = await call((who, text) => said.push(`${who}: ${text}`));
    o.onIncomingEvent!(init);
    o.onMessage!({ message: "Ah, the C.E.O. calls.", role: "agent" });
    o.onMessage!({ message: "Lamar is out.", role: "agent" });
    o.onIncomingEvent!(init); // reconnect
    o.onMessage!({ message: "Ah, the C.E.O.  calls.", role: "agent" });
    o.onMessage!({ message: "Anything else?", role: "agent" });
    expect(said).toEqual(["skippy: Ah, the C.E.O. calls.", "skippy: Lamar is out.", "skippy: Anything else?"]);
  });
  it("greetingGuard only drops a repeat of the opener right after a reconnect", async () => {
    const { greetingGuard } = await import("./talkSession.ts");
    const g = greetingGuard();
    expect(g.event(init)).toBe(false);
    expect(g.keep("Hello there.")).toBe(true);
    expect(g.keep("Hello there.")).toBe(true); // no reconnect: a repeated line is just said
    expect(g.event(init)).toBe(true);
    expect(g.keep("Hello there.")).toBe(false);
    expect(g.keep("Hello there.")).toBe(true);
  });
});

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
