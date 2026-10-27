import { describe, expect, it } from "vitest";
import { SILENCE_MS, SPEECH_LEVEL, silenceGuard } from "./silence.ts";

describe("the Talk call's silence safety (#532)", () => {
  it("ends after two minutes of nobody speaking", () => {
    expect(SILENCE_MS).toBe(120_000);
    let t = 1_000_000;
    const g = silenceGuard(() => t);
    expect(g.over()).toBe(false);
    t += SILENCE_MS - 1;
    expect(g.over()).toBe(false);
    t += 1;
    expect(g.over()).toBe(true);
    expect(g.quietMs()).toBe(SILENCE_MS);
  });

  it("starts over whenever Nikita or Skippy speak, however long the call has run", () => {
    let t = 0;
    const g = silenceGuard(() => t);
    // A call far past the old ten minutes, with talk every minute and a half, never trips it.
    for (let i = 0; i < 20; i++) {
      t += 90_000;
      expect(g.over()).toBe(false);
      g.heard();
    }
    t += SILENCE_MS;
    expect(g.over()).toBe(true);
  });

  it("counts a level of speech but not the room's hum", () => {
    let t = 0;
    const g = silenceGuard(() => t);
    t = 100_000;
    g.level(SPEECH_LEVEL / 2);
    g.level(Number.NaN);
    t = SILENCE_MS;
    expect(g.over()).toBe(true);
    g.level(SPEECH_LEVEL);
    expect(g.over()).toBe(false);
    expect(g.quietMs()).toBe(0);
  });
});
