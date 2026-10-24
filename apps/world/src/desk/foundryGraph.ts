import { crewOf, MAX_AT_ONCE, MAX_RUNNING, runningNow, type Crate, type CrewId, type FoundryData } from "../foundry.ts";
import type { LinkState } from "../systems.ts";
import { FOUNDRY_THREAD } from "./deskData.ts";

/**
 * The Foundry's system as a graph for the Desk's Systems page: every part an idea passes through on its way to the
 * live site, and the state of each, from real feeds only (GitHub through the Desk's feed, and api/foundry's GET).
 * Anything the Desk can't measure says so in its detail. Pure, so the states can be tested; FoundryDiagram draws it.
 */

export type GraphNodeId = "nikita" | "desk" | "shaping" | "issues" | "queue" | "builder" | "rivet" | "rusty" | "rocky" | "checks" | "main" | "deploy" | "blob";
/** How a part is drawn: a person, a service (circle), an agent (hexagon) or a store (diamond). */
export type GraphKind = "person" | "service" | "agent" | "store";

export interface GraphNode {
  id: GraphNodeId;
  label: string;
  /** What it runs on, in a word or two ("Opus", "Azure"). */
  sub: string;
  kind: GraphKind;
  state: LinkState;
  /** The short live reading under its name. */
  status: string;
  /** How busy, 0..1 (the ring's gauge). */
  load: number;
  /** What it is. */
  what: string;
  /** Where the reading comes from, or that it can't be measured. */
  source: string;
  url?: string;
}

export interface GraphEdge {
  from: GraphNodeId;
  to: GraphNodeId;
  state: LinkState;
  /** What travels along it. */
  label: string;
  /** How it's routed, and what decides its state. */
  what: string;
}

/** What api/foundry's GET says is set up; null while asking, "unreached" when it didn't answer. */
export type FoundrySetup = { direct: boolean; shape: boolean; images: boolean } | null | "unreached";

export interface GraphInput {
  now: number;
  /** True once the Desk's feed (GitHub) has answered. */
  connected: boolean;
  data: FoundryData;
  setup: FoundrySetup;
  /** The next queue check (FoundryPage's nextCheck). */
  nextCheck: number;
}

/** The queue checks run every 15 minutes. */
export const CHECK_EVERY_MS = 15 * 60_000;

const LANE: Record<"rivet" | "rusty" | "rocky", CrewId> = {
  rivet: "semicolon",
  rusty: "tessellate",
  rocky: "caret",
};

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

