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
 * (tessellate, Sonnet) simple work plus upkeep and ideas, Rocky (caret, Opus) anything complex or big-picture. Each can
 * run clones of itself for jobs at the same time. The Foundry's submind leads them and isn't crew.
 */
export type CrewId = "semicolon" | "caret" | "tessellate";

export const CREW: Record<CrewId, { name: string; job: string }> = {
  semicolon: { name: "Rivet", job: "First responder" },
  caret: { name: "Rocky", job: "Master builder" },
  tessellate: { name: "Rusty", job: "Builder, upkeep and ideas" },
};

export interface Crate {
  number: number;
  title: string;
  kind: CrateKind;
  state: CrateState;
  /** The model rung a fix is on: 1 Haiku (Rivet), 2 Sonnet (Rusty), 3 Opus (Rocky). */
  rung: 1 | 2 | 3 | null;
  url: string;
  /** Date.now() of the last change. */
  updatedAt: number;
  /** The issue's pitch line (ideas carry one), or "". */
  pitch: string;
  /** Small, medium or large, when the issue says. */
  size: "small" | "medium" | "large" | null;
  /** An idea Nikita sent back with notes; Rusty is rewriting it. */
  revising: boolean;
  /** Who an idea's card says builds it ("**Builder:** Rusty"), when it says. */
  builder?: CrewId | null;
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
}

export interface FoundryData {
  crates: Crate[];
  /** Every shipped change GitHub still lists, newest first. */
  changelog: Change[];
  checks: { state: ChecksState; url: string | null; at: number | null };
  /** Ideas Nikita passed on: closed and labelled `foundry:passed`, waiting on the shelf for a comeback. */
  shelved: number;
}

/** The slice of GitHub's issue JSON we read. */
export interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
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
    out.push({
      key: `issue-${issue.number}`,
      at: Date.parse(issue.closed_at ?? issue.updated_at),
      title: issue.title,
      // A built idea is a build by the time it ships.
      kind: kind === "idea" ? "build" : kind,
      issue: { number: issue.number, url: issue.html_url },
      landed: pr ? { label: `PR #${pr.number}`, url: pr.html_url } : commit ? { label: commit.sha.slice(0, 7), url: commit.html_url } : null,
    });
  }
  // A pull request for an issue already listed (or still open) is that issue's, not a change of its own.
  const tracked = new Set(issues.map((i) => i.number));
  for (const p of merged) {
    if (used.has(p.number)) continue;
    const refs = [branchIssue(p.head.ref), ...mentions(`${p.title}\n${p.body ?? ""}`)];
    if (refs.some((n) => n !== null && tracked.has(n))) continue;
    const lane = /^foundry\/(fix|upkeep|build|idea)\//.exec(p.head.ref)?.[1] as CrateKind | undefined;
    out.push({ key: `pr-${p.number}`, at: Date.parse(p.merged_at!), title: p.title, kind: lane === "idea" ? "build" : (lane ?? "chat"), issue: null, landed: { label: `PR #${p.number}`, url: p.html_url } });
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
    if (issue.state === "closed") {
      if (!labels.has("foundry:shipped")) continue;
      if (now - Date.parse(issue.closed_at ?? issue.updated_at) > SHIPPED_FOR_MS) continue;
      state = "shipped";
    } else {
      state = labels.has("foundry:stuck") ? "stuck" : labels.has("foundry:ready") ? "ready" : labels.has("foundry:working") ? "working" : "queued";
    }
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    crates.push({ number: issue.number, title: issue.title, kind, state, rung, url: issue.html_url, updatedAt, revising: labels.has("foundry:revise"), ...readBody(issue.body ?? "") });
  }
  return crates.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The pitch, size and builder the Foundry writes into an issue ("**Pitch:** …", "**Size:** small", "**Builder:** Rusty"). */
