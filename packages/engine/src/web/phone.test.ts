/** The phone layout's one rule (#1045): the width every room shares, and the pixel ratio a phone's scene draws at (#1070). */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./phone.css", () => ({}));
const { dprGuard, isPhone, PHONE_MAX, PHONE_QUERY, resetDprRung, sceneDpr } = await import("./phone.ts");

function screen(width: number, dpr: number) {
  vi.stubGlobal("window", { devicePixelRatio: dpr, matchMedia: (q: string) => ({ matches: q === PHONE_QUERY && width <= PHONE_MAX, addEventListener() {}, removeEventListener() {} }) });
}

/** Runs `ms` of frames `step` apart through a guard, starting at `t`; returns where it ended. */
function run(g: { frame: (now: number) => void }, t: number, ms: number, step: number): number {
  for (const end = t + ms; t < end; t += step) g.frame(t);
  return t;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetDprRung();
});

describe("the phone layout (#1045)", () => {
  it("is the width the rooms already used", () => {
    expect(PHONE_QUERY).toBe("(max-width: 760px)");
  });
  it("knows a phone from a desktop", () => {
    screen(393, 3);
    expect(isPhone()).toBe(true);
    screen(1440, 2);
    expect(isPhone()).toBe(false);
  });
  it("draws a phone's scene at no more than 2x, a desktop's at no more than 1.75x (#1070)", () => {
    screen(393, 3);
    expect(sceneDpr()).toBe(2);
    screen(393, 1.5);
    expect(sceneDpr()).toBe(1.5);
    screen(1440, 3);
    expect(sceneDpr()).toBe(1.75);
    screen(1440, 1);
    expect(sceneDpr()).toBe(1);
  });
  it("is a desktop with no window", () => {
    expect(isPhone()).toBe(false);
  });
});

describe("the frame guard (#1070)", () => {
  it("holds 2x while frames keep up", () => {
    screen(393, 3);
    const apply = vi.fn();
    run(dprGuard(apply), 1000, 10_000, 16.7);
    expect(apply).not.toHaveBeenCalled();
    expect(sceneDpr()).toBe(2);
  });
  it("steps down 2, 1.5, 1.25 while frames run slow, and no further", () => {
    screen(393, 3);
    const apply = vi.fn();
    const g = dprGuard(apply);
    let t = run(g, 1000, 1500, 30);
    expect(apply).not.toHaveBeenCalled();
    t = run(g, t, 1500, 30);
    expect(apply).toHaveBeenLastCalledWith(1.5);
    t = run(g, t, 3000, 30);
    expect(apply).toHaveBeenLastCalledWith(1.25);
    run(g, t, 10_000, 30);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(sceneDpr()).toBe(1.25);
  });
  it("never steps back up in the same page view, and a scene built later starts down there", () => {
    screen(393, 3);
    const g = dprGuard(() => {});
    const t = run(g, 1000, 3000, 30);
    run(g, t, 10_000, 16.7);
    expect(sceneDpr()).toBe(1.5);
    expect(sceneDpr(1.75, 2)).toBe(1.5);
  });
  it("lets a short hitch or a hidden tab pass", () => {
    screen(393, 3);
    const apply = vi.fn();
    const g = dprGuard(apply);
    let t = run(g, 1000, 1000, 16.7);
    t = run(g, t, 300, 40);
    t = run(g, t, 2000, 16.7);
    g.frame(t + 5000);
    run(g, t + 5000, 2000, 16.7);
    expect(apply).not.toHaveBeenCalled();
  });
  it("does nothing on a desktop", () => {
    screen(1440, 2);
    const apply = vi.fn();
    run(dprGuard(apply), 1000, 10_000, 50);
    expect(apply).not.toHaveBeenCalled();
    expect(sceneDpr()).toBe(1.75);
  });
});
