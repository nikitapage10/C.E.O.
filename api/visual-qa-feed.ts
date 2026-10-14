/**
 * The latest Visual QA run (#91) for the Desk's Systems > Foundry page, as a read-only Vercel function. It reads the
 * last finished run of .github/workflows/visual-qa.yml on `main` and the names of its artifacts, which carry the run's
 * headline (rooms reviewed, findings, blockers: api/_visualqa/review.ts, `summaryName`). Nothing is downloaded and
 * Gemini is never called from here: two GitHub reads with the Foundry's token, cached like the other feeds
 * (api/_feedcache.ts). Returns counts, a time, a state and a link to the run only (docs/THREAT-MODEL.md, TB6).
 *
 * GET → VisualQaFeed (below).
 */

import { canonical, memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";
import { readSummaryName, type ReviewState } from "./_visualqa/review.js";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;
const RUN_URL = /^https:\/\/github\.com\/nikitapage10\/C\.E\.O\.\/actions\/runs\/\d+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface VisualQaRun {
  at: string;
  url: string;
  /** The workflow run itself: `pass` when the tour recorded, `fail` when it didn't. */
  run: "pass" | "fail" | "other";
  /** What Gemini did: reviewed every room, some, none (no key or past the day's cap), or didn't answer. `unknown` when the headline is missing. */
  review: ReviewState | "unknown";
  rooms: number;
  findings: number;
  blockers: number;
}

export interface VisualQaFeed {
  at: string;
  /** The latest finished run on main, or null before the first. */
  latest: VisualQaRun | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);

/** The feed's view of a run and its artifact list, or null when there's no run. Everything else is dropped. */
export function latestOf(runs: unknown, artifacts: unknown): VisualQaRun | null {
  const list = obj(runs)?.workflow_runs;
  const run = Array.isArray(list) ? obj(list[0]) : null;
  if (!run) return null;
  const url = typeof run.html_url === "string" && RUN_URL.test(run.html_url) ? run.html_url : null;
  const at = iso(run.updated_at) ?? iso(run.created_at);
  if (!url || !at) return null;
  const c = run.conclusion;
  const names = (Array.isArray(obj(artifacts)?.artifacts) ? (obj(artifacts)!.artifacts as unknown[]) : []).map((a) => obj(a)?.name).filter((n): n is string => typeof n === "string");
  const head = names.map(readSummaryName).find((s) => s !== null) ?? null;
  return {
    at,
    url,
    run: c === "success" ? "pass" : c === "failure" || c === "timed_out" ? "fail" : "other",
    review: head?.review ?? "unknown",
    rooms: head?.rooms ?? 0,
    findings: head?.findings ?? 0,
    blockers: head?.blockers ?? 0,
  };
}

async function read(path: string): Promise<unknown> {
  const token = await githubToken("read");
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Cache lifetime in seconds: a run lands a few times a day at most. */
const TTL = 300;

const feed = memo(TTL * 1000, async () => {
  let runs: unknown;
  try {
    runs = await read("/actions/workflows/visual-qa.yml/runs?branch=main&status=completed&per_page=1");
  } catch (e) {
    // 404: the workflow isn't on main yet, so there is no run to show.
    if (e instanceof Error && e.message === "404") return JSON.stringify({ at: new Date().toISOString(), latest: null } satisfies VisualQaFeed);
    throw e;
  }
  const id = obj(Array.isArray(obj(runs)?.workflow_runs) ? (obj(runs)!.workflow_runs as unknown[])[0] : null)?.id;
  const artifacts = typeof id === "number" && Number.isSafeInteger(id) ? await read(`/actions/runs/${id}/artifacts?per_page=20`).catch(() => null) : null;
  const out: VisualQaFeed = { at: new Date().toISOString(), latest: latestOf(runs, artifacts) };
  return JSON.stringify(out);
});

export async function GET(req: Request): Promise<Response> {
  const redirect = canonical(req);
  if (redirect) return redirect;
  try {
    return new Response(await feed(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${TTL}, stale-while-revalidate=900` },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
