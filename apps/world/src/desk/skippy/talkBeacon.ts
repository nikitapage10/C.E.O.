import type { StartTimings } from "./talk.ts";

/**
 * The Talk timing beacon (#512): when a call reaches Skippy's first word, or fails to start, its stage timings (the
 * numbers talk.ts keeps, #496) go to /api/talk-timing (api/_boot/talkTiming.ts), so the Boiler Room can show how fast
 * Talk starts on real calls. Stage names and milliseconds only: never a word, a sound or a transcript.
 *
 * The built site only, and never from a browser test (the local server has no /api), like bootBeacon.ts (#373).
 */
export const TALK_TIMING_PATH = "/api/talk-timing";

/** The server stages, "name=ms name=ms" (readServerTiming), as an object of numbers. */
export function serverStages(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (raw ?? "").split(" ").slice(0, 12)) {
    const m = /^([a-z][a-z0-9_-]{0,20})=(\d{1,6})$/i.exec(part);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

export function sendTalkTiming(t: StartTimings, ok: boolean) {
  if (!import.meta.env.PROD || navigator.webdriver) return;
  const { server, ...stages } = t;
  void fetch(TALK_TIMING_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok, ...stages, server: serverStages(server) }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}
