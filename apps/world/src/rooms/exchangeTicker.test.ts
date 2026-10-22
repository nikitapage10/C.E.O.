import { describe, expect, it } from "vitest";
import type { PmMarket } from "../desk/exchange/polymarket.ts";
import { tickerChunks } from "./exchangeTicker.ts";

const m = (over: Partial<PmMarket>): PmMarket => ({ id: "1", question: "Fed cuts in December?", outcome: "Yes", prob: 0.63, change24h: 0.02, volume24h: 1, volume: 1, endDate: null, url: null, closed: false, spark: [], ...over });

describe("the Exchange room's ticker ring (#253)", () => {
  it("reads Polymarket's live odds and the day's move", () => {
    expect(tickerChunks([m({}), m({ question: "Rain in NYC on Saturday?", prob: 0.22, change24h: -0.04 }), m({ change24h: null })])).toEqual([
      "FED CUTS IN DECEMBER  63% ▲2",
      "RAIN IN NYC ON SATURDAY  22% ▼4",
      "FED CUTS IN DECEMBER  63% —",
    ]);
  });

  it("cuts long questions, and says it's waiting rather than making odds up", () => {
    expect(tickerChunks([m({ question: "x".repeat(90) })])[0]!.length).toBeLessThan(60);
    expect(tickerChunks([]).join(" ")).toContain("READING THE ODDS");
    expect(tickerChunks([]).join(" ")).not.toMatch(/%/);
  });
});
