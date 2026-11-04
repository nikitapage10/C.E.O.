import { create } from "zustand";
import { ponderLine } from "../../../../../api/_skippy/ponder.ts";
import type { RoomIntent, RoomIntentAction, RoomMic, RoomUtterance } from "../../../../../packages/engine/src/voice.ts";

/**
 * The room mic, browser side (#638): one tap (or hold Space) on a Desk room's page and Nikita talks straight to the room's
 * submind. Nikita, 2026-11-04: "It'll kind of record my voice right away and send it over to him, and he'll respond in the
 * Skippy voice with the Haven personality." No call, no greeting: listening starts on the press, and on the release (or a
 * second tap, or a pause after a tap) the words go to POST /api/skippy-room and the answer plays in Skippy's voice.
 *
 * The words come from the browser's own speech recognition where it has one (Chrome, Edge, Safari); where it hasn't
 * (Firefox), a short clip goes to the function instead and ElevenLabs Scribe writes the words. Nothing is kept here but
 * the room's last few turns, in memory, so a follow-on follows on; they are forgotten on reload.
 */

export type MicPhase = "idle" | "listening" | "thinking" | "speaking" | "said";

/** Past this, a press was a hold: the release sends. A shorter press is a tap, and listening goes on. */
export const HOLD_MS = 350;
/** After a tap, this much quiet after the last words sends them. */
export const TAP_QUIET_MS = 1_600;
/** After a tap with nothing heard at all, give up. */
export const TAP_EMPTY_MS = 8_000;
/** The one waiting line shows only when the answer takes longer than this. */
export const WAIT_LINE_MS = 1_200;
/** How long the answer's text stays once it has been said (or shown, without audio). */
export const SAID_MS = 6_000;
/** The room's turns kept for a follow-on, and for how long. */
const KEEP_TURNS = 6;
const KEEP_MS = 10 * 60_000;
const TEXT_MAX = 300;

export interface RoomAnswer {
  ok: boolean;
  /** Buttons a room's own intent handler offered with its answer. */
  actions?: readonly RoomIntentAction[];
  say: string;
  /** Which way the ask went: "skippy" (the submind answered), "device", "shopping" or "todo" (the Haven's rules). */
  kind: string;
  /** The answer read aloud, MP3, base64; left out when the voice is capped or down. */
  audio?: string;
}

const SAYS: Record<number, string> = {
  401: "Sign in on the Desk to talk to the rooms.",
  413: "That was too long for me. Keep it short.",
  503: "The rooms can't talk on this site yet.",
};

/** One ask to the function: the words (or a clip), the room, its last few turns. */
export async function askRoom(
  room: string,
  said: { text: string } | { clip: Blob },
  history: Turn[],
  last: string | null,
  doFetch: typeof fetch = fetch,
): Promise<RoomAnswer> {
  try {
    const res =
      "text" in said
        ? await doFetch("/api/skippy-room", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              room,
              text: said.text.slice(0, TEXT_MAX),
              history,
              ...(last && { last }),
            }),
          })
        : await doFetch(`/api/skippy-room?room=${encodeURIComponent(room)}`, {
            method: "POST",
            headers: { "Content-Type": said.clip.type || "audio/webm" },
            credentials: "same-origin",
            body: said.clip,
          });
    const body = (await res.json().catch(() => ({}))) as {
      say?: unknown;
      kind?: unknown;
      audio?: unknown;
    };
    const say = typeof body.say === "string" ? body.say.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    const kind = typeof body.kind === "string" ? body.kind : "skippy";
    if (!res.ok)
      return {
        ok: false,
        say: say || SAYS[res.status] || "That didn't go through. Try again.",
        kind,
      };
    if (!say) return { ok: false, say: "That didn't go through. Try again.", kind };
    const audio = typeof body.audio === "string" && /^[A-Za-z0-9+/=]{100,}$/.test(body.audio) ? body.audio : undefined;
    return { ok: true, say, kind, ...(audio && { audio }) };
  } catch {
    return {
      ok: false,
      say: "That didn't go through. Try again.",
      kind: "skippy",
    };
  }
}

