import { create } from "zustand";
import { readCrew } from "../hologram/crew.ts";
import { setCrew, setSpeaker } from "../hologram/signal.ts";
import { setCallLive } from "./liveCall.ts";
import { stopSpeaking, useSkippy } from "./chat.ts";
import { sendTalkTiming } from "./talkBeacon.ts";
import { SILENCE_CHECK_MS, silenceGuard, type SilenceGuard } from "./silence.ts";
import { holdBegin, holdCheck, holdEnd, holdHeard } from "./hold.ts";

/**
 * Talking to Skippy out loud (#434), browser side; the function is api/skippy-voice.ts. A tap asks for the microphone,
 * then for a one-session token from our own function (the ElevenLabs key never comes here), then joins ElevenLabs'
 * agent over WebRTC with the client in talkSession.ts, which loads only on that first tap so the Desk's first load
 * carries none of it. What is said on the call is added to the chat as it goes, so a typed message after it can
 * follow on. A call ends on a second tap, when Skippy hangs up, after two minutes of nobody speaking (silence.ts) or
 * when the page goes away. The site sets no budget and no call length (#532): the ElevenLabs plan's credits are the
 * only limit. When ElevenLabs refuses for them ("quota"), or fails, a plain note says so and typing and dictation
 * carry on.
 * With Skippy's crew (#479) the call also carries its own key for the room lookups (`tool`), and what Skippy hands to
 * his own thread on the call (hand_to_kernel) is waited on in the chat like a typed hand-off: while the call is live,
 * an answer that lands is told to Skippy (ElevenLabs' contextual update) so he reads it out at the next pause; once
 * the call is over it simply lands in the chat.
 */

/** The plan's credits as ElevenLabs counts them (#477), when it answered. */
export interface TalkCredits {
  used: number;
  limit: number;
  resetAt: string | null;
  tier: string | null;
}

export type TalkPhase = "idle" | "starting" | "live" | "ending";
export type TalkReason = "quota" | "silence" | "no-key" | "not-set-up" | "agent-denied" | "key-invalid" | "plan" | "eleven" | "mic" | "signed-out" | "slow" | "failed" | "unsupported";

/** What the Desk says when a call can't start or breaks; each ends by saying typing still works. */
export const TALK_NOTE: Record<TalkReason, string> = {
  quota: "ElevenLabs credits used up. My voice is out of fuel, monkey, so it's typing and the mic until they refill.",
  silence: "Two minutes of nothing, monkey. I hung up so the open mic stops eating your credits. Ring again whenever.",
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

export function readCredits(raw: unknown): TalkCredits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e10;
  if (!ok(r.used) || !ok(r.limit) || r.limit <= 0) return null;
  const resetAt = typeof r.resetAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.resetAt) ? r.resetAt : null;
  const tier = typeof r.tier === "string" && /^[A-Za-z0-9 -]{1,30}$/.test(r.tier) ? r.tier : null;
  return { used: r.used, limit: r.limit, resetAt, tier };
}

/** Whether the plan has no credits left. */
export const creditsOut = (c: TalkCredits) => c.used >= c.limit;

/** "Creator plan: 21,743 credits left of 122,113 · resets Nov 5", or "ElevenLabs credits used up · resets Nov 5": the plan's own count, under Talk. */
export const creditsLine = (c: TalkCredits) => {
  const reset = c.resetAt ? ` · resets ${new Date(`${c.resetAt}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  if (creditsOut(c)) return `${CREDITS_OUT}${reset}`;
  const left = c.limit - c.used;
  return `${c.tier ? `${c.tier[0]!.toUpperCase()}${c.tier.slice(1)} plan` : "Plan"}: ${left.toLocaleString("en-US")} credits left of ${c.limit.toLocaleString("en-US")}${reset}`;
};

/** What Talk shows when ElevenLabs' credits are spent. */
export const CREDITS_OUT = "ElevenLabs credits used up";

/** Whole seconds from `startedAt` to `now`; 0 before a call has started or if the clock stepped back. */
export const elapsedSecs = (startedAt: number, now: number): number => (startedAt > 0 ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0);

