import { readBody, type Crate } from "../../foundry.ts";
import { foundryJobs, readClaudeCode, readDuration, type Trail, type UsageFeed } from "../../usage.ts";
import type { Stage } from "./forge.ts";

/**
 * How far along each job in flight is, and roughly how long it has left (#488): "60% · about 25 min left".
 *
 * The builder says so on the issue's trail, a `**Trail · Progress:** 60% · checks running · about 25 min left` step at
 * each milestone (docs/FOUNDRY.md, "The trail on every issue"), and the newest one wins. A job with none yet (or one
 * whose stage has since run past what the builder said) is placed from its stage instead: the trail's own steps
 * (Assigned, Work, Pictures, Checks) and its pull request on the forge; its time left then comes from how long past
 * jobs of the same size took. No canvas and no DOM here, so it is unit tested (progress.test.ts).
 */

export type ProgressSource = "builder" | "stage";

export interface Progress {
  /** 0–100. */
  pct: number;
  /** What's happening now in a few plain words ("checks running"), when the builder said; "" otherwise. */
  doing: string;
  /** Minutes left, rounded; null when there's no estimate. */
  leftMin: number | null;
  /** Past its estimate: the job is taking longer than the builder said, or than past jobs of its size took. */
  long: boolean;
  /** Whether the builder said it (a Progress step) or the Desk worked it out from the stage. */
  source: ProgressSource;
}

const PROGRESS = "**Trail · Progress:**";
/** Longest "what's happening" the Desk shows. */
const DOING_MAX = 80;

/**
 * A Progress step's three parts: `**Trail · Progress:** 60% · checks running · about 25 min left`. The percent
 * leads; the time left is any part ending in "left"; the rest is what's happening. null when it isn't a Progress
 * step or has no percent.
 */
