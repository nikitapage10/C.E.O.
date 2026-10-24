/**
 * Polymarket's public market data, read-only (#240; docs.polymarket.com, "API"): no key, no wallet, no trading.
 *
 *   Gamma  https://gamma-api.polymarket.com/markets    the busiest open markets (order=volume24hr), or markets by id
 *                                                      or slug; /events?slug= for an event link
 *          /markets?tag_id=…&include_tag=true          world-moving markets by topic, with their tags (#345)
 *   CLOB   https://clob.polymarket.com/prices-history  one day of an outcome token's prices, for the sparkline
 *
 * Everything that comes back is untrusted: each market is rebuilt from scratch with only the fields the board shows,
 * numbers range-checked, text stripped of control and direction characters and cut short, links rebuilt from a checked
 * slug, and answers past a size cap refused.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { PM_SPARK_MAX, PM_TEXT_MAX, PM_TOP_MAX, PM_WATCH_MAX, PM_WORLD_MAX, type PmMarket, type PmWorld, type PmWorldKind } from "./types.js";

export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB = "https://clob.polymarket.com";

/** How many markets to ask for before filtering down to PM_TOP_MAX. */
const TOP_ASK = 40;
/** A market this sure is all but decided; the top board skips it (a pinned one still shows). */
const DECIDED = 0.01;
/** At most this many of one event's markets on the top board, so one election doesn't fill it. */
const PER_EVENT = 2;
/** Upstream answers past this are refused (a full top read is about 0.3 MB). */
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 6000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const ID = /^\d{1,12}$/;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;
const TOKEN = /^\d{1,90}$/;

/** Plain, short text: no control, zero-width or direction characters, whitespace collapsed. */
export function cleanText(v: unknown, max = PM_TEXT_MAX): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Gamma sends some lists as JSON in a string ('["Yes", "No"]'). */
function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const got: unknown = JSON.parse(v);
    return Array.isArray(got) ? got : [];
  } catch {
    return [];
  }
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Raw Gamma market, as far as we read it. */
type Raw = Record<string, unknown>;

/** The outcome token the odds are for (the first), checked; server side only, never sent to the browser. */
export function tokenOf(raw: Raw): string | null {
  const t = list(raw.clobTokenIds)[0];
  return typeof t === "string" && TOKEN.test(t) ? t : null;
}

/** The slug of the market's event, else its own: polymarket.com/event/<slug> opens either. */
function slugOf(raw: Raw): string | null {
  const events = Array.isArray(raw.events) ? (raw.events as Raw[]) : [];
  for (const s of [events[0]?.slug, raw.slug]) if (typeof s === "string" && SLUG.test(s)) return s;
  return null;
}

/** Rebuilds one market from Gamma's answer with only the board's fields; null when it can't be read. */
export function shapeMarket(raw: unknown): (PmMarket & { token: string | null; event: string | null }) | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Raw;
  const id = typeof r.id === "string" || typeof r.id === "number" ? String(r.id) : "";
  if (!ID.test(id)) return null;
  const question = cleanText(r.question);
  const prob = num(list(r.outcomePrices)[0]);
  if (!question || prob === null || prob < 0 || prob > 1) return null;
  const change = num(r.oneDayPriceChange);
  const end = typeof r.endDate === "string" && Number.isFinite(Date.parse(r.endDate)) ? new Date(Date.parse(r.endDate)).toISOString() : null;
  const slug = slugOf(r);
  const events = Array.isArray(r.events) ? (r.events as Raw[]) : [];
  const event = events[0] && (typeof events[0].id === "string" || typeof events[0].id === "number") ? String(events[0].id) : null;
  return {
    id,
    question,
    outcome: cleanText(list(r.outcomes)[0], 40) || "Yes",
    prob: round(prob, 4),
    change24h: change !== null && change >= -1 && change <= 1 ? round(change, 4) : null,
    volume24h: Math.max(0, Math.round(num(r.volume24hr) ?? 0)),
    volume: Math.max(0, Math.round(num(r.volumeNum) ?? num(r.volume) ?? 0)),
    endDate: end,
    url: slug ? `https://polymarket.com/event/${slug}` : null,
    closed: r.closed === true || r.active === false,
    spark: [],
    token: tokenOf(r),
    event,
  };
}

