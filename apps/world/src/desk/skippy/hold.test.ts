import { afterEach, describe, expect, it, vi } from "vitest";
import { ASIDE_AFTER_MS, HOLD_AFTER_MS, HOLD_ASIDES, HOLD_TICK_MS, holdBegin, holdCheck, holdEnd, holdHeard, holdMachine, readHoldMuted, setHoldMuted, setHoldPlayer, useHold, type HoldView } from "./hold.ts";

const waitingView = (over: Partial<HoldView> = {}): HoldView => ({ live: true, pending: true, agentSpeaking: false, muted: false, ...over });

describe("hold music's rules (#546)", () => {
  it("starts only after two quiet seconds with something still pending", () => {
    const m = holdMachine(() => 0.99);
    expect(m.step(waitingView(), 0).playing).toBe(false);
    expect(m.step(waitingView(), HOLD_AFTER_MS - 1).playing).toBe(false);
    const s = m.step(waitingView(), HOLD_AFTER_MS);
    expect(s).toMatchObject({ playing: true, started: true });
    // Once on, it stays on without starting again.
    expect(m.step(waitingView(), HOLD_AFTER_MS + 500)).toMatchObject({ playing: true, started: false });
  });

  it("never plays for a short lookup", () => {
    const m = holdMachine();
    for (let t = 0; t < 1_900; t += 100) expect(m.step(waitingView(), t).playing).toBe(false);
    // The answer is back before the two seconds.
    expect(m.step(waitingView({ pending: false }), 1_900).playing).toBe(false);
    expect(m.step(waitingView({ pending: false }), 10_000).playing).toBe(false);
    // A new wait counts its own two seconds from its own start.
    expect(m.step(waitingView(), 10_100).playing).toBe(false);
    expect(m.step(waitingView(), 10_100 + HOLD_AFTER_MS).playing).toBe(true);
  });

  it("counts the two seconds from the last speech: the waiting line first, then the music", () => {
    const m = holdMachine();
    m.step(waitingView(), 0);
    // Skippy says his one waiting line while the hand-off is out.
    m.step(waitingView({ agentSpeaking: true }), 1_500);
    expect(m.step(waitingView(), 2_500).playing).toBe(false);
    expect(m.step(waitingView(), 1_500 + HOLD_AFTER_MS - 1).playing).toBe(false);
    expect(m.step(waitingView(), 1_500 + HOLD_AFTER_MS).playing).toBe(true);
  });

  it("ducks out at once when the answer lands, an agent speaks, Nikita speaks, the call ends or it is muted", () => {
    const playing = () => {
      const m = holdMachine();
      m.step(waitingView(), 0);
      expect(m.step(waitingView(), HOLD_AFTER_MS).playing).toBe(true);
      return m;
    };
    expect(playing().step(waitingView({ pending: false }), 3_000)).toMatchObject({ playing: false, stopped: true });
    expect(playing().step(waitingView({ agentSpeaking: true }), 3_000)).toMatchObject({ playing: false, stopped: true });
    expect(playing().step(waitingView({ live: false }), 3_000)).toMatchObject({ playing: false, stopped: true });
    expect(playing().step(waitingView({ muted: true }), 3_000)).toMatchObject({ playing: false, stopped: true });
    const barge = playing();
    expect(barge.heard(3_000)).toBe(true);
    expect(barge.playing).toBe(false);
    // ...and only comes back after two more quiet seconds, still waiting.
    expect(barge.step(waitingView(), 3_000 + HOLD_AFTER_MS - 1).playing).toBe(false);
    expect(barge.step(waitingView(), 3_000 + HOLD_AFTER_MS).playing).toBe(true);
  });

  it("muted, it never starts; unmuted mid-wait, it picks up", () => {
    const m = holdMachine();
    for (let t = 0; t <= 5_000; t += 500) expect(m.step(waitingView({ muted: true }), t).playing).toBe(false);
    expect(m.step(waitingView(), 5_100)).toMatchObject({ playing: true, started: true });
  });

  it("brings at most one aside a wait, only on a long one, and only sometimes", () => {
    const lucky = holdMachine(() => 0);
    lucky.step(waitingView(), 0);
    expect(lucky.step(waitingView(), HOLD_AFTER_MS).aside).toBeNull();
    expect(lucky.step(waitingView(), ASIDE_AFTER_MS - 1).aside).toBeNull();
    expect(lucky.step(waitingView(), ASIDE_AFTER_MS).aside).toBe(HOLD_ASIDES[0]);
    for (let t = ASIDE_AFTER_MS + 100; t < 60_000; t += 1_000) expect(lucky.step(waitingView(), t).aside).toBeNull();
    // A new wait may get its own.
    lucky.step(waitingView({ pending: false }), 60_000);
    lucky.step(waitingView(), 61_000);
    expect(lucky.step(waitingView(), 61_000 + ASIDE_AFTER_MS).aside).not.toBeNull();

    const unlucky = holdMachine(() => 0.99);
    unlucky.step(waitingView(), 0);
    for (let t = HOLD_AFTER_MS; t < 60_000; t += 500) expect(unlucky.step(waitingView(), t).aside).toBeNull();
  });

  it("asides are short, in character and never anyone's private detail", () => {
    for (const a of HOLD_ASIDES) {
      expect(a.length).toBeLessThan(70);
      expect(a).not.toMatch(/@|\d{3}|thread|kernel|hand-off|crew/i);
    }
  });
});

