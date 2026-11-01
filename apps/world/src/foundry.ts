import { create } from "zustand";
import { useSystems, type LinkState } from "./systems.ts";
import { UPKEEP_ANCHOR_MS, UPKEEP_EVERY_MS } from "./desk/crewRuns.ts";
import type { GhJob } from "./desk/jobs.ts";
import { ownPictures, pictureRef } from "../../../api/_pictures.ts";
import { keepFeed, readKept } from "./feedKeep.ts";

/**
 * The Foundry's real work, read from GitHub through the Desk's feed (api/foundry-feed.ts). Shared by the Desk (cards, Systems) and the Lattice (the Foundry
 * room). Imports nothing from the 3D world, so the Desk can load it alone.
 *
 * The coding happens in the Foundry thread in Claude Code; it keeps its queue as GitHub issues labelled
 * `foundry` (see docs/FOUNDRY.md for the labels). The repo is public, so the browser reads them directly.
 */

export const REPO = "nikitapage10/C.E.O.";
const API = `https://api.github.com/repos/${REPO}`;
/**
 * The feed is cached for a few seconds at Vercel's edge, so the Desk can ask every half minute (and every few seconds
 * for a minute after a click on the Desk) without running GitHub's rate limit dry.
 */
const POLL_MS = 30_000;
const QUICK_MS = 2_000;
const QUICK_FOR_MS = 30_000;
/** Shipped crates stay on show this long. */
const SHIPPED_FOR_MS = 24 * 3_600_000;

/** `chat` is work Nikita asked for in chat and a thread is building outside the lanes; it shows here so the Foundry lists everything in flight. */
export type CrateKind = "fix" | "idea" | "build" | "upkeep" | "chat";
export type CrateState = "queued" | "working" | "ready" | "stuck" | "shipped";
/**
 * The Foundry crew, by agent id and model (Nikita, 2026-10-13): Rivet (semicolon) first responder on Haiku and, since
 * 2026-10-22, the upkeep lane on Sonnet (Opus when a job needs it), Rusty (tessellate, Sonnet) simple work plus the
 * ideas, Rocky (caret, Opus) anything complex or big-picture. Rivet can run clones of herself for jobs at the same
 * time, outside Rusty's four slots; Rusty has his dock crew (four jobs at once at most); Rocky
 * takes one at a time (`MAX_RUNNING`). The Foundry's submind leads them and isn't crew.
 */
export type CrewId = "semicolon" | "caret" | "tessellate";
export type Model = "Haiku" | "Sonnet" | "Opus";

/**
 * The model a crate is being worked on: what its Builder line names, else its fix rung, else Sonnet for upkeep
 * (Rivet's maintenance default, docs/FOUNDRY.md), else the crew member's usual one (Rivet Haiku, Rocky Opus, Rusty Sonnet).
 */
export function modelOf(crate: Pick<Crate, "rung"> & Pick<Partial<Crate>, "model" | "kind">, who: CrewId): Model {
  if (crate.model) return crate.model;
  if (crate.kind === "upkeep") return "Sonnet";
  if (crate.rung === 1) return "Haiku";
  if (crate.rung === 3) return "Opus";
  if (crate.rung === 2) return "Sonnet";
  return who === "semicolon" ? "Haiku" : who === "caret" ? "Opus" : "Sonnet";
}

/** Every name a Builder line can carry: the three crew (Rivet, Rusty, Rocky), Rusty's dock crew and Skippy. */
export type HandName = "Rivet" | "Rusty" | "Rocky" | "Dusty" | "Gusty" | "Musty" | "Skippy";
const HAND_NAMES: readonly HandName[] = ["Rivet", "Rusty", "Rocky", "Dusty", "Gusty", "Musty", "Skippy"];
/** The crew lane a named builder works in: Rusty's dock crew work in his lane; Skippy is not crew, so no lane of his own. */
const HAND_LANE: Record<HandName, CrewId | null> = { Rivet: "semicolon", Rusty: "tessellate", Rocky: "caret", Dusty: "tessellate", Gusty: "tessellate", Musty: "tessellate", Skippy: null };

export const CREW: Record<CrewId, { name: string; job: string }> = {
  semicolon: { name: "Rivet", job: "First responder and upkeep" },
  caret: { name: "Rocky", job: "Master builder" },
  tessellate: { name: "Rusty", job: "Builder and ideas" },
};

/**
 * The order the Desk lists the crew in, by the weight of work each takes (Nikita, 2026-10-13, issue #83): Rivet
 * (Haiku), then Rusty (Sonnet or Opus), then Rocky (Opus).
 */
export const CREW_ORDER: readonly CrewId[] = ["semicolon", "tessellate", "caret"];

/** Each crew member's tier in that order and the models they run on (docs/FOUNDRY.md, "The crew"). */
export const CREW_RANK: Record<CrewId, { tier: 1 | 2 | 3; models: string }> = {
  semicolon: { tier: 1, models: "Haiku/Sonnet" },
  tessellate: { tier: 2, models: "Sonnet/Opus" },
  caret: { tier: 3, models: "Opus" },
};

/**
 * The model each crew member runs on, and the colour its bench's work light shows (Nikita, 2026-10-13: who's working
 * on what model, visible at a glance). Rusty's dock crew run on his model.
 */
export const MODEL: Record<CrewId, { name: "Haiku" | "Sonnet" | "Opus"; colour: string }> = {
  semicolon: { name: "Haiku", colour: "#6fe3c1" },
  tessellate: { name: "Sonnet", colour: "#7fb0ff" },
  caret: { name: "Opus", colour: "#ffb04a" },
};

export interface Crate {
  number: number;
  title: string;
  kind: CrateKind;
  state: CrateState;
  /** The model rung a fix is on: 1 Haiku (Rivet), 2 Sonnet (Rusty), 3 Opus (Rusty). */
  rung: 1 | 2 | 3 | null;
  url: string;
  /** Date.now() of the last change. */
  updatedAt: number;
  /** Date.now() the issue was closed, for shipped crates; unlike `updatedAt` a later comment never moves it. */
  closedAt?: number;
  /** The issue's pitch line (ideas carry one), or "". */
  pitch: string;
  /**
   * What's being built in two to four words, an -ing phrase ("Speeding up the Lattice"), from the issue's
   * `**Short:**` line; "" when it has none. The Lattice shows it under the builder's name.
   */
  short?: string;
  /** Date.now() the issue was opened. */
  createdAt?: number;
  /** Small, medium or large, when the issue says. */
  size: "small" | "medium" | "large" | null;
  /** An idea Nikita sent back with notes; Rivet is rewriting it. */
  revising: boolean;
  /** An idea Rivet asked Nikita something about first (`foundry:question`): it is off the build queue until answered or approved as is. */
  asking?: boolean;
  /** The issue's `**Question:**` line: what Rivet asks, or "". */
  question?: string;
  /** An idea build paused for a fix (`foundry:paused`): its branch is pushed as work in progress, and it resumes when the fix ships. */
  paused?: boolean;
  /** A build the Builder approved itself as low risk (`foundry:auto`, docs/FOUNDRY.md "Auto-approval"); Nikita can stop it from the Desk until it ships. */
  auto?: boolean;
  /** Who an idea's card says builds it ("**Builder:** Rusty"), when it says. */
  builder?: CrewId | null;
  /** The name its Builder line gives ("Gusty" in "**Builder:** Gusty (Opus)"): Rusty's dock crew keep their own name on the forge. */
  hand?: HandName | null;
  /** The model its Builder line names ("**Builder:** Rusty (Opus)"), when it names one. */
  model?: Model | null;
  /**
   * Pictures Nikita attached to an idea, as names in the private Blob store ("foundry/ideas/…"), never links: the
   * Desk shows them only through its own picture function, on short-lived signed links (#127).
   */
  images?: string[];
}

