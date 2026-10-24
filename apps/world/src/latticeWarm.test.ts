import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LET_GO_MS, startLetGo, trips } from "./latticeWarm.ts";

describe("startLetGo (#406)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    trips.count = 3;
  });
  afterEach(() => vi.useRealTimers());

  it("lets the Lattice go after ten minutes and resets the trips", () => {
    const letGo = vi.fn();
    startLetGo(letGo);
    vi.advanceTimersByTime(LET_GO_MS - 1);
    expect(letGo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(letGo).toHaveBeenCalledTimes(1);
    expect(trips.count).toBe(0);
  });

  it("does nothing when cancelled by a quick return", () => {
    const letGo = vi.fn();
    startLetGo(letGo)();
    vi.advanceTimersByTime(LET_GO_MS * 2);
    expect(letGo).not.toHaveBeenCalled();
    expect(trips.count).toBe(3);
  });
});