/** A room's own line read aloud (`{ room, speak }`): the MP3 as base64, or undefined (capped, down, signed out). */
export async function speakLine(room: string, say: string, doFetch: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const res = await doFetch("/api/skippy-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ room, speak: say.slice(0, TEXT_MAX) }),
    });
    const body = (await res.json().catch(() => ({}))) as { audio?: unknown };
    return res.ok && typeof body.audio === "string" && /^[A-Za-z0-9+/=]{100,}$/.test(body.audio) ? body.audio : undefined;
  } catch {
    return undefined;
  }
}

/* ── A room's own intent handler (its manifest's `voice`, @ceo/engine/voice) ── */

/** Every room's manifest, each loaded only when its room is first spoken to. */
const MANIFESTS = import.meta.glob<{
  default: { voice?: () => Promise<{ intent: RoomIntent }> };
}>("../../../../../rooms/*/room.ts");
const intents = new Map<string, Promise<RoomIntent | null>>();

/** The room's intent handler, or null when it has none (then its submind answers everything). Loaded once. */
export function intentFor(
  room: string,
  manifests: Record<
    string,
    () => Promise<{
      default: { voice?: () => Promise<{ intent: RoomIntent }> };
    }>
  > = MANIFESTS,
): Promise<RoomIntent | null> {
  let got = intents.get(room);
  if (!got) {
    const load = manifests[`../../../../../rooms/${room}/room.ts`];
    got = load
      ? load()
          .then((m) => (m.default.voice ? m.default.voice().then((v) => v.intent) : null))
          .catch(() => null)
      : Promise.resolve(null);
    intents.set(room, got);
  }
  return got;
}
export const forgetIntents = () => intents.clear();

/**
 * Words to a room: its own intent handler first, if it has one and takes them; else its submind (the function). A room's
 * own answer is read aloud through the same voice.
 */
export async function answerWords(
  room: string,
  text: string,
  via: RoomUtterance["via"],
  history: Turn[],
  last: string | null,
  doFetch: typeof fetch = fetch,
  intent: Promise<RoomIntent | null> = intentFor(room),
): Promise<RoomAnswer> {
  const handler = await intent;
  const mine = handler ? await handler({ text, room, via, history }).catch(() => null) : null;
  const say = mine?.say.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  if (say) {
    const audio = await speakLine(room, say, doFetch);
    return {
      ok: true,
      say,
      kind: "intent",
      ...(audio && { audio }),
      ...(mine?.actions?.length && { actions: mine.actions.slice(0, 3) }),
    };
  }
  return askRoom(room, { text }, history, last, doFetch);
}

/* ── The room's last few turns ── */

export interface Turn {
  who: "nikita" | "skippy";
  text: string;
}
const memory = new Map<string, { at: number; turns: Turn[]; last: string | null }>();

/** The room's turns and which way its last ask went, empty after ten quiet minutes. */
export function recall(room: string, now = Date.now()): { turns: Turn[]; last: string | null } {
  const m = memory.get(room);
  return m && now - m.at < KEEP_MS ? { turns: m.turns, last: m.last } : { turns: [], last: null };
}

export function remember(room: string, said: string, answer: string, kind: string, now = Date.now()): void {
  const turns = [...recall(room, now).turns, { who: "nikita" as const, text: said }, { who: "skippy" as const, text: answer }].slice(-KEEP_TURNS);
  memory.set(room, { at: now, turns, last: kind });
}

export const forgetRooms = () => memory.clear();

/* ── Listening ── */

/** The slice of the Web Speech API used here. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const canRecord = () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Whether this browser can hear Nikita at all: its own recognition, or a clip for the function. */
export const micSupported = (): boolean => recognitionClass() !== null || canRecord();

/** What a listen came to: the words, a clip, nothing, or why not. */
export type Heard = { text: string } | { clip: Blob } | { none: true } | { error: string };