export type ChecksState = "pass" | "fail" | "running" | "unknown";

/** One shipped change for the changelog: a Foundry issue that shipped, or a merged pull request with no issue. */
export interface Change {
  key: string;
  /** Date.now() style: when it shipped. */
  at: number;
  /** Date.now() the issue was opened, when it has one; `at` minus this is how long the change took. */
  openedAt?: number;
  title: string;
  kind: CrateKind;
  /** The issue that tracked it, when there is one. */
  issue: { number: number; url: string } | null;
  /** Where the code landed: its pull request, or the commit on main. */
  landed: { label: string; url: string } | null;
  /** Who built it, from the issue's Builder line (fixes by rung); Rusty's dock crew count as Rusty. Null for a pull request with no issue. */
  by: CrewId | null;
  /** The issue's `**Short:**` line, or "". */
  short: string;
  /** Whether it waited for Nikita: auto-approved by the Builder, approved by Nikita, or work that needs no approval (`changeSource`). */
  approval: Approval;
  /** Where it came from: Nikita, a Builder idea, upkeep, a fix, or chat (`changeSource`). */
  origin: Origin;
  /**
   * Nikita's Undo from the Changelog (docs/FOUNDRY.md, "Undo"): `requested` while the issue carries `foundry:undo` and
   * the Builder reverts it through the fix lane, `done` once the revert shipped (`foundry:undone`). Absent otherwise.
   */
  undo?: "requested" | "done";
  /** The pull request that reverted it ("Undo #<n>: …"), once there is one. */
  reverted?: { label: string; url: string };
  /** The pictures on its issue's "**Trail · Pictures:**" steps, oldest first, once the Desk has the trails (`withTrails`). */
  pictures?: Picture[];
}

/** One picture from a Pictures step: a JPEG or PNG on the `foundry-shots` branch (scripts/issue-shots.sh). */
export interface Picture {
  src: string;
  /** Short plain text: the file's name made readable ("changelog wide"). */
  alt: string;
  /** What the step says they show, plain text and short; "" when it says nothing. */
  note: string;
}

/**
 * Whether a shipped change waited for Nikita (docs/FOUNDRY.md, "Auto-approval"): `auto`, the Builder approved a
 * low-risk idea itself (`foundry:auto`); `manual`, Nikita approved it; `none`, upkeep, fixes and chat that need no
 * approval.
 */
export type Approval = "auto" | "manual" | "none";
/**
 * Where a shipped change came from: `nikita`, an idea Nikita sent from the Desk (or asked for as an idea); `builder`,
 * a morning idea or an idea the Builder filed from upkeep; `upkeep`; `fix`; `chat`, work Nikita asked for in chat.
 */
export type Origin = "nikita" | "builder" | "upkeep" | "fix" | "chat";

/** The label the Builder adds, with `foundry:build`, to an idea it approved itself (docs/FOUNDRY.md, "Auto-approval"). */
export const AUTO_LABEL = "foundry:auto";
/** A shipped change Nikita asked to take back from the Changelog; the Builder reverts it (docs/FOUNDRY.md, "Undo"). */
export const UNDO_LABEL = "foundry:undo";
/** A shipped change whose revert has shipped too. */
export const UNDONE_LABEL = "foundry:undone";

/** What an issue's trail steps say about its approval and origin. */
function readTrails(trails: readonly string[]): { auto: boolean; byNikita: boolean; fromNikita: boolean } {
  const decisions = trails.filter((t) => t.startsWith("**Trail · Decision:**") || t.startsWith("Approved for building")).map((t) => t.replace(/^\*\*Trail · Decision:\*\*\s*/, ""));
  return {
    auto: decisions.some((t) => /^Auto-approved by Skippy/i.test(t)),
    // "Approved for building by Nikita on the Desk.", or a bigger fix Nikita shipped ("Shipped by Nikita …").
    byNikita: decisions.some((t) => /^(?:Approved|Shipped|Ship)\b[^\n]*\bby Nikita\b/i.test(t)),
    fromNikita: trails.some((t) => /^\*\*Trail · Origin:\*\*\s*Nikita\b/.test(t)),
  };
}

/**
 * How a change was approved and where it came from, from its kind, its labels, its issue body and (when the Desk has
 * them) its trail steps. A built idea is Nikita's call (`manual`) unless it carries `foundry:auto` or an
 * "Auto-approved by Skippy" Decision, so every build from before the rule reads as Nikita's. Upkeep, fixes and chat need
 * no approval (`none`) unless a Decision says Nikita signed one off (a bigger fix's Ship). An idea is Nikita's when
 * its body has Nikita's Desk words or its Origin step names Nikita, else the Builder's (a morning idea, or one from upkeep).
 */
export function changeSource(kind: CrateKind, labels: Iterable<string>, body = "", trails: readonly string[] = []): { approval: Approval; origin: Origin } {
  const has = new Set(labels);
  const trail = readTrails(trails);
  const idea = kind === "build" || kind === "idea";
  const origin: Origin = idea ? (/\*\*From Nikita\b/.test(body) || trail.fromNikita ? "nikita" : "builder") : kind;
  const approval: Approval = has.has(AUTO_LABEL) || trail.auto ? "auto" : idea || trail.byNikita ? "manual" : "none";
  return { approval, origin };
}

/**
 * Where every Foundry picture lives: the `foundry-shots` branch of this repo, served raw by GitHub
 * (scripts/issue-shots.sh). Nothing else is ever shown: a comment on a public repo is untrusted, so a picture from any
 * other host, repo or branch, or any other kind of link, is dropped.
 */
export const PICTURE_ROOT = "https://raw.githubusercontent.com/nikitapage10/C.E.O./foundry-shots/";
/** The most pictures one change shows. */
export const MAX_PICTURES = 12;
const PICTURE_STEP = "**Trail · Pictures:**";
const PICTURE_PATH = /^\d{1,6}\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:jpe?g|png)$/i;

