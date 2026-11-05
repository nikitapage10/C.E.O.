import { describe, expect, it } from "vitest";
import { isPmMarket, money, move, moveTone, pct, pmLinkState, readBoard, sparkPath, tapeLine, type PmBoard, type PmMarket } from "./polymarket.ts";

const M: PmMarket = { id: "12", question: "Will it rain?", outcome: "Yes", prob: 0.42, change24h: 0.031, volume24h: 1_400_000, volume: 9_000_000, endDate: null, url: "https://polymarket.com/event/rain", closed: false, spark: [0.4, 0.42] };
const B: PmBoard = { ok: true, at: "2026-10-22T12:00:00.000Z", top: [M], world: [], watch: [], watchlist: [], canPin: true };

describe("the Exchange's Polymarket board, browser side", () => {
  it("reads the numbers the way the board says them", () => {
    expect(pct(0.42)).toBe("42%");
    expect(pct(0.004)).toBe("<1%");
    expect(pct(0.996)).toBe(">99%");
    expect(pct(0)).toBe("0%");
    expect(move(0.031)).toBe("+3.1");
    expect(move(-0.004)).toBe("−0.4");
    expect(move(0)).toBe("0.0");
    expect(move(null)).toBe("–");
    expect(moveTone(0.02)).toBe("up");
    expect(moveTone(-0.02)).toBe("down");
    expect(moveTone(null)).toBe("flat");
    expect(money(1_400_000)).toBe("$1.4M");
    expect(money(820_400)).toBe("$820K");
    expect(money(2_100_000_000)).toBe("$2.1B");
    expect(money(950)).toBe("$950");
  });

  it("draws a sparkline only with two points or more", () => {
    expect(sparkPath([0.5], 72, 22)).toBe("");
    const d = sparkPath([0.2, 0.4, 0.3], 72, 22);
    expect(d.startsWith("M0.0 ")).toBe(true);
    expect(d.split("L")).toHaveLength(3);
  });

  it("drops anything that isn't the board's shape, links to polymarket.com only", () => {
    expect(isPmMarket(M)).toBe(true);
    expect(isPmMarket({ ...M, url: "javascript:alert(1)" })).toBe(false);
    expect(isPmMarket({ ...M, url: "https://evil.example/event/x" })).toBe(false);
    expect(isPmMarket({ ...M, prob: 3 })).toBe(false);
    expect(isPmMarket({ ...M, id: "<b>" })).toBe(false);
    const got = readBoard({ ...B, top: [M, { ...M, id: "x" }], watchlist: ["1", "<x>"], extra: "ignored" })!;
    expect(got.top).toEqual([M]);
    expect(got.watchlist).toEqual(["1"]);
    expect(got).not.toHaveProperty("extra");
    expect(readBoard({ error: "upstream" })).toBeNull();
    expect(readBoard(null)).toBeNull();
  });

  it("says how the link stands, on Systems, in the Boiler Room and on the tape", () => {
    expect(pmLinkState("ready", B)).toBe("ok");
    expect(pmLinkState("ready", { ...B, stale: true })).toBe("slow");
    expect(pmLinkState("failed", B)).toBe("down");
    expect(pmLinkState("off", null)).toBe("off");
    expect(pmLinkState("idle", null)).toBe("off");
    expect(tapeLine("ready", B)).toBe("Polymarket live · 1 market");
    expect(tapeLine("failed", null)).toBe("Polymarket not answering");
    expect(tapeLine("off", null)).toBe("not connected");
  });
});
