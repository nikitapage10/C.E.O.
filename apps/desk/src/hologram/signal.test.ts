import { beforeEach, describe, expect, it } from "vitest";
import { useSkippy } from "../skippy/chat.ts";
import { INTERRUPTED_MS, SWAP_MS, expressionOf, heardEvent, holoEvents, roomNamedIn, setCrew, setSpeaker, speakerOf, stripTags, tagMood, transferred, useHolo, type FaceInputs } from "./signal.ts";

const at = (over: Partial<FaceInputs> = {}): FaceInputs => ({ phase: "live", mode: "listening", tools: 0, thinking: false, swappedAt: 0, interruptedAt: 0, line: "", now: 100_000, ...over });

describe("Skippy's face on a call (#481)", () => {
  beforeEach(() => holoEvents.reset());

  it("listens while Nikita talks and is smug while he does", () => {
    expect(expressionOf(at())).toBe("listening");
    expect(expressionOf(at({ mode: "speaking", line: "Obviously." }))).toBe("smug");
  });

  it("laughs on a [laugh] or [excited] line and is annoyed on a [sigh]", () => {
    expect(expressionOf(at({ mode: "speaking", line: "[laughs] Monkeys." }))).toBe("laughing");
    expect(expressionOf(at({ mode: "speaking", line: "Oh! [excited] It shipped." }))).toBe("laughing");
    expect(expressionOf(at({ mode: "speaking", line: "[sigh] Fine." }))).toBe("annoyed");
    // A tag only moves his face while he's the one talking.
    expect(expressionOf(at({ mode: "listening", line: "[laugh]" }))).toBe("listening");
  });

  it("thinks while connecting, during a lookup, and through a hand-off", () => {
    expect(expressionOf(at({ phase: "starting" }))).toBe("thinking");
    expect(expressionOf(at({ mode: "speaking", tools: 1 }))).toBe("thinking");
    expect(expressionOf(at({ thinking: true }))).toBe("thinking");
    expect(expressionOf(at({ swappedAt: 100_000 - SWAP_MS / 2 }))).toBe("thinking");
    expect(expressionOf(at({ swappedAt: 100_000 - SWAP_MS - 1 }))).toBe("listening");
  });

  it("is annoyed for a moment when he's cut off", () => {
    expect(expressionOf(at({ mode: "speaking", interruptedAt: 100_000 - 200 }))).toBe("annoyed");
    expect(expressionOf(at({ mode: "speaking", interruptedAt: 100_000 - INTERRUPTED_MS - 1 }))).toBe("smug");
  });

  it("reads tags and keeps them out of the captions", () => {
    expect(tagMood("No tags here")).toBeNull();
    expect(stripTags("[laughs]  Two things are   building. [excited]")).toBe("Two things are building.");
  });

  it("counts lookups and swaps the speaker for hand-offs", () => {
    holoEvents.toolStart();
    holoEvents.toolStart();
    holoEvents.toolEnd();
    expect(useHolo.getState().tools).toBe(1);
    holoEvents.toolEnd();
    holoEvents.toolEnd();
    expect(useHolo.getState().tools).toBe(0);
    setSpeaker("foundry");
    expect(useHolo.getState().speaker).toBe("foundry");
    expect(useHolo.getState().swappedAt).toBeGreaterThan(0);
    setSpeaker(null);
    expect(useHolo.getState().speaker).toBeNull();
  });
});

/** A transfer as ElevenLabs' client sees it: the plain tool response names no target. */
const transfer = (id: string, result?: unknown) =>
  result === undefined
    ? { type: "agent_tool_response", agent_tool_response: { tool_name: "transfer_to_agent", tool_call_id: id, tool_type: "system", is_error: false, is_called: true, event_id: 1 } }
    : { type: "agent_tool_response_full_payload", agent_tool_response_full_payload: { tool_name: "transfer_to_agent", tool_call_id: id, tool_type: "system", is_error: false, is_called: true, event_id: 1, full_tool_result: JSON.stringify(result) } };

