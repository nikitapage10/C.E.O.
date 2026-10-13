/**
 * The world step's budget guard (docs/WORLD.md). Claude's API is capped at $10 a month for C.E.O., shared by idea
 * shaping (api/foundry.ts) and the hourly world step. The step keeps its own month total in the saved state, and stops
 * calling Claude once the month's world spend would pass WORLD_BUDGET_USD (default $6, which leaves $4 for shaping,
 * whose calls cost a fraction of a cent each). Past that, every hour is written from the scripted lines until the
 * month turns. A step costs about $0.002 (about $1.50 a month hourly), so the guard is a backstop, not a plan.
 */

import { costOf, SHAPE_PRICE, type Usage } from "../foundry.js";
import type { MonthTotals, StepCost, WorldState } from "./types.js";

/** The world's share of the month's Claude API cap, in dollars. */
export const WORLD_BUDGET_USD = 6;
/** The most one step can cost: its prompt (about 15k tokens, at most 40k) and its answer (max_tokens) at full price. */
export const STEP_CEILING_USD = (40_000 * SHAPE_PRICE.input * 2 + 3_000 * SHAPE_PRICE.output) / 1_000_000;

/** The step's usage, with the 1-hour cache writes broken out (they cost 2x input, not 1.25x). */
export interface StepUsage extends Usage {
  cache_creation?: { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null;
}

/** The world budget from the environment (WORLD_BUDGET_USD), else the default; never above the $10 cap. */
export function worldBudget(env: string | undefined): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 && env !== undefined && env !== "" ? Math.min(n, 10) : WORLD_BUDGET_USD;
}

/** "2026-10": the calendar month (UTC) a time falls in, as the API bills it. */
export function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

/** What a step's call cost, in dollars: as idea shaping counts it, plus the extra for 1-hour cache writes. */
export function stepCost(usage: StepUsage): StepCost {
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const tokensIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const inRate = tokensIn > SHAPE_PRICE.longFrom ? SHAPE_PRICE.longInput : SHAPE_PRICE.input;
  const extra = (write1h * inRate * (2 - SHAPE_PRICE.cacheWrite)) / 1_000_000;
  return { usd: costOf(usage) + extra, tokensIn, tokensOut: usage.output_tokens };
}

const EMPTY: MonthTotals = { usd: 0, tokensIn: 0, tokensOut: 0, calls: 0, scripted: 0 };

/** The world's totals for the month of `now`. */
export function monthTotals(state: Pick<WorldState, "spend">, now: number): MonthTotals {
  return { ...EMPTY, ...state.spend[monthOf(now)] };
}

/** Whether this step may call Claude: only while one more step, at its most, still fits in the month's budget. */
export function canSpend(state: Pick<WorldState, "spend">, now: number, budget = WORLD_BUDGET_USD): boolean {
  return monthTotals(state, now).usd + STEP_CEILING_USD <= budget;
}

/** The spend ledger with this step added (and only the last six months kept). */
export function addSpend(spend: WorldState["spend"], now: number, cost: StepCost | null, source: "claude" | "scripted"): WorldState["spend"] {
  const month = monthOf(now);
  const cur = { ...EMPTY, ...spend[month] };
  const next: MonthTotals = {
    usd: cur.usd + (cost?.usd ?? 0),
    tokensIn: cur.tokensIn + (cost?.tokensIn ?? 0),
    tokensOut: cur.tokensOut + (cost?.tokensOut ?? 0),
    // A call that answered unusably still costs, and still counts as a call.
    calls: cur.calls + (cost ? 1 : 0),
    scripted: cur.scripted + (source === "scripted" ? 1 : 0),
  };
  const all = { ...spend, [month]: next };
  return Object.fromEntries(Object.keys(all).sort().slice(-6).map((k) => [k, all[k]!]));
}
