/**
 * The site's own sound, ducked to silence while Skippy is on a Talk call (#952, Nikita 2026-11-06: "mute all other
 * site sound during a Skippy call, including the Senate"). Every sound source of the site registers here: the Senate's
 * voices and gallery murmurs, the floor's and the rooms' spoken answers (media elements), the Lattice's glitch sounds
 * and the C.E.O.'s track (Web Audio contexts). The call itself (ElevenLabs' own audio) and its hold music never
 * register, so only they are heard. When the call ends, everything comes back as it was: a media element is unmuted,
 * and a context this ducking suspended is resumed (one that was already suspended for its own reasons stays so).
 *
 * Tiny and dependency-free: the Desk (talk.ts) and the Lattice both import it (@ceo/engine/web/siteSound.ts).
 */

let ducked = false;
const elements = new Set<HTMLMediaElement>();
const contexts = new Set<AudioContext>();
/** The contexts this ducking suspended, to resume on the way back. */
const paused = new Set<AudioContext>();
const listeners = new Set<(ducked: boolean) => void>();

/** Whether the site's own sound is ducked right now (a Skippy call is on). */
export const siteDucked = (): boolean => ducked;

/** Registers one of the site's media elements: muted at once while ducked, and on every duck after. */
export function duckable<T extends HTMLMediaElement>(el: T): T {
  elements.add(el);
  if (ducked) el.muted = true;
  return el;
}

/** Registers one of the site's Web Audio contexts: suspended while ducked, resumed after if this suspended it. */
export function duckableContext<T extends AudioContext>(ctx: T): T {
  contexts.add(ctx);
  if (ducked && ctx.state === "running") {
    paused.add(ctx);
    void ctx.suspend().catch(() => undefined);
  }
  return ctx;
}

/** Hears every duck and restore (a source that holds its own queue can wait instead of playing into silence). */
export function onSiteDuck(fn: (ducked: boolean) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Ducks the site's sound to silence (a call started), or brings it back (the call ended). Idempotent. */
export function duckSite(on: boolean): void {
  if (on === ducked) return;
  ducked = on;
  for (const el of elements) {
    try {
      el.muted = on;
    } catch {
      /* a gone element */
    }
  }
  for (const ctx of contexts) {
    try {
      if (on && ctx.state === "running") {
        paused.add(ctx);
        void ctx.suspend().catch(() => undefined);
      } else if (!on && paused.has(ctx) && ctx.state !== "closed")
        void ctx.resume().catch(() => undefined);
    } catch {
      /* a closed context */
    }
  }
  if (!on) paused.clear();
  // The browser's own voice (the chat's read-aloud) stops too; it is never started during a call (chat.ts, speak).
  if (on && typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* no voice here */
    }
  }
  for (const fn of listeners) fn(on);
}

/** Test seam: forget every registration. */
export function forgetSiteSound(): void {
  ducked = false;
  elements.clear();
  contexts.clear();
  paused.clear();
  listeners.clear();
}
