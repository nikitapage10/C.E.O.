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

/**
 * What a world-moving market is about (#345): the Bookie's asides cover geopolitics, US and world politics and pop
 * culture, never sports.
 */
export type PmWorldKind = "geopolitics" | "politics" | "culture";
export const PM_WORLD_KINDS: readonly PmWorldKind[] = ["geopolitics", "politics", "culture"];

/** A market that moves the world, for the Bookie's asides (#345): a board market plus what it's about. */
export interface PmWorld extends PmMarket {
  kind: PmWorldKind;
}

export interface PmBoard {
  ok: true;
  /** When the server read Polymarket (ISO). */
  at: string;
  /** The busiest open markets by 24-hour volume. */
  top: PmMarket[];
  /** The pinned markets, in pin order. */
  watch: PmMarket[];
  /**
   * World-moving markets for the Bookie's asides (#345): geopolitics, politics and pop culture picked by volume and the
   * day's move, sports left out. Empty while that read hasn't answered: the asides then say they're waiting.
   */
  world: PmWorld[];
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
export const PM_WORLD_MAX = 6;


/* ── Nikita's own positions (#253): read-only, from his Polymarket US account, only to a signed-in Desk ── */

/** One position, as the Desk's private positions board shows it. Text came from Polymarket: drawn as text only. */
export interface PmPosition {
  /** The market's title, plain text, trimmed. */
  market: string;
  /** The outcome the contracts are on ("Yes", "Brewers"). */
  outcome: string;
  /** The event's page on polymarket.us, built from a checked slug; null when there is none. */
  url: string | null;
  /** Short (a negative net position): on Polymarket US that is the other side of the outcome. */
  short: boolean;
  /** Contracts held (the size of the net position, always positive here). */
  contracts: number;
  /** Average cost per contract, 0..1; null when it can't be worked out. */
  avgPrice: number | null;
  /** What the position is worth now, in dollars (Polymarket US's cash value). */
  value: number;
  /** Its cost basis, in dollars. */
  cost: number;
  /** Unrealised profit or loss, in dollars (value − cost). */
  pnl: number;
  /** The same as a percentage of the cost; null when the cost is nothing. */
  pnlPct: number | null;
  /** Profit or loss already taken on this market, in dollars. */
  realized: number;
  /** The market has expired (settling or settled). */
  expired: boolean;
}

/** One line of recent activity: a fill or a settlement. Deposits and withdrawals are never read. No ids are kept. */
export interface PmTrade {
  /** When (ISO). */
  at: string;
  /** "voided" is a fill the exchange busted afterwards: shown, struck through, never counted. */
  kind: "trade" | "settled" | "voided";
  market: string;
  url: string | null;
  /** Contracts moved (0 when Polymarket doesn't say). */
  contracts: number;
  /** Price per contract, 0..1; null when there is none. */
  price: number | null;
}

export interface PmTotals {
  /** Open positions counted. */
  open: number;
  /** What they're worth now, what they cost, and the difference, in dollars. */
  value: number;
  cost: number;
  pnl: number;
}

/**
 * GET /api/exchange-positions, signed in with the Desk passkey. "waiting" until the Polymarket US key is set (or while
 * it can't be read). Nothing about the key is ever sent to the browser.
 */
export type PmPositions =
  | { ok: true; state: "waiting"; reason: "no-key" | "bad-key" }
  | {
      ok: true;
      state: "live";
      /** When the server read Polymarket US (ISO). */
      at: string;
      /** Open positions, largest first. */
      positions: PmPosition[];
      /** Newest first. */
      activity: PmTrade[];
      totals: PmTotals;
      /** More positions than the board reads (PM_POS_MAX); the totals cover only those read. */
      more: boolean;
      /** True when Polymarket US didn't answer and this is the last good read. */
      stale?: boolean;
    };

export const PM_POS_MAX = 100;
export const PM_TRADES_MAX = 12;
