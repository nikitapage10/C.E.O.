/**
 * The living Lattice's hourly step, as a Vercel function (docs/WORLD.md). A GitHub Actions workflow
 * (.github/workflows/world-step.yml) posts here every hour; the step advances the world one hour and saves it.
 *
 * POST → { stepped: true, at } after a step, or { stepped: false, at, nextAt } when the last step is under 55
 *        minutes old (nothing changes, nothing is spent). That rule is what makes it safe to leave open: calling it
 *        more often does nothing, so it needs no secret, and the site gate lets it through (#236). So the answer
 *        never carries the hour's words, only whether it stepped and when.
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
 *   GEMINI_API_KEY         optional: the day's story, read aloud about every five hours and once the recap is filed
 *                          (api/_world/story.ts), and the week in Ilyr on Sunday evening (api/_world/week.ts)
 *   GEMINI_BUDGET_USD      optional: Gemini's own monthly cap (default 5, never above 10)
 *   ELEVENLABS_API_KEY     optional (#365): ElevenLabs reads the day's story first, under ELEVENLABS_BUDGET_USD
 *                          (default 10), with ELEVENLABS_VOICE_ID; Gemini reads when it can't
 */

import { waitUntil } from "./_waitUntil.js";
import { canSpend, worldBudget } from "./_world/budget.js";
import { claudeAsk, claudeStoryWriter } from "./_world/claude.js";
import { readClock } from "./_world/clock.js";
import { readFeed } from "./_world/digest.js";
import { runStep } from "./_world/step.js";
import { makeWeekStory } from "./_world/week.js";
import { weekDue } from "./_world/weeks.js";
import { editionAt, elevenFromEnv, geminiBudget, geminiKey, makeStory, mountainOf, pickStoryStore } from "./_world/story.js";
import { pickStore, StaleStateError, type WorldStore } from "./_world/store.js";
import type { WorldState } from "./_world/types.js";

/**
 * Once the day's recap is filed, Skippy reads the day aloud (api/_world/story.ts, #365): after the answer has gone,
 * so the step stays fast. Without a voice key (ELEVENLABS_API_KEY or GEMINI_API_KEY), or past both caps, nothing is
 * called.
 */
function tellTheDay(world: WorldStore, day: string): void {
  const stories = pickStoryStore();
  const key = geminiKey();
  const eleven = elevenFromEnv();
  if (!stories || (!key && !eleven)) return;
  waitUntil(
    makeStory({ world, stories, day, now: Date.now(), key, eleven, budget: geminiBudget(process.env.GEMINI_BUDGET_USD), write: claudeStoryWriter() }).catch(() => undefined),
  );
}

/**
 * The day so far (#365): at the first step after each 5-hour mark (5 am, 10 am, 3 pm, 8 pm Mountain), a fresh "so
 * far" edition of today, when the Chronicle has something new since the last one. Each edition is claimed once, so
 * the next steps in the same window spend nothing (one store read). Claude writes it only while the world's budget
 * has room, else the Chronicle's own lines do.
 */
function tellSoFar(world: WorldStore, state: WorldState, now: number): void {
  const { day } = mountainOf(now);
  const edition = editionAt(day, now);
  const stories = pickStoryStore();
  const key = geminiKey();
  const eleven = elevenFromEnv();
  if (edition < 1 || !stories || (!key && !eleven)) return;
  const write = canSpend(state, now, worldBudget(process.env.WORLD_BUDGET_USD)) ? claudeStoryWriter() : null;
  waitUntil(
    makeStory({ world, stories, day, now, key, eleven, budget: geminiBudget(process.env.GEMINI_BUDGET_USD), write, allowPartial: true, edition }).catch(() => undefined),
  );
}

/**
 * On Sunday evening (the first steps from 6 pm Mountain) the Historian tells the week (api/_world/week.ts, #211): one
 * Claude write, only while the world's budget has room, else a script from the recaps, then one Gemini reading. Told
 * once; the hours after retry only a reading that failed.
 */
function tellTheWeek(world: WorldStore, state: WorldState, now: number): void {
  const week = weekDue(now);
  const stories = pickStoryStore();
  if (!week || !stories) return;
  const claude = canSpend(state, now, worldBudget(process.env.WORLD_BUDGET_USD)) ? claudeStoryWriter() : null;
  waitUntil(makeWeekStory({ world, stories, week, now, key: geminiKey(), budget: geminiBudget(process.env.GEMINI_BUDGET_USD), write: claude }).catch(() => undefined));
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
    else if (result.stepped) tellSoFar(store, result.state, Date.parse(result.entry.at));
    if (result.stepped) tellTheWeek(store, result.state, Date.parse(result.entry.at));
    // Only whether it stepped and when: the trigger is open (the site gate lets it through, #236), and the hour's
    // words are for the Lattice, behind the gate, not for whoever calls this.
    return json(result.stepped ? { stepped: true, at: result.entry.at } : { stepped: false, at: result.entry?.at ?? null, nextAt: result.nextAt });
  } catch (e) {
    // Another step landed first: this hour is already written.
    if (e instanceof StaleStateError) return json({ stepped: false, error: "already-stepped" }, 409);
    return json({ error: "step" }, 502);
  }
}
