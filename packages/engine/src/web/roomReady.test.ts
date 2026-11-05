import { describe, expect, it, vi } from "vitest";
import { ReadyGate } from "./roomReady.ts";

describe("ReadyGate (#752)", () => {
  it("is ready on mount when the page opened no gate", () => {
    const onReady = vi.fn();
    const g = new ReadyGate(onReady);
    expect(onReady).not.toHaveBeenCalled();
    g.mount();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(g.ready).toBe(true);
  });

  it("waits for the page's code to mount, even with every gate open", () => {
    const onReady = vi.fn();
    const g = new ReadyGate(onReady);
    g.set(g.add(), true);
    expect(onReady).not.toHaveBeenCalled();
    g.mount();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("waits for every gate, then fires once", () => {
    const onReady = vi.fn();
    const g = new ReadyGate(onReady);
    const a = g.add();
    const b = g.add();
    g.mount();
    g.set(a, true);
    expect(onReady).not.toHaveBeenCalled();
    g.set(b, true);
    expect(onReady).toHaveBeenCalledTimes(1);
    g.set(a, false);
    g.set(a, true);
    g.mount();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("ignores a gate opened after it was ready, and an unknown one", () => {
    const onReady = vi.fn();
    const g = new ReadyGate(onReady);
    g.mount();
    const late = g.add();
    g.set(late, false);
    g.set(99, true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(g.ready).toBe(true);
  });

  it("a gate closed again before mount still holds it", () => {
    const onReady = vi.fn();
    const g = new ReadyGate(onReady);
    const a = g.add();
    g.set(a, true);
    g.set(a, false);
    g.mount();
    expect(onReady).not.toHaveBeenCalled();
  });
});