describe("hold music on a live call (#546)", () => {
  afterEach(() => {
    holdEnd();
    vi.useRealTimers();
  });

  const setup = async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const calls: string[] = [];
    setHoldPlayer(async () => ({ play: () => calls.push("play"), duck: () => calls.push("duck") }));
    useHold.setState({ muted: false, playing: false, aside: null });
    const state = { pending: false, speaking: false, mic: 0 };
    holdBegin({ pending: () => state.pending, agentSpeaking: () => state.speaking, micLevel: () => state.mic }, () => 0.99);
    return { calls, state };
  };

  it("plays after the quiet, and ducks the moment Nikita's mic picks him up", async () => {
    const { calls, state } = await setup();
    state.pending = true;
    await vi.advanceTimersByTimeAsync(HOLD_AFTER_MS - HOLD_TICK_MS * 2);
    expect(useHold.getState().playing).toBe(false);
    await vi.advanceTimersByTimeAsync(HOLD_TICK_MS * 4);
    expect(useHold.getState().playing).toBe(true);
    expect(calls).toEqual(["play"]);
    state.mic = 0.4;
    await vi.advanceTimersByTimeAsync(HOLD_TICK_MS);
    expect(useHold.getState().playing).toBe(false);
    expect(calls).toEqual(["play", "duck"]);
  });

  it("ducks on a heard line and on the call's end, and remembers the toggle", async () => {
    const { calls, state } = await setup();
    state.pending = true;
    await vi.advanceTimersByTimeAsync(HOLD_AFTER_MS + HOLD_TICK_MS * 2);
    expect(useHold.getState().playing).toBe(true);
    holdHeard();
    expect(useHold.getState().playing).toBe(false);
    await vi.advanceTimersByTimeAsync(HOLD_AFTER_MS + HOLD_TICK_MS * 2);
    expect(useHold.getState().playing).toBe(true);
    setHoldMuted(true);
    expect(useHold.getState()).toMatchObject({ playing: false, muted: true });
    setHoldMuted(false);
    holdCheck();
    expect(useHold.getState().playing).toBe(true);
    holdEnd();
    expect(useHold.getState().playing).toBe(false);
    expect(calls.filter((c) => c === "duck").length).toBe(3);
  });

  it("reads the toggle off this device, defaulting to on", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }, matchMedia: () => ({ matches: false }) });
    expect(readHoldMuted()).toBe(false);
    setHoldMuted(true);
    expect(readHoldMuted()).toBe(true);
    setHoldMuted(false);
    expect(readHoldMuted()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("starts muted when reduced motion is asked for and nothing was chosen", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null }, matchMedia: (q: string) => ({ matches: q.includes("reduced-motion") }) });
    expect(readHoldMuted()).toBe(true);
    vi.unstubAllGlobals();
  });
});
