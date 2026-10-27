import { create } from "zustand";
import { readCrew } from "../hologram/crew.ts";
import { stopSpeaking, useSkippy } from "./chat.ts";

/**
 * Talking to Skippy out loud (#434), browser side; the function is api/skippy-voice.ts. A tap asks for the microphone,
 * then for a one-session token from our own function (the ElevenLabs key never comes here), then joins ElevenLabs'
 * agent over WebRTC with the client in talkSession.ts, which loads only on that first tap so the Desk's first load
 * carries none of it. What is said on the call is added to the chat as it goes, so a typed message after it can
 * follow on. A call ends on a second tap, when Skippy hangs up, after `maxSecs` (ten minutes) or when the page goes
 * away. Past the month's minutes, or when ElevenLabs fails, a plain note says so and typing and dictation carry on.
 * With Skippy's crew (#479) the call also carries its own key for the room lookups (`tool`), and what Skippy hands to
 * his own thread on the call (hand_to_kernel) is waited on in the chat like a typed hand-off: while the call is live,
 * an answer that lands is told to Skippy (ElevenLabs' contextual update) so he reads it out at the next pause; once
 * the call is over it simply lands in the chat.
 */

export interface TalkUsage {
  month: string;
  usedMin: number;
  budgetMin: number;
  leftMin: number;
  sessionMin: number;
  canTalk: boolean;
  /** The month's dollars (#477): the talk's estimate against its share, all of ElevenLabs against the cap. */
  usedUsd?: number;
  budgetUsd?: number;
  elevenUsd?: number;
  capUsd?: number;
  calls?: number;
}

/** The plan's credits as ElevenLabs counts them (#477), when it answered. */
export interface TalkCredits {
  used: number;
  limit: number;
  resetAt: string | null;
  tier: string | null;
}

export type TalkPhase = "idle" | "starting" | "live" | "ending";
export type TalkReason = "capped" | "no-key" | "not-set-up" | "agent-denied" | "key-invalid" | "plan" | "eleven" | "mic" | "signed-out" | "slow" | "failed" | "unsupported";

/** What the Desk says when a call can't start or breaks; each ends by saying typing still works. */
export const TALK_NOTE: Record<TalkReason, string> = {
  capped: "This month's talk minutes are spent, so it's typing and the mic until the month turns.",
  "no-key": "Talking needs the ElevenLabs key on the server. Typing and the mic still work.",
  "not-set-up": "Talking isn't set up on this site. Typing and the mic still work.",
  "agent-denied": "Talking waits on one ElevenLabs setting: the key needs access to Agents. Typing and the mic still work.",
  "key-invalid": "ElevenLabs doesn't accept the key this site has; it may be stale, so set it again on the Desk's Keys page. Typing and the mic still work.",
  plan: "ElevenLabs' plan or limits refused the call. Typing and the mic still work.",
  eleven: "Couldn't reach ElevenLabs for a call. Typing and the mic still work.",
  mic: "No microphone: allow it for this site to talk. Typing still works.",
  "signed-out": "Sign in on the Desk to talk to Skippy.",
  slow: "That's a lot of calls in a row. Try again in a minute.",
  failed: "The call dropped. Typing and the mic still work.",
  unsupported: "This browser can't make the call. Typing and the mic still work.",
};

export function readUsage(raw: unknown): TalkUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100_000 ? v : null);
  const used = n(r.usedMin);
  const budget = n(r.budgetMin);
  const left = n(r.leftMin);
  const session = n(r.sessionMin);
  if (used === null || budget === null || left === null || session === null) return null;
  const money = (k: string) => {
    const v = n(r[k]);
    return v === null ? {} : { [k]: v };
  };
  return {
    month: typeof r.month === "string" ? r.month.slice(0, 7) : "",
    usedMin: used,
    budgetMin: budget,
    leftMin: left,
    sessionMin: session,
    canTalk: r.canTalk === true,
    ...money("usedUsd"),
    ...money("budgetUsd"),
    ...money("elevenUsd"),
    ...money("capUsd"),
    ...money("calls"),
  };
}

export function readCredits(raw: unknown): TalkCredits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e10;
  if (!ok(r.used) || !ok(r.limit) || r.limit <= 0) return null;
  const resetAt = typeof r.resetAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.resetAt) ? r.resetAt : null;
  const tier = typeof r.tier === "string" && /^[A-Za-z0-9 -]{1,30}$/.test(r.tier) ? r.tier : null;
  return { used: r.used, limit: r.limit, resetAt, tier };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** "3.0 of 41.6 talk min this month · $0.36 of $5.00 share · $1.10 of $10.00 cap": the small line under the call button. */
export const usageLine = (u: TalkUsage) => {
  const parts = [`${u.usedMin.toFixed(1)} of ${u.budgetMin.toFixed(1)} talk min this month`];
  if (u.usedUsd !== undefined && u.budgetUsd !== undefined) parts.push(`${usd(u.usedUsd)} of ${usd(u.budgetUsd)} share`);
  if (u.elevenUsd !== undefined && u.capUsd !== undefined) parts.push(`${usd(u.elevenUsd)} of ${usd(u.capUsd)} cap`);
  return parts.join(" · ");
};

