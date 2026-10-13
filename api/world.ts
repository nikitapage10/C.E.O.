/**
 * The living Lattice's read feed, as a Vercel function (docs/WORLD.md): what the Lattice loads on open (relationships
 * as they stand, the last hours' conversations) and what the Desk's Chronicle, Usage panel and Changelog read.
 *
 * GET           → WorldFeed (api/_world/types.ts): the latest state, its recent hours and this month's world spend.
 * GET ?day=…    → DayPage: one day of the Chronicle ("2026-10-13", Mountain time), oldest hour first.
 *
 * The world moves once an hour, so answers are cached at Vercel's edge for a few minutes: every open tab shares one
 * read of the store.
 */

import { monthOf, monthTotals, worldBudget } from "./_world/budget.js";
import { claudeKey } from "./_world/claude.js";
import { nextAt } from "./_world/step.js";
import { DAY, pickStore } from "./_world/store.js";
import { geminiBudget, geminiKey, pickStoryStore, storyMonth, type StorySpend } from "./_world/story.js";
import type { WorldFeed } from "./_world/types.js";

const RECENT_SENT = 12;

function json(body: unknown, status = 200, cache = "public, s-maxage=300, stale-while-revalidate=3600"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? cache : "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  const day = new URL(request.url).searchParams.get("day");
  try {
    if (day !== null) {
      if (!DAY.test(day)) return json({ error: "bad-day" }, 400);
      return json(await store.readDay(day));
    }
    const stories = pickStoryStore();
    const [state, storySpend] = await Promise.all([store.loadState(), stories ? stories.loadSpend().catch((): StorySpend => ({})) : Promise.resolve<StorySpend>({})]);
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
      story: { month: monthOf(now), budget: geminiBudget(process.env.GEMINI_BUDGET_USD), gemini: Boolean(geminiKey()), ...storyMonth(storySpend, now) },
    };
    return json(feed);
  } catch {
    return json({ error: "store" }, 502);
  }
}
