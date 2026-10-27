/**
 * The day's story (#95, livelier in #102; docs/WORLD.md): the quick "today in Ilyr" update, presented by Skippy, the
 * Magnificent since #365, made about every five hours as the day goes ("so far" editions) and once more when the
 * recap is filed. The latest edition is the one served. As a Vercel (and Azure) function. The audio lives in the private Blob store and is served from here, so it comes from our own origin (the
 * CSP's media-src is 'self').
 *
 * GET  ?day=2026-10-13          → { day, ready: true, script, durationSec, partial, edition, reader, stale, at, audio } or
 *                                  { day, ready: false, reason } ("no-key", "over-budget", "not-yet"). The voice is
 *                                  ElevenLabs alone (#472): "no-key" and "over-budget" mean the audio waits on it.
 * GET  ?day=2026-10-13&audio=1  → the WAV (audio/wav). Under 4 MB it is one cacheable 200; a longer one is served in
 *                                  ranges (206), since a function's response is capped at 4.5 MB.
 * POST { day? }                 → make today's or yesterday's story now, once (the Desk's "Make it now"). Only in the
 *                                  Desk's sign-in session (#132, api/desk-auth.ts). Without `day`: yesterday
 *                                  if its recap is written and it has no story yet, else today so far (this 5-hour
 *                                  mark's edition, when the Chronicle has something new). A story made in an older
 *                                  style (`stale`) is remade once in the current one.
 *
 * GET  ?week=2026-10-19        → { week, ready: true, script, durationSec, writer, at, audio } or { week, ready: false }:
 *                                  the week in Ilyr (#211), by the week's Monday; `audio` is null when it wasn't read aloud.
 * GET  ?week=2026-10-19&audio=1 → its WAV, served like a day's.
 *
 * The world step makes each day's story by itself once the recap is written, and the week's on Sunday evening
 * (api/world-step.ts, waitUntil).
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   ELEVENLABS_API_KEY    the only voice (#365, #472; Key Vault secret `elevenlabs`): without it the script shows and
 *                         the audio waits on ElevenLabs
 *   ELEVENLABS_VOICE_ID   optional: the one voice for every spoken thing, Skippy's calls included (default Daniel)
 *   ELEVENLABS_BUDGET_USD optional: ElevenLabs' own monthly cap (default 10, never above 10); past it, the audio waits
 *   FOUNDRY_DESK_KEY   the root of the Desk's sign-in (api/_desk/keys.ts), for POST
 *   CLAUDE_API_KEY     optional: Claude Haiku writes the script (else it is put together from the Chronicle's lines)
 *   BLOB_STORE_ID      the private Blob store (Vercel's OIDC sign-in)
 */

import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore, type AuthStore } from "./_desk/store.js";
import { claudeStoryWriter } from "./_world/claude.js";
import { backfillDays, elevenFromEnv, hasAudio, isCurrent, makeStory, pickStoryStore, voiceBlocked, type DayStory, type StoryStore, type WeekStory } from "./_world/story.js";
import { DAY, pickStore, type WorldStore } from "./_world/store.js";
import type { DayStoryView, WeekStoryView } from "./_world/types.js";

/** The largest body one response carries (Vercel's cap is 4.5 MB). */
export const MAX_BODY = 4_000_000;

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? cache : "no-store" } });
}

/**
 * What the Desk is told about a story: the transcript and where to hear it. A script still waiting on ElevenLabs
 * (#472) has no audio link, and `waiting` says why: no key, past its cap, or it didn't answer last time.
 */
export function storyView(s: DayStory, waiting: "no-key" | "over-budget" | "speech-failed" = "speech-failed"): DayStoryView {
  return {
    day: s.day,
    ready: true as const,
    script: s.script,
    durationSec: s.durationSec,
    partial: s.partial,
    edition: s.partial ? (s.edition ?? null) : null,
    // Stories read before #472 (Gemini) stay as they were; a missing reader is one of those.
    reader: s.reader ?? "gemini",
    writer: s.writer,
    stale: !isCurrent(s),
    at: s.at,
    ...(hasAudio(s) ? { audio: `/api/day-story?day=${s.day}&audio=1&v=${Date.parse(s.at)}` } : { audio: null, waiting }),
  };
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
  /** Where the Desk's sign-in keeps its passkeys (#132). */
  auth: AuthStore | null;
}

