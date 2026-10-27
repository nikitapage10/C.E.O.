/**
 * The call's submind exchanges, for the Council of Skippies (#479). ElevenLabs gives the transcript only once the call
 * is over (GET /v1/convai/conversations/{id}: `transcript[]` with `role`, `message`, `time_in_call_secs` and each agent
 * line's `agent_metadata.agent_id`), so this runs when the call is settled (api/_skippy/voice.ts, settle).
 *
 * Each stretch of the call a submind held the mic becomes one turn in its room's log (api/_skippy/log.ts), marked
 * `via: "voice"` and `by` the submind: the question in a short form (Nikita's last words before the hand-over), and the
 * answer's gist (the submind's first lines). Both are scrubbed (no amounts, links, emails, keys, numbers that look like
 * phones) and checked again by the privacy check; a part that still looks private is held back whole. These turns are
 * Desk-only: the subminds' read key never lists them (api/skippy.ts, roomLog).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { privateParts } from "../_privacy.js";
import type { LoggedTurn } from "./log.js";
import { submindOfAgent } from "./voicecrew.js";
import type { KeptThing } from "./voicetoken.js";
import { said } from "./voicereads.js";

export const QUESTION_SHORT = 200;
export const GIST_MAX = 320;
const HELD = "(held back: it looked private)";

interface Line {
  role: "user" | "agent";
  message: string;
  agent: string | null;
  secs: number;
}

function linesOf(conversation: unknown): { lines: Line[]; start: number | null } {
  const c = (conversation && typeof conversation === "object" ? conversation : {}) as Record<string, unknown>;
  const meta = (c.metadata && typeof c.metadata === "object" ? c.metadata : {}) as Record<string, unknown>;
  const start = typeof meta.start_time_unix_secs === "number" && Number.isFinite(meta.start_time_unix_secs) ? meta.start_time_unix_secs * 1000 : null;
  const lines = (Array.isArray(c.transcript) ? c.transcript : [])
    .map((t): Line | null => {
      const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      if ((o.role !== "user" && o.role !== "agent") || typeof o.message !== "string" || !o.message.trim()) return null;
      const md = (o.agent_metadata && typeof o.agent_metadata === "object" ? o.agent_metadata : {}) as Record<string, unknown>;
      return { role: o.role, message: o.message, agent: typeof md.agent_id === "string" ? md.agent_id : null, secs: typeof o.time_in_call_secs === "number" ? o.time_in_call_secs : 0 };
    })
    .filter((l): l is Line => l !== null);
  return { lines, start };
}

/** The first sentences of what was said, up to the gist's cap. */
function gistOf(parts: string[]): string {
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > GIST_MAX) break;
    out += s;
  }
  return out.trim() || text.slice(0, GIST_MAX);
}

/** Held back whole when the words as said look private; else scrubbed (no amounts, links, keys) and cut short. */
const clean = (raw: string, max: number) => (!raw.trim() ? "" : privateParts(raw).length ? HELD : said(raw, max));

/** The submind exchanges in a finished call, as room-log turns (oldest first). */
export function exchangesOf(conversation: unknown, agents: Record<string, KeptThing>, fallbackStart: number): Omit<LoggedTurn, "id">[] {
  const { lines, start } = linesOf(conversation);
  const t0 = start ?? fallbackStart;
  const out: Omit<LoggedTurn, "id">[] = [];
  let lastUser = "";
  let cur: { by: NonNullable<ReturnType<typeof submindOfAgent>>; question: string; parts: string[]; secs: number } | null = null;
  const close = () => {
    if (cur && cur.parts.length) {
      const question = clean(cur.question, QUESTION_SHORT) || "(asked by voice)";
      const answer = clean(gistOf(cur.parts), GIST_MAX);
      if (answer) out.push({ at: new Date(t0 + cur.secs * 1000).toISOString(), question, answer, room: cur.by.room, model: "voice", via: "voice", by: cur.by.id });
    }
    cur = null;
  };
  for (const l of lines) {
    if (l.role === "user") {
      lastUser = l.message;
      continue;
    }
    const s = l.agent ? submindOfAgent(agents, l.agent) : null;
    if (!s) {
      close();
      continue;
    }
    if (cur && cur.by.id !== s.id) close();
    if (!cur) cur = { by: s, question: lastUser, parts: [], secs: l.secs };
    if (cur.parts.length < 4) cur.parts.push(l.message);
  }
  close();
  return out.slice(0, 10);
}

/** The finished call's transcript, or null while it runs or when ElevenLabs doesn't answer. */
export async function readConversation(key: string, id: string, fetcher: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetcher(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const got = (await res.json().catch(() => null)) as { status?: unknown } | null;
    return got && (got.status === "done" || got.status === "failed") ? got : null;
  } catch {
    return null;
  }
}
