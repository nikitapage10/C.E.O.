import { create } from "zustand";
import { useSystems, type LinkState } from "./systems.ts";

/**
 * The Foundry's real work, read from GitHub. Shared by the Desk (cards, Systems) and the Lattice (the Foundry
 * room). Imports nothing from the 3D world, so the Desk can load it alone.
 *
 * The coding happens in the Foundry thread in Claude Code; it keeps its queue as GitHub issues labelled
 * `foundry` (see docs/FOUNDRY.md for the labels). The repo is public, so the browser reads them directly.
 */

export const REPO = "nikitapage10/C.E.O.";
const API = `https://api.github.com/repos/${REPO}`;
/** Unauthenticated GitHub allows 60 requests an hour per visitor; two per poll every three minutes is 40. */
const POLL_MS = 3 * 60_000;
/** Shipped crates stay on show this long. */
const SHIPPED_FOR_MS = 24 * 3_600_000;

export type CrateKind = "fix" | "idea" | "build" | "upkeep";
export type CrateState = "queued" | "working" | "ready" | "stuck" | "shipped";
/** The Foundry crew, by agent id: Skippy (semicolon) first responder, Rocky (caret) master builder, Rusty (tessellate) upkeep and ideas. */
export type CrewId = "semicolon" | "caret" | "tessellate";

export const CREW: Record<CrewId, { name: string; job: string }> = {
  semicolon: { name: "Skippy", job: "First responder" },
  caret: { name: "Rocky", job: "Master builder" },
  tessellate: { name: "Rusty", job: "Upkeep and ideas" },
};

export interface Crate {
  number: number;
  title: string;
  kind: CrateKind;
  state: CrateState;
  /** The model rung a fix is on: 1 Haiku, 2 Sonnet, 3 Opus. */
  rung: 1 | 2 | 3 | null;
  url: string;
  /** Date.now() of the last change. */
  updatedAt: number;
}

export type ChecksState = "pass" | "fail" | "running" | "unknown";

export interface FoundryData {
  crates: Crate[];
  checks: { state: ChecksState; url: string | null; at: number | null };
}

/** The slice of GitHub's issue JSON we read. */
export interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
  closed_at?: string | null;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

/** The slice of GitHub's workflow-run JSON we read. */
export interface GhRun {
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at: string;
}

const KINDS: CrateKind[] = ["fix", "idea", "build", "upkeep"];

/** Issues labelled `foundry` become crates; pull requests, untyped issues and closed-unshipped ones drop out. */
export function parseCrates(issues: GhIssue[], now = Date.now()): Crate[] {
  const crates: Crate[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = new Set(issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))));
    if (!labels.has("foundry")) continue;
    const kind = KINDS.find((k) => labels.has(`foundry:${k}`));
    if (!kind) continue;
    const updatedAt = Date.parse(issue.updated_at);
    let state: CrateState;
    if (issue.state === "closed") {
      if (!labels.has("foundry:shipped")) continue;
      if (now - Date.parse(issue.closed_at ?? issue.updated_at) > SHIPPED_FOR_MS) continue;
      state = "shipped";
    } else {
      state = labels.has("foundry:stuck") ? "stuck" : labels.has("foundry:ready") ? "ready" : labels.has("foundry:working") ? "working" : "queued";
    }
    const rung = labels.has("rung:3") ? 3 : labels.has("rung:2") ? 2 : labels.has("rung:1") ? 1 : null;
    crates.push({ number: issue.number, title: issue.title, kind, state, rung, url: issue.html_url, updatedAt });
  }
  return crates.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Who carries a crate: Skippy takes first tries at fixes, Rocky the harder rungs and approved builds, Rusty upkeep and ideas. */
export function crewFor(crate: Pick<Crate, "kind" | "rung">): CrewId {
  if (crate.kind === "fix") return crate.rung !== null && crate.rung >= 2 ? "caret" : "semicolon";
  if (crate.kind === "build") return "caret";
  return "tessellate";
}

export function parseChecks(runs: GhRun[]): FoundryData["checks"] {
  const run = runs[0];
  if (!run) return { state: "unknown", url: null, at: null };
  const state: ChecksState = run.status !== "completed" ? "running" : run.conclusion === "success" ? "pass" : run.conclusion === "failure" ? "fail" : "unknown";
  return { state, url: run.html_url, at: Date.parse(run.updated_at) };
}

/** What each crew member is doing: the crate they hold that matters most (stuck, then working, then ready). */
export function crewWork(crates: Crate[]): Record<CrewId, Crate | null> {
  const rank: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };
  const out: Record<CrewId, Crate | null> = { semicolon: null, caret: null, tessellate: null };
  for (const c of crates) {
    if (c.state === "shipped" || c.state === "queued" || (c.kind === "idea" && c.state !== "working")) continue;
    const who = crewFor(c);
    const held = out[who];
    if (!held || rank[c.state] < rank[held.state]) out[who] = c;
  }
  return out;
}

interface FoundryStore {
  data: FoundryData;
  /** True once GitHub has answered at least once. */
  connected: boolean;
  lastFetch: number | null;
  set: (data: FoundryData) => void;
}

export const EMPTY_FOUNDRY: FoundryData = { crates: [], checks: { state: "unknown", url: null, at: null } };

export const useFoundry = create<FoundryStore>((set) => ({
  data: EMPTY_FOUNDRY,
  connected: false,
  lastFetch: null,
  set: (data) => set({ data, connected: true, lastFetch: Date.now() }),
}));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export async function refreshFoundry(): Promise<void> {
  try {
    const [issues, runs] = await Promise.all([
      fetchJson<GhIssue[]>(`${API}/issues?labels=foundry&state=all&sort=updated&per_page=40`),
      fetchJson<{ workflow_runs: GhRun[] }>(`${API}/actions/workflows/checks.yml/runs?branch=main&per_page=1`).catch(() => ({ workflow_runs: [] })),
    ]);
    const data: FoundryData = { crates: parseCrates(issues), checks: parseChecks(runs.workflow_runs) };
    useFoundry.getState().set(data);
    // The Foundry's two pipes in the Boiler Room and on Systems.
    const { setLink } = useSystems.getState();
    const now = Date.now();
    const checks: Record<ChecksState, LinkState> = { pass: "ok", fail: "down", running: "slow", unknown: "off" };
    setLink("checks", { state: checks[data.checks.state], load: data.checks.state === "running" ? 0.9 : 0.4, lastSeen: data.checks.at, note: data.checks.url ?? undefined });
    const busy = data.crates.filter((c) => c.state === "working").length;
    const stuck = data.crates.some((c) => c.state === "stuck");
    setLink("foundry", { state: stuck ? "slow" : "ok", load: Math.min(1, 0.25 + busy * 0.3), lastSeen: now, note: stuck ? "A crate is stuck and needs you" : undefined });
  } catch {
    // Offline or rate-limited: keep what we had and try again next poll.
  }
}

let started = false;
/** Start polling GitHub (once per page). Skipped in tests and with `?offline`. */
export function startFoundry(): void {
  if (started || typeof window === "undefined" || new URLSearchParams(window.location.search).has("offline")) return;
  started = true;
  void refreshFoundry();
  setInterval(() => {
    if (document.visibilityState === "visible") void refreshFoundry();
  }, POLL_MS);
}
