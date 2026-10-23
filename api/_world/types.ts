/**
 * The living Lattice's saved world (docs/WORLD.md): the state the hourly step carries forward, and the history it
 * writes. Shared by the step (api/world-step.ts), the read feed (api/world.ts) and the Desk and the Lattice, which only
 * import these types. Plain data, no imports, so the Vercel functions and the browser bundle both take it as is.
 */

export type RoomId = "foundry" | "spire" | "exchange" | "green" | "relay" | "archive" | "breakroom" | "boiler" | "workshop" | "studio";
export type RelationshipKind = "friend" | "best-friend" | "rival" | "nemesis" | "crush" | "partner" | "mentor" | "sibling" | "ex";

/** The cast as the step sees it (generated into api/_world/cast.ts from packages/simulator/src/worldCast.ts). */
export interface WorldCast {
  rooms: { id: RoomId; name: string }[];
  kinds: RelationshipKind[];
  members: {
    id: string;
    name: string;
    role: string;
    room: RoomId;
    lead: boolean;
    traits: string[];
    bio: string;
    catchphrase: string;
    voice: string[];
  }[];
  relationships: { a: string; b: string; kind: RelationshipKind; note: string }[];
  scripted: {
    quips: Record<string, string[]>;
    conduct: Record<string, string[]>;
    shipped: Record<string, string[]>;
    summaries: string[];
  };
}

/** A relationship as the world has it now. `since` is when a step last changed it (absent for the cast's own). */
export interface WorldRelationship {
  a: string;
  b: string;
  kind: RelationshipKind;
  note: string;
  since?: string;
}

/** One line of a scene: who says it (an agent id) and what. */
export interface SceneLine {
  who: string;
  text: string;
}

/** A moment in one room: a short conversation. */
export interface Scene {
  room: RoomId;
  title: string;
  lines: SceneLine[];
}

/** A relationship a step changed, with what it was before. */
export interface RelationshipChange {
  a: string;
  b: string;
  kind: RelationshipKind;
  note: string;
  was: RelationshipKind | null;
}

/** A builder's one line on a job of theirs that shipped this hour. */
export interface Remark {
  issue: number;
  title: string;
  who: string;
  text: string;
}

/** The token use and cost of a step's Claude call. */
export interface StepCost {
  usd: number;
  tokensIn: number;
  tokensOut: number;
}

/** One step of the world: an hour in Ilyr. */
export interface HistoryEntry {
  step: number;
  /** ISO time the step ran. */
  at: string;
  /** Its day in Mountain time, "2026-10-13": the Chronicle's pages. */
  day: string;
  /** Who wrote it: Claude, or the scripted stand-in (over budget, no key, or Claude didn't answer). */
  source: "claude" | "scripted";
  summary: string;
  scenes: Scene[];
  changes: RelationshipChange[];
  remarks: Remark[];
  /** The hour's real events, as fed to the step (public Foundry work only). */
  events: string[];
  /** The day in Ilyr: the previous day's recap, written by the first step after midnight. */
  recap?: { day: string; text: string };
  cost: StepCost | null;
}

/** The world's spend in one calendar month (UTC, as the API bills it). */
export interface MonthTotals {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  /** Claude calls made (one per step that asked). */
  calls: number;
  /** Steps the scripted stand-in wrote. */
  scripted: number;
}

/** What the step carries from one hour to the next. */
export interface WorldState {
  version: 1;
  /** Steps taken so far. */
  step: number;
  /** ISO time of the last step; null before the first. */
  at: string | null;
  relationships: WorldRelationship[];
  /** The latest entries, oldest first: the step's memory and what the Lattice plays on open. */
  recent: HistoryEntry[];
  /** Days with history, newest first. */
  days: string[];
  /** The last day whose recap was written. */
  recapped: string | null;
  /** Spend by month ("2026-10"), the last few months. */
  spend: Record<string, MonthTotals>;
  /** Builder remarks, newest first: the Foundry tab's Changelog shows them by issue. */
  remarks: (Remark & { at: string })[];
}

/** A page of the Chronicle: one day. */
export interface DayPage {
  day: string;
  entries: HistoryEntry[];
  recap: string | null;
}

/** What GET /api/world answers. */
export interface WorldFeed {
  ok: true;
  at: string | null;
  step: number;
  /** When the next step is due (ISO), or null before the first. */
  nextAt: string | null;
  relationships: WorldRelationship[];
  recent: HistoryEntry[];
  days: string[];
  remarks: (Remark & { at: string })[];
  spend: { month: string; budget: number } & MonthTotals;
  /** Whether Claude is set up for the step (else every hour is scripted). */
  claude: boolean;
  /**
   * The day's story (api/_world/story.ts): Gemini's speech spend this month against its own cap, and the Claude cost
   * of the scripts (part of the shared Claude cap). `gemini` says whether the key is set.
   */
  story?: { month: string; budget: number; gemini: boolean; usd: number; calls: number; stories: number; tokensIn: number; tokensOut: number; scriptUsd: number };
  /**
   * The email agent's public counts (#263, api/_email/status.ts): counts and states only, never a subject or a
   * sender. Null where the agent doesn't run (the Vercel copy) or hasn't reported yet.
   */
  email?: import("../_email/status.js").EmailStatus | null;
}

/** What GET /api/day-story?day=… answers (api/day-story.ts): the day's story, or why there isn't one. */
export type DayStoryView =
  | { day: string; ready: true; script: string; durationSec: number; partial: boolean; writer: "claude" | "chronicle"; /** Made in an older style (#102): "Make it now" may remake it once. */ stale: boolean; at: string; audio: string }
  | { day: string; ready: false; reason: "no-key" | "over-budget" | "not-yet" };

/**
 * What GET /api/day-story?week=… answers (#211): the week in Ilyr, told on Sunday evening. `audio` is null when the
 * script is there but could not be read aloud (no Gemini key, or the month's speech budget spent).
 */
export type WeekStoryView =
  | { week: string; ready: true; script: string; durationSec: number; writer: "claude" | "chronicle"; at: string; audio: string | null }
  | { week: string; ready: false };

/** What GET /api/world-step answers: the world clock the Desk's Systems page and the Boiler Room's pipe read. */
export interface WorldClock {
  /** ISO time of the last step; null before the first. */
  at: string | null;
  step: number;
  /** When the next step may run (ISO): 55 minutes after the last. */
  nextAt: string | null;
  /** Which store the world is saved in ("blob", "supabase", "memory"). */
  store: "blob" | "supabase" | "memory";
  /** Whether Claude is set up for the step (else every hour is scripted). */
  claude: boolean;
  /** Who wrote the last hour, or null before the first. */
  source: "claude" | "scripted" | null;
  /** The world's spend this month (UTC) against its share of the cap. */
  spend: { month: string; usd: number; budget: number; calls: number; scripted: number };
}
