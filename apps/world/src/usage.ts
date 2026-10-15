import { useEffect, useState } from "react";
import { crewFor, readBody, REPO, type CrateKind, type Model } from "./foundry.ts";

/**
 * What the Foundry uses, for the Desk's Usage panel, counted from the issue trails (docs/FOUNDRY.md, "The trail on
 * every issue"), read through api/foundry-usage.ts:
 * - this month's Claude API spend on quick idea shaping, from the token use and cost each call wrote on its
 *   "**Trail · Shaped:**" step (api/foundry.ts), against the monthly cap;
 * - the Foundry's work by model (Haiku, Sonnet, Opus): how many jobs and for how long, this week and all time, from
 *   who the Builder assigned each job to and when it shipped.
 * Claude's plan limits (the session and weekly limits on Claude Code) live only on Claude's own usage page, which a
 * website can't read, so the panel links there.
 */

/** The monthly cap on quick shaping's Claude API spend, in dollars (api/foundry.ts). */
export const SPEND_CAP_USD = 10;
/** Claude's own usage page: the plan's session and weekly limits (Settings → Usage). */
export const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
export const MODELS: Model[] = ["Haiku", "Sonnet", "Opus"];

const POLL_MS = 60_000;
const API = `https://api.github.com/repos/${REPO}`;
/** The trail's trusted authors, as `TRAIL_AUTHORS` in api/_world/digest.ts: only their Pictures steps are shown. */
const PICTURE_AUTHORS: ReadonlySet<string> = new Set(["nikitapage10", "github-actions[bot]", "ceo-foundry[bot]"]);

/** A Foundry issue, as the usage feed sends it. */
export interface UsageIssue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  body?: string | null;
  labels: string[];
}

/** One trail comment ("**Trail · …**"): its issue, when it was written, and what it says. */
export interface Trail {
  issue: number;
  at: string;
  body: string;
}

export interface UsageFeed {
  issues: UsageIssue[];
  trails: Trail[];
}

/** The token use and cost a Shaped step records ("Used 812 tokens in and 140 out, $0.000151."); null when it has none. */
export function readSpend(body: string): { tokensIn: number; tokensOut: number; usd: number } | null {
  const m = /Used ([\d,]+) tokens in and ([\d,]+) out, \$(\d+(?:\.\d+)?)/.exec(body);
  if (!m) return null;
  const n = (s: string) => Number(s.replace(/,/g, ""));
  return { tokensIn: n(m[1]!), tokensOut: n(m[2]!), usd: Number(m[3]) };
}

export interface MonthSpend {
  /** "October 2026". */
  month: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

/** Quick shaping's spend in the calendar month of `now` (UTC, as the API bills it). */
export function monthSpend(trails: Trail[], now = Date.now()): MonthSpend {
  const d = new Date(now);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return sumSpend(trails, from, to, d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }));
}

function sumSpend(trails: Trail[], from: number, to: number, month: string): MonthSpend {
  const out: MonthSpend = { month, calls: 0, tokensIn: 0, tokensOut: 0, usd: 0 };
  for (const t of trails) {
    if (!t.body.startsWith("**Trail · Shaped:**")) continue;
    const at = Date.parse(t.at);
    if (!(at >= from && at < to)) continue;
    const spend = readSpend(t.body);
    if (!spend) continue;
    out.calls += 1;
    out.tokensIn += spend.tokensIn;
    out.tokensOut += spend.tokensOut;
    out.usd += spend.usd;
  }
  return out;
}

/** One job the Foundry ran: on which model, from when it was taken up to when it shipped (null while it runs). */
export interface Job {
  issue: number;
  model: Model;
  start: number;
  end: number | null;
}

const KINDS: CrateKind[] = ["fix", "build", "upkeep", "chat"];
const step = (t: Trail, name: string) => t.body.startsWith(`**Trail · ${name}:**`);

/** The model a Trail · Assigned step names ("… gives this to Rusty on Opus"). */
export function assignedModel(body: string): Model | null {
  const said = /\bon (Haiku|Sonnet|Opus)\b/i.exec(body)?.[1]?.toLowerCase();
  return said === "haiku" ? "Haiku" : said === "sonnet" ? "Sonnet" : said === "opus" ? "Opus" : null;
}

