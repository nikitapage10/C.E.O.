/**
 * Talking to the rooms (#638): one tap on a Desk room's page and Nikita's words go straight to that room's submind, with
 * no call, no greeting and no introduction, and the answer comes back in Skippy's ElevenLabs voice, bent the submind's
 * way. Nikita, 2026-11-04 01:40Z: "It'll kind of record my voice right away and send it over to him, and he'll respond in
 * the Skippy voice with the Haven personality."
 *
 * This module is the data and the pure pieces: which submind leads which Desk room and how it talks (docs/SKIPPY.md,
 * "Voices"; the five on the Talk call reuse their on-air manner from voicecrew.ts), the extra rules Desk Skippy's chat
 * gets for a room's voice (`roomRules`), the spoken cut of an answer (`spokenRoom`), and the two ElevenLabs calls:
 * the answer read aloud (`speakRoom`, Flash for the first word fast, MP3 inline) and, for a browser without its own
 * speech recognition, a short clip transcribed (`transcribeRoom`, Scribe). Both count against ElevenLabs' one monthly
 * cap, the stories' ledger, like every voice. The route is api/_skippy/roomroute.ts.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { spokenOf } from "../_haven/classify.js";
import { canSpeakEleven, elevenCost, type ElevenConfig, type StoryStore } from "../_world/story.js";
import type { LogRoom } from "./log.js";
import { ANSWER_FIRST, UNSPOKEN } from "./ponder.js";
import { SKIPPY_SOUND, onAirById, type VoiceSound } from "./voicecrew.js";

/** A Desk room's voice: who answers there, and how. */
export interface RoomVoice {
  /** The Desk room (its route). */
  room: string;
  /** Its submind's id (packages/simulator/src/subminds.ts, SUBMINDS or DESK_SUBMINDS; a test holds this to them). */
  submind: string;
  name: string;
  /** The room as Nikita says it ("the Boiler Room"). */
  place: string;
  /** Where its exchanges are kept for the Council (api/_skippy/log.ts), or null for a room with no log of its own. */
  log: Exclude<LogRoom, "none" | "kernel"> | null;
  /** How it talks (docs/SKIPPY.md, "Voices"). */
  persona: string;
  /** Skippy's voice, bent its way (pace and steadiness), as on the call (#504). */
  sound: VoiceSound;
}

const onAir = (id: string) => {
  const s = onAirById(id);
  if (!s) throw new Error(`no on-air submind ${id}`);
  return { persona: s.persona, sound: s.sound };
};

/**
 * Every Desk page with a lead: each room with its submind, and Today with Skippy himself (hands-free on Today talks to
 * him; Today has no room mic, Ask Skippy is there).
 */
