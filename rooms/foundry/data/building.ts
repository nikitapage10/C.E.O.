import { modelOf, threadOf, type Change, type Crate, type Model, type OpenPr } from "../../../apps/world/src/foundry.ts";
import { forgeLanes, queueOf, type Lane, type Stage } from "./forge.ts";

/**
 * What's being built (#1204): the Foundry page's "Building now" board, read from the same GitHub issues as the Deep
 * Furnace (Nikita, 2026-11-17: "what's the status, what's currently being built?"). Every job in hand with its Short
 * line, who builds it, the thread it's built in (docs/FOUNDRY.md, "Dispatching"), where it stands and for how long;
 * then the last few that shipped and the queue. Real data only: no issue, no row. No DOM here, so it is unit tested
 * (building.test.ts).
 */

/** Where a job stands, in the board's few words: the forge's stages folded into working, PR open, checks and held. */
export type BoardState = "working" | "pr" | "checks" | "red" | "green" | "waiting" | "paused" | "ready" | "stuck";

export const BOARD_WORDS: Record<BoardState, string> = {
  working: "Working",
  pr: "PR open",
  checks: "Checks running",
  red: "Checks red",
  green: "Checks green",
  waiting: "Waiting its turn",
  paused: "Paused for a fix",
  ready: "Needs your OK",
  stuck: "Stuck",
};

/** Each state's tone on the board: running work glows, held work dims, what needs Nikita is hot. */
export const BOARD_TONE: Record<BoardState, "run" | "ok" | "off" | "hot" | "bad"> = {
  working: "run",
  pr: "run",
  checks: "run",
  red: "bad",
  green: "ok",
  waiting: "off",
  paused: "off",
  ready: "hot",
  stuck: "bad",
};

const STAGE_STATE: Record<Stage, BoardState> = { building: "working", pr: "pr", checks: "checks", red: "red", green: "green", waiting: "waiting", paused: "paused", ready: "ready", stuck: "stuck" };

export interface BoardRow {
  crate: Crate;
  /** What's being built: the Short line, else a trimmed title. */
  what: string;
  /** Whose hands are on it (Rusty, Dusty, Rocky, Rivet…), and on which model. */
  hand: string;
  model: Model;
  /** The thread it's built in: a room's name or "Builder". */
  thread: string;
  state: BoardState;
  /** Its open pull request, when it has one. */
  pr: OpenPr | null;
  /** Date.now() it started: the issue's opening, else its last change. */
  since: number;
}

/** What's being built, in a few words: the issue's Short line, else its title without a trailing full stop. */
export function whatOf(crate: Pick<Crate, "title"> & Pick<Partial<Crate>, "short">): string {
  return (crate.short || crate.title.trim()).replace(/\.$/, "");
}

const rowOf = (l: Lane): BoardRow => ({
  crate: l.crate,
  what: whatOf(l.crate),
  hand: l.hand,
  model: modelOf(l.crate, l.who),
  thread: threadOf(l.crate),
  state: STAGE_STATE[l.stage],
  pr: l.pr,
  since: l.crate.createdAt ?? l.crate.updatedAt,
});

/** Every job in hand, in the forge's own order (running first, then what needs Nikita, then held), with nothing cut. */
export function buildingNow(crates: Crate[], prs: readonly OpenPr[] = []): BoardRow[] {
  const { lanes, more } = forgeLanes(crates, prs);
  return [...lanes, ...more].map(rowOf);
}

/** How many shipped jobs the board lists. */
export const JUST_SHIPPED = 5;

/** The last few Foundry jobs that shipped, newest first: changelog entries with an issue (closed `foundry:shipped`). */
export function justShipped(changelog: readonly Change[], limit = JUST_SHIPPED): Change[] {
  return changelog
    .filter((c) => c.issue !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** The queue as the board shows it: the forge's queue, oldest first. */
export const queued = queueOf;

/** How long, in the board's short words: "12m", "3h", "2d". */
export function ageWords(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
