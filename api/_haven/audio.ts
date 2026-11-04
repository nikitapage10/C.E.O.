/**
 * Skippy's voice for the phone (#627): the spoken answer as a short-lived, single-use link, and the greeting clips.
 *
 * The answer. When the shortcut sends `voice: true`, `say` is read by ElevenLabs in the one voice
 * (ELEVENLABS_VOICE_ID, `speakEleven` in api/_world/story.ts), under ElevenLabs' existing monthly cap (the day's
 * story's ledger, `world/stories/spend.json`, where every ElevenLabs character is counted). Past the cap, or when
 * ElevenLabs doesn't answer, `audio` is left out and the shortcut speaks `say` itself. The WAV is kept in the private
 * blob store (`haven/audio/<id>.wav`) and handed back as a link: `/api/capture?a=pa1.<expiry>.<id>.<mac>`, an HMAC
 * under a key derived from FOUNDRY_DESK_KEY (no new secret; never the phone's key), good for five minutes and once:
 * the file is deleted as it is served. The site gate checks the signature with the environment alone (api/_site/gate.ts).
 * Links never carry the phone's key or anything it said.
 *
 * The greeting clips. A few short lines in the same voice ("Yeah, what?"), made once from the Desk (signed in) and
 * kept as small MP3s (`haven/greet/<n>.mp3`, mono, 22 kHz, 32 kbps, a few kB each), served by GET /api/hey-skippy
 * (and /hey-skippy/hello.mp3) as a rotating pick. Nothing private is in them, so they are public by design.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { ELEVEN_URL, elevenCost, elevenRequest, canSpeakEleven, speakEleven, wavOf, type ElevenConfig, type StoryStore } from "../_world/story.js";
import { readJson, updateJson } from "./json.js";
import { audioKey, AUDIO_ID, signAudio } from "./links.js";

export { audioIdOf, audioKey, signAudio } from "./links.js";

/** How long an answer's audio link answers. */
export const AUDIO_MS = 5 * 60_000;
const AUDIO_INDEX = "haven/audio/index.json";
const audioPath = (id: string) => `haven/audio/${id}.wav`;
export interface VoiceDeps {
  blob: BlobBackend;
  eleven: ElevenConfig | null;
  /** The ElevenLabs ledger every voice shares (the stories' spend). */
  ledger: Pick<StoryStore, "loadSpend" | "addSpend"> | null;
  deskKey: string;
  fetcher?: typeof fetch;
}

/**
 * Reads `say` aloud and keeps it for one fetch: the link token, or null when it can't (no key, the month's cap
 * reached, ElevenLabs down). Counted against ElevenLabs' cap like every other voice.
 */
export async function speakForPhone(say: string, deps: VoiceDeps, now: number): Promise<string | null> {
  if (!deps.eleven || !deps.ledger || !audioKey(deps.deskKey)) return null;
  try {
    if (!canSpeakEleven(await deps.ledger.loadSpend(), now, deps.eleven.budget)) return null;
  } catch {
    return null;
  }
  const spoken = await speakEleven(say, deps.eleven, deps.fetcher ?? fetch);
  if (!spoken) return null;
  await deps.ledger.addSpend(now, { elevenUsd: elevenCost(spoken.chars), elevenChars: spoken.chars, elevenCalls: 1 }).catch(() => undefined);
  const id = randomBytes(12).toString("base64url");
  const until = now + AUDIO_MS;
  try {
    await deps.blob.put(audioPath(id), wavOf(spoken.pcm, spoken.sampleRate), { contentType: "audio/wav", addRandomSuffix: false, allowOverwrite: false });
    // The index lets the next answer clear any link that was never fetched.
    const stale = await updateJson(deps.blob, AUDIO_INDEX, [] as { id: string; until: number }[], (cur) => {
      const list = Array.isArray(cur) ? cur.filter((e) => e && typeof e.id === "string" && typeof e.until === "number") : [];
      return { next: [...list.filter((e) => e.until > now), { id, until }].slice(-50), result: list.filter((e) => e.until <= now) };
    });
    await Promise.all(stale.map((e) => (AUDIO_ID.test(e.id) ? deps.blob.del(audioPath(e.id)).catch(() => undefined) : undefined)));
  } catch {
    return null;
  }
  return signAudio(deps.deskKey, id, until);
}

