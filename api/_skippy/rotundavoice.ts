/**
 * Today's Senate Rotunda read aloud (#755). Nikita, 2026-11-05: "Let's have a sound on button for the today page and have
 * some of these conversations actually voice acted ... it also will help the flow and the timing of things."
 *
 * With sound on, the chair (Skippy) speaks in his own voice, ELEVENLABS_VOICE_ID, Nikita's custom voice, and every
 * submind speaks in a premade ElevenLabs voice of its own that fits how it talks. This file is the one place each one is
 * picked (`ROTUNDA_VOICES`). The browser asks through the rooms' speak path, POST /api/skippy-room with
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

/** A member's voice in the chamber. */
export interface CastVoice {
  /** "The Builder". */
  name: string;
  /** The ElevenLabs premade voice, or null for Skippy's own (ELEVENLABS_VOICE_ID). */
  voice: string | null;
  /** The premade voice's name, for the docs and the lore. */
  voiceName: string;
  sound: VoiceSound;
}

const sound = (room: string, fallback: VoiceSound): VoiceSound => ROOM_VOICES[room]?.sound ?? fallback;

/**
 * Who speaks in which voice, keyed by the Rotunda's seat ids (its rooms; "kernel" is the chair). The premade voices are
 * ElevenLabs' default library, open to every plan, and no two members share one. The pace and steadiness are each
 * member's on the room mic (roomvoice.ts), so a submind sounds the same way in its room and in the chamber.
 */
export const ROTUNDA_VOICES: Record<string, CastVoice> = {
  kernel: { name: "Skippy, the Magnificent", voice: null, voiceName: "Skippy's own", sound: SKIPPY_SOUND },
  // A hot-tempered foreman: gravelly and short.
  foundry: { name: "The Builder", voice: "N2lVS1w4EtoT3dr4eOWO", voiceName: "Callum", sound: sound("foundry", SKIPPY_SOUND) },
  // A smarmy executive: smooth and persuasive.
  spire: { name: "The Executive", voice: "CwhRBWXzGAHq8TQ4Fs17", voiceName: "Roger", sound: sound("spire", SKIPPY_SOUND) },
  // A nervous odds-maker: young and quick.
  exchange: { name: "The Bookie", voice: "TX3LPaxmHKxFdv7VOQHJ", voiceName: "Liam", sound: sound("exchange", SKIPPY_SOUND) },
  // A play-by-play commentator: bright and hyped.
  green: { name: "The Commentator", voice: "IKne3meq5aSn9XLyUdCD", voiceName: "Charlie", sound: sound("green", SKIPPY_SOUND) },
  // A jittery gossip: playful and fast.
  relay: { name: "The Messenger", voice: "cgSgspJ2msm6clMCkdW9", voiceName: "Jessica", sound: sound("relay", SKIPPY_SOUND) },
  // A footnote-obsessed pedant: a warm British storyteller.
  archive: { name: "The Historian", voice: "JBFqnCBsd6RMkjVDRZzb", voiceName: "George", sound: sound("archive", SKIPPY_SOUND) },
  // The Breakroom's host: enthusiastic and quirky.
  breakroom: { name: "The Life of the Party", voice: "FGY2WhTYpPnrIDTdsKH5", voiceName: "Laura", sound: { speed: 1.08, stability: 0.32, similarity_boost: 0.75 } },
  // A gloomy pessimist: deep, low and slow.
  boiler: { name: "The Pessimist", voice: "nPczCjzI2devNBz1zQrb", voiceName: "Brian", sound: sound("boiler", SKIPPY_SOUND) },
  // A temperamental artiste: dramatic and breathy.
  workshop: { name: "The Artiste", voice: "XB0fDUnXU5powFXDhCwa", voiceName: "Charlotte", sound: sound("workshop", SKIPPY_SOUND) },
  // A dramatic auteur: a classy tenor.
  studio: { name: "The Director", voice: "cjVigY5qzO86Huf0OWal", voiceName: "Eric", sound: sound("studio", SKIPPY_SOUND) },
  // A house steward with a ledger: crisp and British.
  haven: { name: "The Steward", voice: "Xb7hH8MSUJpSbSDYk0k2", voiceName: "Alice", sound: sound("haven", SKIPPY_SOUND) },
  // A stage manager on a headset: level and neutral.
  annex: { name: "The Stagehand", voice: "SAz9YHcvj6GT2YYXdXww", voiceName: "River", sound: sound("annex", SKIPPY_SOUND) },
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
 * One line in a member's voice: from the cache when it has been said before, else made once by ElevenLabs Flash and kept.
 * Null when it can't be (no key, no store, the cap or the share reached, ElevenLabs down or slow).
 */
export async function speakCast(by: string, say: string, deps: CastDeps): Promise<{ audio: Uint8Array; cached: boolean } | null> {
  const cast = castVoiceOf(by);
  const text = say.replace(/\s+/g, " ").trim();
  if (!cast || !text || text.length > ROTUNDA_SAY_MAX || !deps.eleven || !deps.ledger || !deps.blob) return null;
  const voice = cast.voice ?? deps.eleven.voice;
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
