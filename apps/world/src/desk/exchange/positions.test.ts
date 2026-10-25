import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeskAuth } from "../signin.ts";
import { bookLine, cents, readPositions, signedPct, signedUsd, startPositions, usd, usePositions } from "./positions.ts";

const pos = { market: "Brewers win?", outcome: "Yes", url: "https://polymarket.us/event/mlb", short: false, contracts: 40, avgPrice: 0.55, value: 25.2, cost: 22, pnl: 3.2, pnlPct: 14.5, realized: 0, expired: false };

describe("the positions board's data (#253)", () => {
  it("reads a live answer, dropping rows that don't fit and links off polymarket.us", () => {
    const got = readPositions({
      ok: true,
      state: "live",
      at: "2026-10-22T12:00:00Z",
      positions: [pos, { ...pos, url: "https://evil.example/x" }, { ...pos, value: "lots" }],
      activity: [{ at: "2026-10-21T00:00:00Z", kind: "trade", market: "Brewers win?", url: null, contracts: 3, price: 0.5 }, { at: "x", kind: "trade" }],
      totals: { open: 1, value: 25.2, cost: 22, pnl: 3.2 },
      more: false,
    });
    expect(got?.state).toBe("live");
    if (got?.state !== "live") return;
    expect(got.positions).toHaveLength(1);
    expect(got.activity).toHaveLength(1);
  });

  it("reads the waiting answer, and refuses anything else", () => {
    expect(readPositions({ ok: true, state: "waiting", reason: "no-key" })).toEqual({ ok: true, state: "waiting", reason: "no-key" });
    expect(readPositions({ ok: true, state: "live" })).toBeNull();
    expect(readPositions({ error: "signed-out" })).toBeNull();
  });

  it("writes money plainly", () => {
    expect(usd(1240.5)).toBe("$1,240.50");
    expect(usd(-12)).toBe("−$12.00");
    expect(signedUsd(3.2)).toBe("+$3.20");
    expect(signedUsd(-2)).toBe("−$2.00");
    expect(signedUsd(0.001)).toBe("$0.00");
    expect(signedPct(14.54)).toBe("+14.5%");
    expect(signedPct(null)).toBe("–");
    expect(cents(0.55)).toBe("55¢");
  });

  it("puts the book's state on the tape in words, never a figure", () => {
    for (const s of ["idle", "signed-out", "off", "waiting", "live", "failed"] as const) expect(bookLine(s).join(" ")).not.toMatch(/\d/);
    expect(bookLine("waiting")[0]).toBe("waiting for the key");
  });
});

describe("the positions poll's teardown (#451)", () => {
  const original = usePositions.getState().refresh;
  const refresh = vi.fn(async () => {});
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { search: "" }, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval });
    vi.stubGlobal("document", { visibilityState: "visible" });
    refresh.mockClear();
    usePositions.setState({ refresh });
  });
  afterEach(() => {
    usePositions.setState({ refresh: original });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("polls while started, keeps polling until the last starter stops, then goes quiet and can start again", () => {
    const stopA = startPositions();
    expect(refresh).toHaveBeenCalledTimes(1);
    const stopB = startPositions();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    stopA();
    stopA(); // a second call from the same starter changes nothing
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    stopB();
    vi.advanceTimersByTime(600_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    useDeskAuth.setState({ auth: { status: "out" } as never });
    expect(refresh).toHaveBeenCalledTimes(3);

    const stopC = startPositions();
    expect(refresh).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    stopC();
    vi.advanceTimersByTime(600_000);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("returns a no-op stop on offline pages", () => {
    vi.stubGlobal("window", { location: { search: "?offline" }, setInterval, clearInterval });
    const stop = startPositions();
    stop();
    expect(refresh).not.toHaveBeenCalled();
  });
});
