/**
 * The world clock (issue #53): what GET /api/world-step answers, read from the saved state without running a step.
 * The Desk's Systems page and the Boiler Room's pipe poll it to show when the last hour ran, when the next is due, who
 * wrote it and this month's world spend. Only times, counts and dollars leave here: nothing an hour said.
 */

import { monthOf, monthTotals } from "./budget.js";
import { nextAt } from "./step.js";
import type { WorldClock, WorldState } from "./types.js";

export function readClock(state: WorldState | null, opts: { store: WorldClock["store"]; claude: boolean; budget: number; now: number }): WorldClock {
  const { usd, calls, scripted } = monthTotals(state ?? { spend: {} }, opts.now);
  return {
    at: state?.at ?? null,
    step: state?.step ?? 0,
    nextAt: state ? nextAt(state, opts.now) : null,
    store: opts.store,
    claude: opts.claude,
    source: state?.recent.at(-1)?.source ?? null,
    spend: { month: monthOf(opts.now), usd, budget: opts.budget, calls, scripted },
  };
}
