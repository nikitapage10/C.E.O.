import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from "./achievements/achievements.ts";
import { BeatDetector, phrase } from "./club/deck.ts";
import { DAY_MS, darkness, formatHour, latticeDay, latticeHour, shiftOf } from "./night/dayCycle.ts";
import { moodOf, replyTo } from "./letters/letters.ts";
import { VEIL_CAST, VEIL_COSTUMES, isVeilForced, veilCostumeFor } from "./veil/veil.ts";
import { GATHERING_BY_ID, GATHERINGS } from "./gatherings/gatherings.ts";

describe("the Lattice's hours", () => {
  it("runs a day in DAY_MS from the start hour", () => {
    expect(latticeHour(0, 16)).toBe(16);
    expect(latticeHour(DAY_MS / 2, 16)).toBeCloseTo(4);
    expect(latticeHour(DAY_MS, 16)).toBeCloseTo(16);
    expect(latticeDay(0, 16)).toBe(1);
    expect(latticeDay((DAY_MS * 8) / 24, 16)).toBe(2);
  });
  it("is dark at night and light by day, easing between", () => {
    expect(darkness(12)).toBe(0);
    expect(darkness(23)).toBe(1);
    expect(darkness(2)).toBe(1);
    expect(darkness(19.5)).toBeGreaterThan(0);
    expect(darkness(19.5)).toBeLessThan(1);
    expect(shiftOf(12)).toBe("day");
    expect(shiftOf(19)).toBe("dusk");
    expect(shiftOf(3)).toBe("night");
    expect(shiftOf(5)).toBe("dawn");
    expect(formatHour(3.5)).toBe("03:30");
  });
});

describe("the decks", () => {
  it("builds through the last eight beats of a phrase", () => {
    expect(phrase(0).build).toBe(0);
    expect(phrase(23).build).toBe(0);
    expect(phrase(28).build).toBeCloseTo(0.5);
    expect(phrase(32).phraseIndex).toBe(1);
  });
  it("hears kicks and finds the drop after a breakdown", () => {
    const d = new BeatDetector();
    let t = 0;
    let kicks = 0;
    let drops = 0;
    const frame = (bass: number) => {
      const r = d.push(bass, t);
      t += 1 / 60;
      if (r.kick) kicks++;
      if (r.drop) drops++;
    };
    // Eight seconds of four-on-the-floor at 124 bpm.
    for (let i = 0; i < 480; i++) frame((t * 124) / 60 % 1 < 0.15 ? 0.9 : 0.3);
    expect(kicks).toBeGreaterThan(10);
    expect(drops).toBe(0);
    // A four-second breakdown, then the bass comes back.
    for (let i = 0; i < 240; i++) frame(0.05);
    for (let i = 0; i < 120; i++) frame((t * 124) / 60 % 1 < 0.15 ? 1 : 0.5);
    expect(drops).toBe(1);
  });
});

describe("letters", () => {
  it("reads the mood of a letter", () => {
    expect(moodOf("I love you guys")).toBe("love");
    expect(moodOf("Thanks for the hard work")).toBe("thanks");
    expect(moodOf("Sorry about the outage")).toBe("sorry");
    expect(moodOf("Great job on the release")).toBe("praise");
    expect(moodOf("Who's playing at the club tonight")).toBe("music");
    expect(moodOf("How is Myshka")).toBe("cat");
    expect(moodOf("What are you working on?")).toBe("question");
    expect(moodOf("Hello")).toBe("plain");
  });
  it("answers in the agent's own way, the same way every time", () => {
    expect(replyTo("caret", "hi", 3)).toBe(replyTo("caret", "hi", 3));
    expect(replyTo("caret", "hi", 0)).toMatch(/^Letter!/);
    expect(replyTo("someone-new", "hi", 0).length).toBeGreaterThan(10);
  });
});

describe("the Hallowed Veil", () => {
  it("is off unless the C.E.O. calls it", () => {
    expect(isVeilForced(null)).toBe(false);
    expect(isVeilForced("on")).toBe(true);
    expect(GATHERING_BY_ID["costume-party"]?.manual).toBe(true);
    expect(GATHERINGS.filter((g) => g.dressAll).map((g) => g.id)).toEqual(["costume-party"]);
  });
  it("dresses everyone except Memo, who comes as himself", () => {
    expect(veilCostumeFor("memo")).toBeNull();
    expect(veilCostumeFor("caret")).toBe(VEIL_CAST.caret);
    expect(VEIL_COSTUMES).toContain(veilCostumeFor("a-new-agent"));
    expect(veilCostumeFor("a-new-agent")).toBe(veilCostumeFor("a-new-agent"));
  });
});

describe("achievements", () => {
  it("have unique ids, a title, a line and a hint", () => {
    expect(Object.keys(ACHIEVEMENT_BY_ID)).toHaveLength(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.title && a.line && a.hint).toBeTruthy();
  });
});
