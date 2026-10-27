/**
 * The Desk's Usage panel feed, as a Vercel function: the Foundry's issues and their trail comments, which hold
 * everything the panel counts. Each quick-shaping call writes its own token use and cost on its idea's
 * "**Trail · Shaped:**" step (api/foundry.ts), and the Builder writes who built each job on which model and when
 * ("**Trail · Assigned:**", "**Trail · Shipped:**"). The Desk adds them up (apps/world/src/usage.ts).
 *
 * GET → { issues, trails }: slim issues ({ number, title, state, created_at, closed_at, body, labels }) and trail
 * comments ({ issue, at, body }), newest first; `at` is the comment's created_at, which dates each tab's numbers. Shipped
 * steps keep up to 3000 characters so their "Claude Code: 291k tokens on Opus, 1 h 50 min." lines survive. Cached at Vercel's edge for a minute; the panel asks every minute. A request with any query string is redirected to the bare URL so it hits that cache, and a warm function keeps its last answer for the same minute (api/_feedcache.ts).
 */

import { canonical, memo } from "./_feedcache.js";
import { githubToken } from "./_github.js";
import { TRAIL_AUTHORS } from "./_world/digest.js";

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;
/** Pages of 100 to read: enough for every Foundry issue and the last 500 comments. */
const ISSUE_PAGES = 3;
const COMMENT_PAGES = 5;

/** Answers by path with their ETag, kept while the function stays warm: an unchanged page costs GitHub nothing. */
const seen = new Map<string, { etag: string; body: unknown }>();

async function read<T>(path: string): Promise<T> {
  const token = await githubToken("read");
  const had = seen.get(path);
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(had ? { "If-None-Match": had.etag } : {}) },
  });
  if (res.status === 304 && had) return had.body as T;
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const body = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) seen.set(path, { etag, body });
  return body;
}

/** Every page of a list, until a short page or the limit. */
async function readAll<T>(path: string, pages: number): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= pages; page++) {
    const got = await read<T[]>(`${path}&per_page=100&page=${page}`);
    out.push(...got);
    if (got.length < 100) break;
  }
  return out;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

export interface Comment {
  issue_url: string;
  created_at: string;
  body?: string | null;
  user?: { login?: string } | null;
}

/** The comments the panel reads: the trail steps, and the older "Approved for building" note from before the trail. */
const TRAIL = /^(\*\*Trail ·|Approved for building)/;
const PICTURES = "**Trail · Pictures:**";
/** A builder's progress on a job in flight (#488): its percent and words show on the Desk's forge. */
const PROGRESS = "**Trail · Progress:**";

/**
 * Whether the Desk may read a comment as a trail step. A Pictures step puts images on the Desk's Changelog, and a
 * Progress step puts its words and percent on a job in flight, so those count only from the trail's trusted authors
 * (Nikita's account, the Checks workflow and the crew's App); the repo is public, and anyone could post one. The Desk
 * still checks every picture link itself (`pictureUrl` in foundry.ts) and keeps a Progress step's words plain.
 */
export function isTrail(c: Comment): boolean {
  const body = c.body ?? "";
  if (!TRAIL.test(body)) return false;
  return !(body.startsWith(PICTURES) || body.startsWith(PROGRESS)) || TRAIL_AUTHORS.has(c.user?.login ?? "");
}

/** How much of a step to keep: Shipped steps carry long token lines, and Pictures steps a line per picture. */
const keep = (body: string) => (body.startsWith("**Trail · Shipped:**") || body.startsWith(PICTURES) ? 3000 : 1200);

/** Cache lifetime in seconds, for both the edge header and the in-function memo. */
const TTL = 60;

const usage = memo(TTL * 1000, async () => {
  const [issues, comments] = await Promise.all([readAll<Issue>("/issues?labels=foundry&state=all&sort=created&direction=desc", ISSUE_PAGES), readAll<Comment>("/issues/comments?sort=created&direction=desc", COMMENT_PAGES)]);
  return JSON.stringify({
    issues: issues
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, state: i.state, created_at: i.created_at, closed_at: i.closed_at, body: (i.body ?? "").slice(0, 2000), labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))) })),
    trails: comments
      .filter(isTrail)
      .map((c) => ({ issue: Number(/\/issues\/(\d+)$/.exec(c.issue_url)?.[1] ?? 0), at: c.created_at, body: (c.body ?? "").slice(0, keep(c.body ?? "")) })),
  });
});

export async function GET(req: Request): Promise<Response> {
  const redirect = canonical(req);
  if (redirect) return redirect;
  try {
    return new Response(await usage(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${TTL}, stale-while-revalidate=300` },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
