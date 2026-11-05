import { create } from "zustand";
import { silentWav } from "../roomvoice/roomVoice.ts";

/**
 * The Rotunda's sound (#755), browser side. Nikita, 2026-11-05: "Let's have a sound on button for the today page and have
 * some of these conversations actually voice acted." Off by default (browsers block sound until a tap), remembered per
 * device. While it is on, the chair and the subminds speak their captions: each line is asked of POST /api/skippy-room
 * (`{ room: "today", speak, as }`), which answers from its blob cache or makes the line once in that member's voice
 * (api/_skippy/rotundavoice.ts). The scene (rotundaScene.ts) waits on `say` to pace the choreography by the audio; when
 * a line can't be spoken (signed out, capped, down, blocked) `say` answers false at once and the caption is held for its
 * reading time instead, so a failure is never heard, only read.
 *
 * Murmurs play quieter on a second player, only while the main speaker is silent, and stop the moment it speaks.
 */

const KEY = "ceo.rotunda.sound";
/** The gallery's murmurs, against a speaker's 1. */
export const MURMUR_VOLUME = 0.32;
/** The most lines kept in memory as playable audio this visit. */
const KEEP = 96;
/** The most lines asked for at once. */
const AT_ONCE = 2;
/** A line that never reports its end is let go after this long. */
const LINE_MAX_MS = 30_000;

export const readSound = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};
const keepSound = (on: boolean) => {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private window: the choice lasts this visit */
  }
};

interface SoundStore {
  on: boolean;
  /** Someone in the chamber is speaking now (the level indicator moves). */
  speaking: boolean;
  set: (p: Partial<Omit<SoundStore, "set">>) => void;
}
export const useRotundaSound = create<SoundStore>((set) => ({
  on: typeof window !== "undefined" && readSound(),
  speaking: false,
  set: (p) => set(p),
}));

/** What the scene asks of the voice. */
export interface RotundaVoice {
  /** Speaks a line to its end: true once it has, false at once (or when stopped) when it can't be spoken. */
  say: (by: string, text: string) => Promise<boolean>;
  /** Starts fetching lines that are coming up, so they play without a wait. */
  prefetch: (lines: { by: string; text: string }[]) => void;
  /** A quiet murmur from the gallery, only while no one speaks: its length in seconds, or null when it wasn't played. */
  murmur: (by: string, text: string) => Promise<number | null>;
  /** Stops whatever is playing (a new item brought to the floor). */
  stop: () => void;
  /** Holds the sound while the chamber is out of view. */
  hold: (held: boolean) => void;
  dispose: () => void;
}

type Fetch = typeof fetch;

/** One line asked of the function: an object URL for its MP3, or null. `gone` says the function won't speak this visit. */
export async function fetchLine(by: string, text: string, doFetch: Fetch = fetch): Promise<{ url: string | null; gone: boolean }> {
  try {
    const res = await doFetch("/api/skippy-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ room: "today", speak: text.slice(0, 300), as: by }),
    });
    // Signed out, or the rooms' voice isn't on this site: stop asking until the page is opened again.
    if (res.status === 401 || res.status === 403 || res.status === 503) return { url: null, gone: true };
    const body = (await res.json().catch(() => ({}))) as { audio?: unknown };
    if (!res.ok || typeof body.audio !== "string" || !/^[A-Za-z0-9+/=]{100,}$/.test(body.audio)) return { url: null, gone: false };
    const bin = atob(body.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { url: URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })), gone: false };
  } catch {
    return { url: null, gone: false };
  }
}

/** The live voices' players, unlocked inside the tap that turns the sound on. */
const unlockers = new Set<() => void>();

const keyOf = (by: string, text: string) => `${by}\u0000${text}`;

