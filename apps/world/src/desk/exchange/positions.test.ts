import { describe, expect, it } from "vitest";
import { bookLine, cents, readPositions, signedPct, signedUsd, usd } from "./positions.ts";

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
