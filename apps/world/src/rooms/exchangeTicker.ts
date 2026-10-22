import { moveTone, pct, type PmMarket } from "../desk/exchange/polymarket.ts";

/**
 * The ticker ring reads Polymarket's live public odds (#253, the board's own feed: apps/world/src/desk/exchange/
 * polymarket.ts): the busiest open markets, each with its odds and the day's move. Public market data only; nothing
 * from Nikita's own positions ever reaches the Lattice. Until the feed answers, the ring says so instead of making odds up.
 */
export function tickerChunks(top: readonly PmMarket[]): string[] {
  if (!top.length) return ["POLYMARKET · READING THE ODDS", "THE BOOKIE IS SWEATING ANYWAY"];
  return top.map((m) => {
    const q = m.question.toUpperCase().replace(/\?$/, "");
    const name = q.length > 46 ? `${q.slice(0, 45).trimEnd()}…` : q;
    const tone = moveTone(m.change24h);
    const pts = m.change24h === null ? "" : Math.round(Math.abs(m.change24h) * 100);
    return `${name}  ${pct(m.prob)} ${tone === "up" ? `▲${pts}` : tone === "down" ? `▼${pts}` : "—"}`;
  });
}