/** mm:ss. */
export const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export type Started = { ok: true; token: string; conversation: string; desk: string; tool?: string; crew?: Record<string, string>; serverTiming?: string } | { ok: false; reason: TalkReason };

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
    if (res.status === 502) return { ok: false, reason: body.error === "agent-denied" || body.error === "key-invalid" || body.error === "plan" || body.error === "quota" ? body.error : "eleven" };
    if (!res.ok || body.ok !== true || typeof body.token !== "string" || !body.token) return { ok: false, reason: "eleven" };
    const timing = res.headers.get("Server-Timing");
    return { ok: true, token: body.token, conversation: typeof body.conversation === "string" ? body.conversation : "", desk: typeof body.desk === "string" ? body.desk : "", ...(isToolToken(body.tool) && { tool: body.tool }), ...crewOf(body.crew), ...(timing && { serverTiming: readServerTiming(timing) }) };
  } catch {
    return { ok: false, reason: "eleven" };
  }
}

/** A Server-Timing header as `name=ms` pairs (#496): names and numbers only, whatever else it carries dropped. */
export function readServerTiming(raw: string): string {
  return raw
    .split(",")
    .slice(0, 20)
    .map((part) => /^\s*([a-z][a-z0-9_-]{0,20})\s*;\s*dur=(\d{1,6}(?:\.\d+)?)\s*$/i.exec(part))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]}=${Math.round(Number(m[2]))}`)
    .join(" ");
}

/**
 * A call's start, stage by stage (#496): milliseconds from the tap to the mic's yes, the token, the call code, the
 * connected call and his first word, and the server's own stages. Also left as performance marks (`talk:*`).
 */
export interface StartTimings {
  mic?: number;
  token?: number;
  code?: number;
  connected?: number;
  firstWord?: number;
  server?: string;
}

/** How long a warm-up counts for: the server keeps the Desk's lines a minute (api/skippy-voice.ts, DESK_KEEP_MS). */
export const WARM_MS = 50_000;
let warmedAt = 0;

type SessionModule = typeof import("./talkSession.ts");
type Session = Awaited<ReturnType<SessionModule["openCall"]>>;
let loading: Promise<SessionModule> | null = null;
const loadSession = () => (loading ??= import("./talkSession.ts"));

let session: Session | null = null;
let conversation = "";
let timer: ReturnType<typeof setInterval> | null = null;
let quiet: SilenceGuard | null = null;

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

/** The most of an answer put into the call (#521): a long one was cut mid-sentence at 500 characters. */
export const LANDED_MAX = 1500;

/** Text cut at a sentence end within `max`, or at a word, never mid-sentence when it can be helped. */
export function clipSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (stop > max / 2) return head.slice(0, stop + 1);
  return head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max).trimEnd();
}

/**
 * What Skippy is told when what his deeper self worked out lands mid-call (#506): say it now, answer first. It goes in
 * with a request for a turn (talkSession.ts, speakNow), so he speaks it at once instead of at Nikita's next line. In
 * character (#498): the note never says "thread", "hand-off", "Kernel" or "crew", so he has nothing to echo.
 */
export const landedNote = (text: string, final: boolean): string =>
  `${final ? "The answer" : "An update"} from the deeper you just landed on what Nikita asked you to dig into: "${clipSentence(text, LANDED_MAX)}". Say it to him now, answer first, in one or two short sentences of your own, in character, with no recap and no question after. Drop whatever else you were about to say, and no waiting line.`;

/** The chat bubbles this call is waiting on (chat turn id to the text last told to Skippy), and the watch on them. */
let heard = new Map<number, string>();
let unwatch: (() => void) | null = null;
/** The bubbles this call's own hand-offs wait on (#546): only these hold the line with music, not an older ask. */
let mine = new Set<number>();
/** The call's lookups in flight (#546). */
let inFlight = 0;

/** Whether the call is waiting on an answer right now: a lookup out, or one of its hand-offs not back (#546). */
const waiting = (): boolean => inFlight > 0 || [...mine].some((b) => heard.has(b));

/**
 * Waits in the chat on each hand-off the call made, and puts the answer into the live call the moment it lands (#506).
 * On a live call it also takes up what the chat is already waiting on from earlier (a typed ask, a call before this
 * one), so an answer that lands now is said now. Only a final answer is spoken: an interim "still pondering" stays in
 * the chat, so the call keeps to one waiting line.
 */
async function followHandoffs(id: string): Promise<void> {
  const chat = useSkippy.getState();
  for (const turn of await readHandoffs(id)) {
    const bubble = await chat.wait(turn, "kernel", "skippy");
    if (bubble !== null && session) {
      heard.set(bubble, useSkippy.getState().turns.find((t) => t.id === bubble)?.text ?? "");
      mine.add(bubble);
    }
  }
  if (session) for (const t of useSkippy.getState().turns) if (t.pending?.needs === "skippy" && !heard.has(t.id)) heard.set(t.id, t.text);
  if (unwatch || !heard.size) return;
  unwatch = useSkippy.subscribe((s) => {
    let landed: string | null = null;
    for (const [bubble, last] of heard) {
      const t = s.turns.find((x) => x.id === bubble);
      if (!t) {
        heard.delete(bubble);
        continue;
      }
      if (t.text === last) continue;
      heard.set(bubble, t.text);
      if (t.pending) continue;
      heard.delete(bubble);
      landed = t.text;
    }
    // Several answers in one look: only the newest is spoken, so a stale line never queues behind it (#537).
    if (landed === null) return;
    // The answer is in: the hold music is out before he says it (#546).
    holdHeard();
    const text: string = landed;
    try {
      session?.speakNow(landedNote(text, true));
    } catch {
      /* the call is going: the answer is in the chat anyway */
    }
  });
}

interface TalkStore {
  phase: TalkPhase;
  /** Who has the floor on a live call. */
  mode: "listening" | "speaking";
  /** The plan's credits from ElevenLabs (#477), null when it didn't answer. */
  credits: TalkCredits | null;
  /** Whether a call can start (null until asked). */
  ready: boolean | null;
  reason: TalkReason | null;
  startedAt: number;
  /** Seconds on the live call, ticked by the store itself once a second (#537), so no view depends on its own timer. */
  elapsed: number;
  /** The last start's stages (#496). */
  timings: StartTimings | null;
  refresh: (doFetch?: typeof fetch) => Promise<void>;
  /**
   * Gets a call ready before the tap (#496), when the pointer or focus reaches Talk: wakes the function and fills its
   * Desk lines and agent check (GET ?warm=1), and fetches the call's code and the hologram. Once a minute at most.
   */
  warm: (doFetch?: typeof fetch) => void;
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
    if (timer) clearInterval(timer);
    timer = null;
    quiet = null;
    holdEnd();
    inFlight = 0;
    mine = new Set();
    const was = session;
    session = null;
    setCallLive(false);
    if (was) await was.end().catch(() => undefined);
    const id = conversation;
    conversation = "";
    unwatch?.();
    unwatch = null;
    heard = new Map();
    set({ phase: "idle", mode: "listening", elapsed: 0, ...(reason && { reason }) });
    if (reason) note(reason);
    if (id) {
      try {
        await fetch("/api/skippy-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "end", conversation: id }), credentials: "same-origin" });
      } catch {
        /* followed up on a later request */
      }
      // Anything handed to the Kernel on the call and not yet waited on lands in the chat from here (#479).
      await followHandoffs(id).catch(() => undefined);
    }
  };

  return {
    phase: "idle",
    mode: "listening",
    credits: null,
    ready: null,
    reason: null,
    startedAt: 0,
    elapsed: 0,
    timings: null,
    warm: (doFetch = fetch) => {
      if (get().phase !== "idle" || get().ready === false || Date.now() - warmedAt < WARM_MS) return;
      warmedAt = Date.now();
      void loadSession().catch(() => undefined);
      void import("../hologram/HologramCall.tsx").then((m) => m.preloadHologram()).catch(() => undefined);
      void doFetch("/api/skippy-voice?warm=1", { credentials: "same-origin" }).catch(() => undefined);
    },
    refresh: async (doFetch = fetch) => {
      try {
        const res = await doFetch("/api/skippy-voice", { credentials: "same-origin" });
        if (!res.ok) return set({ ready: false, reason: res.status === 401 ? "signed-out" : "not-set-up" });
        const body = (await res.json().catch(() => ({}))) as { ready?: unknown; reason?: unknown; credits?: unknown };
        const reason = typeof body.reason === "string" && body.reason in TALK_NOTE ? (body.reason as TalkReason) : null;
        set({ ready: body.ready === true, reason: body.ready === true ? null : reason, credits: readCredits(body.credits) });
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
      set({ phase: "starting", reason: null, timings: {} });
      stopSpeaking();
      // Each stage timed from the tap (#496).
      const tap = performance.now();
      const mark = (stage: keyof Omit<StartTimings, "server">) => {
        try {
          performance.mark(`talk:${stage}`);
        } catch {
          /* marks are a nicety */
        }
        set((st) => ({ timings: { ...st.timings, [stage]: Math.round(performance.now() - tap) } }));
      };
      const mod = loadSession().then((m) => (mark("code"), m));
      // Texting on the call (#536): its client tools, loaded with the call's own code.
      const texting = import("../texts/talkTools.ts").catch(() => null);
      // The microphone prompt comes only now, straight after the tap, and before anything is spent.
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => t.stop());
      } catch {
        set({ phase: "idle", reason: "mic" });
        return note("mic");
      }
      mark("mic");
      const got = await requestToken();
      mark("token");
      if (got.ok && got.serverTiming) set((st) => ({ timings: { ...st.timings, server: got.serverTiming } }));
      if (!got.ok) {
        set({ phase: "idle", reason: got.reason });
        return note(got.reason);
      }
      // The hologram learns the call's crew (agent id → submind) the moment the start answer lands (#490).
      setCrew(got.crew ?? {});
      conversation = got.conversation;
      if (get().phase !== "starting") return void (await finish(null));
      try {
        const m = await mod;
        const tx = await texting;
        session = await m.openCall({
          ...(tx && { clientTools: tx.talkTools((key) => useSkippy.getState().addCard(key)) as unknown as Record<string, (p: Record<string, unknown>) => Promise<string>> }),
          token: got.token,
          desk: got.desk,
          ...(got.tool && { tool: got.tool }),
          // Who has the mic (#490, #491): talkSession hands the call's events to the hologram; a stand-in call (the
          // browser tests) reports the agent here instead. Either way the crew (set above) turns agent ids into rooms.
          onAgent: (agent) => setSpeaker(agent),
          onMessage: (who, text) => {
            quiet?.heard();
            holdHeard();
            // Nikita's own words are the only thing a spoken "send" counts from (texts/compose.ts).
            if (who === "nikita") tx?.heard(text);
            useSkippy.getState().say(who, text);
          },
          onMode: (mode) => {
            quiet?.heard();
            if (mode === "speaking") holdHeard();
            if (mode === "speaking" && get().timings?.firstWord === undefined) {
              mark("firstWord");
              sendTalkTiming(get().timings ?? {}, true);
            }
            set({ mode });
          },
          onToolStart: () => {
            inFlight += 1;
            holdCheck();
          },
          onTool: (name, escalated) => {
            inFlight = Math.max(0, inFlight - 1);
            // A hand-off, or a lookup that went on to the deeper mind (#546): its answer is waited on in the chat.
            if ((name === "hand_to_kernel" || escalated) && conversation) void followHandoffs(conversation).catch(() => undefined);
            holdCheck();
          },
          onInterrupt: () => holdHeard(),
          onEnd: () => {
            if (get().phase === "live") void finish(null);
          },
          onError: () => {
            if (get().phase === "live") void finish("failed");
          },
        });
      } catch {
        sendTalkTiming(get().timings ?? {}, false);
        await finish("eleven");
        return;
      }
      if (get().phase !== "starting") {
        // Ended (or the page left) while it was connecting.
        await finish(null);
        return;
      }
      mark("connected");
      set({ phase: "live", startedAt: Date.now(), elapsed: 0 });
      // Answers land in the call as they come (#506): the chat looks every few seconds, and whatever it is already
      // waiting on for Skippy is followed from now.
      setCallLive(true);
      // Hold music (#546): a wait on a lookup or a hand-off, after two quiet seconds, gets a quiet loop until it lands.
      holdBegin({ pending: waiting, agentSpeaking: () => get().mode === "speaking", micLevel: () => (get().mode === "listening" ? talkLevel() : 0) });
      void followHandoffs(got.conversation ?? "").catch(() => undefined);
      // The one safety (#532): two minutes of nobody speaking ends the call. Skippy's mode, any message and the
      // level (his voice while he speaks, the mic otherwise) all count as someone speaking.
      const guard = silenceGuard();
      quiet = guard;
      timer = setInterval(() => {
        guard.level(talkLevel());
        set({ elapsed: elapsedSecs(get().startedAt, Date.now()) });
        if (guard.over() && get().phase === "live") void finish("silence");
      }, SILENCE_CHECK_MS);
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
