import { create } from "zustand";
import { useSystems, type LinkState } from "./systems.ts";

/**
 * The Foundry's real work, read from GitHub through the Desk's feed (api/foundry-feed.ts). Shared by the Desk (cards, Systems) and the Lattice (the Foundry
 * room). Imports nothing from the 3D world, so the Desk can load it alone.
 *
 * The coding happens in the Foundry thread in Claude Code; it keeps its queue as GitHub issues labelled
 * `foundry` (see docs/FOUNDRY.md for the labels). The repo is public, so the browser reads them directly.
 */

export const REPO = "nikitapage10/C.E.O.";
const API = `https://api.github.com/repos/${REPO}`;
/**
 * The feed is cached for a few seconds at Vercel's edge, so the Desk can ask every half minute (and every few seconds
 * for a minute after a click on the Desk) without running GitHub's rate limit dry.
 */
const POLL_MS = 30_000;
const QUICK_MS = 2_000;
const QUICK_FOR_MS = 30_000;
/** Shipped crates stay on show this long. */
const SHIPPED_FOR_MS = 24 * 3_600_000;
const HOUR = 3_600_000;
/** The "Foundry: upkeep" routine runs at :57 past every sixth hour, UTC. */
const UPKEEP_MINUTE = 57;
const UPKEEP_EVERY_HOURS = 6;

/** `chat` is work Nikita asked for in chat and a thread is building outside the lanes; it shows here so the Foundry lists everything in flight. */
export type CrateKind = "fix" | "idea" | "build" | "upkeep" | "chat";
export type CrateState = "queued" | "working" | "ready" | "stuck" | "shipped";
/**
 * The Foundry crew, by agent id and model (Nikita, 2026-10-13): Rivet (semicolon, Haiku) first responder, Rusty
 * (tessellate, Sonnet) simple work plus upkeep and ideas, Rocky (caret, Opus) anything complex or big-picture. Rivet
 * can run clones of herself for jobs at the same time; Rusty has his dock crew (four jobs at once at most); Rocky
 * takes one at a time (`MAX_RUNNING`). The Foundry's submind leads them and isn't crew.
 */
export type CrewId = "semicolon" | "caret" | "tessellate";
export type Model = "Haiku" | "Sonnet" | "Opus";

/**
 * The model a crate is being worked on: what its Builder line names, else its fix rung, else the crew member's usual
 * one (Rivet Haiku, Rocky Opus, Rusty Sonnet).
 */
export function modelOf(crate: Pick<Crate, "rung"> & Pick<Partial<Crate>, "model">, who: CrewId): Model {
  if (crate.model) return crate.model;
  if (crate.rung === 1) return "Haiku";
  if (crate.rung === 3) return "Opus";
  if (crate.rung === 2) return "Sonnet";
  return who === "semicolon" ? "Haiku" : who === "caret" ? "Opus" : "Sonnet";
}

export const CREW: Record<CrewId, { name: string; job: string }> = {
  semicolon: { name: "Rivet", job: "First responder" },
  caret: { name: "Rocky", job: "Master builder" },
  tessellate: { name: "Rusty", job: "Builder, upkeep and ideas" },
};

/**
 * The model each crew member runs on, and the colour its bench's work light shows (Nikita, 2026-10-13: who's working
 * on what model, visible at a glance). Rusty's dock crew run on his model.
 */
export const MODEL: Record<CrewId, { name: "Haiku" | "Sonnet" | "Opus"; colour: string }> = {
  semicolon: { name: "Haiku", colour: "#6fe3c1" },
  tessellate: { name: "Sonnet", colour: "#7fb0ff" },
  caret: { name: "Opus", colour: "#ffb04a" },
};

