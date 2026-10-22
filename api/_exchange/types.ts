/**
 * What the Exchange's Polymarket board reads (#240): public market data only, trimmed to the fields the board shows.
 * Shared by the function (api/_exchange/route.ts) and the Desk (apps/world/src/desk/exchange/polymarket.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

/** One market as the board shows it. Every string came from Polymarket: the Desk renders it as text, never as markup. */
export interface PmMarket {
  /** Polymarket's market id (Gamma), digits only. */
  id: string;
  /** The question, plain text, trimmed to PM_TEXT_MAX characters. */
  question: string;
  /** The outcome the odds are for: "Yes" on a yes/no market, else the first outcome ("Kings"). */
  outcome: string;
  /** That outcome's price, 0..1: the market's probability. */
  prob: number;
  /** How far the price moved in the last 24 hours, in probability points (-1..1); null when Polymarket doesn't say. */
  change24h: number | null;
  /** Dollars traded in the last 24 hours, and ever. */
  volume24h: number;
  volume: number;
  /** When the market is due to close (ISO), if it says. */
  endDate: string | null;
  /** The market's page on polymarket.com, built from a checked slug; null when there is none. */
  url: string | null;
  /** Closed or resolved: shown greyed on the watchlist, never on the top board. */
  closed: boolean;
  /** The last day's prices for the sparkline, oldest first, at most PM_SPARK_MAX points (empty when unknown). */
  spark: number[];
}

export interface PmBoard {
  ok: true;
  /** When the server read Polymarket (ISO). */
  at: string;
  /** The busiest open markets by 24-hour volume. */
  top: PmMarket[];
  /** The pinned markets, in pin order. */
  watch: PmMarket[];
  /** The pinned ids (a pinned market Polymarket no longer lists stays here until it is unpinned). */
  watchlist: string[];
  /** Whether pins can be saved here (the private store is connected). */
  canPin: boolean;
  /** True when Polymarket didn't answer and this is the last good read. */
  stale?: boolean;
}

/** POST /api/exchange-markets, signed in with the Desk passkey. `ref` is a market id, a slug or a polymarket.com link. */
export type PmWrite = { action: "pin"; ref: string } | { action: "unpin"; id: string };

export const PM_TOP_MAX = 10;
export const PM_WATCH_MAX = 8;
export const PM_TEXT_MAX = 160;
export const PM_SPARK_MAX = 48;
