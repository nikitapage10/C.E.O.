import { DESK_SUBMINDS, SUBMINDS } from "../../simulator/src/subminds.ts";

/**
 * The rooms' voice (#638), part of the shared chrome (docs/ROOMS.md, "The room voice"). Two ways in, one listener:
 *
 * - the room mic: a one-tap (or hold Space) mic on every Desk room's page that talks straight to that room's submind;
 * - hands-free: a toggle in the Desk's bar that keeps listening across pages, each thing said going to whoever leads the
 *   page Nikita is on (Skippy on Today, the room's submind elsewhere).
 *
 * Which submind a page reaches is its manifest's `submind` (the contract test holds every manifest to this), read from
 * the one list (SUBMINDS, or DESK_SUBMINDS for a Desk-only room such as the Annex or the Haven). A room may also register
 * an intent handler in its manifest (`voice`, below): it sees each utterance first and answers it itself, or returns
 * null and the room's submind answers as usual. Pure data and types: safe for the Desk's first load.
 */

export interface RoomMic {
  /** The Desk room (its route and the `room` the function takes). */
  room: string;
  /** Its lead's id ("skippy" on Today), name and colour. */
  submind: string;
  name: string;
  colour: string;
}

/** Skippy on Today: the Kernel's ice. */
export const SKIPPY_VOICE: RoomMic = {
  room: "today",
  submind: "skippy",
  name: "Skippy",
  colour: "#8fd8ff",
};

/** The room mic on a Desk route, or null where there is none (Today keeps Ask Skippy, the Lattice, a page without a submind). */
export function roomMicOf(route: string): RoomMic | null {
  if (route === "today" || route === "lattice") return null;
  const s = DESK_SUBMINDS.find((m) => m.room === route) ?? SUBMINDS.find((m) => m.room === route);
  return s ? { room: route, submind: s.id, name: s.name, colour: s.colour } : null;
}

/** Who hands-free talks to on a Desk route: Skippy on Today, else the room mic's submind; null on a page with no lead. */
export const voiceTargetOf = (route: string): RoomMic | null => (route === "today" ? SKIPPY_VOICE : roomMicOf(route));

/* ── A room's intent handler ── */

/** One thing Nikita said to a room, as its intent handler gets it. */
export interface RoomUtterance {
  /** The words, one line, at most 300 characters. */
  text: string;
  /** The Desk room it was said on. */
  room: string;
  /** "tap" (the room mic, or Space) or "hands-free" (the bar's toggle). */
  via: "tap" | "hands-free";
  /** The room's last few spoken turns, oldest first, kept in memory only. */
  history: readonly { who: "nikita" | "skippy"; text: string }[];
}

/** A button the answer offers (to confirm a reply, a rule, a disposition): shown under the spoken line for a while. */
export interface RoomIntentAction {
  /** Its label, under 32 characters. */
  label: string;
  run: () => unknown;
}

/** A room's answer to an utterance. */
export interface RoomIntentReply {
  /** What is said aloud (in Skippy's voice, bent the room's submind's way) and shown: one or two sentences. */
  say: string;
  actions?: readonly RoomIntentAction[];
}

/**
 * A room's intent handler: sees each utterance first, in the browser. Returns its reply, or null to let the room's
 * submind answer (the default: Desk Skippy's chat as that submind, POST /api/skippy-room). It calls its own room's
 * endpoints for any work, under that room's own auth and caps.
 */
export type RoomIntent = (utterance: RoomUtterance) => Promise<RoomIntentReply | null>;

/** What a manifest's `voice` loader resolves to: the module holding the room's intent handler, loaded on first use. */
export interface RoomVoiceModule {
  intent: RoomIntent;
}
