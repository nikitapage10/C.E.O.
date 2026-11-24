/**
 * The Studio's audio line (#311, part of the render line): Skippy's voice, music and sound effects from ElevenLabs,
 * for the Director's thread to put under a test episode. Azure only, like every ElevenLabs call: the key lives only in
 * this Function App's Key Vault (`elevenlabs`), and the thread never sees it.
 *
 *   POST /api/studio-audio { mode: "tts", text, voice? }               → { id, status: "working" } (202)
 *   POST /api/studio-audio { mode: "music", prompt, length_ms }        → the same; length 10 s to 3 minutes
 *   POST /api/studio-audio { mode: "sfx", text, duration_seconds? }    → the same; 0.5 to 30 seconds
 *   POST /api/studio-audio { fetch: "<id>" }                           → { status: "working" } (202),
 *        { status: "done", mime: "audio/mpeg", audio_base64, alignment? } (200), { status: "failed", error } (502),
 *        or { error: "gone" } (404)
 *
 * Why a job and a fetch: a three-minute piece of music takes longer than the Static Web App's ~45-second cut, so the
 * first call answers at once and the work carries on (waitUntil); the thread asks again until it is done.
 *
 * Who: the feed key only (SUBMIND_FEED_TOKEN, a POST with no query, api/_site/roomkeys.ts), checked by the gate and
 * again here. What it can do: spend ElevenLabs plan credits on audio made from the words in the request, no more than
 * DAY_CAP jobs a UTC day. What it reads back: only the audio it made for that request. Nothing private goes in or comes
 * out, and nothing is public: each result sits in the private blob store (`studio/audio/<id>.json`) for KEEP_MS,
 * then is deleted by a later job.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { pickBlob } from "../_blob.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { waitUntil } from "../_waitUntil.js";
import { ELEVEN_MODEL, elevenFromEnv, type ElevenConfig } from "../_world/story.js";
import { readJson, updateJson } from "../_haven/json.js";

export { STUDIO_AUDIO_PATH } from "../_site/roomkeys.js";
/** Jobs a UTC day, all three kinds together. */
export const DAY_CAP = 60;
/** How long a finished result can still be fetched. */
export const KEEP_MS = 24 * 60 * 60_000;
export const TEXT_MAX = 5_000;
export const PROMPT_MAX = 2_000;
export const MUSIC_MIN_MS = 10_000;
export const MUSIC_MAX_MS = 180_000;
export const SFX_MIN_S = 0.5;
export const SFX_MAX_S = 30;
const API = "https://api.elevenlabs.io/v1";
const FORMAT = "mp3_44100_128";
const ID = /^[A-Za-z0-9_-]{16}$/;
const VOICE = /^[A-Za-z0-9]{10,40}$/;
const BODY_MAX = 16_000;

export type AudioJob =
  | { mode: "tts"; text: string; voice?: string }
  | { mode: "music"; prompt: string; length_ms: number }
  | { mode: "sfx"; text: string; duration_seconds?: number };

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

type Stored =
  | { status: "working"; at: number }
  | { status: "done"; at: number; mime: "audio/mpeg"; audio_base64: string; alignment?: Alignment }
  | { status: "failed"; at: number; error: string };

export interface StudioAudioDeps {
  blob: BlobBackend | null;
  eleven: ElevenConfig | null;
  env: Record<string, string | undefined>;
  now: number;
  fetcher?: typeof fetch;
  /** Defaults to waitUntil; tests await the work instead. */
  later?: (work: Promise<unknown>) => void;
}

const jobPath = (id: string) => `studio/audio/${id}.json`;
const DAY_FILE = "studio/audio/days.json";
const INDEX_FILE = "studio/audio/index.json";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** The job a body asks for, or null when it doesn't fit exactly. */
export function parseJob(body: unknown): AudioJob | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  if (b.mode === "tts" && only("mode", "text", "voice") && isText(b.text, TEXT_MAX)) {
    if (b.voice === undefined) return { mode: "tts", text: b.text };
    return typeof b.voice === "string" && VOICE.test(b.voice) ? { mode: "tts", text: b.text, voice: b.voice } : null;
  }
  if (b.mode === "music" && only("mode", "prompt", "length_ms") && isText(b.prompt, PROMPT_MAX)) {
    const ms = b.length_ms;
    return typeof ms === "number" && Number.isInteger(ms) && ms >= MUSIC_MIN_MS && ms <= MUSIC_MAX_MS ? { mode: "music", prompt: b.prompt, length_ms: ms } : null;
  }
  if (b.mode === "sfx" && only("mode", "text", "duration_seconds") && isText(b.text, PROMPT_MAX)) {
    const d = b.duration_seconds;
    if (d === undefined) return { mode: "sfx", text: b.text };
    return typeof d === "number" && Number.isFinite(d) && d >= SFX_MIN_S && d <= SFX_MAX_S ? { mode: "sfx", text: b.text, duration_seconds: d } : null;
  }
  return null;
}

const base64 = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

