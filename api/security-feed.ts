/**
 * The security posture feed for the Desk's Systems > Security page (#82), as a read-only Vercel function. The Desk
 * is public to read, so this returns posture only: each scan's last result on `main` (pass or fail, when, and a link
 * to the run), whether the repo's security features are on, how many alerts are open and fixed, and the OpenSSF
 * Scorecard score. Never an alert's details: no file paths, rules, packages, versions or descriptions, since an open
 * one would be a map for an attacker (docs/THREAT-MODEL.md, TB6). Everything else from GitHub is dropped here, not
 * in the browser.
 *
 * GitHub reads go out with the Foundry's token (read-only calls only), and Scorecard's public API is read from here
 * because the browser's CSP allows only this site and api.github.com. A read the token isn't allowed to make comes
 * back as "not reported" rather than failing the feed. Cached like the other feeds (api/_feedcache.ts): canonical
 * URL, a short memo with one read in flight, and the edge cache.
 *
 * GET → SecurityFeed (below).
 */

import { canonical, memo } from "./_feedcache.js";

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
}

export type FeatureState = "on" | "off" | "unreported";

export interface AlertCount {
  open: number;
  fixed: number;
  /** True when either count hit the page size, so it reads "100+". */
  more: boolean;
}

export interface SecurityFeed {
  at: string;
  workflows: WorkflowState[];
  features: { id: string; name: string; state: FeatureState }[];
  alerts: { codeScanning: AlertCount | null; dependabot: AlertCount | null };
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

const env = (name: string): string => process.env[name] ?? "";

class ReadError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

async function read(path: string): Promise<unknown> {
  const token = env("FOUNDRY_GITHUB_TOKEN");
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new ReadError(res.status);
  return res.json();
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);

/** The last finished run's result, reduced to a state, a time and a link to it. */
export function runState(body: unknown, wf: (typeof WORKFLOWS)[number]): WorkflowState {
  const base = { id: wf.id, name: wf.name, scope: wf.scope };
  const runs = obj(body)?.workflow_runs;
  if (!Array.isArray(runs)) return { ...base, state: "unreported", conclusion: null, at: null, url: null };
  const run = obj(runs[0]);
  if (!run) return { ...base, state: "none", conclusion: null, at: null, url: null };
  const c = typeof run.conclusion === "string" ? run.conclusion : "";
  const state: RunState = c === "success" ? "pass" : c === "failure" || c === "timed_out" || c === "startup_failure" ? "fail" : "other";
  return {
    ...base,
    state,
    conclusion: state === "other" && /^[a-z_]{1,20}$/.test(c) ? c.replace(/_/g, " ") : null,
    at: iso(run.updated_at) ?? iso(run.created_at),
    url: typeof run.html_url === "string" && RUN_URL.test(run.html_url) ? run.html_url : null,
  };
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

/** Open and fixed alert counts for one kind of alert: the lists are read only to be counted, then dropped. */
async function alertCount(kind: "code-scanning" | "dependabot"): Promise<AlertCount | null> {
  try {
    const [open, fixed] = await Promise.all([read(`/${kind}/alerts?state=open&per_page=${PAGE}`), read(`/${kind}/alerts?state=fixed&per_page=${PAGE}`)]);
    if (!Array.isArray(open) || !Array.isArray(fixed)) return null;
    return { open: open.length, fixed: fixed.length, more: open.length >= PAGE || fixed.length >= PAGE };
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
    read(`/actions/workflows/${wf.file}/runs?${wf.scope === "main" ? "branch=main&" : ""}status=completed&per_page=1`).then(
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
    alerts: { codeScanning, dependabot },
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