/** The top board: open, not yet due, not all but decided, busiest first, at most PER_EVENT from one event. */
export function pickTop(raws: unknown, now: number): ReturnType<typeof shapeMarket>[] {
  const all = (Array.isArray(raws) ? raws : []).map(shapeMarket).filter((m): m is NonNullable<typeof m> => m !== null);
  const open = all.filter((m) => !m.closed && (!m.endDate || Date.parse(m.endDate) > now) && m.prob >= DECIDED && m.prob <= 1 - DECIDED);
  open.sort((a, b) => b.volume24h - a.volume24h);
  const per = new Map<string, number>();
  const out: NonNullable<ReturnType<typeof shapeMarket>>[] = [];
  for (const m of open) {
    const key = m.event ?? m.id;
    const n = per.get(key) ?? 0;
    if (n >= PER_EVENT) continue;
    per.set(key, n + 1);
    out.push(m);
    if (out.length >= PM_TOP_MAX) break;
  }
  return out;
}

/** A day of prices, thinned to PM_SPARK_MAX points in 0..1. */
export function sparkOf(body: unknown): number[] {
  const hist = body && typeof body === "object" && Array.isArray((body as { history?: unknown }).history) ? ((body as { history: unknown[] }).history) : [];
  const ps = hist.map((h) => num(h && typeof h === "object" ? (h as { p?: unknown }).p : null)).filter((p): p is number => p !== null && p >= 0 && p <= 1);
  if (ps.length <= PM_SPARK_MAX) return ps.map((p) => round(p, 4));
  const step = (ps.length - 1) / (PM_SPARK_MAX - 1);
  return Array.from({ length: PM_SPARK_MAX }, (_, i) => round(ps[Math.round(i * step)]!, 4));
}