/**
 * A picture link the Desk will show, or null: exactly `PICTURE_ROOT`, an issue's folder, and a plain file name ending
 * in .jpg, .jpeg or .png. No query, fragment, escapes, dot segments or anything else that could steer it elsewhere.
 */
export function pictureUrl(raw: string): string | null {
  if (!raw.startsWith(PICTURE_ROOT)) return null;
  const rest = raw.slice(PICTURE_ROOT.length);
  if (!PICTURE_PATH.test(rest) || rest.includes("..")) return null;
  // A second lock: the browser's own reading of the link must land on the very same place.
  try {
    const u = new URL(raw);
    return u.href === raw && u.origin === "https://raw.githubusercontent.com" ? raw : null;
  } catch {
    return null;
  }
}

/** Untrusted text made short and plain: no markup characters, no control or direction characters, one line. */
function plain(text: string, max: number): string {
  const kept = Array.from(text, (ch) => {
    const c = ch.codePointAt(0) ?? 0;
    const hidden = c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
    return hidden || "<>`*_[]()#|\\!".includes(ch) ? " " : ch;
  }).join("");
  const t = kept.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The pictures on one trail comment, when it is a Pictures step: each markdown image `![alt](url)` whose url passes
 * `pictureUrl`, in order, with no repeats. Anything else in the comment is ignored. The usage feed keeps only the
 * Pictures steps written by the trail's trusted authors (`TRAIL_AUTHORS` in api/_world/digest.ts).
 */
export function readPictures(body: string): Picture[] {
  if (!body.startsWith(PICTURE_STEP)) return [];
  const note = plain(body.slice(PICTURE_STEP.length).split("\n", 1)[0] ?? "", 140);
  const out: Picture[] = [];
  for (const m of body.matchAll(/!\[([^\]\n]{0,200})\]\(\s*([^\s)]{1,400})\s*\)/g)) {
    const src = pictureUrl(m[2]!);
    if (!src || out.some((p) => p.src === src)) continue;
    // issue-shots.sh names each file "<UTC stamp>-<original name>.jpg" and gives it the original name as its alt.
    const name = src.slice(src.lastIndexOf("/") + 1).replace(/\.(?:jpe?g|png)$/i, "").replace(/^\d{8}-\d{6}-/, "");
    const alt = plain((m[1] ?? "").replace(/[-_]+/g, " "), 60) || plain(name.replace(/[-_.]+/g, " "), 60) || "Picture";
    out.push({ src, alt, note });
    if (out.length >= MAX_PICTURES) break;
  }
  return out;
}

/**
 * The changelog with each issue's trail steps folded in, once the Desk has them (the usage feed): an Origin or
 * Decision step settles what the labels and body alone leave open, and its Pictures steps give it pictures, oldest
 * step first.
 */
export function withTrails(changelog: Change[], trails: readonly { issue: number; body: string; at?: string }[]): Change[] {
  if (!trails.length) return changelog;
  const byIssue = new Map<number, { body: string; at?: string }[]>();
  for (const t of trails) byIssue.set(t.issue, [...(byIssue.get(t.issue) ?? []), t]);
  return changelog.map((c) => {
    const found = c.issue ? byIssue.get(c.issue.number) : undefined;
    if (!found) return c;
    const t = readTrails(found.map((s) => s.body));
    const approval: Approval = c.approval === "auto" || t.auto ? "auto" : c.approval === "manual" || t.byNikita ? "manual" : "none";
    const origin: Origin = c.origin === "builder" && t.fromNikita ? "nikita" : c.origin;
    const pictures: Picture[] = [];
    for (const step of [...found].sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0))) {
      for (const p of readPictures(step.body)) if (pictures.length < MAX_PICTURES && !pictures.some((q) => q.src === p.src)) pictures.push(p);
    }
    if (approval === c.approval && origin === c.origin && !pictures.length) return c;
    return { ...c, approval, origin, ...(pictures.length ? { pictures } : {}) };
  });
}

export interface FoundryData {
  crates: Crate[];
  /** Every shipped change GitHub still lists, newest first. */
  changelog: Change[];
  checks: { state: ChecksState; url: string | null; at: number | null };
  /** Ideas Nikita passed on: closed and labelled `foundry:passed`, waiting on the shelf for a comeback. */
  shelved: number;
  /** The newest commit on main (Vercel builds the live site from it), when GitHub listed one. */
  lastCommit?: LastCommit | null;
  /** The scheduled jobs' newest runs for the Boiler Room's board (desk/jobs.ts); absent without the Desk's feed. */
  jobs?: GhJob[];
  /** The open pull requests, each with the issue it works on and its checks (#432); absent from an older feed. */
  prs?: OpenPr[];
  /** The issues with a pushed branch (#488); absent from an older feed or when the Desk read GitHub directly. */
  branches?: number[];
  /** The recently merged pull requests' milestones, for build progress's time left (#488); absent likewise. */
  timings?: PullTiming[];
}

/** One merged pull request's milestones as Date.now() values (null where GitHub didn't say), from the feed's `timings`. */
export interface PullTiming {
  issue: number | null;
  pushed: number | null;
  opened: number;
  checksAt: number | null;
  greenAt: number | null;
  merged: number;
  deployed: number | null;
}

const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** The feed's `timings`, dropping any that don't parse. */
export function parseTimings(list: unknown): PullTiming[] {
  if (!Array.isArray(list)) return [];
  const out: PullTiming[] = [];
  for (const t of list as Record<string, unknown>[]) {
    const opened = time(t.opened);
    const merged = time(t.merged);
    if (opened === null || merged === null) continue;
    out.push({ issue: typeof t.issue === "number" ? t.issue : null, pushed: time(t.pushed), opened, checksAt: time(t.checksAt), greenAt: time(t.greenAt), merged, deployed: time(t.deployed) });
  }
  return out;
}

/** An open pull request as the Foundry page reads it (api/foundry-feed.ts, `open`). */
export interface OpenPr {
  number: number;
  url: string;
  /** Date.now() it opened. */
  at: number;
  draft: boolean;
  /** The issue it works on, when its branch or a "Closes #n" names one. */
  issue: number | null;
  /** Its head commit's checks summed up; "unknown" before any ran, or when the Desk read GitHub directly. */
  checks: ChecksState;
  /** When its head's checks started, and finished green (#488); null when unknown or not yet. */
  checksAt?: number | null;
  greenAt?: number | null;
}

/** The feed's open pull requests (or GitHub's own list, read directly) as OpenPr, dropping any that don't parse. */
export function parseOpenPrs(list: unknown): OpenPr[] {
  if (!Array.isArray(list)) return [];
  const out: OpenPr[] = [];
  for (const p of list as Record<string, unknown>[]) {
    const at = Date.parse(typeof p.created_at === "string" ? p.created_at : "");
    if (typeof p.number !== "number" || typeof p.html_url !== "string" || Number.isNaN(at)) continue;
    const head = (p.head ?? {}) as { ref?: unknown };
    const issue = typeof p.issue === "number" ? p.issue : typeof head.ref === "string" ? branchIssue(head.ref) ?? closes(`${String(p.title ?? "")}\n${String(p.body ?? "")}`) : null;
    const c = p.checks;
    out.push({ number: p.number, url: p.html_url, at, draft: p.draft === true, issue, checks: c === "pass" || c === "fail" || c === "running" ? c : "unknown", checksAt: time(p.checksAt), greenAt: time(p.greenAt) });
  }
  return out;
}

