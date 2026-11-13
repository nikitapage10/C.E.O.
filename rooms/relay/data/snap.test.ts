import { describe, expect, it } from "vitest";
import { MAX_STEPS, SPRING_MS, springAt, stepFrom, stopsOf, swipeSteps, WheelGate, wheelPx } from "./snap.ts";

/* The codex's snapping (#1161). Numbers only: no people or messages. */

const VIEW = 800;
const tops = [0, 800, 1600, 2400];
const stops = stopsOf(tops, VIEW, 2400);

describe("stops", () => {
  it("rests on each entry's top when each fills the page", () => {
    expect(stops).toEqual([0, 800, 1600, 2400]);
  });
  it("adds resting places down an entry taller than the page, ending with its foot in view", () => {
    const s = stopsOf([0, 2000, 2800], VIEW, 2800);
    expect(s[0]).toBe(0);
    expect(s).toContain(1200); // the tall entry's foot: 2000 - 800
    expect(s.at(-2)).toBe(2000);
    expect(s.at(-1)).toBe(2800);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });
  it("never rests past the furthest scroll", () => {
    expect(stopsOf([0, 800, 1600], VIEW, 1000).every((v) => v <= 1000)).toBe(true);
  });
  it("copes with no entries", () => {
    expect(stopsOf([], VIEW, 0)).toEqual([0]);
  });
});

describe("stepping", () => {
  it("goes to the next and previous stop from where it stands", () => {
    expect(stepFrom(stops, 0, 1)).toBe(800);
    expect(stepFrom(stops, 790, 1)).toBe(1600);
    expect(stepFrom(stops, 1700, -1)).toBe(800);
  });
  it("clamps at the first and last", () => {
    expect(stepFrom(stops, 0, -1)).toBe(0);
    expect(stepFrom(stops, 2400, 3)).toBe(2400);
  });
  it("takes a few for a big fling", () => {
    expect(stepFrom(stops, 0, 3)).toBe(2400);
  });
});

describe("wheel gate", () => {
  it("turns a mouse notch into one step", () => {
    const g = new WheelGate();
    expect(g.feed(1000, 100)).toBe(1);
    expect(g.feed(1500, -100)).toBe(-1); // a quiet gap, then the other way
  });
  it("swallows the inertia tail of a trackpad fling: one step", () => {
    const g = new WheelGate();
    let total = 0;
    let t = 0;
    for (let i = 0; i < 90; i++) {
      total += g.feed(t, Math.max(1, 60 * Math.exp(-i / 18)));
      t += 16;
    }
    expect(total).toBe(1);
  });
  it("lets a big fling advance a few, never more than the cap", () => {
    const g = new WheelGate();
    const n = g.feed(0, 700);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(MAX_STEPS);
    const h = new WheelGate();
    expect(h.feed(0, 5000)).toBe(MAX_STEPS);
  });
  it("ignores a graze", () => {
    const g = new WheelGate();
    expect(g.feed(0, 3)).toBe(0);
    expect(g.feed(16, 3)).toBe(0);
  });
  it("starts a new step when the wheel is pushed again once the step has landed", () => {
    const g = new WheelGate();
    expect(g.feed(0, 40)).toBe(1);
    for (let t = 16; t < 400; t += 16) expect(g.feed(t, 6)).toBe(0);
    expect(g.feed(416, 90)).toBe(1);
  });
  it("does not start a new step on a speed-up inside the lock window", () => {
    const g = new WheelGate();
    expect(g.feed(0, 40)).toBe(1);
    expect(g.feed(30, 4)).toBe(0);
    expect(g.feed(60, 90)).toBe(0);
  });
  it("normalises line and page deltas", () => {
    expect(wheelPx(3, 1, 800)).toBe(48);
    expect(wheelPx(1, 2, 800)).toBe(800);
    expect(wheelPx(10, 0, 800)).toBe(10);
  });
});

describe("swipes", () => {
  it("one step for a normal swipe, up goes down the list", () => {
    expect(swipeSteps(-120, 200, VIEW)).toBe(1);
    expect(swipeSteps(120, 200, VIEW)).toBe(-1);
  });
  it("ignores a tap or a nudge", () => {
    expect(swipeSteps(-6, 80, VIEW)).toBe(0);
  });
  it("a short quick flick counts", () => {
    expect(swipeSteps(-50, 60, VIEW)).toBe(1);
  });
  it("a hard fling takes a few, capped", () => {
    expect(swipeSteps(-600, 120, VIEW)).toBe(MAX_STEPS);
  });
});

describe("spring", () => {
  it("starts at rest and ends exactly on target", () => {
    expect(springAt(0, 800, 0)).toBe(0);
    expect(springAt(0, 800, SPRING_MS)).toBe(800);
  });
  it("overshoots a little, then settles", () => {
    let peak = 0;
    for (let t = 0; t <= SPRING_MS; t += 5) peak = Math.max(peak, springAt(0, 800, t));
    expect(peak).toBeGreaterThan(800);
    expect(peak).toBeLessThan(800 * 1.08);
    expect(Math.abs(springAt(0, 800, SPRING_MS - 20) - 800)).toBeLessThan(8);
  });
  it("works upward too", () => {
    expect(Math.min(...Array.from({ length: 140 }, (_, i) => springAt(800, 0, i * 5)))).toBeLessThan(0);
  });
  it("is a plain snap under reduced motion, with no bounce", () => {
    expect(springAt(0, 800, 0, true)).toBe(800);
    expect(springAt(0, 800, 100, true)).toBe(800);
  });
});
