/**
 * The hour's real events, for the world step (docs/WORLD.md): what the Foundry shipped and started, what the C.E.O.
 * decided on the Desk, and how the checks went, read from GitHub (the repo is public). Only Foundry issues, and only
 * their titles, numbers, labels and the kind of each trail step: never an issue body, never a comment's words, and
 * nothing from the Relay (messages, contacts and personal data never leave the hub on the MacBook, and never reach the
 * step). Every line still goes through `scrub` before it is used, as a second lock.
 */

const REPO = "nikitapage10/C.E.O.";
const GH = `https://api.github.com/repos/${REPO}`;

export interface FeedIssue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  updated_at?: string;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

export interface FeedComment {
  issue_url: string;
  created_at: string;
  body?: string | null;
  /** Who wrote it. Only Nikita's account and the Checks workflow write trail steps; anyone else's is skipped. */
  user?: { login?: string } | null;
}

/**
 * The accounts whose comments count as trail steps, as in scripts/foundry-issue.sh (#59): the repo is public, so
 * anyone can post a comment that starts "**Trail · Assigned:**", and that mustn't become an event in the Lattice.
 */
export const TRAIL_AUTHORS: ReadonlySet<string> = new Set(["nikitapage10", "github-actions[bot]"]);

export interface FeedRun {
  conclusion: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
}

/** What the step reads from GitHub. */
export interface Feed {
  issues: FeedIssue[];
  comments: FeedComment[];
  runs: FeedRun[];
}

/** A job that shipped in the window, and who built it (an agent id). */
export interface ShippedJob {
  issue: number;
  title: string;
  who: string;
}

export interface Digest {
  /** One plain line per event, oldest first, at most 12. */
  lines: string[];
  shipped: ShippedJob[];
}

/** The crew by the names the Builder lines use; Rusty's dock crew count as Rusty. */
const CREW: Record<string, string> = { rusty: "tessellate", dusty: "tessellate", gusty: "tessellate", musty: "tessellate", rocky: "caret", rivet: "semicolon", "the builder": "ember", builder: "ember" };
const CREW_NAME: Record<string, string> = { tessellate: "Rusty", caret: "Rocky", semicolon: "Rivet", ember: "the Builder" };

const labelsOf = (i: FeedIssue) => i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? "")));
const MAX_LINES = 12;

/**
 * Text with its disguises taken off: invisible format characters dropped and full-width look-alikes folded to plain
 * ASCII, so "ｎｉｋｉｔａ＠…" or a key split by a zero-width space reads like the plain one. `scrub` and the Desk's
 * privacy check (api/_privacy.ts) both start here.
 */