describe("the hologram's speaker on a call (#490)", () => {
  beforeEach(() => {
    useSkippy.setState({ turns: [] });
    holoEvents.reset();
  });

  it("strips every audio tag from what is shown, and only tags", () => {
    expect(stripTags("[smug] Obviously. [fast] Two builds, [slow] one red.")).toBe("Obviously. Two builds, one red.");
    expect(stripTags("[sarcastic, slowly] Fine [sigh] .")).toBe("Fine.");
    expect(stripTags("Read #490 [1] and the [Desk]")).toBe("Read #490 [1] and the");
    expect(stripTags("No tags, monkey.")).toBe("No tags, monkey.");
  });

  it("names a speaker by room, submind id, agent id, name or job, and Skippy by null or his name", () => {
    setCrew({ agent_soot01: "soot", agent_turf01: "turf" });
    expect(speakerOf("boiler")).toBe("boiler");
    expect(speakerOf("soot")).toBe("boiler");
    expect(speakerOf("agent_soot01")).toBe("boiler");
    expect(speakerOf("The Commentator")).toBe("green");
    expect(speakerOf("Skippy, the Pessimist")).toBe("boiler");
    expect(speakerOf("pessimist")).toBe("boiler");
    expect(speakerOf(null)).toBeNull();
    expect(speakerOf("Skippy")).toBeNull();
    expect(speakerOf("Skippy, the Magnificent")).toBeNull();
    // Skippy's own agent: any agent id outside the crew, once the crew is known.
    expect(speakerOf("agent_skippy1")).toBeNull();
    expect(speakerOf(42)).toBeUndefined();
    expect(speakerOf("agent_skippy1", {})).toBeUndefined();
  });

  it("drives the projection: each switch repaints and stamps the swap; nonsense changes nothing", () => {
    setCrew({ agent_soot01: "soot" });
    expect(setSpeaker("agent_soot01")).toBe(true);
    expect(useHolo.getState().speaker).toBe("boiler");
    const at = useHolo.getState().swappedAt;
    expect(at).toBeGreaterThan(0);
    expect(setSpeaker("green")).toBe(true);
    expect(useHolo.getState().speaker).toBe("green");
    expect(setSpeaker(null)).toBe(true);
    expect(useHolo.getState().speaker).toBeNull();
    useHolo.setState({ crew: {} });
    expect(setSpeaker("who-knows")).toBe(false);
    expect(useHolo.getState().speaker).toBeNull();
  });

  it("reads the submind a hand-off line names, the last one named winning", () => {
    expect(roomNamedIn("Here's the Pessimist. Bring a towel, he's about to rain on us.")).toBe("boiler");
    expect(roomNamedIn("Hold on, monkey. Giving you the Commentator.")).toBe("green");
    expect(roomNamedIn("[sigh] Not the Bookie. The Messenger.")).toBe("relay");
    expect(roomNamedIn("Two builds are green. To the Green we go.")).toBe("green");
    expect(roomNamedIn("Two builds are green.")).toBeNull();
    expect(roomNamedIn("Nothing to see here.")).toBeNull();
  });

  it("follows a transfer that names no target: Skippy hands to whoever his line named, a submind only hands back", () => {
    useSkippy.getState().say("skippy", "[smug] Here's the Pessimist. Bring a towel, he's about to rain on us.");
    expect(heardEvent(transfer("call_1"))).toBe("boiler");
    expect(useHolo.getState().speaker).toBe("boiler");
    // The same transfer's full payload counts once.
    expect(heardEvent(transfer("call_1", { status: "ok" }))).toBeUndefined();
    expect(useHolo.getState().speaker).toBe("boiler");
    expect(heardEvent(transfer("call_2"))).toBeNull();
    expect(useHolo.getState().speaker).toBeNull();
  });

  it("takes a transfer's target when its result names a crew agent, under any key", () => {
    setCrew({ agent_turf01: "turf" });
    expect(heardEvent(transfer("call_3", { transfer: { destination: "agent_turf01" } }))).toBe("green");
    expect(useHolo.getState().speaker).toBe("green");
    // A line that carries its agent: Skippy's own puts him back.
    heardEvent({ type: "agent_response", agent_response_event: { agent_response: "Back.", agent_metadata: { agent_id: "agent_skippy1" } } });
    expect(useHolo.getState().speaker).toBeNull();
  });

  it("waits for the submind's own sign-on when the hand-off line named no one", () => {
    useSkippy.getState().say("skippy", "Hang on.");
    expect(transferred()).toBeUndefined();
    expect(useHolo.getState().speaker).toBeNull();
    useSkippy.getState().say("skippy", "[gloomy] The Pessimist. Something's leaking. Let's see what.");
    expect(useHolo.getState().speaker).toBe("boiler");
  });
});
