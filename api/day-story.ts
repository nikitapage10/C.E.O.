/**
 * The day's story (issue #95, docs/WORLD.md): the Historian reading the day in Ilyr aloud, as a Vercel function. The
 * audio lives in the private Blob store and is served from here, so it comes from our own origin (the CSP's
 * media-src is 'self').
 *
 * GET  ?day=2026-10-13          → { day, ready: true, script, durationSec, partial, at, audio } or
 *                                  { day, ready: false, reason } ("no-key", "over-budget", "not-yet").
 * GET  ?day=2026-10-13&audio=1  → the WAV (audio/wav). Under 4 MB it is one cacheable 200; a longer one is served in
 *                                  ranges (206), since a function's response is capped at 4.5 MB.
 * POST { key, day? }            → make today's or yesterday's story now, once (the Desk's "Make it now"). Gated by the
 *                                  Desk key, compared in constant time as in api/foundry.ts. Without `day`: yesterday
 *                                  if its recap is written and it has no story yet, else today so far.
 *
 * The world step makes each day's story by itself once the recap is written (api/world-step.ts, waitUntil).
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   GEMINI_API_KEY     Gemini's speech (without it there is no audio, and the Desk says so)
 *   GEMINI_BUDGET_USD  optional: Gemini's own monthly cap (default 5, never above 10)
 *   FOUNDRY_DESK_KEY   the Desk's passphrase, for POST
 *   CLAUDE_API_KEY     optional: Claude Haiku writes the script (else it is put together from the Chronicle's lines)
 *   BLOB_STORE_ID      the private Blob store (Vercel's OIDC sign-in)
 */

import { timingSafeEqual } from "node:crypto";
import { claudeStoryWriter } from "./_world/claude.js";
import { backfillDays, canSpeak, geminiBudget, geminiKey, makeStory, pickStoryStore, type DayStory, type StoryStore } from "./_world/story.js";
import { DAY, pickStore, type WorldStore } from "./_world/store.js";
import type { DayStoryView } from "./_world/types.js";

/** The largest body one response carries (Vercel's cap is 4.5 MB). */
export const MAX_BODY = 4_000_000;

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? cache : "no-store" } });
}

function keyMatches(given: unknown, want = process.env.FOUNDRY_DESK_KEY ?? ""): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(want);
  const b = Buffer.from(given);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** What the Desk is told about a story: the transcript and where to hear it. */
export function storyView(s: DayStory): DayStoryView {
  return { day: s.day, ready: true as const, script: s.script, durationSec: s.durationSec, partial: s.partial, writer: s.writer, at: s.at, audio: `/api/day-story?day=${s.day}&audio=1&v=${Date.parse(s.at)}` };
}

/** Serve the WAV: whole when it fits, else the range asked for (at most MAX_BODY). */
export function audioResponse(wav: Uint8Array, range: string | null, versioned: boolean): Response {
  const total = wav.length;
  const base = { "Content-Type": "audio/wav", "Accept-Ranges": total > MAX_BODY ? "bytes" : "none" };
  if (total <= MAX_BODY) {
    // One answer for every request, so the edge can cache it; a versioned link never changes.
    const cache = versioned ? "public, max-age=31536000, immutable" : "public, s-maxage=300, stale-while-revalidate=3600";
    return new Response(new Uint8Array(wav), { status: 200, headers: { ...base, "Content-Length": String(total), "Cache-Control": cache } });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "bytes=0-");
  let start = m?.[1] ? Number(m[1]) : NaN;
  let end = m?.[2] ? Number(m[2]) : NaN;
  if (Number.isNaN(start)) {
    // "bytes=-500": the last 500.
    start = Number.isNaN(end) ? 0 : Math.max(0, total - end);
    end = total - 1;
  }
  if (Number.isNaN(end) || end >= total) end = total - 1;
  if (!m || start >= total || start > end) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` } });
  end = Math.min(end, start + MAX_BODY - 1);
  return new Response(wav.slice(start, end + 1), {
    status: 206,
    // A range is per request: the browser may keep it, a shared cache must not.
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1), "Cache-Control": "private, max-age=86400", Vary: "Range" },
  });
}

export interface DayStoryEnv {
  world: WorldStore | null;
  stories: StoryStore | null;
  env: Record<string, string | undefined>;
  now: number;
  fetcher?: typeof fetch;
}

const live = (): DayStoryEnv => ({ world: pickStore(), stories: pickStoryStore(), env: process.env, now: Date.now() });

export async function handleGet(request: Request, deps: DayStoryEnv = live()): Promise<Response> {
  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? "";
  if (!DAY.test(day)) return json({ error: "bad-day" }, 400);
  if (!deps.stories) return json({ error: "not-set-up" }, 503);
  try {
    if (url.searchParams.has("audio")) {
      const wav = await deps.stories.readAudio(day);
      if (!wav) return json({ error: "not-found" }, 404);
      return audioResponse(wav, request.headers.get("range"), url.searchParams.has("v"));
    }
    const story = await deps.stories.readStory(day);
    if (story) return json(storyView(story), 200, "public, s-maxage=60, stale-while-revalidate=600");
    const view: DayStoryView = {
      day,
      ready: false,
      reason: !geminiKey(deps.env) ? "no-key" : !canSpeak(await deps.stories.loadSpend(), deps.now, geminiBudget(deps.env.GEMINI_BUDGET_USD)) ? "over-budget" : "not-yet",
    };
    return json(view, 200, "public, s-maxage=60");
  } catch {
    return json({ error: "store" }, 502);
  }
}

export async function handlePost(request: Request, deps: DayStoryEnv = live()): Promise<Response> {
  if (!deps.env.FOUNDRY_DESK_KEY || !deps.world || !deps.stories) return json({ error: "not-set-up" }, 503);
  const body = (await request.json().catch(() => null)) as { key?: unknown; day?: unknown } | null;
  if (!keyMatches(body?.key, deps.env.FOUNDRY_DESK_KEY)) return json({ error: "wrong-key" }, 401);
  const [today, yesterday] = backfillDays(deps.now) as [string, string];
  let day = typeof body?.day === "string" ? body.day : "";
  if (day && day !== today && day !== yesterday) return json({ error: "bad-day" }, 400);
  try {
    if (!day) {
      const y = await deps.world.readDay(yesterday);
      day = y.recap && !(await deps.stories.readStory(yesterday)) ? yesterday : today;
    }
    const result = await makeStory({
      world: deps.world,
      stories: deps.stories,
      day,
      now: deps.now,
      key: geminiKey(deps.env),
      budget: geminiBudget(deps.env.GEMINI_BUDGET_USD),
      write: claudeStoryWriter(deps.env.CLAUDE_API_KEY || deps.env.ANTHROPIC_API_KEY || ""),
      fetcher: deps.fetcher,
      allowPartial: true,
    });
    return json({ day, made: result.made, ...(result.made ? {} : { reason: result.reason }), story: result.story ? storyView(result.story) : null });
  } catch {
    return json({ error: "story" }, 502);
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