export interface Crate {
  number: number;
  title: string;
  kind: CrateKind;
  state: CrateState;
  /** The model rung a fix is on: 1 Haiku (Rivet), 2 Sonnet (Rusty), 3 Opus (Rusty). */
  rung: 1 | 2 | 3 | null;
  url: string;
  /** Date.now() of the last change. */
  updatedAt: number;
  /** Date.now() the issue was closed, for shipped crates; unlike `updatedAt` a later comment never moves it. */
  closedAt?: number;
  /** The issue's pitch line (ideas carry one), or "". */
  pitch: string;
  /**
   * What's being built in two to four words, an -ing phrase ("Speeding up the Lattice"), from the issue's
   * `**Short:**` line; "" when it has none. The Lattice shows it under the builder's name.
   */
  short?: string;
  /** Date.now() the issue was opened. */
  createdAt?: number;
  /** Small, medium or large, when the issue says. */
  size: "small" | "medium" | "large" | null;
  /** An idea Nikita sent back with notes; Rusty is rewriting it. */
  revising: boolean;
  /** An idea build paused for a fix (`foundry:paused`): its branch is pushed as work in progress, and it resumes when the fix ships. */
  paused?: boolean;
  /** Who an idea's card says builds it ("**Builder:** Rusty"), when it says. */
  builder?: CrewId | null;
  /** The model its Builder line names ("**Builder:** Rusty (Opus)"), when it names one. */
  model?: Model | null;
  /** Pictures Nikita attached to an idea (public image links from the issue body). */
  images?: string[];
}

export type ChecksState = "pass" | "fail" | "running" | "unknown";

/** One shipped change for the changelog: a Foundry issue that shipped, or a merged pull request with no issue. */
export interface Change {
  key: string;
  /** Date.now() style: when it shipped. */
  at: number;
  title: string;
  kind: CrateKind;
  /** The issue that tracked it, when there is one. */
  issue: { number: number; url: string } | null;
  /** Where the code landed: its pull request, or the commit on main. */
  landed: { label: string; url: string } | null;
  /** Who built it, from the issue's Builder line (fixes by rung); Rusty's dock crew count as Rusty. Null for a pull request with no issue. */
  by: CrewId | null;
  /** The issue's `**Short:**` line, or "". */
  short: string;
}

export interface FoundryData {
  crates: Crate[];
  /** Every shipped change GitHub still lists, newest first. */
  changelog: Change[];
  checks: { state: ChecksState; url: string | null; at: number | null };
  /** Ideas Nikita passed on: closed and labelled `foundry:passed`, waiting on the shelf for a comeback. */
  shelved: number;
  /** The newest commit on main (Vercel builds the live site from it), when GitHub listed one. */
  lastCommit?: LastCommit | null;
}

/** The newest commit on main: its short sha, link, first line and when it landed. */
export interface LastCommit {
  sha: string;
  url: string;
  title: string;
  at: number;
}

/** The newest commit on main from GitHub's list (newest first), or null when there is none or it has no date. */
export function parseLastCommit(commits: GhCommit[]): LastCommit | null {
  const c = commits[0];
  const at = Date.parse(c?.commit.committer?.date ?? "");
  if (!c || Number.isNaN(at)) return null;
  return { sha: c.sha.slice(0, 7), url: c.html_url, title: c.commit.message.split("\n")[0]!.trim(), at };
}

/** The slice of GitHub's issue JSON we read. */
export interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
  created_at?: string;
  closed_at?: string | null;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

/** The slice of GitHub's workflow-run JSON we read. */
export interface GhRun {
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at: string;
}

/** The slice of GitHub's pull request JSON we read. */
export interface GhPull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  body?: string | null;
  head: { ref: string };
}

/** The slice of GitHub's commit JSON we read. */
export interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string } | null };
}

const KINDS: CrateKind[] = ["fix", "idea", "build", "upkeep", "chat"];

function labelSet(issue: GhIssue): Set<string> {
  return new Set(issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))));
}

/** The issue numbers a text points at ("Closes #13", "(#5)"). */
function mentions(text: string): Set<number> {
  return new Set([...text.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])));
}

