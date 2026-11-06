import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The floor's flow since #948: on the release the box goes, the one who answers rises and says it aloud, waits for a
 * reply, steps back down, and the chamber is steered back to what it was on before it picks up. Made-up words only.
 */

const heard = vi.hoisted(() => ({ next: null as unknown }));
vi.mock("../roomvoice/roomVoice.ts", () => ({
  askRoom: vi.fn(async () => ({ ok: true, say: "Fallback answer.", kind: "skippy" })),
  listen: () => ({ cancel: () => undefined, finish: async () => ({ text: "how warm is it in the flat" }) }),
  micSupported: () => true,
  recall: () => ({ turns: [], last: null }),
  remember: () => undefined,
  setOwnVoice: () => undefined,
  silentWav: () => "",
}));
vi.mock("../holdToTalk.ts", () => ({ holdHint: () => undefined }));
vi.mock("../skippy/wrote.ts", () => ({ announceWrote: () => undefined, readWrote: () => null }));
vi.mock("./voice.ts", () => ({ fetchLine: async () => ({ url: null, gone: false }) }));
vi.mock("./liveTalk.ts", () => ({ fetchFloor: async () => heard.next }));

const { floorCancel, floorEnd, floorStart, setFloorScene, useFloor } = await import("./senateFloor.ts");
const { useDeskAuth } = await import("@ceo/engine/web/signin.ts");
const { FLOOR_WAIT_MS } = await import("./floorSteer.ts");

class FakeAudio extends EventTarget {
  src = "";
  paused = true;
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play() {
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function makeScene(topic: boolean) {
  const calls: string[] = [];
  const scene = {
    hold: (on: boolean) => calls.push(`hold:${on}`),
    talk: () => undefined,
    seated: () => ["boiler", "foundry"],
    light: () => undefined,
    rise: (id: string | null) => calls.push(`rise:${id}`),
    where: () => (topic ? "the motion was that a starship crew beats any single hero" : null),
    topic: () => (topic ? { motion: "that a starship crew beats any single hero", lines: [], cast: ["boiler", "foundry"] } : null),
    join: vi.fn(() => topic),
  };
  return { scene, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Audio", FakeAudio);
  useDeskAuth.setState({ auth: { status: "in" } } as never);
});
afterEach(() => {
  floorCancel();
  setFloorScene(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("a tool answer on the floor (#948)", () => {
  it("is said aloud by the chair from his podium, waits, then steers back and picks up", async () => {
    const { scene, calls } = makeScene(true);
    setFloorScene(scene);
    heard.next = { chair: { say: "It is twenty-one degrees in the flat." } };
    floorStart();
    expect(useFloor.getState().phase).toBe("listening");
    const done = floorEnd();
    await settle();
    // The box is gone: the chair answers in the chamber, risen.
    expect(useFloor.getState().phase).toBe("answering");
    expect(useFloor.getState().turn).toMatchObject({ by: "kernel", say: "It is twenty-one degrees in the flat." });
    expect(calls).toContain("rise:kernel");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useFloor.getState().phase).toBe("waiting");
    expect(calls).not.toContain("hold:false");
    await vi.advanceTimersByTimeAsync(FLOOR_WAIT_MS);
    expect(calls).toContain("rise:null");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useFloor.getState().turn?.say).toMatch(/interrupt|where were we|back to it/i);
    expect(useFloor.getState().turn?.say).toMatch(/starship crew/);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(useFloor.getState().phase).toBe("idle");
    expect(calls[calls.length - 1]).toBe("hold:false");
  });

  it("holding Space again while he waits carries the exchange on: no step down, no steer", async () => {
    const { scene, calls } = makeScene(true);
    setFloorScene(scene);
    heard.next = { chair: { say: "It is twenty-one degrees in the flat." } };
    floorStart();
    void floorEnd();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useFloor.getState().phase).toBe("waiting");
    floorStart();
    await vi.advanceTimersByTimeAsync(FLOOR_WAIT_MS + 2_000);
    expect(useFloor.getState().phase).toBe("listening");
    expect(calls).not.toContain("rise:null");
    expect(calls).not.toContain("hold:false");
  });
});

describe("a remark on the debate (#948)", () => {
  it("is joined to the argument and answered by the member, risen on his podium", async () => {
    const { scene, calls } = makeScene(true);
    setFloorScene(scene);
    heard.next = { join: { answers: [{ by: "boiler", text: "It will go wrong, as ever." }], rest: [], close: "The motion carries." } };
    floorStart();
    void floorEnd();
    await settle();
    expect(scene.join).toHaveBeenCalledOnce();
    expect(calls).toContain("rise:boiler");
    expect(useFloor.getState().turn).toMatchObject({ by: "boiler" });
  });

  it("with nothing on the floor, steps down and picks up without a steer", async () => {
    const { scene, calls } = makeScene(false);
    setFloorScene(scene);
    heard.next = { lines: [{ by: "foundry", text: "Then build it." }] };
    floorStart();
    const done = floorEnd();
    await vi.advanceTimersByTimeAsync(5_000 + FLOOR_WAIT_MS + 2_000);
    await done;
    expect(calls).toContain("rise:foundry");
    expect(useFloor.getState().phase).toBe("idle");
    expect(calls[calls.length - 1]).toBe("hold:false");
  });
});
