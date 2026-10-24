/**
 * What the one-off Azure seed copies from production's Vercel Blob store (docs/AZURE.md, "Seeding the Azure state"),
 * and where each file lands on disk before the workflow uploads it into `ceo-state` under the same name.
 *
 * Only the world, its stories and the idea pictures: the Desk's sign-ins (`desk/`) stay behind, because passkeys and
 * push subscriptions belong to the address they were made on, and Skippy's chat ledger is per copy.
 */

import { join, normalize, sep } from "node:path";

/** The prefixes copied, as the stores name them (api/_world/store.ts, api/_world/story.ts, api/foundry-image.ts). */
export const SEED_PREFIXES = ["world/", "foundry/ideas/"];

/**
 * The file a blob's pathname is written to under `root`, or null when the name isn't one to copy or could step out
 * of `root` (an absolute name, `..`, a backslash or a control character): the listing comes from a remote store, so
 * its names are checked before they become paths.
 */
export function seedTarget(root, pathname) {
  if (typeof pathname !== "string" || pathname === "" || pathname.endsWith("/")) return null;
  if (!SEED_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(pathname) || pathname.startsWith("/")) return null;
  if (pathname.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  const target = normalize(join(root, pathname));
  return target.startsWith(normalize(root) + sep) ? target : null;
}

/* ── Without the token: the same files, rebuilt from production's public API ── */

/**
 * Values the Azure store's own code uses, kept here so the public seed runs with plain Node (no `npm ci`, no build). A
 * unit test (seed-azure-lib.test.mjs) keeps them equal to api/_world/prompt.ts and api/_world/story.ts.
 */
export const RECENT_KEEP = 24;
export const STORY_STYLE = 4;
export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Achird";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (d) => typeof d === "string" && DAY_RE.test(d);
const json = (value) => JSON.stringify(value);

/** The Monday of a day's week ("2026-10-21" → "2026-10-19"): the name the week's story is kept under. */
export function mondayOf(day) {
  const t = Date.parse(`${day}T12:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The seed's files, as the Azure store names and shapes them (api/_world/store.ts, api/_world/story.ts), from what
 * production's public pages serve:
 *
 *   feed     GET /api/world (WorldFeed)
 *   pages    GET /api/world?day=… for each of feed.days (DayPage, as stored)
 *   stories  [{ view, wav }]: GET /api/day-story?day=… when ready, and its audio
 *   weeks    [{ view, wav }]: GET /api/day-story?week=… when ready, and its audio (wav null when it has none)
 *
 * The state's fields the hourly step reads all come across: step, at, relationships, days and remarks as served; the
 * last RECENT_KEEP hours from the day pages; `recapped` from the recaps the hours wrote; and this month's spend (the
 * feed carries no earlier months, which only the ledger's history used). Anything written after the feed was read (an
 * hour that stepped in between) is left out, so the state and its days agree. Throws when the feed isn't a world.
 *
 * Returns [{ name, data }], data a string or bytes.
 */
export function publicSeedFiles({ feed, pages = [], stories = [], weeks = [] }) {
  if (!feed || feed.ok !== true || !Number.isInteger(feed.step) || feed.step < 1 || typeof feed.at !== "string") {
    throw new Error("production's /api/world has no world to copy");
  }
  if (!Array.isArray(feed.relationships) || !Array.isArray(feed.recent) || !Array.isArray(feed.days) || !Array.isArray(feed.remarks)) {
    throw new Error("production's /api/world is missing part of the world");
  }
  const upTo = feed.step;
  const files = [];

  // Every hour up to the feed's, from the day pages and the feed's own recent hours (one entry per step).
  const byStep = new Map();
  const keptPages = [];
  for (const page of pages) {
    if (!page || !isDay(page.day) || !feed.days.includes(page.day) || !Array.isArray(page.entries)) continue;
    const entries = page.entries.filter((e) => Number.isInteger(e?.step) && e.step <= upTo && e.day === page.day);
    for (const e of entries) byStep.set(e.step, e);
    keptPages.push({ day: page.day, entries, recap: page.recap });
  }
  for (const e of feed.recent) if (Number.isInteger(e?.step) && e.step <= upTo) byStep.set(e.step, e);
  const hours = [...byStep.values()].sort((a, b) => a.step - b.step);
  if (hours.at(-1)?.step !== upTo) throw new Error(`production's hours stop before step ${upTo}`);

  // A day's recap is written by the first hour after it; only those hours' recaps come across.
  const recapDays = new Set(hours.map((e) => e.recap?.day).filter(isDay));
  const recapped = [...recapDays].sort().at(-1) ?? null;
  for (const page of keptPages) {
    const recap = typeof page.recap === "string" && recapDays.has(page.day) ? page.recap : null;
    files.push({ name: `world/days/${page.day}.json`, data: json({ day: page.day, entries: page.entries, recap }) });
  }

  const s = feed.spend;
  const spend = s && /^\d{4}-\d{2}$/.test(s.month) ? { [s.month]: { usd: s.usd ?? 0, tokensIn: s.tokensIn ?? 0, tokensOut: s.tokensOut ?? 0, calls: s.calls ?? 0, scripted: s.scripted ?? 0 } } : {};
  const state = {
    version: 1,
    step: upTo,
    at: feed.at,
    relationships: feed.relationships,
    recent: hours.slice(-RECENT_KEEP),
    days: feed.days.filter(isDay),
    recapped,
    spend,
    remarks: feed.remarks,
  };
  files.push({ name: "world/state.json", data: json(state) });

  // The day stories: what the public view shows, and the audio's own size. What it cost isn't public (no reader uses it).
  for (const { view, wav } of stories) {
    if (!view?.ready || !isDay(view.day) || !(wav instanceof Uint8Array) || wav.byteLength === 0) continue;
    files.push({ name: `world/stories/${view.day}.wav`, data: wav });
    files.push({
      name: `world/stories/${view.day}.json`,
      data: json({
        day: view.day,
        script: view.script,
        partial: !!view.partial,
        writer: view.writer === "claude" ? "claude" : "chronicle",
        // The view only says whether the style is current; an older one may be remade once, as on production.
        style: view.stale ? 1 : STORY_STYLE,
        durationSec: view.durationSec,
        bytes: wav.byteLength,
        model: TTS_MODEL,
        voice: TTS_VOICE,
        at: view.at,
        cost: { usd: 0, tokensIn: 0, tokensOut: 0 },
        scriptUsd: 0,
      }),
    });
  }
  for (const { view, wav } of weeks) {
    if (!view?.ready || !isDay(view.week)) continue;
    const audio = wav instanceof Uint8Array && wav.byteLength > 0;
    if (audio) files.push({ name: `world/stories/week-${view.week}.wav`, data: wav });
    files.push({
      name: `world/stories/week-${view.week}.json`,
      data: json({
        week: view.week,
        script: view.script,
        writer: view.writer === "claude" ? "claude" : "chronicle",
        audio,
        durationSec: audio ? view.durationSec : 0,
        bytes: audio ? wav.byteLength : 0,
        model: audio ? TTS_MODEL : null,
        voice: audio ? TTS_VOICE : null,
        at: view.at,
        cost: null,
        scriptUsd: 0,
      }),
    });
  }

  // Gemini's ledger for this month, so Azure's speech budget starts where production's is.
  const st = feed.story;
  if (st && /^\d{4}-\d{2}$/.test(st.month)) {
    files.push({
      name: "world/stories/spend.json",
      data: json({ [st.month]: { usd: st.usd ?? 0, tokensIn: st.tokensIn ?? 0, tokensOut: st.tokensOut ?? 0, calls: st.calls ?? 0, stories: st.stories ?? 0, scriptUsd: st.scriptUsd ?? 0 } }),
    });
  }
  return files;
}
