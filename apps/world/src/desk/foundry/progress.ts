import type { Crate, OpenPr, PullTiming } from "../../foundry.ts";
import type { Trail } from "../../usage.ts";
import type { Stage } from "./forge.ts";

/**
 * How far along each job in flight is, and roughly how long it has left (#488): "57% · about 12 min left".
 *
 * Both come from real milestones, never from a guess (Nikita, 2026-10-27). The bar is step N of the seven every job
 * passes (assigned, branch pushed, pull request open, checks running, checks green, merged, deployed), each at a fixed
 * percent; which steps a job has reached comes from GitHub (its Assigned step, its pushed branch, its open pull request
 * and that pull request's checks). The time left is the sum of the median measured durations of the steps still to
 * go, from the recently merged pull requests (api/foundry-feed.ts, `timings`), less the time the current step has
 * already run (the live CI run's own elapsed time while checks are running); it is left out when there's no history
 * for a step still to go. A builder's `**Trail · Progress:**` note adds words ("fixing the phone layout"), never the
 * percent. No canvas and no DOM here, so it is unit tested (progress.test.ts).
 */

/** The milestones every job passes, in order. */
export const MILESTONES = ["assigned", "pushed", "open", "checks", "green", "merged", "deployed"] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Each milestone in a few plain words. */
export const MILESTONE_WORDS: Record<Milestone, string> = {
  assigned: "assigned",
  pushed: "branch pushed",
  open: "pull request open",
  checks: "checks running",
  green: "checks green",
  merged: "merged",
  deployed: "deployed",
};

/** Step N of M's fixed percent: an even share of the seven. */
export const stepPct = (n: number) => Math.round((n / MILESTONES.length) * 100);

export interface Progress {
  /** Milestones reached, 1..7 (step N of M). */
  step: number;
  /** The newest milestone reached. */
  at: Milestone;
  /** 0–100, fixed by the step. */
  pct: number;
  /** The builder's note on what is happening now, when they left one; "" otherwise. */
  doing: string;
  /** Minutes left, rounded, at least one; null when a step still to go has no history. */
  leftMin: number | null;
  /** How many merged pull requests the time left was measured from (the fewest across the steps it sums). */
  measured: number;
}

const PROGRESS = "**Trail · Progress:**";
/** Longest note the Desk shows. */
const NOTE_MAX = 80;

/**
 * A builder's Progress note, in plain words: `**Trail · Progress:** fixing the phone layout`. A percent, a step or a
 * time left written in it is dropped, since the milestones set them. null when it isn't a Progress step or says nothing else.
 */
export function readNote(body: string): string | null {
  if (!body.startsWith(PROGRESS)) return null;
  const line = body.slice(PROGRESS.length).split("\n")[0]!;
  const parts = line
    .split(/\s+·\s+|\s+\|\s+/)
    .map((p) =>
      p
        .trim()
        .replace(/^\d{1,3}(?:\.\d+)?\s*%[\s,;:–-]*/, "")
        .replace(/^step\s+\d+\s+of\s+\d+[\s,;:–-]*/i, "")
        .trim(),
    )
    .filter((p) => p && !/^(?:about|around|roughly|~)?\s*[\d.]+\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b.*\b(?:left|to go)\.?$/i.test(p));
  const t = tidy(parts.join(" · "));
  return t || null;
}

