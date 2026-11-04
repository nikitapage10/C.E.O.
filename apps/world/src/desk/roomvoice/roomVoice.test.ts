import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomIntent } from "../../../../../packages/engine/src/voice.ts";
import { SKIPPY_VOICE, voiceTargetOf } from "../../../../../packages/engine/src/voice.ts";
import {
  HF_IDLE_MS,
  HF_QUIET_MS,
  answerWords,
  askRoom,
  forgetIntents,
  forgetRooms,
  handsFreeOff,
  handsFreeOn,
  intentFor,
  micReset,
  recall,
  setOwnVoice,
  remember,
  setVoiceTarget,
  silentWav,
  useRoomMic,
} from "./roomVoice.ts";

/** The room mic's browser side (#638): what it sends, how it reads the answer, and the room's short memory. */

const reply = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("asking a room (#638)", () => {
  it("sends the words, the room, its turns and which way the last ask went", async () => {
    let sent: { url: string; body: unknown } | null = null;
    const doFetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return Response.json({
        say: "The cat ate at six.",
        kind: "skippy",
        audio: "A".repeat(200),
      });
    }) as unknown as typeof fetch;
    const got = await askRoom("haven", { text: "has the cat eaten" }, [{ who: "nikita", text: "hi" }], "shopping", doFetch);
    expect(sent).toEqual({
      url: "/api/skippy-room",
      body: {
        room: "haven",
        text: "has the cat eaten",
        history: [{ who: "nikita", text: "hi" }],
        last: "shopping",
      },
    });
    expect(got).toEqual({
      ok: true,
      say: "The cat ate at six.",
      kind: "skippy",
      audio: "A".repeat(200),
    });
  });

  it("sends a clip with its own type and the room in the address", async () => {
    let seen: { url: string; type: string | null } | null = null;
    const doFetch = (async (url: string, init: RequestInit) => {
      seen = { url, type: new Headers(init.headers).get("content-type") };
      return Response.json({ say: "Fine.", kind: "skippy" });
    }) as unknown as typeof fetch;
    await askRoom("green", { clip: new Blob([new Uint8Array(10)], { type: "audio/webm" }) }, [], null, doFetch);
    expect(seen).toEqual({
      url: "/api/skippy-room?room=green",
      type: "audio/webm",
    });
  });

  it("drops audio that isn't base64, and says why when it fails", async () => {
    expect(await askRoom("green", { text: "x" }, [], null, reply(200, { say: "Hi.", audio: "<script>" }))).toEqual({ ok: true, say: "Hi.", kind: "skippy" });
    expect(await askRoom("green", { text: "x" }, [], null, reply(401, {}))).toMatchObject({
      ok: false,
      say: "Sign in on the Desk to talk to the rooms.",
    });
    expect(await askRoom("green", { text: "x" }, [], null, reply(429, { say: "Slow down, monkey." }))).toMatchObject({ ok: false, say: "Slow down, monkey." });
  });
});

describe("the room's short memory (#638)", () => {
  afterEach(forgetRooms);

  it("keeps the last six turns per room for ten minutes", () => {
    for (let i = 0; i < 5; i++) remember("green", `q${i}`, `a${i}`, "skippy", 1_000);
    const { turns, last } = recall("green", 2_000);
    expect(turns).toHaveLength(6);
    expect(turns.at(-1)).toEqual({ who: "skippy", text: "a4" });
    expect(last).toBe("skippy");
    expect(recall("haven", 2_000).turns).toEqual([]);
    expect(recall("green", 1_000 + 10 * 60_000).turns).toEqual([]);
  });
});

describe("unlocking the audio on the press (#638)", () => {
  it("is a short, valid WAV", () => {
    const uri = silentWav();
    expect(uri.startsWith("data:audio/wav;base64,UklGR")).toBe(true);
    expect(uri.length).toBeLessThan(3_000);
  });
});

describe("a room's own intent handler (#638, its manifest's `voice`)", () => {
  afterEach(forgetIntents);
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });
    return Response.json(body.speak ? { say: body.speak, kind: "spoken", audio: "B".repeat(200) } : { say: "The submind's answer.", kind: "skippy" });
  }) as unknown as typeof fetch;
  beforeEach(() => (calls.length = 0));

  it("answers first when it takes the words, and its line is read aloud with no model call", async () => {
    const run = vi.fn();
    const intent: RoomIntent = async (u) => (u.text.startsWith("mute") ? { say: "Muted the newsletter.", actions: [{ label: "Undo", run }] } : null);
    const got = await answerWords("relay", "mute the newsletter", "hands-free", [], null, doFetch, Promise.resolve(intent));
    expect(got).toMatchObject({
      ok: true,
      say: "Muted the newsletter.",
      kind: "intent",
      audio: "B".repeat(200),
    });
    expect(got.actions?.map((a) => a.label)).toEqual(["Undo"]);
    expect(calls).toEqual([
      {
        url: "/api/skippy-room",
        body: { room: "relay", speak: "Muted the newsletter." },
      },
    ]);
  });

  it("passes on to the room's submind when it returns null, throws, or there is none", async () => {
    const pass: RoomIntent = async () => null;
    const broken: RoomIntent = async () => {
      throw new Error("no");
    };
    for (const intent of [pass, broken, null]) {
      calls.length = 0;
      const got = await answerWords("relay", "what's waiting", "tap", [], null, doFetch, Promise.resolve(intent));
      expect(got.say).toBe("The submind's answer.");
      expect(calls[0]!.body).toMatchObject({
        room: "relay",
        text: "what's waiting",
      });
    }
  });

  it("loads a room's manifest once, and finds no handler where the manifest has none", async () => {
    const intent: RoomIntent = async () => null;
    const load = vi.fn(async () => ({
      default: { voice: async () => ({ intent }) },
    }));
    const manifests = {
      "../../../../../rooms/relay/room.ts": load,
      "../../../../../rooms/green/room.ts": async () => ({ default: {} }),
    };
    expect(await intentFor("relay", manifests)).toBe(intent);
    expect(await intentFor("relay", manifests)).toBe(intent);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await intentFor("green", manifests)).toBeNull();
    expect(await intentFor("nowhere", manifests)).toBeNull();
  });
});

