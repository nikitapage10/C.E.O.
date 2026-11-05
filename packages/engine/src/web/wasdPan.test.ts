import { describe, expect, it, vi } from "vitest";
import { constrain, edgeFactor, fracOf, isTyping, keyOf, PanCore, settle, shouldHandle, SOFT, type PanBounds, type PanCoreOpts } from "./wasdPan.ts";

const box: PanBounds = { kind: "box", x0: -10, x1: 10, z0: -5, z1: 5 };
const disc: PanBounds = { kind: "disc", cx: 0, cz: 0, r: 8 };

describe("the rubber band (#776)", () => {
  it("gives freely inside 80%, resists past it, and stops at the border", () => {
    expect(edgeFactor(0)).toBe(1);
    expect(edgeFactor(SOFT)).toBe(1);
    expect(edgeFactor(0.9)).toBeCloseTo(0.25);
    expect(edgeFactor(0.95)).toBeLessThan(edgeFactor(0.9));
    expect(edgeFactor(1)).toBe(0);
    expect(edgeFactor(1.2)).toBe(0);
  });

  it("moves freely inside a box's soft zone", () => {
    expect(constrain(box, 0, 0, 2, -1)).toEqual([2, -1]);
  });

  it("resists outward steps past 80% of a box, per axis, but not inward ones", () => {
    const [x] = constrain(box, 9, 0, 0.5, 0);
    expect(x).toBeGreaterThan(9);
    expect(x - 9).toBeLessThan(0.5 * 0.5);
    expect(constrain(box, 9, 0, -0.5, 0)[0]).toBeCloseTo(8.5);
    // The other axis, still inside its soft zone, is free.
    expect(constrain(box, 9, 0, 0, 1)[1]).toBe(1);
  });

  it("never passes a box's border, however big the step", () => {
    expect(constrain(box, 0, 0, 100, -100)).toEqual([10, -5]);
    let p: [number, number] = [0, 0];
    for (let i = 0; i < 2000; i++) p = constrain(box, p[0], p[1], 0.2, 0.2);
    expect(p[0]).toBeLessThanOrEqual(10);
    expect(p[1]).toBeLessThanOrEqual(5);
    expect(fracOf(box, p[0], p[1])).toBeGreaterThan(0.95);
  });

  it("resists only the outward part of a step on a disc, and clamps to its rim", () => {
    // At 7 of 8 (87.5%), an outward step is cut, a sideways one isn't.
    const [ox] = constrain(disc, 7, 0, 1, 0);
    expect(ox - 7).toBeLessThan(edgeFactor(7 / 8) + 1e-9);
    const [, sz] = constrain(disc, 7, 0, 0, 0.3);
    expect(sz).toBeCloseTo(0.3);
    const [fx, fz] = constrain(disc, 0, 0, 50, 50);
    expect(Math.hypot(fx, fz)).toBeCloseTo(8);
  });

  it("springs back to the soft edge, and leaves points inside alone", () => {
    expect(settle(box, 3, 1, 0.5)).toEqual([3, 1]);
    expect(settle(box, 10, 0, 1)[0]).toBeCloseTo(8);
    expect(settle(box, -10, 0, 0.5)[0]).toBeCloseTo(-9);
    const [x, z] = settle(disc, 8, 0, 1);
    expect(Math.hypot(x, z)).toBeCloseTo(8 * SOFT);
  });
});