/** The issue number in a lane branch name ("foundry/upkeep/11-lint-ignore-worktrees"). */
function branchIssue(ref: string): number | null {
  const n = /(?:^|\/)(\d+)-/.exec(ref)?.[1];
  return n ? Number(n) : null;
}

/**
 * The changelog: every Foundry issue that shipped (lanes and chat work alike), each with the pull request or commit
 * that landed it, plus merged pull requests that had no issue. Newest first.
 */
export function parseChangelog(issues: GhIssue[], pulls: GhPull[], commits: GhCommit[]): Change[] {
  const merged = pulls.filter((p) => p.merged_at);
  const used = new Set<number>();
  const out: Change[] = [];
  for (const issue of issues) {
    if (issue.pull_request || issue.state !== "closed") continue;
    const labels = labelSet(issue);
    if (!labels.has("foundry") || !labels.has("foundry:shipped")) continue;
    const kind = KINDS.find((k) => labels.has(`foundry:${k}`)) ?? "chat";
    const pr = merged.find((p) => branchIssue(p.head.ref) === issue.number || mentions(`${p.title}\n${p.body ?? ""}`).has(issue.number));
    const commit = pr ? undefined : commits.find((c) => mentions(c.commit.message).has(issue.number));
    if (pr) used.add(pr.number);
    const body = readBody(issue.body ?? "");
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    out.push({
      key: `issue-${issue.number}`,
      at: Date.parse(issue.closed_at ?? issue.updated_at),
      title: issue.title,
      // A built idea is a build by the time it ships.
      kind: kind === "idea" ? "build" : kind,
      issue: { number: issue.number, url: issue.html_url },
      landed: pr ? { label: `PR #${pr.number}`, url: pr.html_url } : commit ? { label: commit.sha.slice(0, 7), url: commit.html_url } : null,
      by: crewFor({ kind, rung, builder: body.builder }),
      short: body.short,
    });
  }
  // A pull request for an issue already listed (or still open) is that issue's, not a change of its own.
  const tracked = new Set(issues.map((i) => i.number));
  for (const p of merged) {
    if (used.has(p.number)) continue;
    const refs = [branchIssue(p.head.ref), ...mentions(`${p.title}\n${p.body ?? ""}`)];
    if (refs.some((n) => n !== null && tracked.has(n))) continue;
    const lane = /^foundry\/(fix|upkeep|build|idea)\//.exec(p.head.ref)?.[1] as CrateKind | undefined;
    out.push({ key: `pr-${p.number}`, at: Date.parse(p.merged_at!), title: p.title, kind: lane === "idea" ? "build" : (lane ?? "chat"), issue: null, landed: { label: `PR #${p.number}`, url: p.html_url }, by: null, short: "" });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** How many changes shipped since local midnight. */
export function shippedToday(changelog: Change[], now = Date.now()): number {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return changelog.filter((c) => c.at >= midnight).length;
}

/** Issues labelled `foundry` become crates; pull requests, untyped issues and closed-unshipped ones drop out. */
export function parseCrates(issues: GhIssue[], now = Date.now()): Crate[] {
  const crates: Crate[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = labelSet(issue);
    if (!labels.has("foundry")) continue;
    const kind = KINDS.find((k) => labels.has(`foundry:${k}`));
    if (!kind) continue;
    const updatedAt = Date.parse(issue.updated_at);
    let state: CrateState;
    let closedAt: number | undefined;
    if (issue.state === "closed") {
      if (!labels.has("foundry:shipped")) continue;
      closedAt = Date.parse(issue.closed_at ?? issue.updated_at);
      if (now - closedAt > SHIPPED_FOR_MS) continue;
      state = "shipped";
    } else {
      state = labels.has("foundry:stuck") ? "stuck" : labels.has("foundry:ready") ? "ready" : labels.has("foundry:working") ? "working" : "queued";
    }
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    crates.push({ number: issue.number, title: issue.title, kind, state, rung, url: issue.html_url, updatedAt, ...(closedAt !== undefined && { closedAt }), ...(issue.created_at && { createdAt: Date.parse(issue.created_at) }), revising: labels.has("foundry:revise"), paused: state === "working" && labels.has("foundry:paused"), ...readBody(issue.body ?? "") });
  }
  return crates.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The pitch, size, short line and builder the Foundry writes into an issue ("**Pitch:** …", "**Size:** small",
 * "**Short:** Speeding up the Lattice", "**Builder:** Rusty (Opus)").
 */
export function readBody(body: string): Pick<Crate, "pitch" | "size" | "builder"> & { short: string; images: string[]; model: Model | null } {
  const pitch = /\*\*Pitch:\*\*\s*([^\n]+)/.exec(body)?.[1]?.trim() ?? "";
  const short = (/\*\*Short:\*\*[ \t]*([^\n]*)/.exec(body)?.[1] ?? "").replace(/[*_`]+/g, "").trim().replace(/[.!]+$/, "");
  const size = /\*\*Size:\*\*\s*(small|medium|large)/i.exec(body)?.[1]?.toLowerCase() as Crate["size"] | undefined;
  const named = /\*\*Builder:\*\*\s*(Rivet|Rusty|Rocky)/i.exec(body)?.[1]?.toLowerCase();
  const builder: CrewId | null = named === "rivet" ? "semicolon" : named === "rusty" ? "tessellate" : named === "rocky" ? "caret" : null;
  const images = [...body.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)].map((m) => m[1]!).slice(0, 4);
  const said = /\*\*Builder:\*\*\s*(?:Rivet|Rusty|Rocky)\s*\(\s*(Haiku|Sonnet|Opus)\b[^)]*\)/i.exec(body)?.[1]?.toLowerCase();
  const model: Model | null = said === "haiku" ? "Haiku" : said === "sonnet" ? "Sonnet" : said === "opus" ? "Opus" : null;
  return { pitch, size: size ?? null, short, builder, images, model };
}

/** A crew member's last few shipped jobs, newest first: each with the issue's Short line (else its title). */
export function recentWork(changelog: Change[], who: CrewId, limit = 3): { number: number; url: string; name: string; at: number }[] {
  return changelog
    .filter((c) => c.by === who && c.issue)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((c) => ({ number: c.issue!.number, url: c.issue!.url, name: c.short || c.title.trim(), at: c.at }));
}

/** The next upkeep tick after `now`. */
export function nextUpkeep(now: number): number {
  const d = new Date(now);
  d.setUTCMinutes(UPKEEP_MINUTE, 0, 0);
  while (d.getTime() <= now || d.getUTCHours() % UPKEEP_EVERY_HOURS !== 0) d.setTime(d.getTime() + HOUR);
  return d.getTime();
}

/** The last upkeep tick at or before `now`. */
export function lastUpkeep(now: number): number {
  return nextUpkeep(now) - UPKEEP_EVERY_HOURS * HOUR;
}

/**
 * The upkeep Rusty is seen at in the Lattice: the job from the latest tick, kept in hand until the next tick even
 * though the real work took a minute (Nikita's rule). The Desk shows the real state; only the room uses this.
 */
export function visibleUpkeep(crates: Crate[], now = Date.now()): Crate | null {
  const since = lastUpkeep(now);
  return crates.find((c) => c.kind === "upkeep" && c.updatedAt >= since) ?? null;
}

/**
 * Whose lane a crate is in. The Builder decides who takes each job and on which model, and writes it on the issue
 * ("**Builder:** Rusty (Opus)"). Fixes go by rung: Rivet (Haiku) on rung 1, Rusty on rungs 2 (Sonnet) and 3 (Opus).
 * Builds and chat work go to the builder their issue names, Rusty when it names none; Rocky is held for high-level
 * work. Rusty also keeps upkeep and ideas.
 */
export function crewFor(crate: Pick<Crate, "kind" | "rung"> & Pick<Partial<Crate>, "builder">): CrewId {
  if (crate.kind === "fix") return crate.rung === 2 || crate.rung === 3 ? "tessellate" : "semicolon";
  if (crate.kind === "build" || crate.kind === "chat") return crate.builder ?? "tessellate";
  return "tessellate";
}

const RANK: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };

/** A crate counts as in someone's hands while it is working, ready or stuck (ideas only while being built). */
function inHand(c: Crate): boolean {
  return c.state !== "shipped" && c.state !== "queued" && (c.kind !== "idea" || c.state === "working");
}

/**
 * Who holds each crate in hand: whoever's model is really doing it (`crewFor`). When one crew member holds several,
 * the rest are worked alongside them, up to their cap (`crewLoad`, `shifts`).
 */
export function assignCrew(crates: Crate[]): Map<number, CrewId> {
  const out = new Map<number, CrewId>();
  for (const c of crates) if (inHand(c)) out.set(c.number, crewFor(c));
  return out;
}

/** Who a crate is with, given everything else in flight. */
export function crewOf(crate: Crate, crates: Crate[]): CrewId {
  return assignCrew(crates).get(crate.number) ?? crewFor(crate);
}

export function parseChecks(runs: GhRun[]): FoundryData["checks"] {
  const run = runs[0];
  if (!run) return { state: "unknown", url: null, at: null };
  const state: ChecksState = run.status !== "completed" ? "running" : run.conclusion === "success" ? "pass" : run.conclusion === "failure" ? "fail" : "unknown";
  return { state, url: run.html_url, at: Date.parse(run.updated_at) };
}

/** How many jobs each crew member has in hand (working, waiting on Nikita or stuck). */
export function crewLoad(crates: Crate[]): Record<CrewId, number> {
  const out: Record<CrewId, number> = { semicolon: 0, caret: 0, tessellate: 0 };
  for (const who of assignCrew(crates).values()) out[who] += 1;
  return out;
}

/** How many spare units wait on Rusty's dock in the Foundry: Dusty, Gusty and Musty, his dock crew. */
export const SPARE_BAYS = 3;

/**
 * Rusty's dock crew, one to a bay in this order: frames Rusty pulled out of the same scrapheap and patched up
 * himself, each in its own paint so they can be told apart on the line (Nikita, 2026-10-13).
 */
export const DOCK_CREW = [
  { name: "Dusty", colour: "#ecc66a" },
  { name: "Gusty", colour: "#3f8fea" },
  { name: "Musty", colour: "#6fae4a" },
] as const;

/**
 * How many jobs run at once across the whole crew (Nikita, 2026-10-13): four. Rusty can take all four, himself and
 * his dock crew; Rocky takes one at a time. Urgent work (a fix) never waits: Rivet's jobs are the emergency slot,
 * outside the four, and a fix in Rusty's hands goes ahead of his other work. Anything past the cap waits its turn.
 */
export const MAX_AT_ONCE = 4;
/** The most jobs each crew member runs at once. */
export const MAX_RUNNING: Record<CrewId, number> = { semicolon: Infinity, caret: 1, tessellate: SPARE_BAYS + 1 };

/** Urgent work: a fix (red checks on main, a bug, an alert). It never waits for the cap. */
function urgent(c: Crate): boolean {
  return c.kind === "fix";
}

/**
 * Which jobs really run, and which wait their turn. Only jobs labelled working count (not queued, not waiting on
 * Nikita, not stuck, not paused for a fix). Urgent work goes first, then the oldest; a job runs while its crew
 * member has a free hand and, unless it's urgent or Rivet's, while fewer than four others are running.
 */
export function runningNow(crates: Crate[]): { running: Map<number, CrewId>; waiting: Map<number, CrewId> } {
  const by = assignCrew(crates);
  const working = crates.filter((c) => c.state === "working" && !c.paused && by.has(c.number)).sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || a.number - b.number);
  const hands: Record<CrewId, number> = { semicolon: 0, caret: 0, tessellate: 0 };
  let counted = 0;
  const out = { running: new Map<number, CrewId>(), waiting: new Map<number, CrewId>() };
  for (const c of working) {
    const who = by.get(c.number)!;
    const outside = who === "semicolon" || urgent(c);
    if (hands[who] >= MAX_RUNNING[who] || (!outside && counted >= MAX_AT_ONCE)) {
      out.waiting.set(c.number, who);
      continue;
    }
    hands[who] += 1;
    if (!outside) counted += 1;
    out.running.set(c.number, who);
  }
  return out;
}

/** One crew member's running jobs (urgent first, then oldest) and the ones waiting their turn. */
export function shifts(crates: Crate[], who: CrewId): { running: Crate[]; waiting: Crate[] } {
  const { running: run, waiting } = runningNow(crates);
  const of = (m: Map<number, CrewId>) => [...m].filter(([, w]) => w === who).map(([n]) => crates.find((c) => c.number === n)!);
  return { running: of(run), waiting: of(waiting) };
}

/** Every job that is working but waiting its turn, because the crew or its crew member is at the cap. */
export function waitingTurn(crates: Crate[]): Set<number> {
  return new Set(runningNow(crates).waiting.keys());
}

/**
 * Who has hands on each of Rusty's running jobs: Rusty on the oldest, then Dusty, Gusty and Musty. Jobs waiting
 * their turn are left out.
 */
export function rustyHands(crates: Crate[]): Map<number, string> {
  const names = ["Rusty", ...DOCK_CREW.map((d) => d.name)];
  return new Map(shifts(crates, "tessellate").running.map((c, i) => [c.number, names[i]!]));
}

/**
 * How many of Rusty's dock crew are awake: one for each job really running past his own. One job, just Rusty;
 * three, Rusty plus Dusty and Gusty. Each awake one works the assembly line alongside him.
 */
export function sparesAwake(crates: Crate[]): number {
  return Math.max(0, shifts(crates, "tessellate").running.length - 1);
}

const SIZE_RANK = { large: 3, medium: 2, small: 1 } as const;

/**
 * The plan on Rocky's drafting table: the biggest idea that is open (an approved build not yet shipped) or upcoming
 * (an idea waiting on the C.E.O.). Biggest by its size; then one already being built; then the newest. Null when
 * there is none.
 */
export function blueprintCrate(crates: Crate[]): Crate | null {
  const open = crates.filter((c) => c.state !== "shipped" && (c.kind === "build" || c.kind === "idea"));
  const score = (c: Crate) => (c.size ? SIZE_RANK[c.size] : 0) * 10 + (c.kind === "build" || c.state === "working" ? 1 : 0);
  let best: Crate | null = null;
  for (const c of open) if (!best || score(c) > score(best) || (score(c) === score(best) && c.updatedAt > best.updatedAt)) best = c;
  return best;
}

/**
 * The job a crew member's name plate in the Lattice shows: what their routine in the room is about. A stuck or
 * ready crate first (they're slumped by it, or waiting at the dock with it); then the job in their own hands
 * (Rusty's oldest running one; the newer ones are his dock crew's, `dockJobs`); then anything else they hold. Rusty
 * with nothing in hand shows the latest upkeep while he's seen working it through (`visibleUpkeep`), unless ideas
 * are waiting on the board. Null when they hold nothing.
 */
export function crewJob(crates: Crate[], who: CrewId, now = Date.now()): Crate | null {
  const held = crewWork(crates)[who];
  if (held && held.state !== "working") return held;
  const own = shifts(crates, who).running[0];
  if (own) return own;
  if (held) return held;
  if (who === "tessellate" && !crates.some((c) => c.kind === "idea" && c.state === "queued")) return visibleUpkeep(crates, now);
  return null;
}

/** The jobs Rusty's dock crew are on, one per awake unit in bay order (Dusty, Gusty, Musty). */
export function dockJobs(crates: Crate[]): Crate[] {
  return shifts(crates, "tessellate").running.slice(1, 1 + SPARE_BAYS);
}

/** What each crew member is doing: the crate they hold that matters most (stuck, then working, then ready). */
export function crewWork(crates: Crate[]): Record<CrewId, Crate | null> {
  const out: Record<CrewId, Crate | null> = { semicolon: null, caret: null, tessellate: null };
  const by = assignCrew(crates);
  for (const c of crates) {
    const who = by.get(c.number);
    if (!who) continue;
    const held = out[who];
    if (!held || RANK[c.state] < RANK[held.state]) out[who] = c;
  }
  return out;
}

interface FoundryStore {
  data: FoundryData;
  /** True once GitHub has answered at least once. */
  connected: boolean;
  lastFetch: number | null;
  /** Ideas Nikita just sent from the Desk, shown at once until GitHub's copy arrives (numbered below zero until then). */
  pending: Crate[];
  set: (data: FoundryData) => void;
  addPending: (crate: Crate) => void;
  /** GitHub answered: the pending card now has its real issue number (or `null` when sending failed). */
  settlePending: (temp: number, issue: number | null) => void;
  /** Rusty's shaping came straight back from Claude: the pending card takes it before GitHub has it. */
  shapePending: (number: number, shape: Pick<Crate, "title" | "pitch" | "size" | "short" | "builder">) => void;
}

export const EMPTY_FOUNDRY: FoundryData = { crates: [], changelog: [], checks: { state: "unknown", url: null, at: null }, shelved: 0, lastCommit: null };

/** How many ideas are on the shelf. */
export function countShelved(issues: GhIssue[]): number {
  return issues.filter((i) => !i.pull_request && i.state === "closed" && i.labels.some((l) => (typeof l === "string" ? l : l.name) === "foundry:passed")).length;
}

export const useFoundry = create<FoundryStore>((set) => ({
  data: EMPTY_FOUNDRY,
  connected: false,
  lastFetch: null,
  pending: [],
  // A pending card stays until the feed carries its issue in at least the same shape, so the board never flickers
  // back to empty or back to the unshaped words.
  set: (data) => set((s) => ({ data, connected: true, lastFetch: Date.now(), pending: s.pending.filter((p) => !data.crates.some((c) => c.number === p.number && (p.revising || !c.revising))) })),
  addPending: (crate) => set((s) => ({ pending: [...s.pending, crate] })),
  settlePending: (temp, issue) =>
    set((s) => ({
      pending:
        issue === null ? s.pending.filter((p) => p.number !== temp)
        : s.pending.map((p) => (p.number === temp ? { ...p, number: issue, url: `https://github.com/${REPO}/issues/${issue}` } : p)),
    })),
  shapePending: (number, shape) => set((s) => ({ pending: s.pending.map((p) => (p.number === number ? { ...p, ...shape, revising: false, updatedAt: Date.now() } : p)) })),
}));

