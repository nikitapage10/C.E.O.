import { describe, expect, it } from "vitest";
import { bookWord, hallBook, hallPosts, hallStatus, hallView, POSTS } from "./hall.ts";
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
});
