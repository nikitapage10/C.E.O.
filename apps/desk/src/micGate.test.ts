import { afterEach, describe, expect, it, vi } from "vitest";
import { claim, END_WAIT_MS, letGo, micBusy, micFree, released, resetMicGate, type Held } from "./micGate.ts";

/** One speech recognition at a time (#1094): a fake recognition whose end comes when the test says. */
function fake(): Held & { stops: number; aborts: number; end: () => void } {
  const r = {
    onend: null as (() => void) | null,
    stops: 0,
    aborts: 0,
    stop() {
      r.stops++;
    },
    abort() {
      r.aborts++;
    },
    end() {
      r.onend?.();
    },
  };
  return r;
}

afterEach(() => {
  resetMicGate();
  vi.useRealTimers();
});

describe("the mic gate (#1094)", () => {
  it("lets go of the recognition still holding the mic when another starts, and waits for its end", async () => {
    const old = fake();
    const ownEnd = vi.fn();
    old.onend = ownEnd;
    claim(old);
    const next = fake();
    claim(next);
    expect(old.aborts).toBe(1);
    expect(micBusy()).toBe(true);
    let free = false;
    void micFree().then(() => (free = true));
    await Promise.resolve();
    expect(free).toBe(false);
    old.end();
    await micFree();
    expect(free).toBe(true);
    expect(ownEnd).toHaveBeenCalledOnce();
    expect(micBusy()).toBe(false);
    expect(next.aborts).toBe(0);
  });

  it("never waits longer than END_WAIT_MS for an end that doesn't come", async () => {
    vi.useFakeTimers();
    const r = fake();
    claim(r);
    const over = letGo(r, "stop");
    expect(r.stops).toBe(1);
    vi.advanceTimersByTime(END_WAIT_MS);
    await over;
    expect(micBusy()).toBe(false);
  });

  it("forgets a recognition that ended on its own, so the next claim lets nothing go", () => {
    const r = fake();
    claim(r);
    released(r);
    const next = fake();
    claim(next);
    expect(r.aborts).toBe(0);
    expect(micBusy()).toBe(false);
  });
});