/**
 * Every job the Foundry has taken up: fixes, builds, upkeep and chat work that are being worked, waiting, stuck or
 * shipped (queued, dropped and unpicked ideas don't count). The model is what the Builder assigned, else the issue's
 * Builder line, else its fix rung, else the crew member's usual one. It starts at the Assigned step (else the first
 * Work step, else the approval for a build, else when the issue was opened) and ends at the Shipped step (else when
 * the issue closed as shipped; a job waiting for an OK or stuck stopped at its last step).
 */
export function foundryJobs(issues: UsageIssue[], trails: Trail[]): Job[] {
  const byIssue = new Map<number, Trail[]>();
  for (const t of trails) byIssue.set(t.issue, [...(byIssue.get(t.issue) ?? []), t]);
  const jobs: Job[] = [];
  for (const issue of issues) {
    const labels = new Set(issue.labels);
    if (!labels.has("foundry")) continue;
    const kind = KINDS.find((k) => labels.has(`foundry:${k}`));
    if (!kind) continue;
    const shipped = labels.has("foundry:shipped");
    const open = issue.state === "open";
    if (open ? !(labels.has("foundry:working") || labels.has("foundry:ready") || labels.has("foundry:stuck")) : !shipped) continue;

    const steps = [...(byIssue.get(issue.number) ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const assigned = steps.find((t) => step(t, "Assigned"));
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    const read = readBody(issue.body ?? "");
    const model = (assigned && assignedModel(assigned.body)) || read.model || (rung === 1 ? "Haiku" : rung === 2 ? "Sonnet" : rung === 3 ? "Opus" : null) || defaultModel(crewFor({ kind, rung, builder: read.builder }));

    const approved = steps.find((t) => step(t, "Decision") || t.body.startsWith("Approved for building"));
    const startStep = assigned ?? steps.find((t) => step(t, "Work")) ?? (kind === "build" ? approved : undefined);
    const start = startStep ? Date.parse(startStep.at) : Date.parse(issue.created_at);
    const shippedStep = steps.find((t) => step(t, "Shipped"));
    let end: number | null = null;
    if (shippedStep) end = Date.parse(shippedStep.at);
    else if (!open) end = Date.parse(issue.closed_at ?? issue.created_at);
    else if (!labels.has("foundry:working")) end = steps.length ? Date.parse(steps.at(-1)!.at) : start;
    jobs.push({ issue: issue.number, model, start, end: end === null ? null : Math.max(start, end) });
  }
  return jobs;
}

function defaultModel(who: ReturnType<typeof crewFor>): Model {
  return who === "semicolon" ? "Haiku" : who === "caret" ? "Opus" : "Sonnet";
}

/** Monday 00:00 of the week `now` is in, local time. */
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The tabs on the Usage panel. "5h" is the last five hours of Foundry work, not the plan's own session meter. */
export type Period = "5h" | "today" | "week" | "all";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "5h", label: "Last 5 hours" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "all", label: "All time" },
];

/** Where a tab's window starts: five hours back, local midnight, local Monday midnight, or the beginning of time. */
export function periodStart(period: Period, now: number): number {
  if (period === "5h") return now - 5 * 3_600_000;
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === "week") return weekStart(now);
  return -Infinity;
}

export interface Tally {
  jobs: number;
  /** Milliseconds of work. */
  ms: number;
  /** Jobs still running. */
  running: number;
}

/** Jobs and hours by model in a window. A job counts when any of its time falls in it, and only that part of its time counts; a running job counts up to `now`. */
export function workByModel(jobs: Job[], period: Period, now = Date.now()): Record<Model, Tally> {
  const out = Object.fromEntries(MODELS.map((m) => [m, { jobs: 0, ms: 0, running: 0 }])) as Record<Model, Tally>;
  const from = periodStart(period, now);
  for (const job of jobs) {
    const end = Math.min(job.end ?? now, now);
    if (end < from || job.start > now) continue;
    const row = out[job.model];
    row.jobs += 1;
    row.ms += Math.max(0, end - Math.max(job.start, from));
    if (job.end === null) row.running += 1;
  }
  return out;
}

/** One "Claude Code: 291k tokens on Opus, 1 h 50 min." line, from a Shipped step. */
export interface CodeUse {
  model: Model;
  tokens: number;
  /** Milliseconds, when the line gives a run time. */
  ms: number | null;
}

/** "291k" -> 291000, "1.2M" -> 1200000, "64,500" -> 64500. */
function readCount(num: string, suffix: string | undefined): number {
  const n = Number(num.replace(/,/g, ""));
  const k = suffix?.toLowerCase() === "m" ? 1e6 : suffix?.toLowerCase() === "k" ? 1e3 : 1;
  return Math.round(n * k);
}

