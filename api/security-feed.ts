/**
 * The security posture feed for the Desk's Systems > Security page (#82), as a read-only Vercel function. The Desk
 * is public to read, so this returns posture only: each scan's last result on `main` (pass or fail, when, and a link
 * to the run), whether the repo's security features are on, how many alerts are open and fixed, and the OpenSSF
 * Scorecard score; each scan's last twenty results (pass or fail, and when) for its trend, and the open alerts counted
 * by severity (#746; counts only, the severity word is GitHub's own scale and names nothing). Never an alert's details: no file paths, rules, packages, versions or descriptions, since an open
 * one would be a map for an attacker (docs/THREAT-MODEL.md, TB6). Everything else from GitHub is dropped here, not
 * in the browser.
 *
 * GitHub reads go out with the Foundry's token (read-only calls only; a read-only App token once the crew's App is
 * set up, api/_github.ts), and Scorecard's public API is read from here
 * because the browser's CSP allows only this site and api.github.com. A read the token isn't allowed to make comes
 * back as "not reported" rather than failing the feed. Cached like the other feeds (api/_feedcache.ts): canonical
 * URL, a short memo with one read in flight, and the edge cache.
 *
 * GET → SecurityFeed (below).
 */

import { canonical, memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;
const SCORECARD = `https://api.securityscorecards.dev/projects/github.com/${REPO}`;
const RUN_URL = /^https:\/\/github\.com\/nikitapage10\/C\.E\.O\.\/actions\/runs\/\d+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type RunState = "pass" | "fail" | "other" | "none" | "unreported";

export interface WorkflowState {
  id: "checks" | "codeql" | "scorecard" | "dependency-review" | "e2e";
  name: string;
  /** Where the run it reports comes from: `main`, or the latest pull request for a check that only runs on those. */
  scope: "main" | "pull request";
  state: RunState;
  /** GitHub's conclusion word when it is neither a pass nor a fail (cancelled, skipped…). */
  conclusion: string | null;
  at: string | null;
  url: string | null;
  /** The last finished runs, oldest first (up to RECENT): only a result and a time, for the trend. */
  recent?: RunMark[];
}

/** One finished run in a scan's trend. */
export interface RunMark {
  state: "pass" | "fail" | "other";
  at: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export type FeatureState = "on" | "off" | "unreported";

export interface AlertCount {
  open: number;
  fixed: number;
  /** True when either count hit the page size, so it reads "100+". */
  more: boolean;
  /** The open ones counted by severity (#746); absent from older answers. */
  severity?: Record<Severity, number>;
}

export interface SecurityFeed {
  at: string;
  workflows: WorkflowState[];
  features: { id: string; name: string; state: FeatureState }[];
  /**
   * `codeScanning` counts the code findings (CodeQL and any other code scanner) and `dependabot` the vulnerable
   * packages: the actionable ones. `posture` counts what Scorecard uploads to code scanning, which grades how the repo
   * is run (branch protection, reviews, fuzzing…) rather than a bug in its code (#901); absent from older answers,
   * where `codeScanning` counted both.
   */
  alerts: { codeScanning: AlertCount | null; dependabot: AlertCount | null; posture?: AlertCount | null };
  scorecard: { score: number; date: string; checks: { name: string; score: number; short: string }[] } | null;
}

const WORKFLOWS: { id: WorkflowState["id"]; name: string; file: string; scope: WorkflowState["scope"] }[] = [
  { id: "checks", name: "Checks", file: "checks.yml", scope: "main" },
  { id: "codeql", name: "CodeQL", file: "codeql.yml", scope: "main" },
  { id: "scorecard", name: "Scorecard", file: "scorecard.yml", scope: "main" },
  // Dependency review runs only on pull requests, so its latest run is the latest pull request's.
  { id: "dependency-review", name: "Dependency review", file: "dependency-review.yml", scope: "pull request" },
  { id: "e2e", name: "E2E", file: "e2e.yml", scope: "main" },
];

class ReadError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

async function read(path: string): Promise<unknown> {
  const token = await githubToken("read");
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new ReadError(res.status);
  return res.json();
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);

/** How many finished runs a scan's trend shows. */
export const RECENT = 20;

const markOf = (c: string): RunMark["state"] => (c === "success" ? "pass" : c === "failure" || c === "timed_out" || c === "startup_failure" ? "fail" : "other");

/** The last finished run's result, reduced to a state, a time and a link to it, and the runs before it as a trend. */
export function runState(body: unknown, wf: (typeof WORKFLOWS)[number]): WorkflowState {
  const base = { id: wf.id, name: wf.name, scope: wf.scope };
  const runs = obj(body)?.workflow_runs;
  if (!Array.isArray(runs)) return { ...base, state: "unreported", conclusion: null, at: null, url: null };
  const run = obj(runs[0]);
  if (!run) return { ...base, state: "none", conclusion: null, at: null, url: null };
  const c = typeof run.conclusion === "string" ? run.conclusion : "";
  const state: RunState = markOf(c);
  const recent: RunMark[] = [];
  for (const x of runs.slice(0, RECENT)) {
    const o = obj(x);
    const at = o ? (iso(o.updated_at) ?? iso(o.created_at)) : null;
    if (o && at) recent.push({ state: markOf(typeof o.conclusion === "string" ? o.conclusion : ""), at });
  }
  return {
    ...base,
    state,
    conclusion: state === "other" && /^[a-z_]{1,20}$/.test(c) ? c.replace(/_/g, " ") : null,
    at: iso(run.updated_at) ?? iso(run.created_at),
    url: typeof run.html_url === "string" && RUN_URL.test(run.html_url) ? run.html_url : null,
    recent: recent.reverse(),
  };
}

/**
 * An open alert's severity on GitHub's own scale, and nothing else about it. Code scanning gives a security severity
 * for security rules and a plain one (error, warning, note) for the rest; Dependabot gives the advisory's.
 */
export function severityOf(kind: "code-scanning" | "dependabot", alert: unknown): Severity | null {
  const a = obj(alert);
  const word = (v: unknown): Severity | null => (v === "critical" || v === "high" || v === "medium" || v === "low" ? v : v === "moderate" ? "medium" : null);
  if (kind === "dependabot") return word(obj(a?.security_advisory)?.severity) ?? word(obj(a?.security_vulnerability)?.severity);
  const rule = obj(a?.rule);
  const sec = word(rule?.security_severity_level);
  if (sec) return sec;
  const plain = rule?.severity;
  return plain === "error" ? "high" : plain === "warning" ? "medium" : plain === "note" ? "low" : null;
}

/** Open alerts counted by severity; one GitHub gives no severity for is left out of every count. */
export function severityCounts(kind: "code-scanning" | "dependabot", open: unknown[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of open) {
    const s = severityOf(kind, a);
    if (s) out[s] += 1;
  }
  return out;
}

/** The repo's security switches, where the token may see them. `security_and_analysis` needs admin, so it is often absent. */
export function featureStates(repo: unknown, pvr: unknown, dependabotListed: boolean): SecurityFeed["features"] {
  const sa = obj(obj(repo)?.security_and_analysis);
  const sw = (key: string): FeatureState => {
    const status = obj(sa?.[key])?.status;
    return status === "enabled" ? "on" : status === "disabled" ? "off" : "unreported";
  };
  const enabled = obj(pvr)?.enabled;
  return [
    { id: "secret-scanning", name: "Secret scanning", state: sw("secret_scanning") },
    { id: "push-protection", name: "Push protection", state: sw("secret_scanning_push_protection") },
    { id: "dependabot-alerts", name: "Dependabot alerts", state: dependabotListed ? "on" : "unreported" },
    { id: "dependabot-updates", name: "Dependabot security updates", state: sw("dependabot_security_updates") },
    { id: "private-reporting", name: "Private vulnerability reporting", state: enabled === true ? "on" : enabled === false ? "off" : "unreported" },
  ];
}

const PAGE = 100;

/**
 * Whether a code scanning alert is Scorecard's: a repo-posture check (Maintained, Code-Review, Branch-Protection…)
 * uploaded as an alert, not a finding in the code. Read from the tool's name only, which is then dropped.
 */
export function isPostureAlert(alert: unknown): boolean {
  const tool = obj(obj(alert)?.tool)?.name;
  return typeof tool === "string" && /^(openssf )?scorecard$/i.test(tool.trim());
}

const countOf = (kind: "code-scanning" | "dependabot", open: unknown[], fixed: unknown[], more: boolean): AlertCount => ({ open: open.length, fixed: fixed.length, more, severity: severityCounts(kind, open) });

/**
 * Open and fixed alert counts for one kind of alert: the lists are read only to be counted, then dropped. Code
 * scanning's are split into code findings and Scorecard's posture checks (`posture`).
 */
async function alertCount(kind: "code-scanning" | "dependabot"): Promise<{ count: AlertCount; posture: AlertCount | null } | null> {
  try {
    const [open, fixed] = await Promise.all([read(`/${kind}/alerts?state=open&per_page=${PAGE}`), read(`/${kind}/alerts?state=fixed&per_page=${PAGE}`)]);
    if (!Array.isArray(open) || !Array.isArray(fixed)) return null;
    const more = open.length >= PAGE || fixed.length >= PAGE;
    if (kind === "dependabot") return { count: countOf(kind, open, fixed, more), posture: null };
    const code = (list: unknown[]) => list.filter((a) => !isPostureAlert(a));
    const card = (list: unknown[]) => list.filter(isPostureAlert);
    return { count: countOf(kind, code(open), code(fixed), more), posture: countOf(kind, card(open), card(fixed), more) };
  } catch {
    return null;
  }
}

/** Scorecard's overall score and each check's score, with Scorecard's generic one-line description of the check. Never its reasons or details, which name files. */
export function scorecardOf(body: unknown): SecurityFeed["scorecard"] {
  const b = obj(body);
  if (!b || typeof b.score !== "number" || !Number.isFinite(b.score)) return null;
  const checks = Array.isArray(b.checks) ? b.checks : [];
  return {
    score: Math.round(b.score * 10) / 10,
    date: iso(b.date) ?? "",
    checks: checks
      .map(obj)
      .filter((c): c is Record<string, unknown> => !!c && typeof c.name === "string" && /^[A-Za-z-]{1,40}$/.test(c.name) && typeof c.score === "number")
      .map((c) => ({
        name: c.name as string,
        score: c.score as number,
        short: typeof obj(c.documentation)?.short === "string" ? (obj(c.documentation)!.short as string).slice(0, 160) : "",
      })),
  };
}

async function scorecard(): Promise<SecurityFeed["scorecard"]> {
  try {
    const res = await fetch(SCORECARD, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return scorecardOf(await res.json());
  } catch {
    return null;
  }
}

/** Cache lifetime in seconds. Scans change a few times a day, and each refresh is eleven GitHub reads. */
const TTL = 120;

const feed = memo(TTL * 1000, async () => {
  const runReads = WORKFLOWS.map((wf) =>
    read(`/actions/workflows/${wf.file}/runs?${wf.scope === "main" ? "branch=main&" : ""}status=completed&per_page=${RECENT}`).then(
      (body) => ({ ok: true, state: runState(body, wf) }),
      () => ({ ok: false, state: runState(null, wf) }),
    ),
  );
  const [runs, repo, pvr, codeScanning, dependabot, card] = await Promise.all([
    Promise.all(runReads),
    read("").catch(() => null),
    read("/private-vulnerability-reporting").catch(() => null),
    alertCount("code-scanning"),
    alertCount("dependabot"),
    scorecard(),
  ]);
  // Nothing at all from GitHub (down, or the token's limit spent): fail, so the Desk keeps what it last had.
  if (!repo && runs.every((r) => !r.ok)) throw new Error("github");
  const out: SecurityFeed = {
    at: new Date().toISOString(),
    workflows: runs.map((r) => r.state),
    features: featureStates(repo, pvr, dependabot !== null),
    alerts: { codeScanning: codeScanning?.count ?? null, dependabot: dependabot?.count ?? null, posture: codeScanning?.posture ?? null },
    scorecard: card,
  };
  return JSON.stringify(out);
});

export async function GET(req: Request): Promise<Response> {
  const redirect = canonical(req);
  if (redirect) return redirect;
  try {
    return new Response(await feed(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${TTL}, stale-while-revalidate=600` },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
