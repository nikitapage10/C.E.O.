import { describe, expect, it } from "vitest";
import { bookWord, hallBook, hallHoldings, hallPosts, hallStatus, hallView, HOLDINGS, POSTS, shareWord, withHoldings } from "./hall.ts";
import type { PmPosition } from "./positions.ts";
import type { PmBoard, PmMarket } from "./polymarket.ts";

const M = (id: string, prob: number, change24h: number | null, volume24h = 1e6, closed = false): PmMarket => ({ id, question: `Will thing ${id} happen by December 31, 2026?`, outcome: "Yes", prob, change24h, volume24h, volume: volume24h * 10, endDate: null, url: null, closed, spark: [] });
const board = (top: PmMarket[], stale = false): PmBoard => ({ ok: true, at: "2026-11-06T06:00:00Z", top, world: [], watch: [], watchlist: [], canPin: false, ...(stale && { stale: true }) });

describe("the trade floor (#823)", () => {
  it("puts the busiest open markets on the posts, in order, each with its share of the day's money", () => {
    const posts = hallPosts(board([M("1", 0.62, 0.07, 4e6), M("2", 0.3, -0.03, 1e6), M("3", 0.5, 0, 2e6, true), M("4", 0.1, null, 2e6)]));
    expect(posts.map((p) => p.id)).toEqual(["1", "2", "4"]);
    expect(posts[0]).toMatchObject({ odds: "62%", move: "▲7", tone: "up", share: 1, name: "Will thing 1 happen" });
    expect(posts[1]).toMatchObject({ move: "▼3", tone: "down", share: 0.25 });
    expect(posts[2]).toMatchObject({ move: "", tone: "flat" });
  });

  it("has room for only so many posts, and none at all before Polymarket answers", () => {
    const many = Array.from({ length: 12 }, (_, i) => M(String(i + 1), 0.5, 0.01));
    expect(hallPosts(board(many))).toHaveLength(POSTS);
    expect(hallPosts(null)).toEqual([]);
  });

  it("says how the read stands", () => {
    expect(hallStatus("ready", board([]))).toBe("live");
    expect(hallStatus("ready", board([], true))).toBe("stale");
    expect(hallStatus("failed", null)).toBe("failed");
    expect(hallStatus("off", null)).toBe("off");
    expect(hallStatus("idle", null)).toBe("reading");
  });

  it("gives the book's kiosk a count only when it is live, never a figure", () => {
    expect(hallBook("live", 3)).toEqual({ state: "live", open: 3 });
    expect(hallBook("signed-out", 3)).toEqual({ state: "locked", open: null });
    expect(hallBook("waiting", null)).toEqual({ state: "waiting", open: null });
    expect(hallBook("failed", null)).toEqual({ state: "off", open: null });
    expect(bookWord({ state: "live", open: 1 })).toEqual(["1", "position open"]);
    expect(bookWord({ state: "live", open: 4 })).toEqual(["4", "positions open"]);
    expect(bookWord({ state: "locked", open: null })).toEqual(["Your book", "behind your passkey"]);
    const v = hallView({ status: "ready", board: board([M("1", 0.5, 0.02)]), posStatus: "live", open: 2, soon: [{ id: "soon-0", name: "The research desk", on: "Waiting on a price source" }] });
    expect(JSON.stringify(v)).not.toMatch(/\$/);
    expect(v.soon).toHaveLength(1);
    expect(v.tape.map((t) => t.id)).toEqual(["1"]);
  });

  // Made-up fixture sizes: plain numbers, only ever turned into shares.
  const P = (market: string, value: number, pnl: number, o: Partial<PmPosition> = {}): PmPosition => ({ market, outcome: "Yes", url: null, short: false, contracts: 1, avgPrice: 0.5, value, cost: value - pnl, pnl, pnlPct: null, realized: 0, expired: false, ...o });

  it("stands the open positions in the ring by their share of the book, biggest first, never a figure (#988)", () => {
    const { holds, more } = hallHoldings([P("Small one?", 10, -1), P("Will the big one happen by December 31, 2026?", 30, 2, { short: true, outcome: "Kings" }), P("Gone one?", 50, 0, { expired: true }), P("Flat one?", 10, 0)]);
    expect(holds.map((h) => h.name)).toEqual(["Will the big one happen", "Small one", "Flat one"]);
    expect(holds[0]).toMatchObject({ side: "Short Kings", share: 0.6, rel: 1, tone: "up" });
    expect(holds[1]).toMatchObject({ share: 0.2, rel: 1 / 3, tone: "down" });
    expect(holds[2]!.tone).toBe("flat");
    expect(more).toBe(0);
    expect(shareWord(0.6)).toBe("60%");
    expect(shareWord(0.001)).toBe("<1%");
    const many = Array.from({ length: HOLDINGS + 3 }, (_, i) => P(`M${i}?`, 1 + i, 0));
    expect(hallHoldings(many).holds).toHaveLength(HOLDINGS);
    expect(hallHoldings(many).more).toBe(3);
    expect(hallHoldings(null)).toEqual({ holds: [], more: 0 });
  });

  it("puts positions on the floor only when the book is live, and flattens their way while Hide is on (#988)", () => {
    const ps = [P("One?", 5, 1), P("Two?", 5, -1)];
    expect(withHoldings({ state: "locked", open: null }, ps, false).holds).toEqual([]);
    expect(withHoldings({ state: "waiting", open: null }, ps, false).holds).toEqual([]);
    const live = withHoldings({ state: "live", open: 2 }, ps, false);
    expect(live.holds!.map((h) => h.tone)).toEqual(["up", "down"]);
    const hidden = withHoldings({ state: "live", open: 2 }, ps, true);
    expect(hidden.hide).toBe(true);
    expect(hidden.holds!.map((h) => h.tone)).toEqual(["flat", "flat"]);
    const v = hallView({ status: "ready", board: board([]), posStatus: "signed-out", open: null, soon: [], positions: ps });
    expect(v.book.holds).toEqual([]);
    const on = hallView({ status: "ready", board: board([]), posStatus: "live", open: 2, soon: [], positions: ps });
    expect(on.book.holds).toHaveLength(2);
    expect(JSON.stringify(on)).not.toMatch(/\$|"value"|"pnl"|"cost"/);
  });
});
