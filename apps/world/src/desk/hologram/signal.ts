import type { RoomId } from "@ceo/core";
import { create } from "zustand";

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

/** A line as it reads on screen: the audio tags ("[laugh]") are for his voice, not for the captions. */
export const stripTags = (text: string) =>
  text
    .replace(/\[[a-z][a-z \-']{0,24}\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

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
}

export const useHolo = create<HoloStore>(() => ({ speaker: null, tools: 0, thinking: false, swappedAt: 0, interruptedAt: 0, muted: false, hidden: false, fromTurn: 0 }));

/**
 * Who has the mic: a room's submind (its can in that room's colours) or null for Skippy. For the mid-call hand-offs
 * (#479): call it when a submind takes over and again with null when Skippy has the floor back.
 */
export function setSpeaker(room: RoomId | null) {
  if (useHolo.getState().speaker === room) return;
  useHolo.setState({ speaker: room, swappedAt: Date.now() });
}

/** Shows him thinking while something outside the call's own tools runs (a hand-off being arranged, say). */
export const setThinking = (on: boolean) => useHolo.setState({ thinking: on });

/** The call's own events (talkSession.ts). */
export const holoEvents = {
  toolStart: () => useHolo.setState((s) => ({ tools: s.tools + 1 })),
  toolEnd: () => useHolo.setState((s) => ({ tools: Math.max(0, s.tools - 1) })),
  interrupted: () => useHolo.setState({ interruptedAt: Date.now() }),
  /** A fresh call starts with Skippy on the mic and nothing in flight; `fromTurn` is the chat's last turn so far. */
  reset: (fromTurn = 0) => useHolo.setState({ speaker: null, tools: 0, thinking: false, swappedAt: 0, interruptedAt: 0, muted: false, hidden: false, fromTurn }),
};
