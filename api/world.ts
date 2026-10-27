/**
 * The living Lattice's read feed, as a Vercel function (docs/WORLD.md): what the Lattice loads on open (relationships
 * as they stand, the last hours' conversations) and what the Desk's Chronicle, Usage panel and Changelog read.
 *
 * GET           → WorldFeed (api/_world/types.ts): the latest state, its recent hours and this month's world spend.
 * GET ?day=…    → DayPage: one day of the Chronicle ("2026-10-13", Mountain time), oldest hour first.
 *
 * GET/POST ?exchange=markets → the Exchange's Polymarket board (#240; vercel.json rewrites /api/exchange-markets here so the
 *               deployment keeps its twelve functions): api/_exchange/route.ts.
 * GET ?exchange=positions → Nikita's Polymarket US positions, signed-in Desk only (#253; rewritten from
 *               /api/exchange-positions the same way): api/_exchange/positions.ts.
 * GET ?green=league → the Green's Sleeper league board (#252; the rewrite of /api/green-league, the same way):
 *               api/_green/route.ts.
 * GET/POST ?green=analysis → the Commentator's call, signed-in Desk only (#276; the rewrite of /api/green-analysis):
 *               api/_green/analysis.ts.
 * GET/POST ?timing=talk → the Talk calls' start timings (#512): api/_boot/talkTiming.ts.
 * GET/POST ?timing=lattice → the Lattice's boot timings (#373; the rewrite of /api/lattice-timing): api/_boot/timing.ts.
 *
 * The world moves once an hour, so answers are cached at Vercel's edge for a few minutes: every open tab shares one
 * read of the store.
 */

import * as timing from "./_boot/timing.js";
import * as talkTiming from "./_boot/talkTiming.js";
import { readPublicEmailStatus } from "./_email/store.js";
import * as positions from "./_exchange/positions.js";
import * as exchange from "./_exchange/route.js";
import * as green from "./_green/route.js";
import * as greenAnalysis from "./_green/analysis.js";
import { monthOf, monthTotals, worldBudget } from "./_world/budget.js";
import { claudeKey } from "./_world/claude.js";
import { nextAt } from "./_world/step.js";
import { DAY, pickStore } from "./_world/store.js";
import { elevenBudget, elevenFromEnv, pickStoryStore, storyMonth, type StorySpend } from "./_world/story.js";
import type { WorldFeed } from "./_world/types.js";

const RECENT_SENT = 12;

function json(body: unknown, status = 200, cache = "public, s-maxage=300, stale-while-revalidate=3600"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? cache : "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  if (positions.isPositions(request)) return positions.GET(request);
  if (exchange.isExchange(request)) return exchange.GET(request);
  if (green.isGreen(request)) return green.GET(request);
  if (greenAnalysis.isAnalysis(request)) return greenAnalysis.GET(request);
  if (timing.isTiming(request)) return timing.GET(request);
  if (talkTiming.isTalkTiming(request)) return talkTiming.GET(request);
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  const day = new URL(request.url).searchParams.get("day");
  try {
    if (day !== null) {
      if (!DAY.test(day)) return json({ error: "bad-day" }, 400);
      return json(await store.readDay(day));
    }
    const stories = pickStoryStore();
    // The email agent's counts (#263) come from its own public file, on the Azure copy only; never its private state.
    const [state, storySpend, email] = await Promise.all([store.loadState(), stories ? stories.loadSpend().catch((): StorySpend => ({})) : Promise.resolve<StorySpend>({}), readPublicEmailStatus()]);
    const now = Date.now();
    const budget = worldBudget(process.env.WORLD_BUDGET_USD);
    const feed: WorldFeed = {
      ok: true,
      at: state?.at ?? null,
      step: state?.step ?? 0,
      nextAt: state?.at ? nextAt(state, now) : null,
      relationships: state?.relationships ?? [],
      recent: (state?.recent ?? []).slice(-RECENT_SENT),
      days: state?.days ?? [],
      remarks: state?.remarks ?? [],
      spend: { month: monthOf(now), budget, ...monthTotals(state ?? { spend: {} }, now) },
      claude: Boolean(claudeKey()),
      story: {
        month: monthOf(now),
        eleven: elevenFromEnv() !== null,
        elevenBudget: elevenBudget(process.env.ELEVENLABS_BUDGET_USD),
        ...storyMonth(storySpend, now),
      },
      email,
    };
    return json(feed);
  } catch {
    return json({ error: "store" }, 502);
  }
}

/**
 * The world feed takes no writes; only the Exchange's pins (#240), the Green's refresh (#276) and the Lattice's boot
 * timings (#373) come through here.
 */
export async function POST(request: Request): Promise<Response> {
  if (exchange.isExchange(request)) return exchange.POST(request);
  if (greenAnalysis.isAnalysis(request)) return greenAnalysis.POST(request);
  if (timing.isTiming(request)) return timing.POST(request);
  if (talkTiming.isTalkTiming(request)) return talkTiming.POST(request);
  return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: { "Content-Type": "application/json", Allow: "GET", "Cache-Control": "no-store" } });
}
