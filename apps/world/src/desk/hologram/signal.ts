import type { RoomId } from "@ceo/core";
import { create } from "zustand";
import { SUBMINDS } from "../../../../../packages/simulator/src/subminds.ts";
import { useSkippy } from "../skippy/chat.ts";
import { agentOfEvent, readCrew } from "./crew.ts";
import { stripTags } from "./tags.ts";

export { stripTags };

/**
 * Skippy's hologram call (#481): what his face and the projection follow while a call is on. Kept tiny and free of
 * three.js, since the call code (talkSession.ts) and the Desk's first load both reach it; the projection itself
 * (HologramStage.tsx and holoScene.ts) loads only once Talk is tapped.
 *
 * The five faces he pulls on a call: listening while Nikita talks, thinking while a lookup or a hand-off is in
 * flight, smug while he talks (his default, naturally), laughing when his line carries a [laugh] or [excited] tag,
 * and annoyed when his line carries a [sigh]-like tag or Nikita cuts him off.
 */
export type Expression = "listening" | "thinking" | "smug" | "laughing" | "annoyed";
export const EXPRESSIONS: readonly Expression[] = ["listening", "thinking", "smug", "laughing", "annoyed"];

/** How long a cut-off keeps him annoyed, in ms. */
export const INTERRUPTED_MS = 1800;
/** How long a hand-off's swap shows him thinking, in ms. */
export const SWAP_MS = 900;

const LAUGH = /\[(?:laugh\w*|chuckl\w*|giggl\w*|excited|cackl\w*|snicker\w*)\]/i;
const ANNOYED = /\[(?:sigh\w*|annoyed|groan\w*|exasperat\w*|frustrat\w*|scoff\w*|huff\w*)\]/i;

/** The mood a line's audio tags ask for, if any. */
export function tagMood(text: string): "laughing" | "annoyed" | null {
  if (LAUGH.test(text)) return "laughing";
  if (ANNOYED.test(text)) return "annoyed";
  return null;
}

export interface FaceInputs {
  phase: "idle" | "starting" | "live" | "ending";
  mode: "listening" | "speaking";
  /** Lookups (tool calls) in flight. */
  tools: number;
  thinking: boolean;
  swappedAt: number;
  interruptedAt: number;
  /** His latest line on this call. */
  line: string;
  now: number;
}

/** Which face he wears, from the call's state. */
export function expressionOf(s: FaceInputs): Expression {
  if (s.phase === "starting") return "thinking";
  if (s.now - s.interruptedAt < INTERRUPTED_MS) return "annoyed";
  if (s.tools > 0 || s.thinking || s.now - s.swappedAt < SWAP_MS) return "thinking";
  if (s.mode !== "speaking") return "listening";
  return tagMood(s.line) ?? "smug";
}

interface HoloStore {
  /** The submind on the mic, by room; null is Skippy himself. */
  speaker: RoomId | null;
  tools: number;
  thinking: boolean;
  swappedAt: number;
  interruptedAt: number;
  muted: boolean;
  /** Whether Nikita tucked the projection away for this call (the call carries on in the dock). */
  hidden: boolean;
  /** The chat's last turn before this call: his caption is his latest line after it. */
  fromTurn: number;
  /** The call's crew (#479): ElevenLabs agent id to submind id, from the call's start answer. */
  crew: Record<string, string>;
}

const FRESH = { speaker: null, tools: 0, thinking: false, swappedAt: 0, interruptedAt: 0, muted: false, hidden: false, fromTurn: 0, crew: {} } as const;

export const useHolo = create<HoloStore>(() => ({ ...FRESH, crew: {} }));

/** Who a speaker reference names: a room, null for Skippy, or undefined when it names no one we know. */
export type Speaker = RoomId | null | undefined;

const SKIPPY = /^(?:skippy(?:,? the magnificent)?|the magnificent|magnificent)$/;
const AGENT_ID = /^[A-Za-z0-9_-]{4,80}$/;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const bare = (s: string) => norm(s).replace(/^skippy,? /, "").replace(/^the /, "");

/**
 * Whoever a hand-off names, in any of the forms the call can know them by (#490): a room ("boiler"), a submind's id
 * ("soot"), its ElevenLabs agent id (once `setCrew` has the call's crew), its name or job ("The Pessimist",
 * "Skippy, the Pessimist", "pessimist"). Null, "", "skippy" or Skippy's own agent id (any agent id not in the crew,
 * once the crew is known) is Skippy. Anything else is undefined: not a speaker, so nothing changes.
 */
export function speakerOf(ref: unknown, crew: Record<string, string> = useHolo.getState().crew): Speaker {
  if (ref === null || ref === undefined) return null;
  if (typeof ref !== "string") return undefined;
  const raw = ref.trim();
  if (!raw || SKIPPY.test(norm(raw))) return null;
  const viaCrew = crew[raw];
  if (viaCrew) return SUBMINDS.find((m) => m.id === viaCrew)?.room;
  const n = norm(raw);
  const b = bare(raw);
  const m = SUBMINDS.find((s) => s.room === n || s.id === n || norm(s.name) === n || bare(s.name) === b || norm(s.job) === b);
  if (m) return m.room;
  if (Object.keys(crew).length && AGENT_ID.test(raw)) return null;
  return undefined;
}

/**
 * Who has the mic (#481, #490): a room's submind (the whole projection in that room's colour, its name on the label, a
 * channel-switch glitch) or Skippy. Takes a room, a submind id, an agent id, a name or job (see `speakerOf`); null
 * brings Skippy back. Returns whether it named anyone (false leaves the projection as it is).
 */
export function setSpeaker(ref: RoomId | string | null): boolean {
  const who = speakerOf(ref);
  if (who === undefined) return false;
  if (useHolo.getState().speaker !== who) useHolo.setState({ speaker: who, swappedAt: Date.now() });
  return true;
}