const live = (): DayStoryEnv => ({ world: pickStore(), stories: pickStoryStore(), env: process.env, now: Date.now(), auth: pickAuthStore() });

/** What the Desk is told about a week's story: the transcript and, when it was read aloud, where to hear it. */
export function weekView(s: WeekStory): WeekStoryView {
  return { week: s.week, ready: true as const, script: s.script, durationSec: s.durationSec, writer: s.writer, at: s.at, audio: s.audio ? `/api/day-story?week=${s.week}&audio=1&v=${Date.parse(s.at)}` : null };
}

async function handleWeek(url: URL, request: Request, stories: StoryStore): Promise<Response> {
  const week = url.searchParams.get("week") ?? "";
  if (!DAY.test(week)) return json({ error: "bad-day" }, 400);
  try {
    if (url.searchParams.has("audio")) {
      const wav = await stories.readWeekAudio(week);
      if (!wav) return json({ error: "not-found" }, 404);
      return audioResponse(wav, request.headers.get("range"), url.searchParams.has("v"));
    }
    const story = await stories.readWeek(week);
    const view: WeekStoryView = story ? weekView(story) : { week, ready: false };
    return json(view, 200, story ? "public, s-maxage=60, stale-while-revalidate=600" : "public, s-maxage=60");
  } catch {
    return json({ error: "store" }, 502);
  }
}

export async function handleGet(request: Request, deps: DayStoryEnv = live()): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has("week")) return deps.stories ? handleWeek(url, request, deps.stories) : json({ error: "not-set-up" }, 503);
  const day = url.searchParams.get("day") ?? "";
  if (!DAY.test(day)) return json({ error: "bad-day" }, 400);
  if (!deps.stories) return json({ error: "not-set-up" }, 503);
  try {
    if (url.searchParams.has("audio")) {
      const wav = await deps.stories.readAudio(day);
      if (!wav) return json({ error: "not-found" }, 404);
      // Each edition replaces the day's audio (#365): only the current edition's link may be cached for good.
      const v = url.searchParams.get("v");
      const story = v ? await deps.stories.readStory(day) : null;
      return audioResponse(wav, request.headers.get("range"), !!story && v === String(Date.parse(story.at)));
    }
    const story = await deps.stories.readStory(day);
    if (story && hasAudio(story)) return json(storyView(story), 200, "public, s-maxage=60, stale-while-revalidate=600");
    // Why ElevenLabs can't read now, or null when it can (a waiting script then failed last time, and is retried).
    const blocked = voiceBlocked(await deps.stories.loadSpend(), deps.now, elevenFromEnv(deps.env));
    if (story) return json(storyView(story, blocked ?? "speech-failed"), 200, "public, s-maxage=60");
    const view: DayStoryView = { day, ready: false, reason: blocked ?? "not-yet" };
    return json(view, 200, "public, s-maxage=60");
  } catch {
    return json({ error: "store" }, 502);
  }
}

export async function handlePost(request: Request, deps: DayStoryEnv = live()): Promise<Response> {
  if (!deps.env.FOUNDRY_DESK_KEY || !deps.world || !deps.stories) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, { deskKey: deps.env.FOUNDRY_DESK_KEY, store: deps.auth, now: deps.now });
  if (!signed.ok) return signed.response;
  return withCookie(await make(request, { ...deps, world: deps.world, stories: deps.stories }), signed);
}

/** A signed-in "Make it now". */
async function make(request: Request, deps: DayStoryEnv & { world: WorldStore; stories: StoryStore }): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { day?: unknown } | null;
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
      eleven: elevenFromEnv(deps.env),
      write: claudeStoryWriter(deps.env.CLAUDE_API_KEY || deps.env.ANTHROPIC_API_KEY || ""),
      fetcher: deps.fetcher,
      allowPartial: true,
      allowRemake: true,
    });
    const waiting = !result.made && (result.reason === "no-key" || result.reason === "over-budget") ? result.reason : "speech-failed";
    return json({ day, made: result.made, ...(result.made ? {} : { reason: result.reason }), story: result.story ? storyView(result.story, waiting) : null });
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
