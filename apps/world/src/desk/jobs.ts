/**
 * The Boiler Room's board of scheduled jobs (#301): every GitHub Actions workflow with a cron, and Visual QA after each
 * push, with its last run, whether it passed, and how late GitHub started it against its cron minute. The runs come
 * from the Desk's feed (api/foundry-feed.ts, `jobs`), trimmed there to names, states, times and links. Real states
 * only: a job GitHub hasn't listed says so.
 */

/** One job on the board: its workflow file, its name in plain words, when it is meant to run, and its cron (UTC). */
export interface JobDef {
  file: string;
  name: string;
  when: string;
  cron: string | null;
}

/** Kept in step with .github/workflows by jobs.test.ts. */
export const JOBS: JobDef[] = [
  { file: "backup-azure.yml", name: "Nightly backup", when: "daily, 10:41 UTC", cron: "41 10 * * *" },
  { file: "checks.yml", name: "Nightly checks", when: "daily, 09:17 UTC", cron: "17 9 * * *" },
  { file: "e2e.yml", name: "Browser tests", when: "daily, 09:47 UTC", cron: "47 9 * * *" },
  { file: "world-step.yml", name: "World step", when: "hourly at :05", cron: "5 * * * *" },
  { file: "desk-pings.yml", name: "Desk pings", when: "hourly at :02", cron: "2 * * * *" },
  { file: "live-watch.yml", name: "Live watch", when: "hourly at :23", cron: "23 * * * *" },
  { file: "codeql.yml", name: "CodeQL scan", when: "Mondays, 04:29 UTC", cron: "29 4 * * 1" },
  { file: "scorecard.yml", name: "Scorecard", when: "Mondays, 05:41 UTC", cron: "41 5 * * 1" },
  { file: "visual-qa.yml", name: "Visual QA", when: "after each push", cron: null },
];

/** A run as the feed hands it over (api/foundry-feed.ts, JobRun). */
export interface GhJobRun {
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at: string | null;
  html_url: string;
}

export interface GhJob {
  file: string;
  run: GhJobRun | null;
}

export type JobState = "pass" | "fail" | "running" | "other" | "none";

export interface JobRow {
  file: string;
  name: string;
  when: string;
  state: JobState;
  /** When the last run was created, or null when GitHub listed none. */
  at: number | null;
  /** Minutes between the cron minute and the run's creation; null without a cron or a run. */
  lateMin: number | null;
  /** The next scheduled run should have come long ago and hasn't. */
  missed: boolean;
  url: string | null;
}

/** GitHub starts scheduled runs late as a matter of course; past this it's worth a mention. */
export const LATE_MIN = 30;
/** How long past its next cron minute a job may go quiet before it counts as missed. */
const MISSED_AFTER_MS = 90 * 60_000;
/** How far the cron search looks, either way: past the longest gap on the board (a week). */
const SEARCH_MS = 8 * 86_400_000;
const MINUTE = 60_000;

const RUN_URL = /^https:\/\/github\.com\/nikitapage10\/C\.E\.O\.\/actions\/runs\/\d+$/;

/** Whether one cron field (`*`, `5`, `1,3`, `1-5`, `*\/15`) allows the value. */
function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!range || !Number.isInteger(step) || step < 1) return false;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = 0;
      hi = Infinity;
    } else if (range.includes("-")) {
      [lo, hi] = range.split("-").map(Number) as [number, number];
    } else {
      lo = Number(range);
      hi = stepRaw === undefined ? lo : Infinity;
    }
    if (!Number.isFinite(lo) || Number.isNaN(hi)) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Whether a five-field cron (UTC, as GitHub reads it) fires at the given minute. */
