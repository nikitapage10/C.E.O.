/**
 * The living Lattice's hourly step, as a Vercel function (docs/WORLD.md). A GitHub Actions workflow
 * (.github/workflows/world-step.yml) posts here every hour; the step advances the world one hour and saves it.
 *
 * POST → { stepped: true, entry } after a step, or { stepped: false, entry, nextAt } when the last step is under 55
 *        minutes old (nothing changes, nothing is spent). That rule is what makes it safe to leave open: calling it
 *        more often does nothing, so it needs no secret.
 * GET  → WorldClock (api/_world/types.ts): when it last ran, when the next is due, who wrote the last hour (Claude or
 *        scripted) and this month's world spend against its share, without running it. The Desk's world clock and the
 *        Boiler Room's pipe poll it, so it is never cached. Only times, counts and dollars: nothing an hour says.
 *
 * Environment (Vercel → Settings → Environment Variables), all already set for the rest of the Desk:
 *   BLOB_STORE_ID          the private Blob store (set by Vercel; the function signs in with Vercel's OIDC token)
 *   CLAUDE_API_KEY         Claude Haiku writes each hour (without it, every hour is scripted, for free)
 *   FOUNDRY_APP_ID, FOUNDRY_APP_PRIVATE_KEY   optional: reads the hour's Foundry events with a read-only token of the
 *                          crew's GitHub App (api/_github.ts, #138) instead of anonymously
 *   FOUNDRY_GITHUB_TOKEN   optional: the same with the older fine-grained token, until the App is set up
 *   WORLD_STORE            optional: "blob" (default) or "supabase" once it is connected (api/_world/store.ts)
 *   WORLD_BUDGET_USD       optional: the world's share of the $10 monthly Claude API cap (default 6)
 *   GEMINI_API_KEY         optional: the day's story, read aloud once the recap is filed (api/_world/story.ts)
 *   GEMINI_BUDGET_USD      optional: Gemini's own monthly cap (default 5, never above 10)
 */

import { waitUntil } from "@vercel/functions";
import { worldBudget } from "./_world/budget.js";
import { claudeAsk, claudeStoryWriter } from "./_world/claude.js";
import { readClock } from "./_world/clock.js";
import { readFeed } from "./_world/digest.js";
import { runStep } from "./_world/step.js";
import { geminiBudget, geminiKey, makeStory, pickStoryStore } from "./_world/story.js";
import { pickStore, StaleStateError, type WorldStore } from "./_world/store.js";

/**
 * Once the day's recap is filed, the Historian reads the day aloud (api/_world/story.ts): after the answer has gone,
 * so the step stays fast. Without GEMINI_API_KEY, or past GEMINI_BUDGET_USD, nothing is called.
 */
function tellTheDay(world: WorldStore, day: string): void {
  const stories = pickStoryStore();
  const key = geminiKey();
  if (!stories || !key) return;
  waitUntil(
    makeStory({ world, stories, day, now: Date.now(), key, budget: geminiBudget(process.env.GEMINI_BUDGET_USD), write: claudeStoryWriter() }).catch(() => undefined),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET(): Promise<Response> {
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  try {
    const state = await store.loadState();
    const clock = readClock(state, { store: store.kind, claude: claudeAsk() !== null, budget: worldBudget(process.env.WORLD_BUDGET_USD), now: Date.now() });
    return json(clock);
  } catch {
    return json({ error: "store" }, 502);
  }
}

export async function POST(): Promise<Response> {
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  try {
    const result = await runStep({ store, now: Date.now(), readFeed: (since) => readFeed(since), ask: claudeAsk(), budget: worldBudget(process.env.WORLD_BUDGET_USD) });
    if (result.stepped && result.entry.recap) tellTheDay(store, result.entry.recap.day);
    return json(result.stepped ? { stepped: true, entry: result.entry } : result);
  } catch (e) {
    // Another step landed first: this hour is already written.
    if (e instanceof StaleStateError) return json({ stepped: false, error: "already-stepped" }, 409);
    return json({ error: "step" }, 502);
  }
}