/** The stored answer for a good token, once: deleted as it is read. Null when gone, used or never made. */
export async function takeAudio(blob: BlobBackend, id: string): Promise<Uint8Array | null> {
  const found = await blob.get(audioPath(id));
  if (!found) return null;
  const bytes = new Uint8Array(await new Response(found.stream).arrayBuffer());
  await blob.del(audioPath(id)).catch(() => undefined);
  return bytes.length ? bytes : null;
}

/* ── The greeting clips ── */

/** What Skippy says when the shortcut opens, one picked at random each time. */
export const GREETINGS = ["Yeah, what?", "Go on, monkey.", "I'm listening, unfortunately.", "Make it quick, I'm being magnificent."] as const;
const greetPath = (n: number) => `haven/greet/${n}.mp3`;
const GREET_STATE = "haven/greet/state.json";
/** The clip's format: mono MP3 at 22 kHz and 32 kbps, a few kB a line, well under 30 kB. */
export const GREET_FORMAT = "mp3_22050_32";
export const GREET_MAX_BYTES = 30 * 1024;

/** Which clips exist, and when they were made. */
export async function greetState(blob: BlobBackend): Promise<{ made: string | null; clips: number }> {
  const s = await readJson<{ made?: unknown; clips?: unknown }>(blob, GREET_STATE, {});
  return { made: typeof s.made === "string" ? s.made : null, clips: typeof s.clips === "number" ? s.clips : 0 };
}

/** One clip, as MP3 bytes from ElevenLabs; null when it didn't answer with one small enough. */
async function speakClip(text: string, eleven: ElevenConfig, fetcher: typeof fetch): Promise<Uint8Array | null> {
  try {
    const res = await fetcher(`${ELEVEN_URL}/${encodeURIComponent(eleven.voice)}?output_format=${GREET_FORMAT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": eleven.key },
      body: JSON.stringify(elevenRequest(text)),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !/audio\/mpeg/i.test(res.headers.get("content-type") ?? "")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 100 && bytes.length <= GREET_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Makes (or remakes) the greeting clips, under ElevenLabs' cap. How many were made, or why none were. */
export async function makeGreetings(deps: Omit<VoiceDeps, "deskKey">, now: number): Promise<{ clips: number } | { error: "no-voice" | "over-budget" | "eleven" }> {
  if (!deps.eleven || !deps.ledger) return { error: "no-voice" };
  if (!canSpeakEleven(await deps.ledger.loadSpend().catch(() => ({})), now, deps.eleven.budget)) return { error: "over-budget" };
  let made = 0;
  let chars = 0;
  for (const [i, line] of GREETINGS.entries()) {
    const bytes = await speakClip(line, deps.eleven, deps.fetcher ?? fetch);
    chars += line.length;
    if (!bytes) break;
    await deps.blob.put(greetPath(made), bytes, { contentType: "audio/mpeg", addRandomSuffix: false, allowOverwrite: true });
    made = i + 1;
  }
  await deps.ledger.addSpend(now, { elevenUsd: elevenCost(chars), elevenChars: chars, elevenCalls: GREETINGS.length }).catch(() => undefined);
  if (!made) return { error: "eleven" };
  await deps.blob.put(GREET_STATE, JSON.stringify({ made: new Date(now).toISOString(), clips: made }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  return { clips: made };
}

/** One of the clips, picked by `pick` (0 ≤ pick < 1); null when none have been made. */
export async function greetClip(blob: BlobBackend, pick: number): Promise<Uint8Array | null> {
  const { clips } = await greetState(blob);
  if (!clips) return null;
  const found = await blob.get(greetPath(Math.min(clips - 1, Math.floor(pick * clips))));
  return found ? new Uint8Array(await new Response(found.stream).arrayBuffer()) : null;
}