export function readBody(body: string): Pick<Crate, "pitch" | "size" | "builder"> {
  const pitch = /\*\*Pitch:\*\*\s*([^\n]+)/.exec(body)?.[1]?.trim() ?? "";
  const size = /\*\*Size:\*\*\s*(small|medium|large)/i.exec(body)?.[1]?.toLowerCase() as Crate["size"] | undefined;
  const named = /\*\*Builder:\*\*\s*(Rusty|Rocky)/i.exec(body)?.[1]?.toLowerCase();
  const builder: CrewId | null = named === "rusty" ? "tessellate" : named === "rocky" ? "caret" : null;
  return { pitch, size: size ?? null, builder };
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
 * Whose lane a crate is in. Fixes go by rung: Rivet (Haiku) on rung 1, Rusty (Sonnet) on rung 2, Rocky (Opus) on
 * rung 3. Approved builds go to the builder the card names, Rocky when it names none: Opus is the default for
 * anything that isn't plainly simple. Rusty also keeps upkeep and ideas. Chat work has no lane; `assignCrew` hands
 * it to whoever is free.
 */
export function crewFor(crate: Pick<Crate, "kind" | "rung"> & Pick<Partial<Crate>, "builder">): CrewId {
  if (crate.kind === "fix") return crate.rung === 3 ? "caret" : crate.rung === 2 ? "tessellate" : "semicolon";
  if (crate.kind === "build") return crate.builder === "tessellate" ? "tessellate" : "caret";
  if (crate.kind === "chat") return "semicolon";
  return "tessellate";
}

/** Who picks up work from outside the lanes: the first responder first, then Rusty, then Rocky. */
const SPARE_HANDS: CrewId[] = ["semicolon", "tessellate", "caret"];

const RANK: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };

/** A crate counts as in someone's hands while it is working, ready or stuck (ideas only while being built). */
function inHand(c: Crate): boolean {
  return c.state !== "shipped" && c.state !== "queued" && (c.kind !== "idea" || c.state === "working");
}

/**
 * Who holds each crate in hand. Lane work goes to its owner. Chat work (a thread building what Nikita asked for in
 * chat) goes to whoever has nothing in hand, so the room shows it being worked on; when everyone is busy a Rusty
 * clone takes it.
 */
export function assignCrew(crates: Crate[]): Map<number, CrewId> {
  const out = new Map<number, CrewId>();
  const busy = new Set<CrewId>();
  const lane = crates.filter((c) => inHand(c) && c.kind !== "chat");
  for (const c of lane) {
    out.set(c.number, crewFor(c));
    busy.add(crewFor(c));
  }
  const chat = crates.filter((c) => inHand(c) && c.kind === "chat").sort((a, b) => a.number - b.number);
  for (const c of chat) {
    const free = SPARE_HANDS.find((who) => !busy.has(who)) ?? "tessellate";
    out.set(c.number, free);
    busy.add(free);
  }
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

/** What each crew member is doing: the crate they hold that matters most (stuck, then working, then ready). */
/** How many jobs each crew member has in hand; past one, the rest are clones of them (same model) working alongside. */
export function crewLoad(crates: Crate[]): Record<CrewId, number> {
  const out: Record<CrewId, number> = { semicolon: 0, caret: 0, tessellate: 0 };
  for (const who of assignCrew(crates).values()) out[who] += 1;
  return out;
}

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
  set: (data: FoundryData) => void;
}

export const EMPTY_FOUNDRY: FoundryData = { crates: [], changelog: [], checks: { state: "unknown", url: null, at: null }, shelved: 0 };

/** How many ideas are on the shelf. */
export function countShelved(issues: GhIssue[]): number {
  return issues.filter((i) => !i.pull_request && i.state === "closed" && i.labels.some((l) => (typeof l === "string" ? l : l.name) === "foundry:passed")).length;
}

export const useFoundry = create<FoundryStore>((set) => ({
  data: EMPTY_FOUNDRY,
  connected: false,
  lastFetch: null,
  set: (data) => set({ data, connected: true, lastFetch: Date.now() }),
}));

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
    const data: FoundryData = { crates: parseCrates(issues), changelog: parseChangelog(issues, pulls, commits), checks: parseChecks(runs.workflow_runs), shelved: countShelved(issues) };
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
