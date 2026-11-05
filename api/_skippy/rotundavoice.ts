/**
 * Today's Senate Rotunda read aloud (#755). Nikita, 2026-11-05: "Let's have a sound on button for the today page and have
 * some of these conversations actually voice acted ... it also will help the flow and the timing of things."
 *
 * With sound on, every member speaks in Skippy's own voice, ELEVENLABS_VOICE_ID, Nikita's custom Skippy voice: they are
 * all Skippys, the chair and his subminds alike (Nikita, 2026-11-05: "when I turn sound on, it's not actually Skippy's
 * voice"; until then each submind had a premade ElevenLabs voice of its own). What still tells them apart is each
 * member's pace and steadiness, the same bend it has on its room's mic. This file is the one place each one is set
 * (`ROTUNDA_VOICES`). The browser asks through the rooms' speak path, POST /api/skippy-room with
 * `{ room: "today", speak, as }` (roomroute.ts). Only the Rotunda's captions are ever sent, and they are public-safe by
 * construction (counts, room names, public titles; rite.ts). The privacy check still runs on every line.
 *
 * Cost (Nikita's Creator plan, a $10 monthly cap): every line is kept in the private blob store under a hash of its words,
 * its voice, its settings and the model, so each line is synthesised once ever. The canned lines (the gallery's murmurs,
 * the Pessimist's counterpoints) cost nothing after their first play. A line that has to be made checks ElevenLabs' one
 * monthly cap (the stories' ledger, like every voice) and the Rotunda's own share of it, so the chamber can never eat
 * the day's story. Past either one, or with ElevenLabs down, nothing comes back and the browser reads the caption at
 * reading pace instead.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import { canSpeakEleven, elevenCost, storyMonth, type ElevenConfig, type StoryStore } from "../_world/story.js";
import { ROOM_TTS_FORMAT, ROOM_TTS_MODEL, ROOM_VOICES } from "./roomvoice.js";
import { SKIPPY_SOUND, type VoiceSound } from "./voicecrew.js";
import { rateOf } from "../../apps/desk/src/rotunda/senators.ts";

/** A member's voice in the chamber: always Skippy's own (ELEVENLABS_VOICE_ID), bent its way. */
export interface CastVoice {
  /** "The Builder". */
  name: string;
  /** Its pace and steadiness in Skippy's voice. */
  sound: VoiceSound;
}

/**
 * A member's sound in the chamber: its room mic's pace and steadiness, made at a pace that comes back to that once the
 * browser shifts it into the member's register (#856; senators.ts, `VOICE_PITCH`: a line played a tone up also plays
 * faster). ElevenLabs takes 0.7 to 1.2.
 */
const sound = (room: string, fallback: VoiceSound): VoiceSound => {
  const s = ROOM_VOICES[room]?.sound ?? fallback;
  return { ...s, speed: Math.round(Math.min(1.2, Math.max(0.7, s.speed / rateOf(room))) * 100) / 100 };
};

/**
 * Who speaks how, keyed by the Rotunda's seat ids (its rooms; "kernel" is the chair). One voice, Skippy's, for all of
 * them; the pace and steadiness are each member's on the room mic (roomvoice.ts), so a submind sounds the same way in its
 * room and in the chamber.
 */
export const ROTUNDA_VOICES: Record<string, CastVoice> = {
  kernel: { name: "Skippy, the Magnificent", sound: SKIPPY_SOUND }, // the central voice, at its own pitch
  // A hot-tempered foreman: measured and heavy.
  foundry: { name: "The Builder", sound: sound("foundry", SKIPPY_SOUND) },
  // A smarmy executive: smooth.
  spire: { name: "The Executive", sound: sound("spire", SKIPPY_SOUND) },
  // A nervous odds-maker: quick and a little unsteady.
  exchange: { name: "The Bookie", sound: sound("exchange", SKIPPY_SOUND) },
  // A play-by-play commentator: fast and hyped.
  green: { name: "The Commentator", sound: sound("green", SKIPPY_SOUND) },
  // A jittery gossip: the fastest in the chamber.
  relay: { name: "The Messenger", sound: sound("relay", SKIPPY_SOUND) },
  // A footnote-obsessed pedant: slow and even.
  archive: { name: "The Historian", sound: sound("archive", SKIPPY_SOUND) },
  // The Breakroom's host: bright and loose.
  breakroom: { name: "The Life of the Party", sound: sound("breakroom", { speed: 1.08, stability: 0.32, similarity_boost: 0.75 }) },
  // A gloomy pessimist: the slowest and flattest.
  boiler: { name: "The Pessimist", sound: sound("boiler", SKIPPY_SOUND) },
  // A temperamental artiste: dramatic and wavering.
  workshop: { name: "The Artiste", sound: sound("workshop", SKIPPY_SOUND) },
  // A dramatic auteur: brisk.
  studio: { name: "The Director", sound: sound("studio", SKIPPY_SOUND) },
  // A house steward with a ledger: unhurried and crisp.
  haven: { name: "The Steward", sound: sound("haven", SKIPPY_SOUND) },
  // A stage manager on a headset: quick and level.
  annex: { name: "The Stagehand", sound: sound("annex", SKIPPY_SOUND) },
};