/** One listen: started on the press, finished on the release. `onWords` gets the words as they come. */
export interface Listener {
  finish(): Promise<Heard>;
  cancel(): void;
}

export function listen(onWords: (words: string) => void): Listener {
  const Rec = recognitionClass();
  return Rec ? recognise(Rec, onWords) : record();
}

function recognise(Rec: new () => Recognition, onWords: (words: string) => void): Listener {
  const r = new Rec();
  r.lang = navigator.language || "en-US";
  r.continuous = true;
  r.interimResults = true;
  let finished = "";
  let tail = "";
  let error: string | null = null;
  let ended = false;
  let done: (() => void) | null = null;
  r.onresult = (e) => {
    tail = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      const t = res[0]?.transcript ?? "";
      if (res.isFinal) finished += `${t.trim()} `;
      else tail += t;
    }
    onWords(`${finished}${tail}`.trim());
  };
  r.onerror = (e) => {
    if (e.error && e.error !== "no-speech" && e.error !== "aborted")
      error = e.error === "not-allowed" ? "The browser blocked the microphone." : "Couldn't hear that. Try again.";
  };
  r.onend = () => {
    ended = true;
    done?.();
  };
  try {
    r.start();
  } catch {
    error = "Couldn't start listening.";
    ended = true;
  }
  return {
    finish: () =>
      new Promise<Heard>((resolve) => {
        const settle = () => {
          const text = `${finished}${tail}`.replace(/\s+/g, " ").trim();
          resolve(error && !text ? { error } : text ? { text } : { none: true });
        };
        if (ended) return settle();
        done = settle;
        // The last words arrive as the recognition stops; give it a moment, never longer.
        setTimeout(() => {
          done = null;
          settle();
        }, 1_500);
        try {
          r.stop();
        } catch {
          settle();
        }
      }),
    cancel: () => {
      ended = true;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

function record(): Listener {
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let error: string | null = null;
  let cancelled = false;
  const chunks: Blob[] = [];
  const ready = navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((s) => {
      stream = s;
      if (cancelled) return stop();
      rec = new MediaRecorder(s);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start();
    })
    .catch(() => {
      error = "The browser blocked the microphone.";
    });
  const stop = () => stream?.getTracks().forEach((t) => t.stop());
  return {
    finish: async () => {
      await ready;
      if (error || !rec) return { error: error ?? "Couldn't start listening." };
      const r = rec as MediaRecorder;
      const stopped = new Promise<void>((res) => (r.onstop = () => res()));
      r.stop();
      await stopped;
      stop();
      const clip = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      return clip.size > 1_000 ? { clip } : { none: true };
    },
    cancel: () => {
      cancelled = true;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      stop();
    },
  };
}

/* ── Speaking ── */

/** A tenth of a second of silence (WAV), played on the press so a phone lets the answer play later without a tap. */
export function silentWav(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8_000, true);
  v.setUint32(28, 16_000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/* ── The mic's state, for the control ── */

export interface MicStore {
  phase: MicPhase;
  /** The room the mic is talking to. */
  room: string | null;
  /** The words as they come. */
  heard: string;
  /** The one waiting line, while a slow answer is on its way. */
  waiting: string | null;
  /** The answer as said, or what went wrong. */
  say: string;
  failed: boolean;
  /** Release to the answer's first sound, in ms (the last ask's). */
  ms: number | null;
  /** Buttons the room's own answer offers, while its line shows. */
  actions: readonly RoomIntentAction[];
  /** Hands-free: off or on. On with no target (Ask Skippy or a call has the floor, or the page has no lead) waits. */
  hf: "off" | "on";
  /** Hands-free: the words as they come, before they are sent. */
  hfHeard: string;
  /** Who hands-free talks to: the lead of the page Nikita is on. */
  target: RoomMic | null;
  /** A page with a listener of its own (Relay's Thread, #615): it has Space, and while it listens hands-free waits. */
  own: { space: boolean; listening: boolean } | null;
  set: (patch: Partial<Omit<MicStore, "set">>) => void;
}

export const useRoomMic = create<MicStore>((set) => ({
  phase: "idle",
  room: null,
  heard: "",
  waiting: null,
  say: "",
  failed: false,
  ms: null,
  actions: [],
  hf: "off",
  hfHeard: "",
  target: null,
  own: null,
  set: (patch) => set(patch),
}));

/** The waiting line for an ask: one of Skippy's, picked by the words so the next ask moves on. */
export const waitLine = (said: string) => ponderLine(said);

/* ── The mic's run: one listen and one answer at a time, outside React ── */

let listener: Listener | null = null;
let pressedAt = 0;
let tapMode = false;
let quiet: ReturnType<typeof setTimeout> | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
let player: HTMLAudioElement | null = null;
/** Which ask is current: a later press, a new room or leaving the page makes an answer still on its way stale. */
let current = 0;

const patch = (p: Partial<Omit<MicStore, "set">>) => useRoomMic.getState().set(p);
const clearTimers = () => {
  if (quiet) clearTimeout(quiet);
  quiet = null;
  timers.forEach(clearTimeout);
  timers = [];
};
const hush = () => {
  if (player && !player.paused) player.pause();
};
const later = (n: number, after: number) => {
  timers.push(
    setTimeout(
      () =>
        current === n &&
        patch({
          phase: "idle",
          say: "",
          heard: "",
          failed: false,
          actions: [],
        }),
      after,
    ),
  );
};

/** Stops whatever the mic is doing: listening, waiting or speaking. */
export function micReset(room: string | null = useRoomMic.getState().room): void {
  clearTimers();
  listener?.cancel();
  listener = null;
  hush();
  current++;
  patch({
    room,
    phase: "idle",
    heard: "",
    waiting: null,
    say: "",
    failed: false,
    actions: [],
  });
}

/** The words are in: send them, show the one waiting line if it's slow, play the answer. */
async function send(room: string, got: Heard, via: RoomUtterance["via"] = "tap", doFetch: typeof fetch = fetch): Promise<void> {
  const n = ++current;
  if ("error" in got || "none" in got) {
    patch({
      phase: "said",
      say: "error" in got ? got.error : "I didn't catch anything. Try again.",
      failed: true,
      waiting: null,
    });
    return later(n, 3_000);
  }
  const words = "text" in got ? got.text : "";
  const t0 = performance.now();
  patch({
    room,
    phase: "thinking",
    waiting: null,
    say: "",
    failed: false,
    actions: [],
  });
  timers.push(setTimeout(() => current === n && patch({ waiting: waitLine(words || room) }), WAIT_LINE_MS));
  const { turns, last } = recall(room);
  const answer = "text" in got ? await answerWords(room, got.text, via, turns, last, doFetch) : await askRoom(room, { clip: got.clip }, turns, last, doFetch);
  if (current !== n) return;
  if (answer.ok && words) remember(room, words, answer.say, answer.kind);
  const a = player;
  const actions = answer.actions ?? [];
  // Buttons stay a while longer, to be read and tapped.
  const stay = actions.length ? SAID_MS * 3 : SAID_MS;
  if (!answer.audio || !a) {
    patch({
      phase: "said",
      say: answer.say,
      failed: !answer.ok,
      waiting: null,
      actions,
    });
    return later(n, stay);
  }
  patch({
    phase: "speaking",
    say: answer.say,
    failed: false,
    waiting: null,
    actions,
  });
  a.onplaying = () => current === n && patch({ ms: Math.round(performance.now() - t0) });
  a.onended = () => {
    if (current !== n) return;
    patch({ phase: "said" });
    later(n, actions.length ? stay : SAID_MS / 2);
  };
  a.src = `data:audio/mpeg;base64,${answer.audio}`;
  await a.play().catch(() => {
    if (current !== n) return;
    patch({ phase: "said" });
    later(n, SAID_MS);
  });
}

/** The release of a hold, a second tap, or a pause after a tap: the words go. */
export async function micFinish(doFetch: typeof fetch = fetch): Promise<void> {
  clearTimers();
  const l = listener;
  const room = useRoomMic.getState().room;
  listener = null;
  if (!l || !room) return;
  patch({ phase: "thinking" });
  await send(room, await l.finish(), "tap", doFetch);
}

/** The press: listening starts at once, and the answer's audio is unlocked inside the gesture. A press while listening sends. */
export function micPress(room: string): void {
  if (listener) return void micFinish();
  clearTimers();
  current++;
  hush();
  unlockAudio();
  pressedAt = performance.now();
  tapMode = false;
  patch({
    room,
    phase: "listening",
    heard: "",
    waiting: null,
    say: "",
    failed: false,
    actions: [],
  });
  listener = listen((words) => {
    patch({ heard: words });
    // After a tap, a pause after the last words sends them.
    if (tapMode) {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(() => void micFinish(), TAP_QUIET_MS);
    }
  });
}

/** The release: a hold sends; a tap keeps listening until a pause, a second tap or the empty timeout. */
export function micRelease(): void {
  if (!listener) return;
  if (performance.now() - pressedAt >= HOLD_MS) return void micFinish();
  tapMode = true;
  quiet = setTimeout(() => void micFinish(), useRoomMic.getState().heard ? TAP_QUIET_MS : TAP_EMPTY_MS);
}

/** Runs a button the room's answer offered, then clears the line. */
export function runAction(a: RoomIntentAction): void {
  try {
    void Promise.resolve(a.run()).catch(() => undefined);
  } finally {
    micReset();
  }
}

/** Plays a moment of silence inside a tap, so a phone lets the answer play later without one. */
function unlockAudio(): void {
  player ??= new Audio();
  player.src = silentWav();
  player.play().catch(() => undefined);
}

/* ── Hands-free: one toggle in the bar, listening across pages (#638) ── */

/** After the last words, this much quiet sends them. */
export const HF_QUIET_MS = 1_100;
/** Hands-free turns itself off after this long with nothing said. */
export const HF_IDLE_MS = 10 * 60_000;
/** Too many failed restarts in a row (the mic gone, the service down) turns it off. */
const HF_MAX_FAILS = 5;

let hfRec: Recognition | null = null;
let hfWords = "";
let hfQuiet: ReturnType<typeof setTimeout> | null = null;
let hfIdle: ReturnType<typeof setTimeout> | null = null;
let hfFails = 0;
let hfBlocked = false;

/** Whether hands-free can run here: it needs the browser's own speech recognition (Chrome, Edge, Safari). */
export const handsFreeSupported = (): boolean => recognitionClass() !== null;

const hfIdleReset = () => {
  if (hfIdle) clearTimeout(hfIdle);
  hfIdle = setTimeout(() => handsFreeOff("Hands-free is off after ten quiet minutes."), HF_IDLE_MS);
};

/** Hands-free on: from a tap on the bar's toggle (the tap also unlocks the answer's audio). */
export function handsFreeOn(): void {
  if (!handsFreeSupported()) return;
  unlockAudio();
  hfFails = 0;
  hfBlocked = false;
  patch({ hf: "on", hfHeard: "" });
  hfIdleReset();
  handsFreeTick();
}

/** Hands-free off: from the toggle, ten quiet minutes, or the microphone refused. `why` shows for a moment. */
export function handsFreeOff(why?: string): void {
  hfStop();
  if (hfIdle) clearTimeout(hfIdle);
  hfIdle = null;
  patch({ hf: "off", hfHeard: "" });
  if (why && useRoomMic.getState().phase === "idle") {
    const n = ++current;
    patch({ phase: "said", say: why, failed: true });
    later(n, 3_000);
  }
}

function hfStop(): void {
  if (hfQuiet) clearTimeout(hfQuiet);
  hfQuiet = null;
  hfWords = "";
  const r = hfRec;
  hfRec = null;
  if (r) {
    r.onend = null;
    r.onresult = null;
    r.onerror = null;
    try {
      r.abort();
    } catch {
      /* already stopped */
    }
  }
}

/** Whether hands-free should be listening right now: on, a lead on this page, and the mic free (nothing asked or said). */
function hfShouldListen(): boolean {
  const s = useRoomMic.getState();
  return s.hf === "on" && !!s.target && !s.own?.listening && !listener && (s.phase === "idle" || s.phase === "said");
}

/** Starts or stops the one hands-free recognition to match the state. Called on every change that matters. */
export function handsFreeTick(): void {
  if (!hfShouldListen()) {
    if (hfRec) hfStop();
    if (useRoomMic.getState().hfHeard) patch({ hfHeard: "" });
    return;
  }
  if (hfRec || hfBlocked) return;
  const Rec = recognitionClass();
  if (!Rec) return handsFreeOff();
  const r = new Rec();
  r.lang = navigator.language || "en-US";
  r.continuous = true;
  r.interimResults = true;
  hfRec = r;
  hfWords = "";
  let finals = "";
  r.onresult = (e) => {
    let tail = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      const t = res[0]?.transcript ?? "";
      if (res.isFinal) finals += `${t.trim()} `;
      else tail += t;
    }
    hfWords = `${finals}${tail}`.replace(/\s+/g, " ").trim();
    hfFails = 0;
    hfIdleReset();
    patch({ hfHeard: hfWords });
    if (hfQuiet) clearTimeout(hfQuiet);
    if (hfWords) hfQuiet = setTimeout(hfSend, HF_QUIET_MS);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      hfBlocked = true;
      handsFreeOff("The browser blocked the microphone.");
    } else if (e.error && e.error !== "no-speech" && e.error !== "aborted") hfFails++;
  };
  r.onend = () => {
    // The browser stops a recognition now and then (a minute of quiet, a network blip): start the next one.
    if (hfRec !== r) return;
    hfRec = null;
    if (hfWords) return hfSend();
    if (hfFails >= HF_MAX_FAILS) return handsFreeOff("Hands-free lost the microphone.");
    setTimeout(handsFreeTick, 250);
  };
  try {
    r.start();
  } catch {
    hfRec = null;
    hfFails++;
    if (hfFails >= HF_MAX_FAILS) handsFreeOff("Couldn't start listening.");
  }
}

/** A pause after words: they go to the lead of the page Nikita is on now. */
function hfSend(): void {
  const words = hfWords.slice(0, TEXT_MAX);
  const target = useRoomMic.getState().target;
  hfStop();
  patch({ hfHeard: "" });
  if (!words || !target) return handsFreeTick();
  void send(target.room, { text: words }, "hands-free");
}

/** The page changed (or its lead did): hands-free follows. Pass null where there is no lead. */
export function setVoiceTarget(target: RoomMic | null): void {
  const was = useRoomMic.getState().target;
  if (was?.room === target?.room) return;
  // Words half-said to the last room are dropped, not sent to the new one.
  hfStop();
  patch({ target, hfHeard: "" });
  handsFreeTick();
}

// One listener at a time: hands-free steps aside while the room mic listens or an answer is on its way or being said,
// and comes back when the mic is free.
useRoomMic.subscribe((s, prev) => {
  if (s.phase !== prev.phase || s.hf !== prev.hf || s.target !== prev.target || s.own !== prev.own) handsFreeTick();
});

/**
 * A page that still runs a listener of its own says so (Relay's Thread, #615, until its intent layer moves onto the
 * room's `voice` hook): it keeps Space, and while it is listening hands-free waits, so only one thing listens. Null when
 * it goes.
 */
export function setOwnVoice(own: { space: boolean; listening: boolean } | null): void {
  const was = useRoomMic.getState().own;
  if (was?.space === own?.space && was?.listening === own?.listening) return;
  patch({ own });
}