export function cronMatches(cron: string, at: number): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const d = new Date(at);
  const dow = d.getUTCDay();
  return (
    fieldMatches(f[0]!, d.getUTCMinutes()) &&
    fieldMatches(f[1]!, d.getUTCHours()) &&
    fieldMatches(f[2]!, d.getUTCDate()) &&
    fieldMatches(f[3]!, d.getUTCMonth() + 1) &&
    (fieldMatches(f[4]!, dow) || (dow === 0 && fieldMatches(f[4]!, 7)))
  );
}

/** The latest cron minute at or before `at`, or null when there is none within a week and a day. */
export function lastSlot(cron: string, at: number): number | null {
  const start = Math.floor(at / MINUTE) * MINUTE;
  for (let t = start; t > start - SEARCH_MS; t -= MINUTE) if (cronMatches(cron, t)) return t;
  return null;
}

/** The first cron minute after `at`, or null when there is none within a week and a day. */
export function nextSlot(cron: string, at: number): number | null {
  const start = Math.floor(at / MINUTE) * MINUTE + MINUTE;
  for (let t = start; t < start + SEARCH_MS; t += MINUTE) if (cronMatches(cron, t)) return t;
  return null;
}

function stateOf(run: GhJobRun): JobState {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "pass";
  if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "startup_failure") return "fail";
  return "other";
}

/** The board's rows, in JOBS order, from the feed's runs (absent from an older cached feed). */
export function jobRows(jobs: GhJob[] | undefined, now: number): JobRow[] {
  const byFile = new Map((Array.isArray(jobs) ? jobs : []).map((j) => [j.file, j.run]));
  return JOBS.map((def) => {
    const run = byFile.get(def.file) ?? null;
    const at = run ? Date.parse(run.created_at) : NaN;
    if (!run || Number.isNaN(at)) return { file: def.file, name: def.name, when: def.when, state: "none", at: null, lateMin: null, missed: false, url: null };
    const slot = def.cron ? lastSlot(def.cron, at) : null;
    const next = def.cron && slot !== null ? nextSlot(def.cron, slot) : null;
    return {
      file: def.file,
      name: def.name,
      when: def.when,
      state: stateOf(run),
      at,
      lateMin: slot === null ? null : Math.floor((at - slot) / MINUTE),
      missed: next !== null && now - next > MISSED_AFTER_MS,
      url: RUN_URL.test(run.html_url) ? run.html_url : null,
    };
  });
}

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The Pessimist's one line on the board: whichever jobs are failing, missed or late, or a grudging all-clear. */
export function pessimistLine(rows: JobRow[]): string {
  const seen = rows.filter((r) => r.state !== "none");
  if (!seen.length) return "Can't see the jobs from here. Never a good sign.";
  const failed = seen.filter((r) => r.state === "fail").map((r) => r.name);
  const missed = seen.filter((r) => r.missed && r.state !== "fail").map((r) => r.name);
  const late = seen.filter((r) => !r.missed && r.state !== "fail" && r.lateMin !== null && r.lateMin >= LATE_MIN);
  const parts: string[] = [];
  if (failed.length) parts.push(`${listed(failed)} failed. Told you.`);
  if (missed.length) parts.push(`${listed(missed)} didn't turn up when ${missed.length === 1 ? "it was" : "they were"} due.`);
  if (late.length === 1) parts.push(`${late[0]!.name} started ${late[0]!.lateMin} min late. Omens.`);
  else if (late.length) parts.push(`${listed(late.map((r) => r.name))} started late. Omens.`);
  if (parts.length) return parts.join(" ");
  return "Everything ran, on time, and passed. Suspicious. ...Fine.";
}

/** "on time", "4 min late", "1 h 12 min late"; "–" without a cron or a run. */
export function lateLabel(row: JobRow): string {
  if (row.lateMin === null) return "–";
  if (row.lateMin < 1) return "on time";
  if (row.lateMin < 60) return `${row.lateMin} min late`;
  const m = row.lateMin % 60;
  return `${Math.floor(row.lateMin / 60)} h${m ? ` ${m} min` : ""} late`;
}