/** A stand-in for the browser's speech recognition: each start() is a new session the test can speak into. */
class FakeRec {
  static live: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  start() {
    FakeRec.live.push(this);
  }
  stop() {
    this.onend?.();
  }
  abort() {
    FakeRec.live = FakeRec.live.filter((r) => r !== this);
  }
  say(text: string) {
    const res = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ resultIndex: 0, results: [res] });
  }
}

describe("hands-free (#638): one toggle, listening page to page", () => {
  const sent: { room: string; text: unknown }[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRec.live = [];
    sent.length = 0;
    vi.stubGlobal("window", { SpeechRecognition: FakeRec });
    vi.stubGlobal("navigator", { language: "en-US" });
    vi.stubGlobal(
      "Audio",
      class {
        paused = true;
        src = "";
        play = () => Promise.resolve();
        pause() {}
      },
    );
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        room: string;
        text: unknown;
      };
      sent.push({ room: body.room, text: body.text });
      return Response.json({ say: "Done.", kind: "skippy" });
    });
  });
  // The rooms' manifests load for real (none has a handler yet); load them before the clock is faked.
  beforeAll(async () => {
    forgetIntents();
    for (const room of ["relay", "today", "green", "haven"]) expect(await intentFor(room)).toBeNull();
  });
  afterEach(() => {
    micReset();
    handsFreeOff();
    setVoiceTarget(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("listens for the page's lead, sends after a pause, and follows a page change", async () => {
    setVoiceTarget(voiceTargetOf("relay"));
    handsFreeOn();
    expect(useRoomMic.getState().hf).toBe("on");
    expect(FakeRec.live).toHaveLength(1);
    FakeRec.live[0]!.say("anything from mum");
    expect(useRoomMic.getState().hfHeard).toBe("anything from mum");
    await vi.advanceTimersByTimeAsync(HF_QUIET_MS + 10);
    expect(sent).toEqual([{ room: "relay", text: "anything from mum" }]);
    // While the answer is out, nothing listens: one listener, and Skippy never hears himself.
    await vi.advanceTimersByTimeAsync(10_000);
    // On Today, Skippy himself.
    setVoiceTarget(SKIPPY_VOICE);
    const rec = FakeRec.live.at(-1)!;
    rec.say("what needs me");
    await vi.advanceTimersByTimeAsync(HF_QUIET_MS + 10);
    expect(sent.at(-1)).toEqual({ room: "today", text: "what needs me" });
  });

  it("waits with no lead (Ask Skippy open), and turns itself off after ten quiet minutes", async () => {
    setVoiceTarget(voiceTargetOf("green"));
    handsFreeOn();
    setVoiceTarget(null);
    expect(FakeRec.live).toHaveLength(0);
    expect(useRoomMic.getState().hf).toBe("on");
    setVoiceTarget(voiceTargetOf("green"));
    expect(FakeRec.live).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HF_IDLE_MS + 10);
    expect(useRoomMic.getState().hf).toBe("off");
    expect(FakeRec.live).toHaveLength(0);
  });

  it("waits while a page's own listener is on (Relay's Thread), so only one thing listens", () => {
    setVoiceTarget(voiceTargetOf("relay"));
    handsFreeOn();
    expect(FakeRec.live).toHaveLength(1);
    setOwnVoice({ space: true, listening: true });
    expect(FakeRec.live).toHaveLength(0);
    setOwnVoice({ space: true, listening: false });
    expect(FakeRec.live).toHaveLength(1);
    setOwnVoice(null);
  });

  it("turns off when the browser blocks the microphone", () => {
    setVoiceTarget(voiceTargetOf("haven"));
    handsFreeOn();
    FakeRec.live[0]!.onerror?.({ error: "not-allowed" });
    expect(useRoomMic.getState().hf).toBe("off");
    expect(useRoomMic.getState().say).toBe("The browser blocked the microphone.");
  });
});
