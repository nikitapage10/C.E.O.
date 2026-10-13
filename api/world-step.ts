/**
 * The living Lattice's hourly step, as a Vercel function (docs/WORLD.md). A GitHub Actions workflow
 * (.github/workflows/world-step.yml) posts here every hour; the step advances the world one hour and saves it.
 *
 * POST → { stepped: true, entry } after a step, or { stepped: false, entry, nextAt } when the last step is under 55
 *        minutes old (nothing changes, nothing is spent). That rule is what makes it safe to leave open: calling it
 *        more often does nothing, so it needs no secret.
 * GET  → { at, step, nextAt, store, claude }: when it last ran, without running it.
 *
 * Environment (Vercel → Settings → Environment Variables), all already set for the rest of the Desk:
 *   BLOB_STORE_ID          the private Blob store (set by Vercel; the function signs in with Vercel's OIDC token)
 *   CLAUDE_API_KEY         Claude Haiku writes each hour (without it, every hour is scripted, for free)
 *   FOUNDRY_GITHUB_TOKEN   optional: reads the hour's Foundry events with the Foundry's token instead of anonymously
 *   WORLD_STORE            optional: "blob" (default) or "supabase" once it is connected (api/_world/store.ts)
 *   WORLD_BUDGET_USD       optional: the world's share of the $10 monthly Claude API cap (default 6)
 */

import { worldBudget } from "./_world/budget.js";
import { claudeAsk } from "./_world/claude.js";
import { readFeed } from "./_world/digest.js";
import { nextAt, runStep } from "./_world/step.js";
import { pickStore, StaleStateError } from "./_world/store.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET(): Promise<Response> {
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  try {
    const state = await store.loadState();
    return json({ at: state?.at ?? null, step: state?.step ?? 0, nextAt: state ? nextAt(state, Date.now()) : null, store: store.kind, claude: claudeAsk() !== null });
  } catch {
    return json({ error: "store" }, 502);
  }
}

export async function POST(): Promise<Response> {
  const store = pickStore();
  if (!store) return json({ error: "not-set-up" }, 503);
  try {
    const result = await runStep({ store, now: Date.now(), readFeed: (since) => readFeed(since), ask: claudeAsk(), budget: worldBudget(process.env.WORLD_BUDGET_USD) });
    return json(result.stepped ? { stepped: true, entry: result.entry } : result);
  } catch (e) {
    // Another step landed first: this hour is already written.
    if (e instanceof StaleStateError) return json({ stepped: false, error: "already-stepped" }, 409);
    return json({ error: "step" }, 502);
  }
}