describe("the input guard (#776)", () => {
  it("maps keys by their place, arrows too", () => {
    expect(keyOf("KeyW")).toBe("fwd");
    expect(keyOf("ArrowUp")).toBe("fwd");
    expect(keyOf("KeyS")).toBe("back");
    expect(keyOf("ArrowLeft")).toBe("left");
    expect(keyOf("KeyD")).toBe("right");
    expect(keyOf("KeyQ")).toBe("ccw");
    expect(keyOf("KeyE")).toBe("cw");
    expect(keyOf("Escape")).toBe("home");
    expect(keyOf("KeyX")).toBeNull();
    expect(keyOf("Space")).toBeNull();
  });

  it("knows what's typed into", () => {
    expect(isTyping({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isTyping({ tagName: "INPUT" })).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTyping({ tagName: "SELECT" })).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: "DIV", getAttribute: (n) => (n === "role" ? "textbox" : null) })).toBe(true);
    expect(isTyping({ tagName: "BUTTON" })).toBe(false);
    expect(isTyping({ tagName: "CANVAS" })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it("takes keys only over or in the scene, never while typing or with a modifier", () => {
    const base = { hovered: true, focusedIn: false, active: { tagName: "BODY" }, mods: false };
    expect(shouldHandle(base)).toBe(true);
    expect(shouldHandle({ ...base, hovered: false })).toBe(false);
    expect(shouldHandle({ ...base, hovered: false, focusedIn: true })).toBe(true);
    // Skippy's chat has focus while the pointer rests on the scene: the keys stay with the chat.
    expect(shouldHandle({ ...base, active: { tagName: "TEXTAREA" } })).toBe(false);
    expect(shouldHandle({ ...base, active: { tagName: "INPUT", type: "text" } })).toBe(false);
    expect(shouldHandle({ ...base, active: { tagName: "DIV", isContentEditable: true } })).toBe(false);
    expect(shouldHandle({ ...base, mods: true })).toBe(false);
    expect(shouldHandle({ ...base, enabled: false })).toBe(false);
  });
});

describe("the pan (#776)", () => {
  const make = (o: Partial<PanCoreOpts> = {}) => new PanCore({ bounds: () => box, origin: () => [0, 0], forward: () => [0, -1], speed: () => 4, ...o });
  const run = (p: PanCore, s: number, dt = 1 / 60) => {
    for (let t = 0; t < s; t += dt) p.step(dt);
  };

  it("pans along the view: W forward, D to the right", () => {
    const p = make();
    p.press("fwd");
    run(p, 0.5);
    expect(p.z).toBeLessThan(-0.5);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    p.release("fwd");
    p.press("right");
    run(p, 0.5);
    expect(p.x).toBeGreaterThan(0.5);
  });

  it("goes the same way at any frame rate", () => {
    const a = make(), b = make();
    a.press("fwd");
    b.press("fwd");
    run(a, 0.6, 1 / 30);
    run(b, 0.6, 1 / 144);
    expect(a.z).toBeCloseTo(b.z, 1);
  });

  it("stops at the border and eases back inside when the keys let go", () => {
    const p = make();
    p.press("right");
    run(p, 10);
    expect(p.x).toBeLessThanOrEqual(10);
    expect(p.x).toBeGreaterThan(8);
    p.release("right");
    run(p, 1.5);
    expect(p.x).toBeCloseTo(8, 1);
  });

  it("returns home after the idle time, and on Escape", () => {
    const onHome = vi.fn();
    const p = make({ returnMs: 1000, onHome });
    p.press("fwd");
    run(p, 0.3);
    p.release("fwd");
    run(p, 0.5);
    expect(p.z).not.toBe(0);
    run(p, 3);
    expect(p.z).toBe(0);
    expect(onHome).toHaveBeenCalledTimes(1);
    p.press("left");
    run(p, 0.3);
    p.press("home");
    expect(p.held.size).toBe(0);
    run(p, 3);
    expect(p.x).toBe(0);
    expect(p.busy).toBe(false);
  });

  it("with reduced motion still pans, and goes home at once", () => {
    const p = make({ reduce: true });
    p.press("fwd");
    p.step(0.1);
    expect(p.z).toBeCloseTo(-0.4);
    p.release("fwd");
    p.home();
    p.step(0.016);
    expect(p.z).toBe(0);
  });

  it("in orbit mode, A/D turn and W/S zoom, nothing pans, and Escape goes home (#802)", () => {
    const turn = vi.fn();
    const zoom = vi.fn();
    const home = vi.fn();
    const p = make({ orbit: { turn, zoom, home } });
    p.press("right");
    p.press("fwd");
    expect(p.step(0.1)).toBe(true);
    expect(turn.mock.calls[0]![0]).toBeGreaterThan(0);
    expect(zoom.mock.calls[0]![0]).toBeGreaterThan(0);
    expect([p.x, p.z]).toEqual([0, 0]);
    p.release("right");
    p.release("fwd");
    p.press("left");
    p.press("back");
    p.step(0.1);
    expect(turn.mock.calls[1]![0]).toBeLessThan(0);
    expect(zoom.mock.calls[1]![0]).toBeLessThan(0);
    p.press("home");
    expect(home).toHaveBeenCalled();
    expect(p.step(0.1)).toBe(false);
  });

  it("turns with Q/E only for a scene that orbits", () => {
    const rotate = vi.fn();
    const p = make({ rotate });
    p.press("cw");
    expect(p.step(0.1)).toBe(true);
    expect(rotate.mock.calls[0]![0]).toBeGreaterThan(0);
    const q = make();
    q.press("ccw");
    expect(q.step(0.1)).toBe(false);
  });
});