export const castVoiceOf = (by: unknown): CastVoice | null => (typeof by === "string" && Object.hasOwn(ROTUNDA_VOICES, by) ? ROTUNDA_VOICES[by]! : null);

/** The Rotunda's share of ElevenLabs' monthly cap, in dollars at the ledger's rate: the rest stays for the stories and calls. */
export const ROTUNDA_SHARE_USD = 3;
/** Where the lines are kept, one MP3 each, named by their hash. */
export const ROTUNDA_CACHE = "rotunda-voice/";
/** The longest line spoken (a caption is well under it). */
export const ROTUNDA_SAY_MAX = 300;

/** A line's name in the cache: a SHA-256 of everything that changes how it sounds. */
export async function lineKey(text: string, voice: string, s: VoiceSound): Promise<string> {
  const raw = JSON.stringify([ROOM_TTS_MODEL, ROOM_TTS_FORMAT, voice, s.speed, s.stability, s.similarity_boost, text]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return `${ROTUNDA_CACHE}${Buffer.from(hash).toString("hex")}.mp3`;
}

type Ledger = Pick<StoryStore, "loadSpend" | "addSpend">;

/** Whether one more line fits ElevenLabs' cap and the Rotunda's share of it. Unreadable means no (fail closed). */
export async function rotundaUnderCap(eleven: ElevenConfig, ledger: Ledger, now: number, chars: number): Promise<boolean> {
  try {
    const spend = await ledger.loadSpend();
    return canSpeakEleven(spend, now, eleven.budget) && storyMonth(spend, now).rotundaUsd + elevenCost(chars) <= Math.min(ROTUNDA_SHARE_USD, eleven.budget);
  } catch {
    return false;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface CastDeps {
  blob: BlobBackend | null;
  eleven: ElevenConfig | null;
  ledger: Ledger | null;
  now: number;
  fetcher: typeof fetch;
}

/**
 * One line in Skippy's voice, bent the member's way: from the cache when it has been said before, else made once by ElevenLabs Flash and kept.
 * Null when it can't be (no key, no store, the cap or the share reached, ElevenLabs down or slow).
 */
export async function speakCast(by: string, say: string, deps: CastDeps): Promise<{ audio: Uint8Array; cached: boolean } | null> {
  const cast = castVoiceOf(by);
  const text = say.replace(/\s+/g, " ").trim();
  if (!cast || !text || text.length > ROTUNDA_SAY_MAX || !deps.eleven || !deps.ledger || !deps.blob) return null;
  // Skippy's own voice for every member (ELEVENLABS_VOICE_ID, read by elevenFromEnv).
  const voice = deps.eleven.voice;
  const path = await lineKey(text, voice, cast.sound);
  try {
    const kept = await deps.blob.get(path, { cached: true });
    if (kept) {
      const audio = await readAll(kept.stream);
      if (audio.length >= 100) return { audio, cached: true };
    }
  } catch {
    /* an unreadable cache is a miss */
  }
  if (!(await rotundaUnderCap(deps.eleven, deps.ledger, deps.now, text.length))) return null;
  try {
    const res = await deps.fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${ROOM_TTS_FORMAT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": deps.eleven.key },
      body: JSON.stringify({
        text,
        model_id: ROOM_TTS_MODEL,
        voice_settings: { stability: cast.sound.stability, similarity_boost: cast.sound.similarity_boost, speed: cast.sound.speed, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const audio = new Uint8Array(await res.arrayBuffer());
    if (audio.length < 100) return null;
    const usd = elevenCost(text.length);
    await deps.ledger.addSpend(deps.now, { elevenUsd: usd, elevenChars: text.length, elevenCalls: 1, rotundaUsd: usd, rotundaChars: text.length }).catch(() => undefined);
    await deps.blob.put(path, audio, { contentType: "audio/mpeg", allowOverwrite: true, cacheControlMaxAge: 31_536_000 }).catch(() => undefined);
    return { audio, cached: false };
  } catch {
    return null;
  }
}