/** One ElevenLabs call. The key goes only in the header, never in a URL, a log or an error. */
export async function makeAudio(job: AudioJob, eleven: ElevenConfig, fetcher: typeof fetch): Promise<Stored> {
  const headers = { "Content-Type": "application/json", "xi-api-key": eleven.key };
  const signal = AbortSignal.timeout(300_000);
  let res: Response;
  if (job.mode === "tts") {
    res = await fetcher(`${API}/text-to-speech/${encodeURIComponent(job.voice ?? eleven.voice)}/with-timestamps?output_format=${FORMAT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: job.text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true } }),
      signal,
    });
    if (!res.ok) return { status: "failed", at: 0, error: `elevenlabs-${res.status}` };
    const out = (await res.json().catch(() => null)) as { audio_base64?: unknown; alignment?: Alignment } | null;
    if (!out || typeof out.audio_base64 !== "string" || !out.audio_base64) return { status: "failed", at: 0, error: "no-audio" };
    return { status: "done", at: 0, mime: "audio/mpeg", audio_base64: out.audio_base64, ...(out.alignment ? { alignment: out.alignment } : {}) };
  }
  if (job.mode === "music") {
    res = await fetcher(`${API}/music?output_format=${FORMAT}`, { method: "POST", headers, body: JSON.stringify({ prompt: job.prompt, music_length_ms: job.length_ms }), signal });
  } else {
    res = await fetcher(`${API}/sound-generation?output_format=${FORMAT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: job.text, ...(job.duration_seconds !== undefined ? { duration_seconds: job.duration_seconds } : {}) }),
      signal,
    });
  }
  if (!res.ok) return { status: "failed", at: 0, error: `elevenlabs-${res.status}` };
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) return { status: "failed", at: 0, error: "no-audio" };
  return { status: "done", at: 0, mime: "audio/mpeg", audio_base64: base64(buf) };
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Takes one of the day's jobs; false when the day's cap is reached. */
async function takeSlot(blob: BlobBackend, now: number): Promise<boolean> {
  const day = dayOf(now);
  return updateJson(blob, DAY_FILE, {} as Record<string, number>, (cur) => {
    const used = typeof cur?.[day] === "number" ? cur[day]! : 0;
    if (used >= DAY_CAP) return { next: null, result: false };
    return { next: { [day]: used + 1 }, result: true };
  });
}

/** Records a new job and deletes results older than KEEP_MS. */
async function track(blob: BlobBackend, id: string, now: number): Promise<void> {
  const stale = await updateJson(blob, INDEX_FILE, [] as { id: string; at: number }[], (cur) => {
    const list = Array.isArray(cur) ? cur.filter((e) => e && typeof e.id === "string" && ID.test(e.id) && typeof e.at === "number") : [];
    return { next: [...list.filter((e) => now - e.at < KEEP_MS), { id, at: now }].slice(-200), result: list.filter((e) => now - e.at >= KEEP_MS) };
  });
  await Promise.all(stale.map((e) => blob.del(jobPath(e.id)).catch(() => undefined)));
}

const save = (blob: BlobBackend, id: string, value: Stored) =>
  blob.put(jobPath(id), JSON.stringify(value), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });

/** POST /api/studio-audio: the feed key only. */
export async function studioAudio(request: Request, deps: StudioAudioDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (!deps.blob || !deps.eleven) return json({ error: "not-set-up" }, 503);
  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const blob = deps.blob;

  if (body && typeof body === "object" && !Array.isArray(body) && "fetch" in body) {
    const id = (body as { fetch: unknown }).fetch;
    if (Object.keys(body).length !== 1 || typeof id !== "string" || !ID.test(id)) return json({ error: "bad-request" }, 400);
    const found = await readJson<Stored | null>(blob, jobPath(id), null);
    if (!found || deps.now - found.at >= KEEP_MS) return json({ error: "gone" }, 404);
    if (found.status === "working") return json({ status: "working" }, 202);
    if (found.status === "failed") return json({ status: "failed", error: found.error }, 502);
    return json({ status: "done", mime: found.mime, audio_base64: found.audio_base64, ...(found.alignment ? { alignment: found.alignment } : {}) });
  }

  const job = parseJob(body);
  if (!job) return json({ error: "bad-request" }, 400);
  if (!(await takeSlot(blob, deps.now))) return json({ error: "day-cap", cap: DAY_CAP }, 429);
  const id = randomBytes(12).toString("base64url");
  const at = deps.now;
  await save(blob, id, { status: "working", at });
  await track(blob, id, at).catch(() => undefined);
  const work = makeAudio(job, deps.eleven, deps.fetcher ?? fetch)
    .catch(() => ({ status: "failed", at: 0, error: "elevenlabs-down" }) as Stored)
    .then((done) => save(blob, id, { ...done, at }))
    .catch(() => undefined);
  (deps.later ?? waitUntil)(work);
  return json({ id, status: "working" }, 202);
}

export function POST(request: Request): Promise<Response> {
  return studioAudio(request, { blob: pickBlob(), eleven: elevenFromEnv(), env: process.env, now: Date.now() });
}
