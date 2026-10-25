import { CREW, crewOf, MAX_AT_ONCE, runningNow, rustyHands, type ChecksState, type Change, type Crate, type CrewId, type OpenPr } from "../../foundry.ts";

/**
 * The Foundry's pipeline as the page draws it (#432): ideas → the queue → the forge (the jobs in flight, one lane each,
 * at most four, the crew's cap) → checks → shipped. No canvas and no DOM here, so it is unit tested (forge.test.ts).
 * Every stage comes from GitHub: the issue's labels (working, ready, stuck, paused), the crew's cap (runningNow) and,
 * for the stretch between building and shipped, the job's open pull request and its checks (api/foundry-feed.ts).
 */

/** A build in flight: anything that isn't an idea waiting for a pick, or an idea that's being built. */
export const isBuild = (c: Crate) => c.kind !== "idea" || c.state === "working";

/** A job in flight is building now, waiting its turn (past the cap), or paused for a fix. */
export type FlightState = "running" | "waiting" | "paused";

/** Where a job stands on its lane. */
export type Stage =
  /** Past the cap: held at the forge's mouth. */
  | "waiting"
  /** Paused for a fix: its branch is pushed, it resumes when the fix ships. */
  | "paused"
  /** At the forge, no pull request yet. */
  | "building"
  /** Its pull request is open, no checks reported yet. */
  | "pr"
  /** Its checks are running. */
  | "checks"
  /** Its checks are red. */
  | "red"
  /** Its checks are green: about to merge. */
  | "green"
  /** Waiting for Nikita's OK (a test needs them). */
  | "ready"
  /** Stuck after every rung, or blocked on Nikita's call. */
  | "stuck";

/** How far along its lane (0 the forge's mouth, 1 shipped) each stage reaches. The gate (checks) stands at GATE_U. */
export const GATE_U = 0.7;
export const STAGE_U: Record<Stage, number> = { waiting: 0.12, paused: 0.34, building: 0.5, stuck: 0.5, pr: 0.62, checks: GATE_U, red: GATE_U, green: 0.86, ready: 0.86 };

/** The stage in a few plain words (the lane's label says it beside the line). */
export const STAGE_WORDS: Record<Stage, string> = {
  waiting: "waiting its turn",
  paused: "paused for a fix",
  building: "building",
  pr: "pull request open",
  checks: "checks running",
  red: "checks red",
  green: "checks green, merging",
  ready: "waiting for your OK",
  stuck: "stuck, needs a look",
};

export interface Lane {
  crate: Crate;
  /** Who has hands on it: Rusty, Dusty, Gusty or Musty on Rusty's work; Rocky or Rivet on theirs. */
  hand: string;
  who: CrewId;
  flight: FlightState;
  stage: Stage;
  /** Its open pull request, when it has one. */
  pr: OpenPr | null;
}

/** The lanes on the stage: the cap's four. */
export const LANES = MAX_AT_ONCE;

const FLIGHT_RANK: Record<string, number> = { running: 0, stuck: 1, ready: 1, waiting: 2, paused: 3 };

/** A job's open pull request: the newest that works on its issue. */
export function prFor(crate: Crate, prs: readonly OpenPr[]): OpenPr | null {
  let best: OpenPr | null = null;
  for (const p of prs) if (p.issue === crate.number && (!best || p.at > best.at)) best = p;
  return best;
}

/** Where a job stands, from its labels, the cap and its pull request. */
export function stageOf(crate: Crate, flight: FlightState, pr: OpenPr | null): Stage {
  if (crate.state === "stuck") return "stuck";
  if (crate.state === "ready") return "ready";
  if (flight === "paused") return "paused";
  if (flight === "waiting") return "waiting";
  if (!pr) return "building";
  return pr.checks === "running" ? "checks" : pr.checks === "fail" ? "red" : pr.checks === "pass" ? "green" : "pr";
}

/**
 * The jobs in flight: every build in hand (working, waiting for an OK, or stuck), the ones really running first, then
 * those that need Nikita, then those waiting their turn or paused; newest first within each. The first {@link LANES}
 * get a lane; the rest are counted on "+N more".
 */