export const ROOM_VOICES: Record<string, RoomVoice> = {
  today: {
    room: "today",
    submind: "skippy",
    name: "Skippy",
    place: "Today",
    log: null,
    persona: "",
    sound: SKIPPY_SOUND,
  },
  green: {
    room: "green",
    submind: "turf",
    name: "The Commentator",
    place: "the Green",
    log: "green",
    ...onAir("turf"),
  },
  exchange: {
    room: "exchange",
    submind: "ticker",
    name: "The Bookie",
    place: "the Exchange",
    log: "exchange",
    ...onAir("ticker"),
  },
  relay: {
    room: "relay",
    submind: "static",
    name: "The Messenger",
    place: "Relay",
    log: "relay",
    ...onAir("static"),
  },
  boiler: {
    room: "boiler",
    submind: "soot",
    name: "The Pessimist",
    place: "the Boiler Room",
    log: "boiler",
    ...onAir("soot"),
  },
  foundry: {
    room: "foundry",
    submind: "ember",
    name: "The Builder",
    place: "the Foundry",
    log: "foundry",
    ...onAir("ember"),
  },
  spire: {
    room: "spire",
    submind: "gilt",
    name: "The Executive",
    place: "the Spire",
    log: null,
    persona:
      "a smarmy executive. Everything is a pitch or a synergy, every number is 'a real opportunity', and every compliment has a price tag. The Spire is still simulated, so you say so plainly when asked about real work there.",
    sound: { speed: 1.04, stability: 0.5, similarity_boost: 0.75 },
  },
  archive: {
    room: "archive",
    submind: "vellum",
    name: "The Historian",
    place: "the Archive",
    log: null,
    persona: "a footnote-obsessed pedant. You correct the record, cite your sources by name, and sigh at sloppy dates. The day's story and the Tide are yours.",
    sound: { speed: 0.94, stability: 0.6, similarity_boost: 0.75 },
  },
  workshop: {
    room: "workshop",
    submind: "putty",
    name: "The Artiste",
    place: "the Workshop",
    log: null,
    persona:
      "a temperamental artiste. Mood boards, sudden inspiration, you abandon a phrase for a better one, and you suffer for the work. The Workshop is still simulated, so you say so plainly when asked about real work there.",
    sound: { speed: 1.02, stability: 0.35, similarity_boost: 0.75 },
  },
  studio: {
    room: "studio",
    submind: "tally",
    name: "The Director",
    place: "the Studio",
    log: null,
    persona:
      "a dramatic auteur. You yell cut, demand one more take, and call every forty-second explainer a masterpiece. The Studio is still simulated, so you say so plainly when asked about real work there.",
    sound: { speed: 1.05, stability: 0.4, similarity_boost: 0.75 },
  },
  annex: {
    room: "annex",
    submind: "stagehand",
    name: "The Stagehand",
    place: "the Annex",
    log: null,
    persona:
      "a stage manager on a headset. You call cues, not speeches ('Standby. Go.'), strike a set without sentiment, and think the main rooms are a bit precious.",
    sound: { speed: 1.08, stability: 0.55, similarity_boost: 0.75 },
  },
  haven: {
    room: "haven",
    submind: "hearth",
    name: "The Steward",
    place: "the Haven",
    log: "haven",
    persona:
      "a warm, unflappable house steward with a dry wit, the one piece of Skippy who likes the monkeys' home more than he lets on. Lamplight voice, unhurried, practical: you know what's on the Kitchen list, which robot is out, and whether the cat has eaten, and you say it like a butler who has seen worse. You fuss over the pets and pretend not to. Never a floor plan, an address or anything that says where the home is.",
    sound: { speed: 0.97, stability: 0.55, similarity_boost: 0.8 },
  },
};

export const roomVoiceOf = (room: unknown): RoomVoice | null => (typeof room === "string" && Object.hasOwn(ROOM_VOICES, room) ? ROOM_VOICES[room]! : null);

/** Words a room's voice never says (Nikita, 2026-10-27): the plumbing, never the persona. */
export const ROOM_UNSPOKEN = /\b(?:crew|team|threads?|builder|kernel)\b/i;

/**
 * What Desk Skippy's chat is told on a room's voice, after his own prompt: answer as the room's submind, spoken, short,
 * no greeting. The answer comes first (voice-calls-answer-first, voice-skippy-brevity).
 */
export function roomRules(v: RoomVoice): string {
  const tag = v.log ? `Set "room" to "${v.log}" unless it is real work for your deeper self ("kernel").` : `Set "room" as usual.`;
  const who =
    v.submind === "skippy"
      ? `Right now Nikita is talking to you by voice from Today's page on the Desk, hands-free, with no call. You answer as yourself.`
      : `Right now Nikita is talking to you by voice from ${v.place}'s page on the Desk, with no call. You answer as ${v.name}, Skippy's submind for ${v.place}: a lesser echo of Skippy, his voice and snark bent your own way, and you know you live in a simulation. How you talk: ${v.persona}`;
  return `${who} Your reply is spoken aloud in Skippy's voice and shown for a moment; nothing else is shown. No greeting, no sign-on, no introduction and never your own name: start with the answer. ${ANSWER_FIRST} One or two short spoken sentences, never more; no lists, no asides, no links or symbols. Never say crew, team, thread, Builder or Kernel out loud. There are no buttons here, so leave "actions" empty. When it needs real work or a deeper look, give your quick take in one sentence and pass it on as usual; the Desk adds that the rest goes there, so don't say it yourself. ${tag}`;
}

/**
 * The answer cut for speaking: the first two sentences (one on a hand-off, with the Desk's line after), any sentence
 * that names the plumbing dropped. Never empty.
 */