/** Plain words only: no markdown, links or anything address-shaped, short enough for one line. */
function tidy(raw: string): string {
  const t = raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\S+@\S+/g, "")
    .replace(/[*_`<>[\]]+/g, "")
    .replace(/#(?!\d)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!\s]+$/, "");
  return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX - 1).trimEnd()}…` : t;
}

/** The fewest measured pull requests a step's median needs. */
export const MIN_HISTORY = 2;
/** A step longer than this sat waiting rather than being worked; it says nothing about the next one. */
const MAX_STEP_MS = 3 * 24 * 3_600_000;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The six steps between the seven milestones, each as a measured median, with how many it was measured from. */
export type StepTimes = { ms: number | null; n: number }[];

/**
 * How long each step takes, measured from the recently merged pull requests: assigned (the issue's Assigned step) to
 * the branch pushed (its first commit), pushed to opened, opened to checks started, checks started to green, green to
 * merged, merged to deployed. A step with fewer than {@link MIN_HISTORY} measurements has no median.
 */
export function stepTimes(timings: readonly PullTiming[], assignedAt: ReadonlyMap<number, number>): StepTimes {
  const gaps: number[][] = [[], [], [], [], [], []];
  for (const t of timings) {
    const at = [t.issue !== null ? (assignedAt.get(t.issue) ?? null) : null, t.pushed, t.opened, t.checksAt, t.greenAt, t.merged, t.deployed];
    for (let i = 0; i < 6; i++) {
      const a = at[i];
      const b = at[i + 1];
      if (a == null || b == null) continue;
      const d = b - a;
      if (d >= 0 && d <= MAX_STEP_MS) gaps[i]!.push(d);
    }
  }
  return gaps.map((g) => ({ ms: g.length >= MIN_HISTORY ? median(g) : null, n: g.length }));
}

/** When each issue was assigned: its first Assigned step, else its first Work step. */
export function assignedTimes(trails: readonly Trail[]): Map<number, number> {
  const out = new Map<number, number>();
  const work = new Map<number, number>();
  for (const t of trails) {
    const at = Date.parse(t.at);
    if (Number.isNaN(at)) continue;
    const into = t.body.startsWith("**Trail · Assigned:**") ? out : t.body.startsWith("**Trail · Work:**") ? work : null;
    if (into && (!into.has(t.issue) || at < into.get(t.issue)!)) into.set(t.issue, at);
  }
  for (const [issue, at] of work) if (!out.has(issue)) out.set(issue, at);
  return out;
}

/**
 * The newest milestone a job has reached, its step, and when it got there (null where GitHub doesn't say). Red
 * checks go back to the pull request being open: the fix and its checks are still to come.
 */
export function reached(crate: Pick<Crate, "createdAt">, pr: OpenPr | null, pushed: boolean, assignedAt: number | null): { at: Milestone; since: number | null; step: number } {
  if (pr) {
    if (pr.checks === "pass") return { at: "green", since: pr.greenAt ?? null, step: 5 };
    if (pr.checks === "running") return { at: "checks", since: pr.checksAt ?? null, step: 4 };
    return { at: "open", since: pr.at, step: 3 };
  }
  if (pushed) return { at: "pushed", since: null, step: 2 };
  return { at: "assigned", since: assignedAt ?? crate.createdAt ?? null, step: 1 };
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * One job's progress. Paused, waiting and stuck jobs aren't moving, so they get none. The time left is the median of
 * the step it is on less how long it has been on it (never below nothing), plus the medians of every step after.
 */
export function progressOf(crate: Crate, stage: Stage | null, pr: OpenPr | null, pushed: boolean, steps: readonly Trail[], times: StepTimes, assignedAt: number | null, now: number): Progress | null {
  if (stage === "paused" || stage === "waiting" || stage === "stuck") return null;
  const where = reached(crate, pr, pushed, assignedAt);
  let note = "";
  for (let i = steps.length - 1; i >= 0 && !note; i--) note = readNote(steps[i]!.body) ?? "";
  let left: number | null = 0;
  let measured = Infinity;
  for (let i = where.step - 1; i < times.length; i++) {
    const t = times[i]!;
    if (t.ms === null) {
      left = null;
      break;
    }
    measured = Math.min(measured, t.n);
    left += i === where.step - 1 && where.since !== null ? Math.max(0, t.ms - (now - where.since)) : t.ms;
  }
  const known = left !== null && measured !== Infinity;
  return { step: where.step, at: where.at, pct: stepPct(where.step), doing: note, leftMin: known ? minutes(left!) : null, measured: known ? measured : 0 };
}

/** Every lane's progress at once, keyed by issue: the trails grouped and the steps measured once. */
export function progressMap(jobs: readonly { crate: Crate; stage: Stage | null; pr: OpenPr | null }[], trails: readonly Trail[] | null, timings: readonly PullTiming[], branches: readonly number[], now: number): Map<number, Progress> {
  const out = new Map<number, Progress>();
  const all = trails ?? [];
  const assigned = assignedTimes(all);
  const times = stepTimes(timings, assigned);
  const byIssue = new Map<number, Trail[]>();
  for (const t of all) byIssue.set(t.issue, [...(byIssue.get(t.issue) ?? []), t]);
  for (const list of byIssue.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const pushed = new Set(branches);
  for (const { crate, stage, pr } of jobs) {
    const p = progressOf(crate, stage, pr, pushed.has(crate.number), byIssue.get(crate.number) ?? [], times, assigned.get(crate.number) ?? null, now);
    if (p) out.set(crate.number, p);
  }
  return out;
}

/** "about 25 min left", "about 2 h left"; "" with no history. */
export function leftWords(p: Pick<Progress, "leftMin">): string {
  if (p.leftMin === null) return "";
  if (p.leftMin < 90) return `about ${p.leftMin} min left`;
  const h = Math.round(p.leftMin / 30) / 2;
  return `about ${h % 1 ? h.toFixed(1) : h} h left`;
}

/** "57% · about 12 min left", or just "57%". */
export function progressWords(p: Progress): string {
  const left = leftWords(p);
  return left ? `${p.pct}% · ${left}` : `${p.pct}%`;
}

/** "Step 4 of 7, checks running". */
export function stepWords(p: Pick<Progress, "step" | "at">): string {
  return `Step ${p.step} of ${MILESTONES.length}, ${MILESTONE_WORDS[p.at]}`;
}

/** Where the time left came from, for the opened lane. */
export function sourceWords(p: Progress): string {
  return p.leftMin === null ? "no time yet: a step still to go has no history" : `measured from the last ${p.measured} merged pull requests`;
}
