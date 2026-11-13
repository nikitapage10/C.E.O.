/**
 * What one AI call cost, by its model's list price (#1142, the Tokenomics tab). The ledger's dollars are an estimate
 * from the tokens each answer reports; the providers' own daily totals (./admin.ts) are the truth it is checked
 * against. The prices are the ones the callers already use for their caps, kept in one place here:
 *
 *   Claude   api/_skippy/budget.ts (Haiku, Sonnet and Opus), cache writes 1.25x input (5 minutes) or 2x (1 hour), reads
 *            0.1x; the Message Batches API half price; web search $10 per 1,000.
 *   Gemini   api/_skippy/gemini.ts (in and out per million, and each grounded search).
 *   OpenAI   api/_haven/photoGen.ts (the 2.6 image models by token) and the Green's second opinion (gpt-4.1-mini).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

// Copied, not imported: the callers import this module, and importing them back would make a cycle at load time.
// prices.test.ts holds the copies equal to the originals.
export const HAIKU_PRICE = { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5, longFrom: 100_000, cacheRead: 0.1 } as const;
export const SONNET_PRICE = { input: 2, output: 10, longInput: 2, longOutput: 10, longFrom: 1_000_000, cacheRead: 0.1 } as const;
export const OPUS_PRICE = { input: 4, output: 20, longInput: 4, longOutput: 20, longFrom: 1_000_000, cacheRead: 0.05 } as const;
export const SEARCH_USD = 0.01;
/** Gemini, dollars per million tokens (in, out) by model prefix, and per grounded search. */
export const GEMINI_RATES: { prefix: string; in: number; out: number }[] = [
  { prefix: "gemini-4-argon", in: 4, out: 20 },
  { prefix: "gemini-3.8-flash", in: 1.5, out: 7.5 },
];
export const GEMINI_SEARCH_USD = 0.014;

export type Provider = "anthropic" | "google" | "openai";

/** The token counts one call reports, split the way each provider bills them. */
export interface Tokens {
  /** Input not read from or written to a cache. */
  tokensIn: number;
  tokensOut: number;
  /** Input written to the prompt cache (Claude: the 5-minute part; `cacheWrite1h` the hour-long part). */
  cacheWrite: number;
  cacheWrite1h?: number;
  /** Input read back from a cache (Claude's cache reads, Gemini's cached content, OpenAI's cached input). */
  cacheRead: number;
  /** Server-side web searches. */
  searches: number;
}

interface ClaudePrice {
  input: number;
  output: number;
  longInput: number;
  longOutput: number;
  longFrom: number;
  cacheRead: number;
}

/** A Claude model's price from its id's family; Sonnet's when the family is unknown. */
export function claudePrice(model: string): ClaudePrice {
  const m = model.toLowerCase();
  return m.includes("haiku") ? HAIKU_PRICE : m.includes("opus") ? OPUS_PRICE : SONNET_PRICE;
}

/** OpenAI's prices we know, in dollars per million tokens (in, cached in, out). */
const OPENAI_PRICE: { match: RegExp; in: number; cached: number; out: number }[] = [
  // The 2.6 image models (api/_haven/photoGen.ts): $5 per million text in, $30 per million image tokens out.
  { match: /^gpt-image/, in: 5, cached: 1.25, out: 30 },
  { match: /^gpt-4\.1-mini/, in: 0.4, cached: 0.1, out: 1.6 },
  { match: /^gpt-4\.1-nano/, in: 0.1, cached: 0.025, out: 0.4 },
  { match: /^gpt-4\.1/, in: 2, cached: 0.5, out: 8 },
];

const per = (tokens: number, rate: number) => (tokens * rate) / 1_000_000;

/** What one call cost in dollars, at list price. `batch`: the Message Batches API, half price. Unknown models cost 0. */
export function priceCall(provider: Provider, model: string, t: Tokens, batch = false): number {
  if (provider === "anthropic") {
    const p = claudePrice(model);
    const w1h = t.cacheWrite1h ?? 0;
    const long = t.tokensIn + t.cacheWrite + w1h + t.cacheRead > p.longFrom;
    const inRate = long ? p.longInput : p.input;
    const outRate = long ? p.longOutput : p.output;
    const tokens = per(t.tokensIn, inRate) + per(t.cacheWrite, inRate * 1.25) + per(w1h, inRate * 2) + per(t.cacheRead, inRate * p.cacheRead) + per(t.tokensOut, outRate);
    return (batch ? tokens / 2 : tokens) + t.searches * SEARCH_USD;
  }
  if (provider === "google") {
    const p = GEMINI_RATES.find((r) => model.startsWith(r.prefix)) ?? (model.startsWith("gemini") ? GEMINI_RATES[1] : undefined);
    if (!p) return 0;
    // Gemini bills cached content at a quarter of the input rate.
    return per(t.tokensIn, p.in) + per(t.cacheRead, p.in / 4) + per(t.tokensOut, p.out) + t.searches * GEMINI_SEARCH_USD;
  }
  const p = OPENAI_PRICE.find((x) => x.match.test(model));
  if (!p) return 0;
  const total = per(t.tokensIn, p.in) + per(t.cacheRead, p.cached) + per(t.tokensOut, p.out);
  return batch ? total / 2 : total;
}