export function createVoice(doFetch: Fetch = fetch): RotundaVoice {
  const lines = new Map<string, Promise<string | null>>();
  const queue: (() => void)[] = [];
  let running = 0;
  let gone = false;
  let dead = false;
  let held = false;
  const main = new Audio();
  const mur = new Audio();
  main.preload = mur.preload = "auto";
  let end: ((ok: boolean) => void) | null = null;
  let murEnd: (() => void) | null = null;
  const on = () => useRotundaSound.getState().on && !gone && !dead;
  const speaking = (v: boolean) => useRotundaSound.getState().speaking !== v && useRotundaSound.getState().set({ speaking: v });

  const pump = () => {
    while (running < AT_ONCE && queue.length) {
      running++;
      queue.shift()!();
    }
  };
  const get = (by: string, text: string): Promise<string | null> => {
    const k = keyOf(by, text);
    let got = lines.get(k);
    if (got) {
      // Most recently used last, so the oldest is let go first.
      lines.delete(k);
      lines.set(k, got);
      return got;
    }
    got = new Promise<string | null>((res) => {
      queue.push(() => {
        void fetchLine(by, text, doFetch).then((r) => {
          running--;
          if (r.gone) gone = true;
          res(r.url);
          pump();
        });
      });
      pump();
    });
    // A line that failed is asked again next time (the cap may have a new month).
    void got.then((u) => !u && lines.get(k) === got && lines.delete(k));
    lines.set(k, got);
    while (lines.size > KEEP) {
      const [oldest, p] = lines.entries().next().value as [string, Promise<string | null>];
      lines.delete(oldest);
      void p.then((u) => u && URL.revokeObjectURL(u));
    }
    return got;
  };

  const hushMurmur = () => {
    if (!mur.paused) mur.pause();
    murEnd?.();
    murEnd = null;
  };
  const finish = (ok: boolean) => {
    const e = end;
    end = null;
    speaking(false);
    e?.(ok);
  };
  main.onended = () => finish(true);
  main.onerror = () => finish(false);

  const visibility = () => voice.hold(held);
  document.addEventListener("visibilitychange", visibility);
  // Inside the tap that turns the sound on, each player plays a moment of silence, so a phone lets it speak later.
  const unlock = () => {
    for (const a of [main, mur]) {
      if (!a.paused) continue;
      a.src = silentWav();
      a.play().catch(() => undefined);
    }
  };
  unlockers.add(unlock);
  // Off means quiet at once, mid-line included.
  const unsub = useRotundaSound.subscribe((s, was) => s.on !== was.on && !s.on && voice.stop());

  const voice: RotundaVoice = {
    async say(by, text) {
      if (!on() || !text) return false;
      const url = await get(by, text);
      if (!url || !on()) return false;
      finish(false);
      hushMurmur();
      return new Promise<boolean>((res) => {
        const t = window.setTimeout(() => end === done && finish(true), LINE_MAX_MS);
        const done = (ok: boolean) => {
          window.clearTimeout(t);
          res(ok);
        };
        end = done;
        main.src = url;
        main.volume = 1;
        speaking(true);
        if (held || document.visibilityState === "hidden") return;
        // Blocked (no tap yet this visit, after a reload with sound on): read it instead.
        main.play().catch(() => end === done && finish(false));
      });
    },
    prefetch(next) {
      if (!on()) return;
      for (const l of next) if (l.text) void get(l.by, l.text);
    },
    async murmur(by, text) {
      if (!on() || end || !mur.paused) return null;
      const url = await get(by, text);
      if (!url || !on() || end || !mur.paused || held) return null;
      mur.src = url;
      mur.volume = MURMUR_VOLUME;
      try {
        await mur.play();
      } catch {
        return null;
      }
      return new Promise<number | null>((res) => {
        const d = Number.isFinite(mur.duration) ? mur.duration : 1.5;
        murEnd = () => res(d);
        mur.onended = () => {
          murEnd?.();
          murEnd = null;
        };
      });
    },
    stop() {
      if (!main.paused) main.pause();
      finish(false);
      hushMurmur();
    },
    hold(h) {
      held = h;
      const away = h || document.visibilityState === "hidden";
      if (away) {
        if (!main.paused) main.pause();
        hushMurmur();
      } else if (end && main.paused && main.src) main.play().catch(() => finish(false));
    },
    dispose() {
      dead = true;
      voice.stop();
      unsub();
      unlockers.delete(unlock);
      document.removeEventListener("visibilitychange", visibility);
      main.removeAttribute("src");
      mur.removeAttribute("src");
      for (const p of lines.values()) void p.then((u) => u && URL.revokeObjectURL(u));
      lines.clear();
    },
  };
  return voice;
}

/** Turns the sound on or off. On, inside the tap, it plays a moment of silence so the browser lets the voices play. */
export function setSound(on: boolean): void {
  keepSound(on);
  useRotundaSound.getState().set({ on, ...(!on && { speaking: false }) });
  if (on) unlockers.forEach((u) => u());
}