/** "1 h 50 min", "3 min", "2h", "45 s" -> milliseconds; null when there is no run time. */
export function readDuration(text: string): number | null {
  let ms = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/gi)) {
    const unit = m[2]!.toLowerCase()[0];
    ms += Number(m[1]) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);
    found = true;
  }
  return found ? Math.round(ms) : null;
}

/** Every Claude Code line in a Shipped step's text; a Shipped step may hold several, and a comment may have none. */
export function readClaudeCode(body: string): CodeUse[] {
  const out: CodeUse[] = [];
  for (const m of body.matchAll(/Claude Code:\s*(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\s*tokens?\s+on\s+(Haiku|Sonnet|Opus)\b([^\n]*)/gi)) {
    const model = m[3]!.toLowerCase();
    const tail = (m[4] ?? "").replace(/^\s*[,;:·-]\s*/, "");
    out.push({ model: model === "haiku" ? "Haiku" : model === "sonnet" ? "Sonnet" : "Opus", tokens: readCount(m[1]!, m[2]), ms: readDuration(tail) });
  }
  return out;
}

/** Claude Code tokens per model in a window, from the "Claude Code:" lines on Shipped steps, each dated by its comment. null for a model with none recorded. */
export function codeTokensByModel(trails: Trail[], period: Period, now = Date.now()): Record<Model, number | null> {
  const out: Record<Model, number | null> = { Haiku: null, Sonnet: null, Opus: null };
  const from = periodStart(period, now);
  for (const t of trails) {
    if (!t.body.startsWith("**Trail · Shipped:**")) continue;
    const at = Date.parse(t.at);
    if (!(at >= from && at <= now)) continue;
    for (const use of readClaudeCode(t.body)) out[use.model] = (out[use.model] ?? 0) + use.tokens;
  }
  return out;
}

/** "291k", "1.2M", "850"; an em dash where nothing is recorded. */
export function formatTokens(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${n >= 1e5 ? Math.round(n / 1e3) : +(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/** Quick shaping's spend with comments dated inside a tab's window. */
export function windowSpend(trails: Trail[], period: Period, now = Date.now()): MonthSpend {
  return sumSpend(trails, periodStart(period, now), now + 1, "");
}

/** "45m", "3h 20m", "2d 5h". */
export function formatSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

/** Dollars at the precision a small spend needs: "$0.0042", "$1.37". */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

async function readFeed(): Promise<UsageFeed> {
  const res = await fetch("/api/foundry-usage", { headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} usage`);
  return (await res.json()) as UsageFeed;
}

/** GitHub directly, for local previews where the function isn't running: one page of each. */
async function readGitHub(): Promise<UsageFeed> {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return (await res.json()) as T;
  };
  const [issues, comments] = await Promise.all([
    get<(Omit<UsageIssue, "labels"> & { labels: ({ name?: string } | string)[]; pull_request?: unknown })[]>("/issues?labels=foundry&state=all&per_page=100"),
    get<{ issue_url: string; created_at: string; body?: string | null; user?: { login?: string } | null }[]>("/issues/comments?sort=created&direction=desc&per_page=100"),
  ]);
  return {
    issues: issues.filter((i) => !i.pull_request).map((i) => ({ ...i, labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))) })),
    trails: comments
      .filter((c) => /^(\*\*Trail ·|Approved for building)/.test(c.body ?? ""))
      // As the usage feed does: a Pictures step counts only from the trail's trusted authors.
      .filter((c) => !(c.body ?? "").startsWith("**Trail · Pictures:**") || PICTURE_AUTHORS.has(c.user?.login ?? ""))
      .map((c) => ({ issue: Number(/\/issues\/(\d+)$/.exec(c.issue_url)?.[1] ?? 0), at: c.created_at, body: c.body ?? "" })),
  };
}

/** The usage feed, read now and every minute while the tab is showing; null until it first answers. */
export function useUsage(): { feed: UsageFeed | null; failed: boolean } {
  const [state, setState] = useState<{ feed: UsageFeed | null; failed: boolean }>({ feed: null, failed: false });
  useEffect(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).has("offline")) return;
    let live = true;
    const load = () =>
      readFeed()
        .catch(readGitHub)
        .then((feed) => live && setState({ feed, failed: false }))
        .catch(() => live && setState((s) => ({ feed: s.feed, failed: s.feed === null })));
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return state;
}