/** The card the Desk shows the moment Nikita sends an idea, in their own words. */
export function pendingIdea(words: string, now: number, images: string[] = []): Crate {
  const first = words.split("\n")[0]!.trim();
  return { number: -now, title: `Idea: ${first.length > 80 ? `${first.slice(0, 77)}…` : first}`, kind: "idea", state: "queued", rung: null, url: "", updatedAt: now, pitch: "", size: null, revising: true, images };
}

/** The last answer per URL with its ETag, so an unchanged answer costs nothing against the rate limit. */
const cache = new Map<string, { etag: string; body: unknown }>();

async function fetchJson<T>(url: string): Promise<T> {
  const had = cache.get(url);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (had) headers["If-None-Match"] = had.etag;
  const res = await fetch(url, { headers });
  if (res.status === 304 && had) return had.body as T;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) cache.set(url, { etag, body });
  return body;
}

interface Feed {
  issues: GhIssue[];
  runs: { workflow_runs: GhRun[] };
  pulls: GhPull[];
  commits: GhCommit[];
}

/** The Desk's own feed (api/foundry-feed.ts): one request, read with the Foundry's token and shared by every tab. */
async function readFeed(): Promise<Feed> {
  // Right after a Desk click, skip the few seconds of edge cache so the change shows at once.
  const url = Date.now() < quickUntil ? `/api/foundry-feed?fresh=${Date.now()}` : "/api/foundry-feed";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} feed`);
  return (await res.json()) as Feed;
}

/** GitHub directly, for local previews where the feed isn't running. */
async function readGitHub(): Promise<Feed> {
  const [issues, runs, pulls, commits] = await Promise.all([
    fetchJson<GhIssue[]>(`${API}/issues?labels=foundry&state=all&sort=updated&per_page=40`),
    fetchJson<{ workflow_runs: GhRun[] }>(`${API}/actions/workflows/checks.yml/runs?branch=main&per_page=1`).catch(() => ({ workflow_runs: [] })),
    fetchJson<GhPull[]>(`${API}/pulls?state=closed&sort=updated&direction=desc&per_page=20`).catch(() => [] as GhPull[]),
    fetchJson<GhCommit[]>(`${API}/commits?sha=main&per_page=40`).catch(() => [] as GhCommit[]),
  ]);
  return { issues, runs, pulls, commits };
}

export async function refreshFoundry(): Promise<void> {
  try {
    const { issues, runs, pulls, commits } = await readFeed().catch(readGitHub);
    const data: FoundryData = { crates: parseCrates(issues), changelog: parseChangelog(issues, pulls, commits), checks: parseChecks(runs.workflow_runs), shelved: countShelved(issues), lastCommit: parseLastCommit(commits) };
    useFoundry.getState().set(data);
    // The Foundry's two pipes in the Boiler Room and on Systems.
    const { setLink } = useSystems.getState();
    const now = Date.now();
    const checks: Record<ChecksState, LinkState> = { pass: "ok", fail: "down", running: "slow", unknown: "off" };
    setLink("checks", { state: checks[data.checks.state], load: data.checks.state === "running" ? 0.9 : 0.4, lastSeen: data.checks.at, note: data.checks.url ?? undefined });
    const busy = data.crates.filter((c) => c.state === "working").length;
    const stuck = data.crates.some((c) => c.state === "stuck");
    setLink("foundry", { state: stuck ? "slow" : "ok", load: Math.min(1, 0.25 + busy * 0.3), lastSeen: now, note: stuck ? "A crate is stuck and needs you" : undefined });
  } catch {
    // Offline or rate-limited: keep what we had and try again next poll.
  }
}

let started = false;
let quickUntil = 0;
let quickTimer: number | null = null;

/** Something just changed on GitHub (a click on the Desk): poll quickly for a minute so it shows without a refresh. */
export function expectChange(): void {
  quickUntil = Date.now() + QUICK_FOR_MS;
  void refreshFoundry();
  if (quickTimer !== null || typeof window === "undefined") return;
  quickTimer = window.setInterval(() => {
    if (Date.now() > quickUntil) {
      if (quickTimer !== null) clearInterval(quickTimer);
      quickTimer = null;
      return;
    }
    if (document.visibilityState === "visible") void refreshFoundry();
  }, QUICK_MS);
}

/** Start polling GitHub (once per page). Skipped in tests and with `?offline`. */
export function startFoundry(): void {
  if (started || typeof window === "undefined" || new URLSearchParams(window.location.search).has("offline")) return;
  started = true;
  void refreshFoundry();
  setInterval(() => {
    if (document.visibilityState === "visible") void refreshFoundry();
  }, POLL_MS);
  // Coming back to the tab asks straight away rather than waiting out the interval.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshFoundry();
  });
}