export function unmask(text: string): string {
  return text.replace(/\p{Cf}/gu, "").replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * Hide anything sensitive that could slip into a line: email addresses, phone numbers, links, money, and anything that
 * looks like a key or token. Agents may talk about anything (Nikita, 2026-10-13); the Lattice is public, so this is
 * the one limit.
 */
export function scrub(text: string): string {
  return unmask(text)
    // Emails spelled out as "name [at] host [dot] com" first. The name part is bounded (an address's local part is at
    // most 64 characters), so a long run of letters costs linear time, not quadratic.
    .replace(/\b[\w.+-]{1,64}\s*[[(]\s*at\s*[\])]\s*[\w-]{1,64}(\s*[[(]\s*dot\s*[\])]\s*[\w-]{1,64})+/gi, "[private]")
    .replace(/[\w.+-]{1,64}@[\w-]+(\.[\w-]+)+/g, "[private]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\b(sk|pk|ghp|gho|github_pat|xox[abp]|AKIA)[-_A-Za-z0-9]{8,}/g, "[key]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[key]")
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[private]" : m))
    .replace(/[$€£]\s?\d[\d,]*(\.\d+)?/g, "[amount]")
    .replace(/\s+/g, " ")
    .trim();
}

/** Who built an issue: its `**Builder:**` line (Rusty unless it names someone else), Rivet for a first-rung fix. */
export function builderOf(issue: FeedIssue): string {
  const named = /\*\*Builder:\*\*\s*([A-Za-z ]+?)\s*(?:\(|$|\n|,)/m.exec(issue.body ?? "")?.[1]?.trim().toLowerCase();
  if (named && CREW[named]) return CREW[named];
  const labels = labelsOf(issue);
  if (labels.includes("rung:1")) return "semicolon";
  return "tessellate";
}

const issueNumber = (url: string) => Number(/\/issues\/(\d+)$/.exec(url)?.[1] ?? 0);
const short = (title: string) => {
  // No angle brackets: the prompt fences the hour's input in tags (prompt.ts), and a title mustn't close one.
  // Only the start is ever shown, so only the start is scrubbed (with room for a secret that runs past the cut).
  const t = scrub(title.replace(/^Idea:\s*/i, "").slice(0, 400).replace(/[<>\uFF1C\uFF1E]/g, ""));
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
};

/** The hour's events from the feed, between `from` and `to` (ms). */
export function digestEvents(feed: Feed, from: number, to: number): Digest {
  const inWindow = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return t >= from && t < to;
  };
  // Foundry issues only: the Relay's work never appears on GitHub, and nothing else is read.
  const issues = new Map(feed.issues.filter((i) => !i.pull_request && labelsOf(i).includes("foundry")).map((i) => [i.number, i]));
  const events: { at: number; line: string }[] = [];
  const shipped: ShippedJob[] = [];

  for (const issue of issues.values()) {
    const labels = labelsOf(issue);
    if (labels.includes("foundry:shipped") && inWindow(issue.closed_at)) {
      const who = builderOf(issue);
      shipped.push({ issue: issue.number, title: short(issue.title), who });
      events.push({ at: Date.parse(issue.closed_at!), line: `Shipped: #${issue.number} ${short(issue.title)} (built by ${CREW_NAME[who]}).` });
    } else if (labels.includes("foundry:idea") && inWindow(issue.created_at)) {
      events.push({ at: Date.parse(issue.created_at), line: `New idea on the Desk: #${issue.number} ${short(issue.title)}.` });
    }
  }

  for (const c of feed.comments) {
    if (!inWindow(c.created_at) || !TRAIL_AUTHORS.has(c.user?.login ?? "")) continue;
    const issue = issues.get(issueNumber(c.issue_url));
    if (!issue) continue;
    const body = c.body ?? "";
    const at = Date.parse(c.created_at);
    const name = short(issue.title);
    // Only which step it is, and who and on what: never the comment's own words.
    if (body.startsWith("**Trail · Assigned:**")) {
      const who = /\b(Rusty|Rocky|Rivet|Dusty|Gusty|Musty)\b/.exec(body)?.[1];
      events.push({ at, line: `Started: #${issue.number} ${name}${who ? ` (${who} on it)` : ""}.` });
    } else if (body.startsWith("**Trail · Decision:**")) {
      const what = /Approved/i.test(body) ? "approved" : /Not this one|passed/i.test(body) ? "passed on" : /Sent back/i.test(body) ? "sent back with notes" : "decided on";
      events.push({ at, line: `The C.E.O. ${what} #${issue.number} ${name}.` });
    } else if (body.startsWith("**Trail · Checks:**") && /red|fail/i.test(body)) {
      events.push({ at, line: `Checks went red on #${issue.number} ${name}.` });
    }
  }

  const run = feed.runs.find((r) => inWindow(r.updated_at ?? r.created_at));
  if (run && run.status === "completed") events.push({ at: Date.parse(run.updated_at ?? run.created_at), line: run.conclusion === "success" ? "The checks on main are green." : `The checks on main went red (${run.conclusion ?? "failed"}).` });

  events.sort((a, b) => a.at - b.at);
  return { lines: events.slice(-MAX_LINES).map((e) => scrub(e.line)), shipped };
}

/** Read the feed from GitHub (with the Foundry's token when it is set, else anonymously). */
export async function readFeed(since: number, token = process.env.FOUNDRY_GITHUB_TOKEN ?? ""): Promise<Feed> {
  const read = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      const res = await fetch(`${GH}${path}`, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      return res.ok ? ((await res.json()) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const iso = new Date(since).toISOString();
  const [issues, comments, runs] = await Promise.all([
    read<FeedIssue[]>(`/issues?labels=foundry&state=all&sort=updated&direction=desc&since=${iso}&per_page=50`, []),
    read<FeedComment[]>(`/issues/comments?sort=created&direction=desc&since=${iso}&per_page=100`, []),
    read<{ workflow_runs: FeedRun[] }>("/actions/workflows/checks.yml/runs?branch=main&per_page=3", { workflow_runs: [] }),
  ]);
  return { issues, comments, runs: runs.workflow_runs ?? [] };
}
