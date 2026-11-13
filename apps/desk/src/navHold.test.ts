import { describe, expect, it, vi } from "vitest";
import { HOLD_MS, createHold } from "./navHold.ts";

/** Holding a room's name opens its tabs (#1113). */

function setup() {
  vi.useFakeTimers();
  const opened = vi.fn();
  const h = createHold(opened, { set: (f, ms) => setTimeout(f, ms) as unknown as number, clear: (id) => clearTimeout(id) });
  return { h, opened };
}

describe("holding a room's name in the bar (#1113)", () => {
  it("opens the tabs after a still hold, and swallows the click that follows the release", () => {
    const { h, opened } = setup();
    h.down(10, 10);
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(opened).toHaveBeenCalledOnce();
    h.up();
    expect(h.eatClick()).toBe(true);
    expect(h.eatClick()).toBe(false);
    vi.useRealTimers();
  });

  it("a quick tap goes to the room as before", () => {
    const { h, opened } = setup();
    h.down(10, 10);
    vi.advanceTimersByTime(120);
    h.up();
    vi.advanceTimersByTime(HOLD_MS);
    expect(opened).not.toHaveBeenCalled();
    expect(h.eatClick()).toBe(false);
    vi.useRealTimers();
  });

  it("a press that slides along the bar is let go", () => {
    const { h, opened } = setup();
    h.down(10, 10);
    h.move(40, 12);
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(opened).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