/** The issue a closing keyword names ("Closes #432"), or null. */
function closes(text: string): number | null {
  const n = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(text)?.[1];
  return n ? Number(n) : null;
}

/** The newest commit on main: its short sha, link, first line and when it landed. */
export interface LastCommit {
  sha: string;
  url: string;
  title: string;
  at: number;
}

/** The newest commit on main from GitHub's list (newest first), or null when there is none or it has no date. */
export function parseLastCommit(commits: GhCommit[]): LastCommit | null {
  const c = commits[0];
  const at = Date.parse(c?.commit.committer?.date ?? "");
  if (!c || Number.isNaN(at)) return null;
  return { sha: c.sha.slice(0, 7), url: c.html_url, title: c.commit.message.split("\n")[0]!.trim(), at };
}

/** The slice of GitHub's issue JSON we read. */
export interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
  created_at?: string;
  closed_at?: string | null;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

/** The slice of GitHub's workflow-run JSON we read. */
export interface GhRun {
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at: string;
  /** What started the run (schedule, workflow_dispatch, pull_request); the nightly light skips pull_request runs. */
  event?: string;
}

/** The slice of GitHub's pull request JSON we read. */
export interface GhPull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  body?: string | null;
  head: { ref: string };
}

/** The slice of GitHub's commit JSON we read. */
export interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string } | null };
}

const KINDS: CrateKind[] = ["fix", "idea", "build", "upkeep", "chat"];

function labelSet(issue: GhIssue): Set<string> {
  return new Set(issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))));
}

/** The issue numbers a text points at ("Closes #13", "(#5)"). */
function mentions(text: string): Set<number> {
  return new Set([...text.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])));
}

/** The issue number in a lane branch name ("foundry/upkeep/11-lint-ignore-worktrees"). */
function branchIssue(ref: string): number | null {
  const n = /(?:^|\/)(\d+)-/.exec(ref)?.[1];
  return n ? Number(n) : null;
}

/**
 * The changelog: every Foundry issue that shipped (lanes and chat work alike), each with the pull request or commit
 * that landed it, plus merged pull requests that had no issue. Newest first.
 */