/** "in 7 min", "now". */
export function inMinutes(at: number, now: number): string {
  const m = Math.round((at - now) / 60_000);
  return m <= 0 ? "now" : `in ${m} min`;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

/** One lane's jobs: running, waiting their turn, and stuck. */
export function laneLoad(crates: Crate[], who: CrewId): { running: number; waiting: number; stuck: number } {
  const { running, waiting } = runningNow(crates);
  const count = (m: Map<number, CrewId>) => [...m.values()].filter((w) => w === who).length;
  const stuck = crates.filter((c) => c.state === "stuck" && crewOf(c, crates) === who).length;
  return { running: count(running), waiting: count(waiting), stuck };
}

/** How many jobs run inside the cap of four (Rivet's emergency slot and urgent fixes run outside it). */
export function capUse(crates: Crate[]): {
  inCap: number;
  outside: number;
  waiting: number;
} {
  const { running, waiting } = runningNow(crates);
  let inCap = 0;
  let outside = 0;
  for (const [n, who] of running) {
    const urgent = crates.find((c) => c.number === n)?.kind === "fix";
    if (who === "semicolon" || urgent) outside += 1;
    else inCap += 1;
  }
  return { inCap, outside, waiting: waiting.size };
}

const CHECKS: Record<FoundryData["checks"]["state"], { state: LinkState; status: string }> = {
  pass: { state: "ok", status: "Passing" },
  fail: { state: "down", status: "Failing" },
  running: { state: "slow", status: "Running" },
  unknown: { state: "off", status: "No run read" },
};

export function foundryGraph({ now, connected, data, setup, nextCheck }: GraphInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const asked = setup !== null && setup !== "unreached";
  const set = asked ? setup : null;
  const gh = (ok: string): { state: LinkState; status: string } => (connected ? { state: "ok", status: ok } : { state: "off", status: "Not reached" });

  const open = data.crates.filter((c) => c.state !== "shipped");
  const queued = open.filter((c) => c.state === "queued").length;
  const working = open.filter((c) => c.state === "working").length;
  const stuck = open.filter((c) => c.state === "stuck").length;
  const ready = open.filter((c) => c.state === "ready").length;

  const lastCheck = nextCheck - CHECK_EVERY_MS;
  const checks = connected ? CHECKS[data.checks.state] : { state: "off" as LinkState, status: "Not reached" };
  const commit = data.lastCommit ?? null;
  const cap = capUse(data.crates);

  const lane = (id: "rivet" | "rusty" | "rocky", label: string, sub: string, what: string): GraphNode => {
    const who = LANE[id];
    const { running, waiting, stuck: held } = laneLoad(data.crates, who);
    const max = MAX_RUNNING[who];
    const capped = Number.isFinite(max);
    let state: LinkState = "ok";
    let status = !running ? "Idle" : capped ? `${running} of ${max} running` : `${running} running`;
    if (held) {
      state = "down";
      status = `${held} stuck`;
    } else if (waiting) {
      state = "slow";
      status = `${running}${capped ? ` of ${max}` : ""} · ${waiting} waiting`;
    }
    if (!connected) {
      state = "off";
      status = "Not reached";
    }
    const load = Number.isFinite(max) ? running / max : Math.min(1, running / 2);
    return {
      id,
      label,
      sub,
      kind: "agent",
      state,
      status,
      load,
      what,
      source: "Jobs labelled working on GitHub, sorted into lanes the way the Foundry room does (urgent first, then oldest, within each crew member's cap).",
    };
  };

  const shaping: Pick<GraphNode, "state" | "status"> =
    setup === null
      ? { state: "off", status: "Checking…" }
      : setup === "unreached"
        ? { state: "off", status: "Not reached" }
        : setup.shape
          ? { state: "ok", status: "Connected" }
          : { state: "off", status: "Not set up" };
  const blob: Pick<GraphNode, "state" | "status"> =
    setup === null
      ? { state: "off", status: "Checking…" }
      : setup === "unreached"
        ? { state: "off", status: "Not reached" }
        : setup.images
          ? { state: "ok", status: "Connected" }
          : { state: "off", status: "Not connected" };

  const nodes: GraphNode[] = [
    {
      id: "nikita",
      label: "Nikita",
      sub: "On the Desk",
      kind: "person",
      state: "ok",
      status: "Here",
      load: 0,
      what: "You. Ideas start here, by voice or typing, and so do the picks: Build, Revise or Not this one.",
      source: "Not measured: you're the one reading this.",
    },
    {
      id: "desk",
      label: "Desk",
      sub: "Azure",
      kind: "service",
      state: "ok",
      status: "Live",
      load: 0.3,
      what: "This site. It reads the crew's work from GitHub every half minute and sends your clicks to the Foundry function.",
      source: "Measured by this page loading.",
    },
    {
      id: "shaping",
      label: "Shaping",
      sub: "Claude Haiku",
      kind: "service",
      ...shaping,
      load: set?.shape ? 0.3 : 0,
      what: "Rusty turns your words into a card (title, pitch, size, builder) in a second or two, through the Claude API in api/foundry.",
      source:
        set && !set.shape
          ? "api/foundry says no Claude key is set, so the next queue check shapes ideas instead."
          : "Whether a Claude key is set, from api/foundry. Each shaping's time and cost go on the issue's trail.",
    },
    {
      id: "issues",
      label: "Issues",
      sub: "GitHub",
      kind: "store",
      ...gh(`${queued} queued · ${working} working`),
      load: Math.min(1, open.length / 12),
      what: "The queue: every job is a GitHub issue labelled foundry, from your ideas, red checks, upkeep and chat work.",
      source: connected
        ? `Read through the Desk's feed: ${open.length} open, ${ready} held on a test${stuck ? `, ${stuck} stuck` : ""}.`
        : "The Desk's feed hasn't answered yet.",
      url: "https://github.com/nikitapage10/C.E.O./issues?q=label%3Afoundry",
    },
    {
      id: "queue",
      label: "Queue check",
      sub: "Within a minute",
      kind: "service",
      ...(connected ? { state: "ok" as LinkState, status: `Next ${clock(nextCheck)}` } : { state: "off" as LinkState, status: "Not reached" }),
      load: Math.min(1, Math.max(0, (now - lastCheck) / CHECK_EVERY_MS)),
      what: `The Builder's watcher looks at the queue every 30 seconds and wakes him the moment an approved build, an unshaped idea or a red check lands. Four routine checks an hour (:06, :21, :36, :51 UTC) back it up. Last one due ${clock(lastCheck)}, next ${inMinutes(nextCheck, now)}.`,
      source: "From the schedule: the Desk can't see the routine itself, so it can't say whether a check actually ran.",
    },
    {
      id: "builder",
      label: "Builder",
      sub: "Opus",
      kind: "agent",
      ...(connected
        ? stuck
          ? { state: "slow" as LinkState, status: `${stuck} stuck` }
          : {
              state: "ok" as LinkState,
              status: working ? `${working} assigned` : "Waiting for work",
            }
        : { state: "off" as LinkState, status: "Not reached" }),
      load: Math.min(1, working / MAX_AT_ONCE),
      what: "The Foundry thread on Claude Code. It reads each job, decides who builds it and on which model, writes that on the issue, and starts the crew.",
      source: "Read from what it writes on GitHub; the thread itself isn't visible to the Desk.",
      url: FOUNDRY_THREAD,
    },
    lane("rivet", "Rivet", "Haiku · Sonnet", "The first responder and the upkeep lane: alerts and rung-one fixes on Haiku, and every five-hour upkeep tick on Sonnet (Opus when a job needs it), security and compliance first. Runs outside the cap of four so it never waits; Rivet can run clones of herself."),
    lane("rusty", "Rusty + dock", "Sonnet · Opus med", "Rusty and his dock crew (Dusty, Gusty, Musty): builds, ideas and harder fixes, up to four jobs at once."),
    lane("rocky", "Rocky", "Opus high", "The master builder, held for big-picture and design-heavy work. One job at a time."),
    {
      id: "checks",
      label: "Checks",
      sub: "GitHub Actions",
      kind: "service",
      ...checks,
      load: data.checks.state === "running" ? 0.9 : data.checks.state === "unknown" ? 0 : 0.4,
      what: "Types, lint, unit tests and the build. Every branch runs them before it can merge; a red run on main opens a fix.",
      source: data.checks.at ? `The latest run on main, ${ago(data.checks.at, now)}.` : "No run on main read yet.",
      url: data.checks.url ?? undefined,
    },
    {
      id: "main",
      label: "main",
      sub: "GitHub",
      kind: "store",
      ...(connected && commit
        ? {
            state: "ok" as LinkState,
            status: `${commit.sha} · ${ago(commit.at, now)}`,
          }
        : {
            state: "off" as LinkState,
            status: connected ? "No commit read" : "Not reached",
          }),
      load: commit ? Math.max(0.1, 1 - (now - commit.at) / 86_400_000) : 0,
      what: "The branch the live site is built from. Lane work merges here by pull request once its checks pass.",
      source: commit ? `Latest commit: “${commit.title}”.` : "No commit on main read yet.",
      url: commit?.url,
    },
    {
      id: "deploy",
      label: "Deploy",
      sub: "Azure",
      kind: "service",
      ...(connected && commit
        ? { state: "ok" as LinkState, status: `Pushed ${ago(commit.at, now)}` }
        : {
            state: "off" as LinkState,
            status: connected ? "Not measurable" : "Not reached",
          }),
      load: commit ? 0.4 : 0,
      what: "Deploy to Azure ships the live site from every push to main, usually within three to four minutes.",
      source: "Not measured directly: the Desk can't read the Azure deploys, so this is the time of the latest commit on main.",
    },
    {
      id: "blob",
      label: "Pictures",
      sub: "Azure Blob",
      kind: "store",
      ...blob,
      load: set?.images ? 0.25 : 0,
      what: "Where pictures you paste, attach or drop on an idea are kept, privately, and served back through api/foundry-image.",
      source:
        set && !set.images
          ? "api/foundry says no blob store is connected (the Azure template sets one up: docs/AZURE.md)."
          : "Whether the blob store is connected, from api/foundry.",
    },
  ];

  const at = (id: GraphNodeId) => nodes.find((n) => n.id === id)!;
  const laneEdge = (id: "rivet" | "rusty" | "rocky"): LinkState => (connected ? (at(id).state === "down" ? "slow" : at(id).state) : "off");
  const edges: GraphEdge[] = [
    {
      from: "nikita",
      to: "desk",
      state: "ok",
      label: "Ideas and picks",
      what: "You speak or type an idea, or tap Build, Revise or Not this one on a card.",
    },
    {
      from: "desk",
      to: "shaping",
      state: asked ? "ok" : "off",
      label: "POST /api/foundry",
      what: asked ? "The Desk sends the idea to the Foundry function, which shapes it when Claude is set up." : "api/foundry hasn't answered, so the Desk can't send ideas yet.",
    },
    {
      from: "shaping",
      to: "issues",
      state: set ? (set.direct ? "ok" : "off") : "off",
      label: "Opens the issue",
      what: set
        ? set.direct
          ? "The function opens the issue on GitHub straight away, shaped or not."
          : "No GitHub write token in the Key Vault, so the function can't open issues."
        : "Waiting on api/foundry.",
    },
    {
      from: "issues",
      to: "queue",
      state: connected ? "ok" : "off",
      label: "Labelled foundry",
      what: "Each check reads the open foundry issues: approved builds, ideas to shape, red checks to fix.",
    },
    {
      from: "queue",
      to: "builder",
      state: connected ? "ok" : "off",
      label: "Hands over jobs",
      what: "The check wakes the Builder with what's ready to start.",
    },
    {
      from: "builder",
      to: "rivet",
      state: laneEdge("rivet"),
      label: "Rung-one fixes, upkeep",
      what: "Simple fixes go to Rivet on Haiku, and each upkeep tick to Rivet on Sonnet, outside the cap of four.",
    },
    {
      from: "builder",
      to: "rusty",
      state: laneEdge("rusty"),
      label: "Builds, ideas",
      what: "Most work goes to Rusty on Sonnet, or Opus at medium when it needs taste; harder fixes too.",
    },
    {
      from: "builder",
      to: "rocky",
      state: laneEdge("rocky"),
      label: "Big-picture builds",
      what: "Large or design-heavy work goes to Rocky on Opus at high effort.",
    },
    {
      from: "rivet",
      to: "checks",
      state: laneEdge("rivet"),
      label: "Branch + pull request",
      what: "Each job is pushed on its own lane branch, and the checks run on it.",
    },
    {
      from: "rusty",
      to: "checks",
      state: laneEdge("rusty"),
      label: "Branch + pull request",
      what: "Each job is pushed on its own lane branch, and the checks run on it.",
    },
    {
      from: "rocky",
      to: "checks",
      state: laneEdge("rocky"),
      label: "Branch + pull request",
      what: "Each job is pushed on its own lane branch, and the checks run on it.",
    },
    {
      from: "checks",
      to: "main",
      state: checks.state,
      label: "Merge when green",
      what: cap.waiting
        ? `Green work merges to main. ${cap.waiting} job${cap.waiting === 1 ? " is" : "s are"} waiting for a free hand.`
        : "Small fixes and upkeep merge once green; bigger work waits for your OK.",
    },
    {
      from: "main",
      to: "deploy",
      state: at("main").state,
      label: "Azure deploys main",
      what: "Every push to main runs Deploy to Azure, which builds and ships the live site.",
    },
    {
      from: "desk",
      to: "blob",
      state: blob.state,
      label: "Pictures on ideas",
      what: "Pictures on an idea upload through api/foundry-image into the private blob store.",
    },
  ];
  return { nodes, edges };
}