/** GET a JSON answer from Polymarket, with a timeout and a size cap. */
export async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const res = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new Error(`polymarket ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new Error("polymarket answer too big");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("polymarket answer too big");
  return JSON.parse(text) as unknown;
}

export const topUrl = () => `${GAMMA}/markets?limit=${TOP_ASK}&active=true&closed=false&order=volume24hr&ascending=false`;
export const byIdsUrl = (ids: string[]) => `${GAMMA}/markets?${ids.map((id) => `id=${id}`).join("&")}`;
export const historyUrl = (token: string) => `${CLOB}/prices-history?market=${token}&interval=1d&fidelity=30`;

/** The sparkline for a market; empty on any failure (the board just draws no line). */
export async function sparkFor(fetcher: Fetcher, token: string | null): Promise<number[]> {
  if (!token) return [];
  try {
    return sparkOf(await getJson(fetcher, historyUrl(token)));
  } catch {
    return [];
  }
}

/** Drops the server-only fields, adds the sparkline, and fills a missing 24-hour move from it. */
export function forBoard(m: NonNullable<ReturnType<typeof shapeMarket>>, spark: number[]): PmMarket {
  const { token: _t, event: _e, ...rest } = m;
  void _t;
  void _e;
  const change24h = rest.change24h ?? (spark.length >= 2 ? round(spark[spark.length - 1]! - spark[0]!, 4) : null);
  return { ...rest, spark, change24h };
}

export async function readTop(fetcher: Fetcher, now: number): Promise<PmMarket[]> {
  const top = pickTop(await getJson(fetcher, topUrl()), now).filter((m): m is NonNullable<typeof m> => m !== null);
  return Promise.all(top.map(async (m) => forBoard(m, await sparkFor(fetcher, m.token))));
}

/** The pinned markets, in pin order. Ids Polymarket doesn't list are left out. */
export async function readWatch(fetcher: Fetcher, ids: string[]): Promise<PmMarket[]> {
  const want = ids.filter((id) => ID.test(id)).slice(0, PM_WATCH_MAX);
  if (!want.length) return [];
  const got = (list(await getJson(fetcher, byIdsUrl(want))) as unknown[]).map(shapeMarket).filter((m): m is NonNullable<typeof m> => m !== null);
  const byId = new Map(got.map((m) => [m.id, m]));
  const ordered = want.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => m !== undefined);
  return Promise.all(ordered.map(async (m) => forBoard(m, await sparkFor(fetcher, m.token))));
}

/**
 * What a pin names: a market id, a market or event slug, or a polymarket.com link to either. Returns the slug or id to
 * look up, or null when it is none of those.
 */
export function parseRef(ref: unknown): { id: string } | { slug: string } | null {
  if (typeof ref !== "string") return null;
  const t = ref.trim();
  if (ID.test(t)) return { id: t };
  let path = t;
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return null;
    }
    if (u.hostname !== "polymarket.com" && u.hostname !== "www.polymarket.com") return null;
    path = u.pathname;
  }
  const parts = path.split("/").filter(Boolean);
  const slug = (parts.length >= 2 && (parts[0] === "event" || parts[0] === "market") ? parts[parts.length - 1] : parts.length === 1 ? parts[0] : undefined)?.toLowerCase();
  return slug && SLUG.test(slug) ? { slug } : null;
}

/** Finds the market a pin names: by id, by market slug, else the busiest open market of the event with that slug. */
export async function resolveRef(fetcher: Fetcher, ref: unknown): Promise<string | null> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  if ("id" in parsed) {
    const got = list(await getJson(fetcher, byIdsUrl([parsed.id]))).map(shapeMarket);
    return got.some((m) => m?.id === parsed.id) ? parsed.id : null;
  }
  const bySlug = list(await getJson(fetcher, `${GAMMA}/markets?slug=${parsed.slug}`)).map(shapeMarket).find((m) => m !== null);
  if (bySlug) return bySlug.id;
  const events = list(await getJson(fetcher, `${GAMMA}/events?slug=${parsed.slug}`));
  const first = events[0] && typeof events[0] === "object" ? (events[0] as Raw) : null;
  const markets = (Array.isArray(first?.markets) ? (first.markets as unknown[]) : []).map(shapeMarket).filter((m): m is NonNullable<typeof m> => m !== null);
  const open = markets.filter((m) => !m.closed);
  return [...(open.length ? open : markets)].sort((a, b) => b.volume24h - a.volume24h)[0]?.id ?? null;
}


/* ── world-moving markets, for the Bookie's asides (#345) ── */

/**
 * Polymarket's topic tags the asides read, in priority order (a market under two of them takes the first): Geopolitics,
 * Politics and Culture ("pop-culture"). Ids from gamma-api.polymarket.com/tags/slug/<slug>.
 */
export const WORLD_TAGS: readonly { kind: PmWorldKind; id: string }[] = [
  { kind: "geopolitics", id: "100265" },
  { kind: "politics", id: "2" },
  { kind: "culture", id: "596" },
];
/** How many of each topic's busiest markets to ask for before picking. */
const WORLD_ASK = 30;
/** A market quieter than this on the day is too thin for its move to mean much. */
export const WORLD_MIN_VOL = 5_000;
/** Odds this close to settled say nothing new. */
const WORLD_DECIDED = 0.03;

/** Nikita doesn't want sports in the asides: any of these tags, or a league in the question, rules a market out. */
const SPORTS_TAGS = new Set([
  "sports", "nfl", "nba", "wnba", "mlb", "nhl", "mls", "soccer", "football", "basketball", "baseball", "hockey", "tennis", "golf", "ufc", "mma",
  "boxing", "f1", "formula-1", "formula1", "nascar", "cricket", "esports", "epl", "premier-league", "champions-league", "ucl", "la-liga",
  "serie-a", "bundesliga", "ligue-1", "ncaa", "ncaab", "ncaaf", "cfb", "cbb", "college-football", "college-basketball", "march-madness",
  "olympics", "world-cup", "fifa-world-cup", "fifa", "super-bowl", "nba-finals", "stanley-cup", "world-series", "wimbledon", "chess", "games",
]);
const SPORTS_WORDS = /\b(NFL|NBA|WNBA|MLB|NHL|MLS|UFC|FIFA|UEFA|NCAA|F1|Formula 1|Premier League|Champions League|Super Bowl|World Series|Stanley Cup|Grand Slam|Wimbledon|Olympics?|World Cup|playoffs?|touchdowns?|Ballon d'Or)\b/i;
/** Busy but not news: tweet counts, "mention" markets, crypto up-or-down candles. */
const NOISE_TAGS = new Set(["recurring", "tweets-markets", "mention-markets", "mentions", "up-or-down", "crypto-prices", "crypto", "weather"]);

/** The slugs of a market's tags (asked for with include_tag=true); server side only. */
export function tagsOf(raw: unknown): string[] {
  const tags = raw && typeof raw === "object" && Array.isArray((raw as Raw).tags) ? ((raw as Raw).tags as unknown[]) : [];
  return tags.map((t) => (t && typeof t === "object" ? (t as Raw).slug : null)).filter((s): s is string => typeof s === "string" && SLUG.test(s));
}

/** Sports, or noise, by its tags or its question. */
export function isOffTopic(question: string, tags: readonly string[]): boolean {
  return tags.some((t) => SPORTS_TAGS.has(t) || NOISE_TAGS.has(t)) || SPORTS_WORDS.test(question);
}

export const worldUrl = (tagId: string) => `${GAMMA}/markets?limit=${WORLD_ASK}&active=true&closed=false&order=volume24hr&ascending=false&tag_id=${tagId}&include_tag=true`;

/** How much a market is worth an aside: a big day's move on a busy market beats a busy market sitting still. */
export function worldScore(m: Pick<PmMarket, "volume24h" | "change24h">): number {
  return Math.sqrt(m.volume24h) * (0.02 + Math.abs(m.change24h ?? 0));
}

type Shaped = NonNullable<ReturnType<typeof shapeMarket>>;

/**
 * Picks the asides from each topic's answer (in WORLD_TAGS order; a topic that didn't answer is null): open, not near
 * settled, busy enough, not sports, one market per event, the best of each topic first so all three get a turn, then
 * the rest by score.
 */
export function pickWorld(answers: readonly (unknown[] | null)[], now: number): (Shaped & { kind: PmWorldKind })[] {
  const seen = new Set<string>();
  const byKind: (Shaped & { kind: PmWorldKind })[][] = WORLD_TAGS.map(({ kind }, i) => {
    const out: (Shaped & { kind: PmWorldKind })[] = [];
    for (const raw of answers[i] ?? []) {
      const m = shapeMarket(raw);
      if (!m || seen.has(m.id)) continue;
      if (m.closed || (m.endDate && Date.parse(m.endDate) <= now)) continue;
      if (m.prob < WORLD_DECIDED || m.prob > 1 - WORLD_DECIDED || m.volume24h < WORLD_MIN_VOL) continue;
      if (isOffTopic(m.question, tagsOf(raw))) continue;
      seen.add(m.id);
      out.push({ ...m, kind });
    }
    return out.sort((a, b) => worldScore(b) - worldScore(a));
  });
  const events = new Set<string>();
  const picked: (Shaped & { kind: PmWorldKind })[] = [];
  const take = (m: Shaped & { kind: PmWorldKind }) => {
    const key = m.event ?? m.id;
    if (events.has(key) || picked.length >= PM_WORLD_MAX) return;
    events.add(key);
    picked.push(m);
  };
  for (const list of byKind) if (list[0]) take(list[0]);
  for (const m of byKind.flat().sort((a, b) => worldScore(b) - worldScore(a))) take(m);
  return picked;
}

/** The asides' markets, with sparklines. Throws only when no topic answered. */
export async function readWorld(fetcher: Fetcher, now: number): Promise<PmWorld[]> {
  const got = await Promise.allSettled(WORLD_TAGS.map(({ id }) => getJson(fetcher, worldUrl(id))));
  if (got.every((g) => g.status === "rejected")) throw new Error("polymarket world: no answer");
  const answers = got.map((g) => (g.status === "fulfilled" ? list(g.value) : null));
  const picked = pickWorld(answers, now);
  return Promise.all(picked.map(async (m) => ({ ...forBoard(m, await sparkFor(fetcher, m.token)), kind: m.kind })));
}