export function parseChangelog(issues: GhIssue[], pulls: GhPull[], commits: GhCommit[]): Change[] {
  const merged = pulls.filter((p) => p.merged_at);
  const used = new Set<number>();
  const out: Change[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = labelSet(issue);
    if (!labels.has("foundry") || !labels.has("foundry:shipped")) continue;
    // An Undo reopens the issue as a fix (`foundry:undo`); it stays on the Changelog, marked, until the revert ships.
    const undoing = labels.has(UNDO_LABEL);
    if (issue.state !== "closed" && !undoing) continue;
    const undo = undoing ? "requested" : labels.has(UNDONE_LABEL) ? "done" : undefined;
    // The fix label an Undo adds isn't what the change was.
    const kindIn = (ks: CrateKind[]) => ks.find((k) => labels.has(`foundry:${k}`));
    const kind = (undo ? kindIn(KINDS.filter((k) => k !== "fix")) : undefined) ?? kindIn(KINDS) ?? "chat";
    const ours = merged.filter((p) => branchIssue(p.head.ref) === issue.number || mentions(`${p.title}\n${p.body ?? ""}`).has(issue.number));
    const isRevert = (p: GhPull) => /^Undo #\d+/i.test(p.title) || /^foundry\/fix\/\d+-undo-/.test(p.head.ref);
    const pr = ours.find((p) => !isRevert(p));
    const revert = ours.find(isRevert);
    const commit = pr ? undefined : commits.find((c) => mentions(c.commit.message).has(issue.number) && !/^(?:Undo #|Revert ")/.test(c.commit.message));
    for (const p of ours) used.add(p.number);
    const body = readBody(issue.body ?? "");
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    // A built idea is a build by the time it ships.
    const shipped: CrateKind = kind === "idea" ? "build" : kind;
    out.push({
      key: `issue-${issue.number}`,
      at: Date.parse(issue.closed_at ?? issue.updated_at),
      ...(issue.created_at && { openedAt: Date.parse(issue.created_at) }),
      title: issue.title,
      kind: shipped,
      issue: { number: issue.number, url: issue.html_url },
      landed: pr ? { label: `PR #${pr.number}`, url: pr.html_url } : commit ? { label: commit.sha.slice(0, 7), url: commit.html_url } : null,
      by: crewFor({ kind, rung, builder: body.builder }),
      short: body.short,
      ...changeSource(shipped, labels, issue.body ?? ""),
      ...(undo && { undo }),
      ...(revert && { reverted: { label: `PR #${revert.number}`, url: revert.html_url } }),
    });
  }
  // A pull request for an issue already listed (or still open) is that issue's, not a change of its own.
  const tracked = new Set(issues.map((i) => i.number));
  for (const p of merged) {
    if (used.has(p.number)) continue;
    const refs = [branchIssue(p.head.ref), ...mentions(`${p.title}\n${p.body ?? ""}`)];
    if (refs.some((n) => n !== null && tracked.has(n))) continue;
    const lane = /^foundry\/(fix|upkeep|build|idea)\//.exec(p.head.ref)?.[1] as CrateKind | undefined;
    const kind: CrateKind = lane === "idea" ? "build" : (lane ?? "chat");
    out.push({ key: `pr-${p.number}`, at: Date.parse(p.merged_at!), title: p.title, kind, issue: null, landed: { label: `PR #${p.number}`, url: p.html_url }, by: null, short: "", ...changeSource(kind, []) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** How many changes shipped since local midnight. */
export function shippedToday(changelog: Change[], now = Date.now()): number {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return changelog.filter((c) => c.at >= midnight).length;
}

/** How far back the Foundry's shipped wall looks: a week. */
export const WALL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Plaques on the shipped wall; anything past these is counted, not hung. */
export const WALL_PLAQUES = 8;

/**
 * The shipped wall's plaques (#182): the changes shipped in the last week, newest first, at most `cap`, and how many
 * more there were. A change that was taken back (an Undo, asked for or done) gets no plaque.
 */
export function shippedThisWeek(changelog: readonly Change[], now = Date.now(), cap = WALL_PLAQUES): { plaques: Change[]; more: number } {
  const week = changelog.filter((c) => !c.undo && c.at <= now && now - c.at <= WALL_WINDOW_MS).sort((a, b) => b.at - a.at);
  return { plaques: week.slice(0, cap), more: Math.max(0, week.length - cap) };
}

/**
 * The shipped bell (#209): rings when the wall's count goes up while someone watches, never for the count first seen
 * (`seen` is null until then), and not when old plaques simply age off the week.
 */
export function bellRings(seen: number | null, count: number): boolean {
  return seen !== null && count > seen;
}

/** A change's title cut to fit a plaque: without an "Idea:" or "Chat:" style tag, on one line, ellipsed past `max` characters. */
export function plaqueTitle(title: string, max = 30): string {
  const t = title
    .replace(/^\s*(?:idea|chat|fix|upkeep|build)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > max * 0.6 ? cut.slice(0, word) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Issues labelled `foundry` become crates; pull requests, untyped issues and closed-unshipped ones drop out. */
export function parseCrates(issues: GhIssue[], now = Date.now()): Crate[] {
  const crates: Crate[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = labelSet(issue);
    if (!labels.has("foundry")) continue;
    const kind = KINDS.find((k) => labels.has(`foundry:${k}`));
    if (!kind) continue;
    const updatedAt = Date.parse(issue.updated_at);
    let state: CrateState;
    let closedAt: number | undefined;
    if (issue.state === "closed") {
      if (!labels.has("foundry:shipped")) continue;
      closedAt = Date.parse(issue.closed_at ?? issue.updated_at);
      if (now - closedAt > SHIPPED_FOR_MS) continue;
      state = "shipped";
    } else {
      // `foundry:blocked` (#135): the Builder needs Nikita's call to go on; it shows as stuck, waiting on Nikita.
      state = labels.has("foundry:stuck") || labels.has("foundry:blocked") ? "stuck" : labels.has("foundry:ready") ? "ready" : labels.has("foundry:working") ? "working" : "queued";
    }
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    crates.push({ number: issue.number, title: issue.title, kind, state, rung, url: issue.html_url, updatedAt, ...(closedAt !== undefined && { closedAt }), ...(issue.created_at && { createdAt: Date.parse(issue.created_at) }), revising: labels.has("foundry:revise"), asking: kind === "idea" && labels.has("foundry:question"), paused: state === "working" && labels.has("foundry:paused"), ...(labels.has(AUTO_LABEL) && { auto: true }), ...readBody(issue.body ?? "") });
  }
  return crates.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The pitch, size, short line and builder the Foundry writes into an issue ("**Pitch:** …", "**Size:** small",
 * "**Short:** Speeding up the Lattice", "**Builder:** Rusty (Opus)").
 */
export function readBody(body: string): Pick<Crate, "pitch" | "size" | "builder"> & { short: string; images: string[]; model: Model | null; question: string; hand: HandName | null } {
  const question = (/^\*\*Question:\*\*[ \t]*(.*)$/m.exec(body)?.[1] ?? "").trim();
  const pitch = /\*\*Pitch:\*\*\s*([^\n]+)/.exec(body)?.[1]?.trim() ?? "";
  const short = (/\*\*Short:\*\*[ \t]*([^\n]*)/.exec(body)?.[1] ?? "").replace(/[*_`]+/g, "").trim().replace(/[.!]+$/, "");
  const size = /\*\*Size:\*\*\s*(small|medium|large)/i.exec(body)?.[1]?.toLowerCase() as Crate["size"] | undefined;
  const names = HAND_NAMES.join("|");
  const named = new RegExp(`\\*\\*Builder:\\*\\*\\s*(${names})\\b`, "i").exec(body)?.[1]?.toLowerCase();
  const hand = HAND_NAMES.find((n) => n.toLowerCase() === named) ?? null;
  const builder: CrewId | null = hand ? HAND_LANE[hand] : null;
  // Only Nikita's own pictures, from the private store: a picture link to any other host is never shown (#127).
  const images = ownPictures(body);
  const said = new RegExp(`\\*\\*Builder:\\*\\*\\s*(?:${names})\\s*\\(\\s*(Haiku|Sonnet|Opus)\\b[^)]*\\)`, "i").exec(body)?.[1]?.toLowerCase();
  const model: Model | null = said === "haiku" ? "Haiku" : said === "sonnet" ? "Sonnet" : said === "opus" ? "Opus" : null;
  return { pitch, size: size ?? null, short, builder, hand, images, model, question };
}

/** A crew member's last few shipped jobs, newest first: each with the issue's Short line (else its title). */
export function recentWork(changelog: Change[], who: CrewId, limit = 3): { number: number; url: string; name: string; at: number }[] {
  return changelog
    .filter((c) => c.by === who && c.issue)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((c) => ({ number: c.issue!.number, url: c.issue!.url, name: c.short || c.title.trim(), at: c.at }));
}

/** The next upkeep tick after `now`: every five hours from the routine's anchor (`crewRuns.ts`, docs/FOUNDRY.md). */
export function nextUpkeep(now: number): number {
  const steps = Math.floor((now - UPKEEP_ANCHOR_MS) / UPKEEP_EVERY_MS) + 1;
  return UPKEEP_ANCHOR_MS + steps * UPKEEP_EVERY_MS;
}

/** The last upkeep tick at or before `now`. */
export function lastUpkeep(now: number): number {
  return nextUpkeep(now) - UPKEEP_EVERY_MS;
}

/**
 * The upkeep Rivet is seen at in the Lattice: the job from the latest tick, kept in hand until the next tick even
 * though the real work took a minute (Nikita's rule). The Desk shows the real state; only the room uses this.
 */
export function visibleUpkeep(crates: Crate[], now = Date.now()): Crate | null {
  const since = lastUpkeep(now);
  return crates.find((c) => c.kind === "upkeep" && c.updatedAt >= since) ?? null;
}

/**
 * Whose lane a crate is in. The Builder decides who takes each job and on which model, and writes it on the issue
 * ("**Builder:** Rusty (Opus)"). Fixes go by rung: Rivet (Haiku) on rung 1, Rusty on rungs 2 (Sonnet) and 3 (Opus).
 * Builds and chat work go to the builder their issue names, Rusty when it names none; Rocky is held for high-level
 * work. Upkeep is Rivet's own lane (Nikita, 2026-10-22), whatever model she runs it on; Rusty keeps the ideas.
 */
export function crewFor(crate: Pick<Crate, "kind" | "rung"> & Pick<Partial<Crate>, "builder">): CrewId {
  if (crate.kind === "fix") return crate.rung === 2 || crate.rung === 3 ? "tessellate" : "semicolon";
  if (crate.kind === "build" || crate.kind === "chat") return crate.builder ?? "tessellate";
  if (crate.kind === "upkeep") return "semicolon";
  return "tessellate";
}

const RANK: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };

/** A crate counts as in someone's hands while it is working, ready or stuck (ideas only while being built). */
function inHand(c: Crate): boolean {
  return c.state !== "shipped" && c.state !== "queued" && (c.kind !== "idea" || c.state === "working");
}

/**
 * Who holds each crate in hand: whoever's model is really doing it (`crewFor`). When one crew member holds several,
 * the rest are worked alongside them, up to their cap (`crewLoad`, `shifts`).
 */
export function assignCrew(crates: Crate[]): Map<number, CrewId> {
  const out = new Map<number, CrewId>();
  for (const c of crates) if (inHand(c)) out.set(c.number, crewFor(c));
  return out;
}

/** Who a crate is with, given everything else in flight. */
export function crewOf(crate: Crate, crates: Crate[]): CrewId {
  return assignCrew(crates).get(crate.number) ?? crewFor(crate);
}

/** The light a workflow run shows on Systems: green, red, amber while running, off when no run was read. */
export const CHECKS_LINK: Record<ChecksState, LinkState> = { pass: "ok", fail: "down", running: "slow", unknown: "off" };

/** The newest run of the nightly browser tests on main (scheduled or by hand), ignoring labelled pull request runs. */
export function parseE2e(runs: GhRun[] | undefined): FoundryData["checks"] {
  return parseChecks((runs ?? []).filter((r) => r.event !== "pull_request").slice(0, 1));
}

export function parseChecks(runs: GhRun[]): FoundryData["checks"] {
  const run = runs[0];
  if (!run) return { state: "unknown", url: null, at: null };
  const state: ChecksState = run.status !== "completed" ? "running" : run.conclusion === "success" ? "pass" : run.conclusion === "failure" ? "fail" : "unknown";
  return { state, url: run.html_url, at: Date.parse(run.updated_at) };
}

/** How many jobs each crew member has in hand (working, waiting on Nikita or stuck). */
export function crewLoad(crates: Crate[]): Record<CrewId, number> {
  const out: Record<CrewId, number> = { semicolon: 0, caret: 0, tessellate: 0 };
  for (const who of assignCrew(crates).values()) out[who] += 1;
  return out;
}

/** How many spare units wait on Rusty's dock in the Foundry: Dusty, Gusty and Musty, his dock crew. */
export const SPARE_BAYS = 3;

/**
 * Rusty's dock crew, one to a bay in this order: frames Rusty pulled out of the same scrapheap and patched up
 * himself, each in its own paint so they can be told apart on the line (Nikita, 2026-10-13).
 */
export const DOCK_CREW = [
  { name: "Dusty", colour: "#ecc66a" },
  { name: "Gusty", colour: "#3f8fea" },
  { name: "Musty", colour: "#6fae4a" },
] as const;

/**
 * How many jobs run at once across the whole crew (Nikita, 2026-10-13): four. Rusty can take all four, himself and
 * his dock crew; Rocky takes one at a time. Urgent work (a fix) never waits: Rivet's jobs (her first responses and,
 * since 2026-10-22, her upkeep lane) are outside the four, and a fix in Rusty's hands goes ahead of his other work. Anything past the cap waits its turn.
 */
export const MAX_AT_ONCE = 4;
/** The most jobs each crew member runs at once. */
export const MAX_RUNNING: Record<CrewId, number> = { semicolon: Infinity, caret: 1, tessellate: SPARE_BAYS + 1 };

/** Urgent work: a fix (red checks on main, a bug, an alert). It never waits for the cap. */
function urgent(c: Crate): boolean {
  return c.kind === "fix";
}

/**
 * Which jobs really run, and which wait their turn. Only jobs labelled working count (not queued, not waiting on
 * Nikita, not stuck, not paused for a fix). Urgent work goes first, then the oldest; a job runs while its crew
 * member has a free hand and, unless it's urgent or Rivet's, while fewer than four others are running.
 */
export function runningNow(crates: Crate[]): { running: Map<number, CrewId>; waiting: Map<number, CrewId> } {
  const by = assignCrew(crates);
  const working = crates.filter((c) => c.state === "working" && !c.paused && by.has(c.number)).sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || a.number - b.number);
  const hands: Record<CrewId, number> = { semicolon: 0, caret: 0, tessellate: 0 };
  let counted = 0;
  const out = { running: new Map<number, CrewId>(), waiting: new Map<number, CrewId>() };
  for (const c of working) {
    const who = by.get(c.number)!;
    const outside = who === "semicolon" || urgent(c);
    if (hands[who] >= MAX_RUNNING[who] || (!outside && counted >= MAX_AT_ONCE)) {
      out.waiting.set(c.number, who);
      continue;
    }
    hands[who] += 1;
    if (!outside) counted += 1;
    out.running.set(c.number, who);
  }
  return out;
}

/** One crew member's running jobs (urgent first, then oldest) and the ones waiting their turn. */
export function shifts(crates: Crate[], who: CrewId): { running: Crate[]; waiting: Crate[] } {
  const { running: run, waiting } = runningNow(crates);
  const of = (m: Map<number, CrewId>) => [...m].filter(([, w]) => w === who).map(([n]) => crates.find((c) => c.number === n)!);
  return { running: of(run), waiting: of(waiting) };
}

/** Every job that is working but waiting its turn, because the crew or its crew member is at the cap. */
export function waitingTurn(crates: Crate[]): Set<number> {
  return new Set(runningNow(crates).waiting.keys());
}

/**
 * Who has hands on each of Rusty's running jobs. A job whose Builder line names Rusty, Dusty, Gusty or Musty
 * gets that one (the first such job when two name the same hand); the rest take the free hands in bay order:
 * Rusty on the oldest, then Dusty, Gusty and Musty. Jobs waiting their turn are left out.
 */
export function rustyHands(crates: Crate[]): Map<number, string> {
  const names: string[] = ["Rusty", ...DOCK_CREW.map((d) => d.name)];
  const running = shifts(crates, "tessellate").running;
  const out = new Map<number, string>();
  const taken = new Set<string>();
  for (const c of running) {
    if (c.hand && names.includes(c.hand) && !taken.has(c.hand)) {
      out.set(c.number, c.hand);
      taken.add(c.hand);
    }
  }
  const free = names.filter((n) => !taken.has(n));
  for (const c of running) if (!out.has(c.number)) out.set(c.number, free.shift() ?? names[0]!);
  return out;
}

/** The paint each named builder wears on the forge and the Desk: Rusty's dock crew in their own colours, Skippy in his shell blue. */
export const HAND_COLOUR: Record<HandName, string> = {
  Rivet: MODEL.semicolon.colour,
  Rusty: "#c9742c",
  Rocky: MODEL.caret.colour,
  Dusty: "#ecc66a",
  Gusty: "#3f8fea",
  Musty: "#6fae4a",
  Skippy: "#7fd8ff",
};

/**
 * How many of Rusty's dock crew are awake: one for each job really running past his own. One job, just Rusty;
 * three, Rusty plus Dusty and Gusty. Each awake one works the assembly line alongside him.
 */
export function sparesAwake(crates: Crate[]): number {
  return Math.max(0, shifts(crates, "tessellate").running.length - 1);
}

const SIZE_RANK = { large: 3, medium: 2, small: 1 } as const;

/**
 * The plan on Rocky's drafting table: the biggest idea that is open (an approved build not yet shipped) or upcoming
 * (an idea waiting on the C.E.O.). Biggest by its size; then one already being built; then the newest. Null when
 * there is none.
 */
export function blueprintCrate(crates: Crate[]): Crate | null {
  const open = crates.filter((c) => c.state !== "shipped" && (c.kind === "build" || c.kind === "idea"));
  const score = (c: Crate) => (c.size ? SIZE_RANK[c.size] : 0) * 10 + (c.kind === "build" || c.state === "working" ? 1 : 0);
  let best: Crate | null = null;
  for (const c of open) if (!best || score(c) > score(best) || (score(c) === score(best) && c.updatedAt > best.updatedAt)) best = c;
  return best;
}

/**
 * The job a crew member's name plate in the Lattice shows: what their routine in the room is about. A stuck or
 * ready crate first (they're slumped by it, or waiting at the dock with it); then the job in their own hands
 * (Rusty's oldest running one; the newer ones are his dock crew's, `dockJobs`); then anything else they hold. Rivet
 * with nothing in hand shows the latest upkeep while she's seen working it through (`visibleUpkeep`). Null when they
 * hold nothing.
 */
export function crewJob(crates: Crate[], who: CrewId, now = Date.now()): Crate | null {
  const held = crewWork(crates)[who];
  if (held && held.state !== "working") return held;
  const own = shifts(crates, who).running[0];
  if (own) return own;
  if (held) return held;
  if (who === "semicolon") return visibleUpkeep(crates, now);
  return null;
}

/** The jobs Rusty's dock crew are on, one per awake unit in bay order (Dusty, Gusty, Musty). */
export function dockJobs(crates: Crate[]): Crate[] {
  return shifts(crates, "tessellate").running.slice(1, 1 + SPARE_BAYS);
}

/** What each crew member is doing: the crate they hold that matters most (stuck, then working, then ready). */
export function crewWork(crates: Crate[]): Record<CrewId, Crate | null> {
  const out: Record<CrewId, Crate | null> = { semicolon: null, caret: null, tessellate: null };
  const by = assignCrew(crates);
  for (const c of crates) {
    const who = by.get(c.number);
    if (!who) continue;
    const held = out[who];
    if (!held || RANK[c.state] < RANK[held.state]) out[who] = c;
  }
  return out;
}

interface FoundryStore {
  data: FoundryData;
  /** True once GitHub has answered at least once. */
  connected: boolean;
  lastFetch: number | null;
  /** While the board shows the copy kept on this device (#513): when that answer was fetched. null once a live answer lands. */
  keptAt: number | null;
  /** Ideas Nikita just sent from the Desk, shown at once until GitHub's copy arrives (numbered below zero until then). */
  pending: Crate[];
  set: (data: FoundryData) => void;
  /** Paint the kept copy until the first live answer replaces it. */
  setKept: (data: FoundryData, at: number) => void;
  addPending: (crate: Crate) => void;
  /** GitHub answered: the pending card now has its real issue number (or `null` when sending failed). */
  settlePending: (temp: number, issue: number | null) => void;
  /** Rivet's shaping came straight back from Claude: the pending card takes it before GitHub has it. */
  shapePending: (number: number, shape: Pick<Crate, "title" | "pitch" | "size" | "short" | "builder"> & { question?: string }) => void;
}

export const EMPTY_FOUNDRY: FoundryData = { crates: [], changelog: [], checks: { state: "unknown", url: null, at: null }, shelved: 0, lastCommit: null };

/** How many ideas are on the shelf. */
export function countShelved(issues: GhIssue[]): number {
  return issues.filter((i) => !i.pull_request && i.state === "closed" && i.labels.some((l) => (typeof l === "string" ? l : l.name) === "foundry:passed")).length;
}

export const useFoundry = create<FoundryStore>((set) => ({
  data: EMPTY_FOUNDRY,
  connected: false,
  lastFetch: null,
  keptAt: null,
  pending: [],
  // A pending card stays until the feed carries its issue in at least the same shape, so the board never flickers
  // back to empty or back to the unshaped words.
  setKept: (data, at) => set((s) => (s.lastFetch === null ? { data, connected: true, keptAt: at } : {})),
  set: (data) => set((s) => ({ data, connected: true, lastFetch: Date.now(), keptAt: null, pending: s.pending.filter((p) => !data.crates.some((c) => c.number === p.number && (p.revising || !c.revising) && (!p.asking || c.asking))) })),
  addPending: (crate) => set((s) => ({ pending: [...s.pending, crate] })),
  settlePending: (temp, issue) =>
    set((s) => ({
      pending:
        issue === null ? s.pending.filter((p) => p.number !== temp)
        : s.pending.map((p) => (p.number === temp ? { ...p, number: issue, url: `https://github.com/${REPO}/issues/${issue}` } : p)),
    })),
  shapePending: (number, shape) => set((s) => ({ pending: s.pending.map((p) => (p.number === number ? { ...p, ...shape, revising: false, asking: Boolean(shape.question), updatedAt: Date.now() } : p)) })),
}));

/** The ideas on the Desk's cards, in the thread's numbering (Build 1, 2, 3): GitHub's open ideas, then any just sent from the Desk until GitHub numbers them. */
export function openIdeas(crates: Crate[], pending: Crate[]): Crate[] {
  const open = crates.filter((c) => c.kind === "idea" && c.state !== "shipped" && !pending.some((p) => p.number === c.number));
  return [...open, ...pending].sort((a, b) => (a.number < 0 ? Infinity : a.number) - (b.number < 0 ? Infinity : b.number));
}

/** Rivet's questions waiting on Nikita (an answer being shaped no longer counts) and the other ideas waiting for a pick, kept apart. */
export function ideaCounts(ideas: Crate[]): { questions: Crate[]; toPick: number } {
  const waiting = ideas.filter((c) => !c.revising);
  const questions = waiting.filter((c) => c.asking && c.question);
  return { questions, toPick: waiting.length - questions.length };
}

/** The card the Desk shows the moment Nikita sends an idea, in their own words. */
export function pendingIdea(words: string, now: number, images: string[] = []): Crate {
  const first = words.split("\n")[0]!.trim();
  return { number: -now, title: `Idea: ${first.length > 80 ? `${first.slice(0, 77)}…` : first}`, kind: "idea", state: "queued", rung: null, url: "", updatedAt: now, pitch: "", size: null, revising: true, images: images.map(pictureRef).filter((p): p is string => p !== null) };
}

/** The last answer per URL with its ETag, so an unchanged answer costs nothing against the rate limit. */
const cache = new Map<string, { etag: string; body: unknown }>();

async function fetchJson<T>(url: string): Promise<T> {
  const had = cache.get(url);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (had) headers["If-None-Match"] = had.etag;
  const res = await fetch(url, { headers });
  if (res.status === 304 && had) return had.body as T;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) cache.set(url, { etag, body });
  return body;
}

interface Feed {
  issues: GhIssue[];
  runs: { workflow_runs: GhRun[] };
  /** The nightly browser tests (e2e.yml); absent from an older cached feed. */
  e2e?: { workflow_runs: GhRun[] };
  /** The hourly live watch (live-watch.yml, #181); absent from an older cached feed. */
  live?: { workflow_runs: GhRun[] };
  pulls: GhPull[];
  commits: GhCommit[];
  /** The scheduled jobs' newest runs (#301); only the Desk's feed reads them, and an older cached feed has none. */
  jobs?: GhJob[];
  /** The open pull requests with their checks (#432); an older cached feed has none. */
  open?: unknown[];
  /** Build progress (#488): the issues with a pushed branch, and the merged pull requests' milestones. */
  branches?: unknown;
  timings?: unknown;
}

/** The Desk's own feed (api/foundry-feed.ts): one request, read with the Foundry's token and shared by every tab. */
async function readFeed(): Promise<Feed> {
  // No cache-busting query: the feed redirects any query to the bare URL, and the few seconds of edge cache are short enough.
  const res = await fetch("/api/foundry-feed", { headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`${res.status} feed`);
  return (await res.json()) as Feed;
}

/** GitHub directly, for local previews where the feed isn't running. */
async function readGitHub(): Promise<Feed> {
  const [issues, runs, e2e, live, pulls, commits, open] = await Promise.all([
    fetchJson<GhIssue[]>(`${API}/issues?labels=foundry&state=all&sort=updated&per_page=40`),
    fetchJson<{ workflow_runs: GhRun[] }>(`${API}/actions/workflows/checks.yml/runs?branch=main&per_page=1`).catch(() => ({ workflow_runs: [] })),
    fetchJson<{ workflow_runs: GhRun[] }>(`${API}/actions/workflows/e2e.yml/runs?branch=main&per_page=5`).catch(() => ({ workflow_runs: [] })),
    fetchJson<{ workflow_runs: GhRun[] }>(`${API}/actions/workflows/live-watch.yml/runs?branch=main&per_page=1`).catch(() => ({ workflow_runs: [] })),
    fetchJson<GhPull[]>(`${API}/pulls?state=closed&sort=updated&direction=desc&per_page=20`).catch(() => [] as GhPull[]),
    fetchJson<GhCommit[]>(`${API}/commits?sha=main&per_page=40`).catch(() => [] as GhCommit[]),
    fetchJson<unknown[]>(`${API}/pulls?state=open&sort=created&direction=desc&per_page=12`).catch(() => [] as unknown[]),
  ]);
  return { issues, runs, e2e, live, pulls, commits, open };
}

/** The Desk's feed, kept on this device: the last real `/api/foundry-feed` answer (never the direct-GitHub fallback). */
const KEPT_FEED = "ceo.foundryFeed";

const isFeed = (v: unknown): v is Feed => {
  const f = v as Partial<Feed> | null;
  return !!f && typeof f === "object" && Array.isArray(f.issues) && Array.isArray(f.pulls) && Array.isArray(f.commits) && !!f.runs && Array.isArray(f.runs.workflow_runs);
};

function parseFeed({ issues, runs, pulls, commits, jobs, open, branches, timings }: Feed): FoundryData {
  return { crates: parseCrates(issues), changelog: parseChangelog(issues, pulls, commits), checks: parseChecks(runs.workflow_runs), shelved: countShelved(issues), lastCommit: parseLastCommit(commits), jobs, prs: parseOpenPrs(open), branches: Array.isArray(branches) ? branches.filter((n): n is number => typeof n === "number") : [], timings: parseTimings(timings) };
}

/** Paint the copy kept on this device, if it is under a day old and well-formed, before the first fetch lands. */
export function paintKeptFoundry(): void {
  const kept = readKept(KEPT_FEED, isFeed);
  if (!kept) return;
  try {
    useFoundry.getState().setKept(parseFeed(kept.value), kept.at);
  } catch {
    // A copy that won't parse is never painted.
  }
}

export async function refreshFoundry(): Promise<void> {
  try {
    let fromFeed = false;
    const feed = await readFeed().then((f) => ((fromFeed = true), f)).catch(readGitHub);
    const { e2e, live } = feed;
    const data = parseFeed(feed);
    if (fromFeed && isFeed(feed)) keepFeed(KEPT_FEED, feed);
    useFoundry.getState().set(data);
    // The Foundry's two pipes in the Boiler Room and on Systems.
    const { setLink } = useSystems.getState();
    const now = Date.now();
    const checks = CHECKS_LINK;
    setLink("checks", { state: checks[data.checks.state], load: data.checks.state === "running" ? 0.9 : 0.4, lastSeen: data.checks.at, note: data.checks.url ?? undefined });
    const nightly = parseE2e(e2e?.workflow_runs);
    setLink("e2e", { state: checks[nightly.state], load: nightly.state === "running" ? 0.9 : 0.4, lastSeen: nightly.at, note: nightly.url ?? undefined });
    const watch = parseChecks(live?.workflow_runs ?? []);
    setLink("live", { state: checks[watch.state], load: watch.state === "running" ? 0.9 : 0.4, lastSeen: watch.at, note: watch.url ?? undefined });
    const busy = data.crates.filter((c) => c.state === "working").length;
    const stuck = data.crates.some((c) => c.state === "stuck");
    setLink("foundry", { state: stuck ? "slow" : "ok", load: Math.min(1, 0.25 + busy * 0.3), lastSeen: now, note: stuck ? "A crate is stuck and needs you" : undefined });
  } catch {
    // Offline or rate-limited: keep what we had and try again next poll.
  }
}

let started = false;
let quickUntil = 0;
let quickTimer: number | null = null;

/** Something just changed on GitHub (a click on the Desk): poll quickly for a minute so it shows without a refresh. */
export function expectChange(): void {
  quickUntil = Date.now() + QUICK_FOR_MS;
  void refreshFoundry();
  if (quickTimer !== null || typeof window === "undefined") return;
  quickTimer = window.setInterval(() => {
    if (Date.now() > quickUntil) {
      if (quickTimer !== null) clearInterval(quickTimer);
      quickTimer = null;
      return;
    }
    if (document.visibilityState === "visible") void refreshFoundry();
  }, QUICK_MS);
}

/** Start polling GitHub (once per page). Skipped in tests and with `?offline`. */
export function startFoundry(): void {
  if (started || typeof window === "undefined" || new URLSearchParams(window.location.search).has("offline")) return;
  started = true;
  paintKeptFoundry();
  void refreshFoundry();
  setInterval(() => {
    if (document.visibilityState === "visible") void refreshFoundry();
  }, POLL_MS);
  // Coming back to the tab asks straight away rather than waiting out the interval.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshFoundry();
  });
}