/** The call's crew from its start answer (talk.ts, `crew`), so `setSpeaker` can take ElevenLabs agent ids. */
export const setCrew = (raw: unknown) => useHolo.setState({ crew: readCrew(raw) });

/** Words a hand-off line names a submind by, beyond its job: its room. */
const ROOM_WORDS: Partial<Record<RoomId, RegExp>> = {
  green: /\b(?:the green|fantasy|league)\b/,
  exchange: /\b(?:exchange|polymarket)\b/,
  relay: /\b(?:relay|inbox)\b/,
  boiler: /\bboiler\b/,
  foundry: /\bfoundry\b/,
};

/** The submind a line hands to, if it names one: the last one named wins ("not the Bookie, the Pessimist"). */
export function roomNamedIn(text: string): RoomId | null {
  const t = stripTags(text).toLowerCase();
  let best: { room: RoomId; at: number } | null = null;
  for (const m of SUBMINDS) {
    const job = new RegExp(`\\b${m.job.toLowerCase().replace(/[^a-z ]/g, "")}\\b`, "g");
    const words = ROOM_WORDS[m.room];
    for (const re of words ? [job, new RegExp(words.source, "g")] : [job]) {
      for (const hit of t.matchAll(re)) if (!best || hit.index! > best.at) best = { room: m.room, at: hit.index! };
    }
  }
  return best?.room ?? null;
}

/**
 * A transfer happened (ElevenLabs' transfer_to_agent came back) (#490). With a target, it is that speaker. Without one
 * (the plain tool response names none), it is worked out: a submind only ever hands the mic back to Skippy, and Skippy
 * hands it to whoever his last line on this call named ("Here's the Pessimist. Bring a towel").
 */
export function transferred(target?: unknown): Speaker {
  const s = useHolo.getState();
  const named = target === undefined ? undefined : speakerOf(target);
  if (named !== undefined) {
    setSpeaker(named);
    return named;
  }
  if (s.speaker !== null) {
    setSpeaker(null);
    return null;
  }
  const lines = useSkippy
    .getState()
    .turns.filter((t) => t.who === "skippy" && !t.note && t.id > s.fromTurn)
    .slice(-2)
    .reverse();
  for (const l of lines) {
    const room = roomNamedIn(l.text);
    if (room) {
      setSpeaker(room);
      return room;
    }
  }
  // Nothing named yet: the submind's own sign-on ("The Pessimist. Something's leaking.") is the next line.
  awaitSignOn();
  return undefined;
}

let unwatch: (() => void) | null = null;
/** Reads the next line said on the call for the name of the submind that just took the mic, for a few seconds. */
function awaitSignOn() {
  unwatch?.();
  const after = useSkippy.getState().turns.at(-1)?.id ?? 0;
  const stop = () => {
    clearTimeout(timer);
    off();
    if (unwatch === stop) unwatch = null;
  };
  const off = useSkippy.subscribe((st) => {
    const line = st.turns.find((t) => t.id > after && t.who === "skippy" && !t.note);
    if (!line) return;
    stop();
    const room = roomNamedIn(line.text);
    if (room && useHolo.getState().speaker === null) setSpeaker(room);
  });
  const timer = setTimeout(stop, 15_000);
  unwatch = stop;
}

const TRANSFER = "transfer_to_agent";
const seen = new Set<string>();
const field = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/**
 * Every raw event of the call (talkSession.ts's onIncomingEvent) (#490): a line or transfer that names its agent sets
 * that speaker; a transfer that names none goes through `transferred`. A transfer's two events (the tool response and
 * its full payload) count once.
 */
export function heardEvent(ev: unknown): Speaker {
  const agent = agentOfEvent(ev);
  const payload = field(ev, "agent_tool_response_full_payload") ?? field(ev, "agent_tool_response");
  const isTransfer = field(payload, "tool_name") === TRANSFER && field(payload, "is_error") !== true;
  const callId = field(payload, "tool_call_id");
  if (isTransfer) {
    const key = typeof callId === "string" && callId ? callId : "";
    const result = field(payload, "full_tool_result");
    // A target in the result that is one of the crew's agents, whatever key the result keeps it under.
    const crew = useHolo.getState().crew;
    const inResult = typeof result === "string" ? Object.keys(crew).find((a) => result.includes(a)) : undefined;
    const target = agent ?? inResult;
    if (key && seen.has(key)) {
      // The second event of a transfer already counted: only a target it names now can correct the guess.
      return target ? (setSpeaker(target), speakerOf(target)) : undefined;
    }
    if (key) seen.add(key);
    return transferred(target);
  }
  if (agent) return setSpeaker(agent) ? speakerOf(agent) : undefined;
  return undefined;
}

/** Shows him thinking while something outside the call's own tools runs (a hand-off being arranged, say). */
export const setThinking = (on: boolean) => useHolo.setState({ thinking: on });

/** The call's own events (talkSession.ts). */
export const holoEvents = {
  toolStart: () => useHolo.setState((s) => ({ tools: s.tools + 1 })),
  toolEnd: () => useHolo.setState((s) => ({ tools: Math.max(0, s.tools - 1) })),
  interrupted: () => useHolo.setState({ interruptedAt: Date.now() }),
  /** A fresh call starts with Skippy on the mic and nothing in flight; `fromTurn` is the chat's last turn so far. */
  reset: (fromTurn = 0) => {
    seen.clear();
    unwatch?.();
    useHolo.setState({ ...FRESH, crew: {}, fromTurn });
  },
  /** Every raw event of the call: see `heardEvent`. */
  event: (ev: unknown) => void heardEvent(ev),
};