export function readProgress(body: string): { pct: number; doing: string; leftMs: number | null } | null {
  if (!body.startsWith(PROGRESS)) return null;
  const line = body.slice(PROGRESS.length).split("\n")[0]!.trim();
  const parts = line.split(/\s+·\s+|\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  const pct = /^(\d{1,3}(?:\.\d+)?)\s*%/.exec(parts[0] ?? "");
  if (!pct) return null;
  let leftMs: number | null = null;
  const doing: string[] = [];
  const rest = [parts[0]!.slice(pct[0].length).replace(/^[\s,;:–-]+/, ""), ...parts.slice(1)].filter(Boolean);
  for (const p of rest) {
    const left = /^(?:about|around|roughly|~)?\s*(.+?)\s+(?:left|to go)\.?$/i.exec(p);
    const ms = left ? readDuration(left[1]!) : null;
    if (ms !== null && leftMs === null) leftMs = ms;
    else doing.push(p);
  }
  return { pct: clampPct(Number(pct[1])), doing: tidy(doing.join(" · ")), leftMs };
}

/** Plain words only: no markdown, links or anything address-shaped, short enough for one line. */
function tidy(raw: string): string {
  const t = raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\S+@\S+/g, "")
    .replace(/[*_`#<>[\]]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!\s]+$/, "");
  return t.length > DOING_MAX ? `${t.slice(0, DOING_MAX - 1).trimEnd()}…` : t;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Where each trail step puts a job (docs/FOUNDRY.md): taken up, building, pictures posted, checks green, shipped. */
export const TRAIL_PCT = { Assigned: 10, Work: 25, Pictures: 70, Checks: 85, Shipped: 100 } as const;
/** Where its stage on the forge puts it: a pull request open is half way (red checks put it back there); checks running or green further on. */
export const STAGE_PCT: Partial<Record<Stage, number>> = { building: 25, pr: 50, checks: 75, red: 50, green: 90, ready: 90 };

/** How far the trail's own steps and the job's stage on the forge put it, without the builder's word. */
export function stagePct(steps: readonly Trail[], stage: Stage | null): number {
  let pct = 0;
  for (const t of steps) for (const [name, p] of Object.entries(TRAIL_PCT)) if (t.body.startsWith(`**Trail · ${name}:**`)) pct = Math.max(pct, p);
  if (stage) pct = Math.max(pct, STAGE_PCT[stage] ?? 0);
  return pct;
}

/** The fewest shipped jobs of a size it takes to estimate from them, and the most recent ones counted. */
export const MIN_HISTORY = 2;
const HISTORY = 20;
/** A "job" longer than this sat open rather than being worked; it says nothing about how long the next one takes. */
const MAX_JOB_MS = 3 * 24 * 3_600_000;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * How long a job of each size usually takes, from the recent shipped ones: the Claude Code run times on their Shipped
 * steps when they give them ("Claude Code: 291k tokens on Opus, 1 h 50 min."), else from taken up to shipped. null for
 * a size with fewer than {@link MIN_HISTORY} shipped jobs.
 */
export function typicalBySize(feed: UsageFeed): Record<"small" | "medium" | "large", number | null> {
  const byIssue = trailsByIssue(feed.trails);
  const size = new Map(feed.issues.map((i) => [i.number, readBody(i.body ?? "").size]));
  const took: Record<"small" | "medium" | "large", { at: number; ms: number }[]> = { small: [], medium: [], large: [] };
  for (const job of foundryJobs(feed.issues, feed.trails)) {
    const s = size.get(job.issue);
    if (!s || job.end === null) continue;
    const issue = feed.issues.find((i) => i.number === job.issue);
    if (!issue || issue.state !== "closed") continue;
    const runs = (byIssue.get(job.issue) ?? []).filter((t) => t.body.startsWith("**Trail · Shipped:**")).flatMap((t) => readClaudeCode(t.body));
    const ran = runs.reduce((sum, r) => sum + (r.ms ?? 0), 0);
    const ms = ran > 0 ? ran : job.end - job.start;
    if (ms > 0 && ms <= MAX_JOB_MS) took[s].push({ at: job.end, ms });
  }
  const pick = (xs: { at: number; ms: number }[]) => (xs.length >= MIN_HISTORY ? median(xs.sort((a, b) => b.at - a.at).slice(0, HISTORY).map((x) => x.ms)) : null);
  return { small: pick(took.small), medium: pick(took.medium), large: pick(took.large) };
}

export function trailsByIssue(trails: readonly Trail[]): Map<number, Trail[]> {
  const by = new Map<number, Trail[]>();
  for (const t of trails) by.set(t.issue, [...(by.get(t.issue) ?? []), t]);
  for (const list of by.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return by;
}

/** When the job was taken up: its Assigned step, else its first Work step, else when the issue was opened. */
function startedAt(crate: Pick<Crate, "createdAt" | "updatedAt">, steps: readonly Trail[]): number {
  const step = steps.find((t) => t.body.startsWith("**Trail · Assigned:**")) ?? steps.find((t) => t.body.startsWith("**Trail · Work:**"));
  return step ? Date.parse(step.at) : (crate.createdAt ?? crate.updatedAt);
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * One job's progress: the builder's newest Progress step, its time left counted down from when it was written; or,
 * with none (or once the stage has run past it), the stage's percent and the typical time for its size less the time
 * it has run. Paused, waiting and stuck jobs aren't moving, so they get none.
 */
export function progressOf(crate: Crate, stage: Stage | null, steps: readonly Trail[], typical: Record<"small" | "medium" | "large", number | null>, now: number): Progress | null {
  if (stage === "paused" || stage === "waiting" || stage === "stuck") return null;
  const fromStage = stagePct(steps, stage);
  // The typical time for its size, less the time it has run: the estimate when the builder gave none.
  const usual = crate.size ? typical[crate.size] : null;
  const typicalLeft = usual === null ? null : usual - (now - startedAt(crate, steps));
  for (let i = steps.length - 1; i >= 0; i--) {
    const said = readProgress(steps[i]!.body);
    if (!said) continue;
    if (said.pct < fromStage) break;
    const left = said.leftMs !== null ? said.leftMs - (now - Date.parse(steps[i]!.at)) : typicalLeft;
    return { pct: said.pct, doing: said.doing, ...timeLeft(said.pct < 100 ? left : null), source: "builder" };
  }
  return { pct: fromStage, doing: "", ...timeLeft(typicalLeft), source: "stage" };
}

function timeLeft(left: number | null): Pick<Progress, "leftMin" | "long"> {
  if (left === null) return { leftMin: null, long: false };
  return left > 0 ? { leftMin: minutes(left), long: false } : { leftMin: null, long: true };
}

/** Every lane's progress at once, keyed by issue: the trails grouped and the typical times worked out once. */
export function progressMap(jobs: readonly { crate: Crate; stage: Stage | null }[], feed: UsageFeed | null, now: number): Map<number, Progress> {
  const out = new Map<number, Progress>();
  if (!feed) return out;
  const byIssue = trailsByIssue(feed.trails);
  const typical = typicalBySize(feed);
  for (const { crate, stage } of jobs) {
    const p = progressOf(crate, stage, byIssue.get(crate.number) ?? [], typical, now);
    if (p) out.set(crate.number, p);
  }
  return out;
}

/** "about 25 min left", "about 2 h left", "running long"; "" with no estimate. */
export function leftWords(p: Pick<Progress, "leftMin" | "long">): string {
  if (p.long) return "running long";
  if (p.leftMin === null) return "";
  if (p.leftMin < 90) return `about ${p.leftMin} min left`;
  const h = Math.round(p.leftMin / 30) / 2;
  return `about ${h % 1 ? h.toFixed(1) : h} h left`;
}

/** "60% · about 25 min left", or just "60%". */
export function progressWords(p: Progress): string {
  const left = leftWords(p);
  return left ? `${p.pct}% · ${left}` : `${p.pct}%`;
}

/** The subtle note on where the number came from. */
export function sourceWords(p: Progress): string {
  return p.source === "builder" ? "the builder's estimate" : "estimated from its stage and past jobs of its size";
}
