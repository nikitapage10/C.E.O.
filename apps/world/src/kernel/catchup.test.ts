import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATCHUP_READ_KEY, lastReadStep, needsReading, pinned, rememberRead, useCatchup } from "./catchup.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
const blocked = () => {
  throw new Error("blocked");
};
const broken = { getItem: blocked, setItem: blocked };

describe("the catch-up's read step", () => {
  it("remembers the last read step", () => {
    const s = memory();
    expect(lastReadStep(s)).toBeNull();
    rememberRead(41, s);
    expect(lastReadStep(s)).toBe(41);
    expect(s.getItem(CATCHUP_READ_KEY)).toBe("41");
  });

  it("shrugs off storage that throws or holds junk", () => {
    expect(lastReadStep(broken)).toBeNull();
    expect(() => rememberRead(3, broken)).not.toThrow();
    const s = memory();
    s.setItem(CATCHUP_READ_KEY, "nope");
    expect(lastReadStep(s)).toBeNull();
  });

  it("a step needs reading unless it is the one already read", () => {
    expect(needsReading(7, null)).toBe(true);
    expect(needsReading(7, 6)).toBe(true);
    expect(needsReading(7, 7)).toBe(false);
  });
});

describe("pinning the catch-up", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memory());
    useCatchup.setState({ catchup: null });
  });

  it("pins a new step until it is read, then remembers it", () => {
    useCatchup.getState().arrive(12, "Rocky fixed the dock.", 0);
    expect(pinned(useCatchup.getState().catchup)?.text).toBe("Rocky fixed the dock.");
    useCatchup.getState().read();
    expect(pinned(useCatchup.getState().catchup)).toBeNull();
    // Signals keeps it.
    expect(useCatchup.getState().catchup?.text).toBe("Rocky fixed the dock.");
    expect(localStorage.getItem(CATCHUP_READ_KEY)).toBe("12");
  });

  it("doesn't pin the same step again once read, but does pin the next", () => {
    rememberRead(12);
    useCatchup.getState().arrive(12, "Same hour.", 0);
    expect(pinned(useCatchup.getState().catchup)).toBeNull();
    useCatchup.getState().arrive(13, "Next hour.", 0);
    expect(pinned(useCatchup.getState().catchup)?.step).toBe(13);
  });
});