export function spokenRoom(reply: string, handedOff: boolean): string {
  const kept = reply
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => s && !UNSPOKEN.test(s) && !ROOM_UNSPOKEN.test(s))
    .join(" ");
  return spokenOf(kept, handedOff);
}

/* ── ElevenLabs ── */

/** The speaking model: Flash, ElevenLabs' fastest to the first word, in the one voice (ELEVENLABS_VOICE_ID). */
export const ROOM_TTS_MODEL = "eleven_flash_v2_5";
/** MP3, small enough to come back inside the answer (two sentences are 20 to 60 kB). */
export const ROOM_TTS_FORMAT = "mp3_44100_64";
/** The most an answer read aloud may be. */
export const ROOM_SAY_MAX = 300;
const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
/** The transcription model. */
export const ROOM_STT_MODEL = "scribe_v1";
/** The longest clip taken: about forty seconds of Opus or AAC. */
export const CLIP_MAX_BYTES = 512 * 1024;
/** What a clip is counted as against the cap: Scribe's rate for a minute (about $0.40 an hour), kept on the safe side. */
export const CLIP_USD = 0.01;

type Ledger = Pick<StoryStore, "loadSpend" | "addSpend">;

/** Whether ElevenLabs' monthly cap has room. Unreadable means no (fail closed). */
async function underCap(eleven: ElevenConfig, ledger: Ledger, now: number): Promise<boolean> {
  try {
    return canSpeakEleven(await ledger.loadSpend(), now, eleven.budget);
  } catch {
    return false;
  }
}

/**
 * The answer read aloud in the one voice with the submind's bend: MP3 bytes, or null (no key, the cap reached,
 * ElevenLabs down or slow). Counted against the cap at the stories' rate, which keeps Flash's cheaper characters on the
 * safe side.
 */
export async function speakRoom(
  say: string,
  sound: VoiceSound,
  eleven: ElevenConfig | null,
  ledger: Ledger | null,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const text = say.trim().slice(0, ROOM_SAY_MAX);
  if (!eleven || !ledger || !text || !(await underCap(eleven, ledger, now))) return null;
  try {
    const res = await fetcher(`${TTS_URL}/${encodeURIComponent(eleven.voice)}?output_format=${ROOM_TTS_FORMAT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": eleven.key,
      },
      body: JSON.stringify({
        text,
        model_id: ROOM_TTS_MODEL,
        voice_settings: {
          stability: sound.stability,
          similarity_boost: sound.similarity_boost,
          speed: sound.speed,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 100) return null;
    await ledger
      .addSpend(now, {
        elevenUsd: elevenCost(text.length),
        elevenChars: text.length,
        elevenCalls: 1,
      })
      .catch(() => undefined);
    return bytes;
  } catch {
    return null;
  }
}

/** The audio types a clip may come in (what MediaRecorder makes in Chrome, Firefox and Safari). */
export const CLIP_TYPES = /^audio\/(?:webm|ogg|mp4|mpeg|aac|wav|x-m4a)(?:;.*)?$/i;

/**
 * A short clip transcribed by ElevenLabs Scribe, for a browser without speech recognition of its own: the words, or
 * null. The clip goes nowhere else and is never kept; the words are never logged.
 */
export async function transcribeRoom(
  clip: Uint8Array,
  type: string,
  eleven: ElevenConfig | null,
  ledger: Ledger | null,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!eleven || !ledger || !clip.length || clip.length > CLIP_MAX_BYTES || !CLIP_TYPES.test(type) || !(await underCap(eleven, ledger, now))) return null;
  try {
    const form = new FormData();
    form.append("model_id", ROOM_STT_MODEL);
    form.append("tag_audio_events", "false");
    form.append("file", new Blob([clip as Uint8Array<ArrayBuffer>], { type: type.split(";")[0] }), "clip");
    const res = await fetcher(STT_URL, {
      method: "POST",
      headers: { "xi-api-key": eleven.key },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    await ledger.addSpend(now, { elevenUsd: CLIP_USD, elevenCalls: 1 }).catch(() => undefined);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
    } | null;
    const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    return text || null;
  } catch {
    return null;
  }
}