export function forgeLanes(crates: Crate[], prs: readonly OpenPr[] = []): { lanes: Lane[]; more: Lane[] } {
  const { running } = runningNow(crates);
  const hands = rustyHands(crates);
  const all = crates
    .filter((c) => isBuild(c) && (c.state === "working" || c.state === "ready" || c.state === "stuck"))
    .map((c): Lane => {
      const flight: FlightState = c.paused ? "paused" : running.has(c.number) || c.state !== "working" ? "running" : "waiting";
      const who = crewOf(c, crates);
      const pr = prFor(c, prs);
      return { crate: c, who, hand: hands.get(c.number) ?? CREW[who].name, flight, pr, stage: stageOf(c, flight, pr) };
    })
    .sort((a, b) => FLIGHT_RANK[rankKey(a)]! - FLIGHT_RANK[rankKey(b)]! || b.crate.updatedAt - a.crate.updatedAt);
  return { lanes: all.slice(0, LANES), more: all.slice(LANES) };
}

const rankKey = (l: Lane) => (l.crate.state === "working" ? l.flight : l.crate.state);

/** The queue: approved work nobody holds yet, oldest first (ideas waiting for a pick are on the bench, not here). */
export function queueOf(crates: Crate[]): Crate[] {
  return crates.filter((c) => c.kind !== "idea" && c.state === "queued").sort((a, b) => a.number - b.number);
}

/* ── Events: what changed between two reads ── */

export interface Snapshot {
  /** Each lane's job and its stage. */
  stages: Map<number, Stage>;
  /** The queue's issue numbers. */
  queue: Set<number>;
  /** The ideas on the bench. */
  ideas: Set<number>;
  /** The changelog's keys. */
  ships: Set<string>;
  main: ChecksState;
}

export type ForgeEvent =
  | { kind: "idea"; issue: number }
  | { kind: "queued"; issue: number }
  | { kind: "picked"; issue: number }
  | { kind: "pr"; issue: number }
  | { kind: "green"; issue: number }
  | { kind: "red"; issue: number }
  | { kind: "shipped"; change: Change }
  | { kind: "main"; state: ChecksState };

export function snapshot(lanes: readonly Lane[], queue: readonly Crate[], ideas: readonly Crate[], changelog: readonly Change[], main: ChecksState): Snapshot {
  return {
    stages: new Map(lanes.map((l) => [l.crate.number, l.stage])),
    queue: new Set(queue.map((c) => c.number)),
    ideas: new Set(ideas.filter((c) => c.number > 0).map((c) => c.number)),
    ships: new Set(changelog.map((c) => c.key)),
    main,
  };
}

const PAST_PR: ReadonlySet<Stage> = new Set(["pr", "checks", "red", "green", "ready"]);

/**
 * The real events between two reads, in the order they'd happen: a new idea, new work queued, a job picked up, its
 * pull request opened, its checks turning green or red, a change shipped, main's checks finishing. A first read has
 * no events (nothing *happened*, the page just opened).
 */
export function forgeEvents(was: Snapshot | null, now: Snapshot, changelog: readonly Change[]): ForgeEvent[] {
  if (!was) return [];
  const out: ForgeEvent[] = [];
  for (const n of now.ideas) if (!was.ideas.has(n)) out.push({ kind: "idea", issue: n });
  for (const n of now.queue) if (!was.queue.has(n)) out.push({ kind: "queued", issue: n });
  for (const [n, s] of now.stages) {
    const before = was.stages.get(n);
    const held = (x: Stage | undefined) => x === undefined || x === "waiting" || x === "paused";
    if (held(before) && !held(s)) out.push({ kind: "picked", issue: n });
    if (before === s) continue;
    if (PAST_PR.has(s) && before && !PAST_PR.has(before)) out.push({ kind: "pr", issue: n });
    if (s === "green" && before !== "green") out.push({ kind: "green", issue: n });
    if (s === "red" && before !== "red") out.push({ kind: "red", issue: n });
  }
  for (const c of changelog) if (!was.ships.has(c.key)) out.push({ kind: "shipped", change: c });
  if (was.main !== now.main && (now.main === "pass" || now.main === "fail")) out.push({ kind: "main", state: now.main });
  return out;
}

/** The neutral words that rise off the line for a ship (no titles: the public view sees them too). */
export function shipWords(c: Change): string {
  return c.issue ? `shipped #${c.issue.number}` : c.landed ? `merged ${c.landed.label}` : "shipped";
}
