/**
 * The Commentator's call under the month's Claude cap (#276). C.E.O.'s Claude API is capped at $10 a month
 * (api/_skippy/budget.ts, CLAUDE_CAP_USD): the world step takes its share, Skippy's chat its own, Rivet's shaping keeps
 * a reserve. The Green's weekly analysis is one Haiku call (about a tenth of a cent), so it gets a small share,
 * GREEN_BUDGET_USD ($0.25 by default), and a call goes out only while
 *
 *   green this month + one call at its most                         <= the Green's share, and
 *   world + Skippy + green this month + one call at its most        <= $10 - the shaping reserve.
 *
 * Its ledger lives beside Skippy's in the private blob store (`desk/green/spend.json`), priced by `costOf` from the one
 * Haiku table (api/foundry.ts). Past the cap the Commentator writes from the numbers alone (scripted), for free.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { SHAPE_PRICE } from "../foundry.js";
import { CLAUDE_CAP_USD, SHAPING_RESERVE_USD } from "../_skippy/budget.js";

export const GREEN_SPEND_PATH = "desk/green/spend.json";
export const GREEN_BUDGET_USD = 0.25;

/** The most one call can take: the numbers (capped at 9k tokens of input) and max_tokens out. */
export const GREEN_MAX_INPUT_TOKENS = 9_000;
export const GREEN_MAX_TOKENS = 1_400;
export const GREEN_CEILING_USD = (GREEN_MAX_INPUT_TOKENS * SHAPE_PRICE.input + GREEN_MAX_TOKENS * SHAPE_PRICE.output) / 1_000_000;

/** GREEN_BUDGET_USD from the environment, else $0.25; never negative, never past the cap. */
export function greenBudget(env: string | undefined): number {
  const n = Number(env);
  const asked = env !== undefined && env.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : GREEN_BUDGET_USD;
  return Math.min(asked, CLAUDE_CAP_USD - SHAPING_RESERVE_USD);
}

/** Whether one more call fits, under the Green's share and under the shared cap with everything else this month. */
export function canGreen(green: number, others: number, budget: number): boolean {
  return green + GREEN_CEILING_USD <= budget && others + green + GREEN_CEILING_USD <= CLAUDE_CAP_USD - SHAPING_RESERVE_USD;
}
