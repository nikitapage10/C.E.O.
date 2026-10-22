/**
 * The email agent's own Claude cap (#263; Nikita, 2026-10-22: "let's start with a 10 dollars a month cap"): separate
 * from the world's, Skippy's and Rivet's, set by EMAIL_BUDGET_USD ($10 by default), and kept in its own month ledger
 * inside the sealed state. Every call's cost comes from the response's own `usage`, priced from the one table below.
 *
 * A call goes out only while this month's spend plus that call at its most stays within the cap. Past it the agent
 * pauses: it keeps checking Gmail every minute and counting new mail (no Claude), and the Desk says "Email agent
 * paused: monthly cap reached" until the month turns.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { monthOf } from "../_world/budget.js";
import type { EmailMonth, EmailState } from "./types.js";

/** Dialtone sorts every new mail on Haiku; Blasto advises and drafts on Sonnet, for needs-you mail only. */
export const SORT_MODEL = "claude-haiku-5-5";
export const ADVISE_MODEL = "claude-sonnet-5-5";
export type EmailModel = typeof SORT_MODEL | typeof ADVISE_MODEL;

export interface ModelPrice {
  /** Dollars per million tokens. */
  input: number;
  output: number;
  /** Prompts above `longFrom` tokens bill at these rates (Haiku 5.5 only; the others have no long-context premium). */
  longInput: number;
  longOutput: number;
  longFrom: number;
  /** Cache writes and reads, as multiples of the input rate. */
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Per-MTok prices, the one table (Anthropic's model catalogue, October 2026): Haiku 5.5 $0.10 in / $0.50 out up to
 * 100K prompt tokens ($0.50 / $2.50 above), Sonnet 5.5 $2 / $10. Cache writes 1.25x input, reads 0.1x.
 */
export const PRICES: Record<EmailModel, ModelPrice> = {
  [SORT_MODEL]: { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5, longFrom: 100_000, cacheWrite: 1.25, cacheRead: 0.1 },
  [ADVISE_MODEL]: { input: 2, output: 10, longInput: 2, longOutput: 10, longFrom: Infinity, cacheWrite: 1.25, cacheRead: 0.1 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** What one call cost, in dollars, from its own usage. */
export function costFor(model: EmailModel, usage: Usage): number {
  const p = PRICES[model];
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const long = usage.input_tokens + write + read > p.longFrom;
  const inRate = long ? p.longInput : p.input;
  const outRate = long ? p.longOutput : p.output;
  return (usage.input_tokens * inRate + write * inRate * p.cacheWrite + read * inRate * p.cacheRead + usage.output_tokens * outRate) / 1_000_000;
}

/** The most input a call can send (the prompt, the instructions and one trimmed mail), and its max_tokens. */
export const MAX_INPUT_TOKENS = 4_000;
export const SORT_MAX_TOKENS = 400;
export const ADVISE_MAX_TOKENS = 1_200;

/** One call at its most: the ceiling checked before it goes out. */
export const CEILING: Record<EmailModel, number> = {
  [SORT_MODEL]: costFor(SORT_MODEL, { input_tokens: MAX_INPUT_TOKENS, output_tokens: SORT_MAX_TOKENS }),
  [ADVISE_MODEL]: costFor(ADVISE_MODEL, { input_tokens: MAX_INPUT_TOKENS, output_tokens: ADVISE_MAX_TOKENS }),
};

export const DEFAULT_EMAIL_BUDGET_USD = 10;

/** EMAIL_BUDGET_USD, or $10; never negative. */
export function emailBudget(env: string | undefined): number {
  const n = Number(env);
  return env !== undefined && env.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_EMAIL_BUDGET_USD;
}

const EMPTY: EmailMonth = { usd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };

export const monthSpend = (state: Pick<EmailState, "spend">, now: number): EmailMonth => ({ ...EMPTY, ...state.spend[monthOf(now)] });

/** Whether one more call on `model` fits under the cap this month. The hard stop. */
export function canSpend(state: Pick<EmailState, "spend">, model: EmailModel, budget: number, now: number): boolean {
  return monthSpend(state, now).usd + CEILING[model] <= budget;
}

/** The state with one call's cost added to this month (and months older than a year dropped). */
export function addSpend<T extends Pick<EmailState, "spend">>(state: T, model: EmailModel, usage: Usage, now: number): T {
  const month = monthOf(now);
  const m = monthSpend(state, now);
  const tokensIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const next = { usd: m.usd + costFor(model, usage), calls: m.calls + 1, tokensIn: m.tokensIn + tokensIn, tokensOut: m.tokensOut + usage.output_tokens };
  const spend: Record<string, EmailMonth> = {};
  for (const [k, v] of Object.entries(state.spend)) if (k >= monthOf(now - 365 * 86_400_000)) spend[k] = v;
  spend[month] = next;
  return { ...state, spend };
}

/** The month's spend as a whole percentage of the cap (100 when the cap is 0). */
export function budgetPct(state: Pick<EmailState, "spend">, budget: number, now: number): number {
  if (budget <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((monthSpend(state, now).usd / budget) * 100)));
}
