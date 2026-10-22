/**
 * What Skippy knows about the Desk when Nikita talks to him (#224): the same live state the Desk already shows,
 * read server-side and cut down to titles, numbers, labels and counts. Ideas waiting for the pick, builds in
 * flight, what is waiting for Nikita's OK, Rivet's open questions, the setup steps still to do, the last few
 * ships and the world clock. Never an issue body or a comment's words (one exception: Rivet's own `**Question:**`
 * line on an idea the Desk or the crew filed, since answering it is one of the things Skippy can route), and every
 * line goes through `scrub` as the public feeds do (api/_world/digest.ts).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { scrub, TRAIL_AUTHORS } from "../_world/digest.js";
import type { SetupStatus } from "../_desk/setup.js";
import type { WorldState } from "../_world/types.js";

/** An issue as the feed carries it: only the fields read here. */
export interface ContextIssue {
  number: number;
  title: string;
  state: string;
  closed_at?: string | null;
  body?: string | null;
  labels: ({ name?: string } | string)[];
  user?: { login?: string } | null;
  pull_request?: unknown;
}

/** One of Rivet's questions: the idea, and what Rivet asked. Skippy may only route answers to these. */
export interface OpenQuestion {
  issue: number;
  title: string;
  question: string;
}

/** The Desk's live state as Skippy is told it. Every string is one scrubbed line. */
export interface DeskContext {
  ideas: { issue: number; title: string }[];
  questions: OpenQuestion[];
  building: { issue: number; title: string; state: string }[];
  waiting: { issue: number; title: string; why: string }[];
  setup: string[];
  shipped: { issue: number; title: string }[];
  world: { step: number; at: string | null; latest: string | null } | null;
}

export const EMPTY_CONTEXT: DeskContext = { ideas: [], questions: [], building: [], waiting: [], setup: [], shipped: [], world: null };

/** At most this many of each list: the prompt stays small and cheap. */
export const LIST_MAX = 6;

const labelsOf = (i: ContextIssue) => i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? "")));

/** A title as Skippy reads it: no "Idea:" prefix, scrubbed, no angle brackets (the prompt's blocks are tags), short. */
export function line(text: string, max = 90): string {
  const t = scrub(text.replace(/^Idea:\s*/i, "").slice(0, 400)).replace(/[<>＜＞]/g, "");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Rivet's `**Question:**` line, only from an issue the Desk, Nikita or the crew filed. */
function questionOf(i: ContextIssue): string {
  if (!TRAIL_AUTHORS.has(i.user?.login ?? "")) return "";
  const q = /^\*\*Question:\*\*[ \t]*(.*)$/m.exec(i.body ?? "")?.[1]?.trim() ?? "";
  return q ? line(q, 240) : "";
}

/** A build's state in a word, from its labels. */
function stateOf(labels: string[]): string {
  if (labels.includes("foundry:working")) return "in progress";
  if (labels.includes("foundry:ready")) return "waiting for Nikita's OK";
  if (labels.includes("foundry:stuck") || labels.includes("foundry:blocked")) return "stuck";
  if (labels.includes("foundry:paused")) return "paused";
  return "queued";
}

const SETUP_NAMES: Record<string, string> = {
  pings: "turn on pings to the phone",
  app: "set up the crew's GitHub App",
  devices: "enrol a second device for sign-in",
  ruleset: "turn on the ruleset for main",
  automerge: "allow auto-merge in the repo",
};

/** The Desk's state from the Foundry's issues, the setup list and the saved world. Pure: the reads happen elsewhere. */
export function deskContext(open: ContextIssue[], shipped: ContextIssue[], setup: SetupStatus | null, world: WorldState | null): DeskContext {
  const foundry = open.filter((i) => !i.pull_request && i.state === "open" && labelsOf(i).includes("foundry"));
  const ideas: DeskContext["ideas"] = [];
  const questions: OpenQuestion[] = [];
  const building: DeskContext["building"] = [];
  const waiting: DeskContext["waiting"] = [];
  for (const i of foundry) {
    const labels = labelsOf(i);
    const title = line(i.title);
    if (labels.includes("foundry:idea")) {
      const q = labels.includes("foundry:question") ? questionOf(i) : "";
      if (q) questions.push({ issue: i.number, title, question: q });
      else if (!labels.includes("foundry:revise")) ideas.push({ issue: i.number, title });
      continue;
    }
    const state = stateOf(labels);
    if (state === "waiting for Nikita's OK" || state === "stuck") waiting.push({ issue: i.number, title, why: state });
    else building.push({ issue: i.number, title, state });
  }
  const todo = setup ? Object.entries(setup.items).filter(([, s]) => s === "todo").map(([k]) => SETUP_NAMES[k] ?? k) : [];
  const latest = world?.recent.at(-1)?.summary;
  return {
    ideas: ideas.slice(0, LIST_MAX),
    questions: questions.slice(0, LIST_MAX),
    building: building.slice(0, LIST_MAX),
    waiting: waiting.slice(0, LIST_MAX),
    setup: todo,
    shipped: shipped
      .filter((i) => !i.pull_request && labelsOf(i).includes("foundry:shipped"))
      .slice(0, 5)
      .map((i) => ({ issue: i.number, title: line(i.title) })),
    world: world ? { step: world.step, at: world.at, latest: latest ? line(latest, 300) : null } : null,
  };
}

/** The context as the lines of the prompt's <desk> block. Counts first, then the lists. */
export function contextLines(c: DeskContext, now: number): string {
  const list = (items: string[]) => (items.length ? items.map((s) => `  - ${s}`).join("\n") : "  - (none)");
  const out = [
    `Now: ${new Date(now).toLocaleString("en-US", { timeZone: "America/Denver", weekday: "long", hour: "numeric", minute: "2-digit" })} Mountain time.`,
    `Ideas waiting for Nikita's pick: ${c.ideas.length}`,
    list(c.ideas.map((i) => `#${i.issue} ${i.title}`)),
    `Rivet's questions waiting for an answer: ${c.questions.length}`,
    list(c.questions.map((q) => `#${q.issue} ${q.title}: Rivet asks "${q.question}"`)),
    `Builds in flight: ${c.building.length}`,
    list(c.building.map((b) => `#${b.issue} ${b.title} (${b.state})`)),
    `Waiting for Nikita: ${c.waiting.length}`,
    list(c.waiting.map((w) => `#${w.issue} ${w.title} (${w.why})`)),
    `Setup steps still to do: ${c.setup.length}`,
    list(c.setup),
    "Shipped lately:",
    list(c.shipped.map((s) => `#${s.issue} ${s.title}`)),
    c.world ? `The Lattice's clock: hour ${c.world.step}${c.world.latest ? `. Latest in Ilyr: ${c.world.latest}` : ""}` : "The Lattice's clock: not running yet.",
  ];
  return out.join("\n");
}