/** "Creator plan: 100,370 of 122,113 credits · resets Nov 5": the plan's own count, under the usage line. */
export const creditsLine = (c: TalkCredits) => {
  const reset = c.resetAt ? ` · resets ${new Date(`${c.resetAt}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return `${c.tier ? `${c.tier[0]!.toUpperCase()}${c.tier.slice(1)} plan` : "Plan"}: ${c.used.toLocaleString("en-US")} of ${c.limit.toLocaleString("en-US")} credits${reset}`;
};

/** mm:ss. */
export const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export type Started = { ok: true; token: string; conversation: string; maxSecs: number; desk: string; usage: TalkUsage | null; tool?: string; crew?: Record<string, string> } | { ok: false; reason: TalkReason; usage?: TalkUsage | null };

/** The call's tool token as our function mints it (api/_skippy/voicetoken.ts): `vt1.<expiry>.<nonce>.<mac>`. */
export const isToolToken = (v: unknown): v is string => typeof v === "string" && v.length <= 200 && /^vt1\.[0-9a-z]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);

/** The crew's agents (#481), only when there are some. */
const crewOf = (raw: unknown) => {
  const crew = readCrew(raw);
  return Object.keys(crew).length ? { crew } : {};
};

/** Ask our function for one call's token. */
export async function requestToken(doFetch: typeof fetch = fetch): Promise<Started> {
  try {
    const res = await doFetch("/api/skippy-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }), credentials: "same-origin" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401) return { ok: false, reason: "signed-out" };
    if (res.status === 429) return { ok: false, reason: "slow" };
    if (res.status === 503) return { ok: false, reason: body.error === "no-key" ? "no-key" : "not-set-up" };
    if (res.status === 502) return { ok: false, reason: body.error === "agent-denied" || body.error === "key-invalid" || body.error === "plan" ? body.error : "eleven" };
    const usage = readUsage(body.usage);
    if (res.ok && body.ok === false && body.reason === "capped") return { ok: false, reason: "capped", usage };
    if (!res.ok || body.ok !== true || typeof body.token !== "string" || !body.token) return { ok: false, reason: "eleven" };
    const maxSecs = typeof body.maxSecs === "number" && body.maxSecs > 0 && body.maxSecs <= 600 ? body.maxSecs : 600;
    return { ok: true, token: body.token, conversation: typeof body.conversation === "string" ? body.conversation : "", maxSecs, desk: typeof body.desk === "string" ? body.desk : "", usage, ...(isToolToken(body.tool) && { tool: body.tool }), ...crewOf(body.crew) };
  } catch {
    return { ok: false, reason: "eleven" };
  }
}

type SessionModule = typeof import("./talkSession.ts");
type Session = Awaited<ReturnType<SessionModule["openCall"]>>;
let loading: Promise<SessionModule> | null = null;
const loadSession = () => (loading ??= import("./talkSession.ts"));

let session: Session | null = null;
let conversation = "";
let timer: ReturnType<typeof setTimeout> | null = null;

/** The call's hand-offs to the Kernel the function kept (#479), as kept turn ids. */
export async function readHandoffs(id: string, doFetch: typeof fetch = fetch): Promise<string[]> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return [];
  try {
    const res = await doFetch(`/api/skippy-voice?handoffs=${encodeURIComponent(id)}`, { credentials: "same-origin" });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { handoffs?: unknown };
    return Array.isArray(body.handoffs) ? body.handoffs.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{16}$/.test(h)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** What Skippy is told when an answer from his own thread lands mid-call. He reads it out at the next natural pause. */
export const landedNote = (text: string, final: boolean): string =>
  `${final ? "The answer" : "An update"} from your own thread just landed on what Nikita asked you to hand off: "${text.slice(0, 500)}". Read it out at the next natural pause, briefly, in your own words.`;

/** The chat bubbles this call is waiting on (chat turn id to the text last told to Skippy), and the watch on them. */
let heard = new Map<number, string>();
let unwatch: (() => void) | null = null;

/** Waits in the chat on each hand-off the call made, and tells the live call when one's answer lands. */
async function followHandoffs(id: string): Promise<void> {
  const chat = useSkippy.getState();
  for (const turn of await readHandoffs(id)) {
    const bubble = await chat.wait(turn, "kernel", "skippy");
    if (bubble !== null && session) heard.set(bubble, useSkippy.getState().turns.find((t) => t.id === bubble)?.text ?? "");
  }
  if (unwatch || !heard.size) return;
  unwatch = useSkippy.subscribe((s) => {
    for (const [bubble, last] of heard) {
      const t = s.turns.find((x) => x.id === bubble);
      if (!t) {
        heard.delete(bubble);
        continue;
      }
      if (t.text === last) continue;
      heard.set(bubble, t.text);
      if (!t.pending) heard.delete(bubble);
      try {
        session?.tell(landedNote(t.text, !t.pending));
      } catch {
        /* the call is going: the answer is in the chat anyway */
      }
    }
  });
}

interface TalkStore {
  phase: TalkPhase;
  /** Who has the floor on a live call. */
  mode: "listening" | "speaking";
  usage: TalkUsage | null;
  /** The plan's credits from ElevenLabs (#477), null when it didn't answer. */
  credits: TalkCredits | null;
  /** Whether a call can start (null until asked). */
  ready: boolean | null;
  reason: TalkReason | null;
  startedAt: number;
  maxSecs: number;
  refresh: (doFetch?: typeof fetch) => Promise<void>;
  start: () => Promise<void>;
  end: () => Promise<void>;
}

/** How loud the call is right now, 0 to 1 (Skippy's voice while he speaks, the mic otherwise). */
export const talkLevel = (): number => {
  try {
    return session ? session.level() : 0;
  } catch {
    return 0;
  }
};

/** Mutes or unmutes Nikita's microphone on a live call (the hologram's pill, #481). */
export const talkMute = (muted: boolean): void => {
  try {
    session?.mute(muted);
  } catch {
    /* the call is going anyway */
  }
};

export const useTalk = create<TalkStore>((set, get) => {
  const note = (reason: TalkReason) => useSkippy.getState().say("skippy", TALK_NOTE[reason], true);

  /** Clean up after a call, however it ended, and settle it. */
  const finish = async (reason: TalkReason | null) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const was = session;
    session = null;
    if (was) await was.end().catch(() => undefined);
    const id = conversation;
    conversation = "";
    unwatch?.();
    unwatch = null;
    heard = new Map();
    set({ phase: "idle", mode: "listening", ...(reason && { reason }) });
    if (reason) note(reason);
    if (id) {
      try {
        const res = await fetch("/api/skippy-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", conversation: id }), credentials: "same-origin" });
        const body = (await res.json().catch(() => ({}))) as { usage?: unknown };
        const usage = readUsage(body.usage);
        if (usage) set({ usage, ready: usage.canTalk });
      } catch {
        /* settled on a later request */
      }
      // Anything handed to the Kernel on the call and not yet waited on lands in the chat from here (#479).
      await followHandoffs(id).catch(() => undefined);
    }
  };

  return {
    phase: "idle",
    mode: "listening",
    usage: null,
    credits: null,
    ready: null,
    reason: null,
    startedAt: 0,
    maxSecs: 600,
    refresh: async (doFetch = fetch) => {
      try {
        const res = await doFetch("/api/skippy-voice", { credentials: "same-origin" });
        if (!res.ok) return set({ ready: false, reason: res.status === 401 ? "signed-out" : "not-set-up" });
        const body = (await res.json().catch(() => ({}))) as { ready?: unknown; reason?: unknown; usage?: unknown; credits?: unknown };
        const reason = typeof body.reason === "string" && body.reason in TALK_NOTE ? (body.reason as TalkReason) : null;
        set({ ready: body.ready === true, reason: body.ready === true ? null : reason, usage: readUsage(body.usage), credits: readCredits(body.credits) });
      } catch {
        /* keep what we had */
      }
    },
    start: async () => {
      if (get().phase !== "idle") return;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        set({ reason: "unsupported" });
        return note("unsupported");
      }
      set({ phase: "starting", reason: null });
      stopSpeaking();
      const mod = loadSession();
      // The microphone prompt comes only now, straight after the tap, and before anything is spent.
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => t.stop());
      } catch {
        set({ phase: "idle", reason: "mic" });
        return note("mic");
      }
      const got = await requestToken();
      if (!got.ok) {
        set({ phase: "idle", reason: got.reason, ...(got.usage && { usage: got.usage, ready: got.usage.canTalk }), ...(got.reason === "capped" && { ready: false }) });
        return note(got.reason);
      }
      if (got.usage) set({ usage: got.usage });
      conversation = got.conversation;
      if (get().phase !== "starting") return void (await finish(null));
      try {
        const m = await mod;
        session = await m.openCall({
          token: got.token,
          desk: got.desk,
          ...(got.tool && { tool: got.tool }),
          // Who has the mic (#481, #491): talkSession swaps the hologram on every transfer, from this crew map.
          crew: got.crew ?? {},
          onMessage: (who, text) => useSkippy.getState().say(who, text),
          onMode: (mode) => set({ mode }),
          onTool: (name) => {
            if (name === "hand_to_kernel" && conversation) void followHandoffs(conversation).catch(() => undefined);
          },
          onEnd: () => {
            if (get().phase === "live") void finish(null);
          },
          onError: () => {
            if (get().phase === "live") void finish("failed");
          },
        });
      } catch {
        await finish("eleven");
        return;
      }
      if (get().phase !== "starting") {
        // Ended (or the page left) while it was connecting.
        await finish(null);
        return;
      }
      set({ phase: "live", startedAt: Date.now(), maxSecs: got.maxSecs });
      timer = setTimeout(() => void get().end(), got.maxSecs * 1000);
    },
    end: async () => {
      const { phase } = get();
      if (phase === "starting") return set({ phase: "ending" });
      if (phase !== "live") return;
      set({ phase: "ending" });
      await finish(null);
    },
  };
});

// A call never outlives the page.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => void useTalk.getState().end());
