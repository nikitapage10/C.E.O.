/**
 * The Desk's Usage panel feed, as a Vercel function: the Foundry's issues and their trail comments, which hold
 * everything the panel counts. Each quick-shaping call writes its own token use and cost on its idea's
 * "**Trail · Shaped:**" step (api/foundry.ts), and the Builder writes who built each job on which model and when
 * ("**Trail · Assigned:**", "**Trail · Shipped:**"). The Desk adds them up (apps/world/src/usage.ts).
 *
 * GET → { issues, trails }: slim issues ({ number, title, state, created_at, closed_at, body, labels }) and trail
 * comments ({ issue, at, body }), newest first. Cached at Vercel's edge for a minute; the panel asks every minute.
 */

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;
/** Pages of 100 to read: enough for every Foundry issue and the last 500 comments. */
const ISSUE_PAGES = 3;
const COMMENT_PAGES = 5;

const env = (name: string): string => process.env[name] ?? "";

/** Answers by path with their ETag, kept while the function stays warm: an unchanged page costs GitHub nothing. */
const seen = new Map<string, { etag: string; body: unknown }>();

async function read<T>(path: string): Promise<T> {
  const token = env("FOUNDRY_GITHUB_TOKEN");
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

interface Comment {
  issue_url: string;
  created_at: string;
  body?: string | null;
}

/** The comments the panel reads: the trail steps, and the older "Approved for building" note from before the trail. */
const TRAIL = /^(\*\*Trail ·|Approved for building)/;

export async function GET(): Promise<Response> {
  try {
    const [issues, comments] = await Promise.all([readAll<Issue>("/issues?labels=foundry&state=all&sort=created&direction=desc", ISSUE_PAGES), readAll<Comment>("/issues/comments?sort=created&direction=desc", COMMENT_PAGES)]);
    const body = {
      issues: issues
        .filter((i) => !i.pull_request)
        .map((i) => ({ number: i.number, title: i.title, state: i.state, created_at: i.created_at, closed_at: i.closed_at, body: (i.body ?? "").slice(0, 2000), labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))) })),
      trails: comments
        .filter((c) => TRAIL.test(c.body ?? ""))
        .map((c) => ({ issue: Number(/\/issues\/(\d+)$/.exec(c.issue_url)?.[1] ?? 0), at: c.created_at, body: (c.body ?? "").slice(0, 1200) })),
    };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "github" }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}
