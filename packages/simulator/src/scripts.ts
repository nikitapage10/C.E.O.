import type { ActionKind, Activity, Agent, Prop, RoomId } from "@ceo/core";
import { isSubmind } from "./agents.ts";
import type { Rng } from "./rng.ts";

/** One beat of an agent's routine. Timed steps (go, do, wait) take Lattice time; the rest are instant. */
export type Step =
  | { kind: "go"; station: string; room?: RoomId }
  | { kind: "do"; activity: Activity; ms: number; prop?: Prop | null }
  | { kind: "set"; activity: Activity; prop?: Prop | null }
  | { kind: "wait"; ms: number }
  | { kind: "quip"; text?: string; chance?: number }
  | { kind: "task"; title: string }
  | { kind: "progress"; progress: number; note?: string }
  | { kind: "finish"; failRate?: number }
  /** Walk over to someone in the home room, whoever is busiest (a submind's check-in). Instant if nobody's there. */
  | { kind: "checkin" }
  | {
      kind: "approval";
      action: ActionKind;
      summary: string;
      detail?: string;
      amountUsd?: number;
      target?: string;
      risk: "low" | "medium" | "high";
    };

export interface ScriptContext {
  rng: Rng;
  agent: Agent;
}

export type Script = (ctx: ScriptContext) => Step[];

const work = (ms: number, activity: Activity = "working", prop?: Prop | null): Step => ({ kind: "do", activity, ms, prop });

/** Break up a task into a few progress beats while the agent does `activity`. */
function grind(rng: Rng, totalMs: number, activity: Activity = "typing", notes: string[] = []): Step[] {
  const beats = rng.int(2, 4);
  const steps: Step[] = [];
  for (let i = 1; i <= beats; i++) {
    steps.push(work(totalMs / beats, activity));
    steps.push({ kind: "progress", progress: Math.min(0.95, i / (beats + 1)), note: notes.length ? rng.pick(notes) : undefined });
  }
  return steps;
}

/**
 * The Foundry is real now: its crates are GitHub issues worked by the Foundry thread in Claude Code (see
 * docs/FOUNDRY.md). The demo builder is retired; the world switches each crew member between these
 * routines to match what their real crate is doing, and the tasks themselves come from GitHub, not from here.
 */
export const foundryIdle: Script = ({ rng, agent }) => [
  { kind: "go", station: rng.pick(["bench-a", "bench-b", "intake"]) },
  { kind: "do", activity: rng.pick(["idle", "staring", "idle"]), ms: rng.int(5000, 9000), prop: null },
  { kind: "quip", chance: 0.2 },
  { kind: "go", station: rng.pick(["bench-a", "bench-b"]) },
  // Rocky dozes off between jobs (Eridian custom); the others rarely do. (Rusty idles here; Rocky has his drafting table, Rivet her post.)
  { kind: "do", activity: agent.id === "caret" ? rng.pick(["idle", "napping"]) : rng.pick(["idle", "idle", "idle", "napping"]), ms: rng.int(4000, 8000) },
];

/** A real fix or build in hand: crate from intake, through the arm, into the furnace, and round again. */
export const foundryFixing: Script = ({ rng }) => [
  { kind: "go", station: "intake" },
  { kind: "set", activity: "carrying", prop: "crate" },
  { kind: "go", station: "assembler" },
  work(rng.int(7000, 11000), "working"),
  { kind: "quip", chance: 0.25 },
  { kind: "go", station: "furnace" },
  work(rng.int(3000, 5000), "working"),
  { kind: "go", station: "assembler" },
  work(rng.int(5000, 8000), "working"),
];

/** Done and checked: waiting at the dock for the C.E.O.'s OK. */
export const foundryReady: Script = ({ rng }) => [
  { kind: "go", station: "shipping" },
  { kind: "do", activity: "waiting", ms: rng.int(8000, 12000), prop: "crate" },
  { kind: "quip", chance: 0.2 },
];

/** Every rung tried and the furnace still red: slumped by it until the C.E.O. looks. */
export const foundryStuck: Script = ({ rng }) => [
  { kind: "go", station: "furnace" },
  { kind: "do", activity: "slumped", ms: rng.int(6000, 10000), prop: null },
  { kind: "do", activity: "staring", ms: rng.int(3000, 5000) },
];

/** Upkeep: slow, careful work at the bench. */
export const foundryUpkeep: Script = ({ rng }) => [
  { kind: "go", station: "bench-a" },
  work(rng.int(8000, 12000), "typing"),
  { kind: "quip", chance: 0.15 },
  { kind: "go", station: "furnace" },
  work(rng.int(2500, 4000), "working"),
];

/**
 * Rivet between fixes: keeping watch from the alarm post, beside the lamp that shows the checks on main. Coffee,
 * a look at the lamp, a look at the furnace.
 */
export const foundryWatch: Script = ({ rng }) => [
  { kind: "go", station: "watch" },
  { kind: "do", activity: rng.pick(["idle", "waiting", "idle"]), ms: rng.int(6000, 10000), prop: rng.chance(0.4) ? "mug" : null },
  { kind: "do", activity: "staring", ms: rng.int(3000, 5000), prop: null },
  { kind: "quip", chance: 0.15 },
];

/** The checks are running: Rivet leans in at the post and doesn't take her eyes off the lamp. */
export const foundryWatchClose: Script = ({ rng }) => [
  { kind: "go", station: "watch" },
  { kind: "do", activity: "working", ms: rng.int(6000, 9000), prop: null },
  { kind: "do", activity: "staring", ms: rng.int(2500, 4000) },
  { kind: "quip", chance: 0.1 },
];

/** Rivet hands a job up to Rocky: picks the crate up at the intake and carries it over to his table. */
export const foundryHandUp: Script = ({ rng }) => [
  { kind: "go", station: "intake" },
  { kind: "set", activity: "carrying", prop: "crate" },
  { kind: "go", station: "handoff" },
  { kind: "do", activity: "waiting", ms: rng.int(3500, 4500), prop: "crate" },
  { kind: "set", activity: "idle", prop: null },
  { kind: "quip", chance: 0.5 },
  { kind: "go", station: "watch" },
  { kind: "do", activity: "idle", ms: rng.int(6000, 9000) },
];

/**
 * Rocky between jobs: at the drafting table over the plan of the biggest idea coming, tracing it by touch, and now
 * and then dozing off over it (Eridian custom; Rivet keeps the watch).
 */
export const foundryDrafting: Script = ({ rng }) => [
  { kind: "go", station: "drafting" },
  { kind: "do", activity: "working", ms: rng.int(7000, 11000), prop: null },
  { kind: "do", activity: rng.pick(["staring", "idle"]), ms: rng.int(3000, 5000) },
  { kind: "quip", chance: 0.15 },
  { kind: "do", activity: rng.pick(["working", "working", "napping"]), ms: rng.int(5000, 9000) },
];

/**
 * A job in Rocky's hands: he takes the crate at the drafting table (where it's handed up to him), builds it at the
 * arm, tests it in the furnace, and goes back to the plan between passes.
 */
export const foundryBuilding: Script = ({ rng }) => [
  { kind: "go", station: "drafting" },
  { kind: "do", activity: "working", ms: rng.int(1500, 2500), prop: null },
  { kind: "set", activity: "carrying", prop: "crate" },
  { kind: "go", station: "assembler" },
  work(rng.int(7000, 11000), "working"),
  { kind: "quip", chance: 0.25 },
  { kind: "go", station: "furnace" },
  work(rng.int(3000, 5000), "working"),
  { kind: "go", station: "assembler" },
  work(rng.int(5000, 8000), "working"),
];

/** Ideas are up on the board: pinning, re-pinning, standing back to look. */
export const foundryIdeas: Script = ({ rng }) => [
  { kind: "go", station: "bench-b" },
  { kind: "do", activity: "working", ms: rng.int(5000, 8000), prop: "chart" },
  { kind: "do", activity: "staring", ms: rng.int(3000, 5000), prop: null },
  { kind: "quip", chance: 0.2 },
];

const BIZ_TASKS = [
  "Reconcile store orders",
  "Answer customer emails",
  "Draft weekly newsletter",
  "Update product listings",
  "Chase an unpaid invoice (politely)",
  "Compare shipping rates",
];

export const spireOperator: Script = ({ rng }) => {
  const desk = rng.pick(["desk-1", "desk-2", "desk-3"]);
  const title = rng.pick(BIZ_TASKS);
  const steps: Step[] = [
    { kind: "go", station: desk },
    { kind: "task", title },
    ...grind(rng, rng.int(6000, 11000), "typing", ["Inbox: 3 → 47", "Spreadsheet achieved", "Found the typo"]),
    { kind: "quip", chance: 0.4 },
    { kind: "go", station: "whiteboard" },
    { kind: "do", activity: "working", ms: 2500, prop: "chart" },
    { kind: "finish", failRate: 0.08 },
    { kind: "set", activity: "idle", prop: null },
  ];
  if (title === "Answer customer emails" || rng.chance(0.25)) {
    steps.push({
      kind: "approval",
      action: "email.send",
      summary: "Send 4 customer replies",
      detail: "Drafted in your voice, minus the third exclamation point.",
      risk: "low",
    });
  }
  if (rng.chance(0.35)) {
    steps.push({ kind: "go", station: "coffee" }, { kind: "do", activity: "working", ms: 2200, prop: "mug" }, { kind: "quip", chance: 0.6 });
  }
  steps.push({ kind: "go", station: "meeting" }, work(rng.int(3000, 5000), "idle"), { kind: "set", activity: "idle", prop: null });
  return steps;
};

/**
 * The Exchange is live (#240, #253): the ring and the odds board read Polymarket, and the C.E.O.'s positions sit on the
 * marquee behind the passkey. The demo's research tasks and pretend trades are gone (LIVE_ROOMS); Noco and Hedge
 * watch the real board from the terminal and the desks, and argue about it.
 */
export const exchangeQuant: Script = ({ rng }) => [
  { kind: "go", station: rng.pick(["terminal", "desk-n", "desk-e", "desk-w"]) },
  { kind: "do", activity: rng.pick(["staring", "idle", "staring"]), ms: rng.int(5000, 9000), prop: null },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: rng.pick(["desk-n", "desk-e", "desk-w", "terminal"]) },
  { kind: "do", activity: rng.pick(["idle", "staring", "waiting"]), ms: rng.int(4000, 7000), prop: rng.chance(0.3) ? "mug" : null },
  { kind: "set", activity: "idle", prop: null },
];

/**
 * The Green is live (#252): the scoreboard and the depth chart read the C.E.O.'s Sleeper league. No demo reviews and
 * no pretend waiver claims (LIVE_ROOMS): Gridiron studies the real chart, paces the sideline and gives the speech.
 */
export const greenCoach: Script = ({ rng }) => [
  { kind: "go", station: "depth-chart" },
  { kind: "do", activity: rng.pick(["staring", "idle"]), ms: rng.int(5000, 8000), prop: null },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: rng.pick(["sideline", "huddle", "sideline"]) },
  { kind: "do", activity: rng.pick(["idle", "staring", "celebrating"]), ms: rng.int(3000, 6000) },
  { kind: "set", activity: "idle", prop: null },
];

export const greenPlayer: Script = ({ rng }) => [
  { kind: "go", station: "huddle" },
  { kind: "do", activity: "carrying", ms: 1200, prop: "ball" },
  { kind: "go", station: "sideline" },
  { kind: "do", activity: "celebrating", ms: 1800 },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: rng.pick(["huddle", "bench"]) },
  { kind: "do", activity: "idle", ms: rng.int(2000, 4000), prop: null },
];

/**
 * The Relay is off the demo: its practice post has stopped, and its real line is live (email since 2026-10-23, #322;
 * texts still wait on the Mac). Blasto and Dialtone keep their rounds, with no tasks and no approvals: the inbox's
 * real work shows on the room's board and tubes, from the email agent's public counts.
 */
export const relayClerk: Script = ({ rng }) => [
  { kind: "go", station: rng.pick(["tubes", "draft-desk", "outbox"]) },
  { kind: "do", activity: rng.pick(["idle", "staring"]), ms: rng.int(4000, 8000), prop: null },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: "switchboard" },
  { kind: "do", activity: "idle", ms: rng.int(3000, 6000) },
];

export const relaySwitchboard: Script = ({ rng }) => [
  { kind: "go", station: "switchboard" },
  { kind: "do", activity: rng.pick(["idle", "staring", "napping"]), ms: rng.int(4000, 8000) },
  { kind: "quip", chance: 0.25 },
  { kind: "go", station: rng.pick(["tubes", "outbox"]) },
  { kind: "do", activity: "idle", ms: rng.int(2000, 4000) },
];

const LORE_TASKS = [
  "Draft Syntherion origin notes",
  "Index Teruānga factions",
  "Prep session 2 encounter table",
  "Cross-check the timeline (again)",
  "Write a relic description",
];

export const archiveScribe: Script = ({ rng }) => {
  const title = rng.pick(LORE_TASKS);
  const steps: Step[] = [
    { kind: "go", station: "shelves" },
    { kind: "do", activity: "working", ms: 2000, prop: "book" },
    { kind: "task", title },
    { kind: "go", station: "loom" },
    ...grind(rng, rng.int(6000, 10000), "working", ["Weaving lore", "Checking canon", "Footnoting a footnote"]),
    { kind: "finish", failRate: 0.06 },
    { kind: "set", activity: "idle", prop: null },
  ];
  if (rng.chance(0.3)) {
    steps.push({
      kind: "approval",
      action: "lore.publish",
      summary: "Publish lore bundle to The Tide",
      detail: "tide.publication.v1 · goes through the Tide's own preview first",
      risk: "low",
    });
  }
  if (rng.chance(0.25)) steps.push({ kind: "go", station: "shrine" }, { kind: "do", activity: "staring", ms: 2500 }, { kind: "quip", text: "Our first Cease & Desist. They grow up so fast." });
  return steps;
};

const RESEARCH_TASKS = [
  "Test whether the relic's glow is plausible",
  "Peer-review the encounter tables",
  "Fact-check the calendar of the Teruānga tides",
  "Recalibrate the resonance lens",
  "Measure the loom's tension (again)",
  "Footnote the footnotes' sources",
];

/** Heimerdinger: experiments at his workbench, fetches a book, and now and then lectures the dice table on patience. */
export const archiveResearcher: Script = ({ rng }) => {
  const steps: Step[] = [
    { kind: "go", station: "lab" },
    { kind: "task", title: rng.pick(RESEARCH_TASKS) },
    ...grind(rng, rng.int(7000, 11000), rng.chance(0.5) ? "working" : "typing", ["Calibrating", "Taking meticulous notes", "Double-checking the double-check", "Hm, hm"]),
    { kind: "finish", failRate: 0.12 },
    { kind: "quip", chance: 0.4 },
    { kind: "set", activity: "idle", prop: null },
  ];
  if (rng.chance(0.35)) steps.push({ kind: "go", station: "shelves" }, { kind: "do", activity: "working", ms: 2200, prop: "book" }, { kind: "go", station: "lab" }, { kind: "do", activity: "idle", ms: 2500, prop: "book" }, { kind: "set", activity: "idle", prop: null });
  if (rng.chance(0.2)) steps.push({ kind: "go", station: "seat-w" }, { kind: "do", activity: "waiting", ms: 3000 }, { kind: "quip", text: "A natural twenty is not a method, my dear colleague." });
  return steps;
};

export const archiveDiceRoller: Script = ({ rng }) => [
  { kind: "go", station: "dice-table" },
  { kind: "task", title: "Roll for initiative (simulate a session)" },
  { kind: "do", activity: "working", ms: rng.int(3000, 5000) },
  { kind: "finish", failRate: 0.3 },
  { kind: "quip", chance: 0.4 },
  { kind: "go", station: "reading" },
  { kind: "do", activity: "idle", ms: rng.int(3000, 6000), prop: "book" },
  { kind: "set", activity: "idle", prop: null },
];

/**
 * Drop keeps the Boiler Room running and its door shut: plugs into the pipe wall to read the gauges, checks the
 * bucket, sweeps the room with its dome on a security pass, resets the incident sign, and now and then charges by
 * the boiler. No tasks and no approvals: the pipes report the real lines, and Drop only tends them.
 */
export const boilerKeeper: Script = ({ rng }) => [
  { kind: "go", station: "pipes" },
  { kind: "do", activity: "working", ms: rng.int(3000, 6000) },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: "bucket" },
  { kind: "do", activity: "working", ms: rng.int(2500, 4500), prop: null },
  // The security pass: a full sweep of the room from the middle of it.
  ...(rng.chance(0.5) ? [{ kind: "do", activity: "staring", ms: rng.int(3500, 6000) } as const] : []),
  { kind: "go", station: rng.pick(["sign", "boiler", "bench"]) },
  { kind: "do", activity: rng.pick(["staring", "working", "idle"]), ms: rng.int(3000, 6000) },
  { kind: "quip", chance: 0.25 },
  ...(rng.chance(0.2) ? [{ kind: "go", station: "boiler" } as const, { kind: "do", activity: "napping", ms: rng.int(6000, 10000) } as const] : []),
];

/**
 * Clause keeps the rules: writes up every pipe in the ledger at the lectern, walks over (stiffly) to inspect a gauge
 * or the incident sign, frets about the kettle, and comes back to file it. Also no tasks and no approvals.
 */
export const boilerCompliance: Script = ({ rng }) => [
  { kind: "go", station: "lectern" },
  { kind: "do", activity: "typing", ms: rng.int(4000, 7000) },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: rng.pick(["pipes", "sign", "bench", "bucket"]) },
  { kind: "do", activity: rng.pick(["staring", "idle", "waiting"]), ms: rng.int(3000, 5500) },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: "lectern" },
  { kind: "do", activity: rng.pick(["typing", "idle"]), ms: rng.int(3000, 5000) },
  ...(rng.chance(0.15) ? [{ kind: "do", activity: "napping", ms: rng.int(5000, 8000) } as const] : []),
];

/**
 * Daub keeps the Workshop's first step: a new idea becomes a picture. Sketches at the easel, takes the finished
 * canvas over to the mould for Chisel, and now and then checks a past figure on the shelves for reference.
 */
export const workshopPainter: Script = ({ rng }) => [
  { kind: "go", station: "easel" },
  { kind: "task", title: rng.pick(["Sketch a new figure", "Paint a costume study", "Colour the turnaround sheet", "Rough out a new pet"]) },
  ...grind(rng, rng.int(9000, 14000), "working", ["Blocking in the shape", "Second wash", "Fixing the hands", "Signed it"]),
  { kind: "quip", chance: 0.3 },
  { kind: "finish", failRate: 0.05 },
  { kind: "set", activity: "carrying", prop: "chart" },
  { kind: "go", station: "mould" },
  { kind: "do", activity: "idle", ms: rng.int(2000, 3500), prop: null },
  { kind: "go", station: rng.pick(["shelves", "bench", "easel"]) },
  { kind: "do", activity: rng.pick(["staring", "working", "idle"]), ms: rng.int(3000, 6000) },
  { kind: "quip", chance: 0.2 },
];

/**
 * Chisel runs the rest of the line: forms the figure in the mould, fits its frame on the turntable, walks it on
 * the rehearsal stage, and packs it in the crate by the exit, ready to join the Lattice.
 */
export const workshopSculptor: Script = ({ rng }) => [
  { kind: "go", station: "mould" },
  { kind: "task", title: rng.pick(["Form a new figure", "Mould a costume", "Recast a maquette", "Form a pet"]) },
  ...grind(rng, rng.int(8000, 12000), "working", ["Points gathering", "Wireframe holding", "Solid", "Lifted out"]),
  { kind: "quip", chance: 0.25 },
  { kind: "set", activity: "carrying", prop: "cube" },
  { kind: "go", station: "fitting" },
  work(rng.int(5000, 8000), "working", null),
  { kind: "progress", progress: 0.97, note: "Frame fitted" },
  { kind: "go", station: "stage" },
  { kind: "do", activity: "staring", ms: rng.int(4000, 7000) },
  { kind: "finish", failRate: 0.08 },
  { kind: "quip", chance: 0.3 },
  ...(rng.chance(0.5)
    ? [{ kind: "set", activity: "carrying", prop: "crate" } as const, { kind: "go", station: "crate" } as const, { kind: "do", activity: "working", ms: rng.int(2000, 3500), prop: null } as const]
    : [{ kind: "go", station: "bench" } as const, { kind: "do", activity: "working", ms: rng.int(3000, 5000) } as const]),
];

/**
 * The Studio (#311): short tall videos that teach how the internet works through apps everyone uses. Folio writes the
 * script at the writing desk (the hook, the analogy, how it works, how it's built), then pins the shots to the
 * storyboard wall. Simulated until the Studio's line is real: the made-up tasks here are the room's demo.
 */
export const studioWriter: Script = ({ rng }) => [
  { kind: "go", station: "script" },
  { kind: "task", title: rng.pick(["Write a 45-second script", "Find the analogy", "Sharpen the hook", "Cut the script to 50 seconds"]) },
  ...grind(rng, rng.int(9000, 14000), "typing", ["The hook", "The analogy", "How it works", "How it's built", "Cut a footnote"]),
  { kind: "quip", chance: 0.3 },
  { kind: "set", activity: "carrying", prop: "book" },
  { kind: "go", station: "storyboard" },
  work(rng.int(4000, 7000), "working", null),
  { kind: "progress", progress: 0.96, note: "Shots pinned" },
  { kind: "finish", failRate: 0.05 },
  { kind: "quip", chance: 0.2 },
];

/** Dot hosts: on its mark in front of the green screen, take after take, then off to watch the cut. */
export const studioHost: Script = ({ rng }) => [
  { kind: "go", station: "set" },
  { kind: "task", title: rng.pick(["Film the hook", "Film the analogy", "Film the sign-off", "One more take"]) },
  ...grind(rng, rng.int(8000, 12000), "working", ["Take one", "Take two", "Take seven", "Cut! Again", "That's the one"]),
  { kind: "quip", chance: 0.35 },
  { kind: "finish", failRate: 0.04 },
  { kind: "go", station: rng.pick(["storyboard", "edit", "set"]) },
  { kind: "do", activity: rng.pick(["staring", "idle", "celebrating"]), ms: rng.int(3000, 5500) },
  { kind: "quip", chance: 0.2 },
];

/** Arc runs the camera for the take, cuts it at the edit desk, and renders the short, tall, at the rack. */
export const studioEditor: Script = ({ rng }) => [
  { kind: "go", station: "camera" },
  { kind: "do", activity: "working", ms: rng.int(5000, 8000), prop: null },
  { kind: "quip", chance: 0.2 },
  { kind: "go", station: "edit" },
  { kind: "task", title: rng.pick(["Cut the takes together", "Lay the captions", "Cut to the beat", "Trim to 45 seconds"]) },
  ...grind(rng, rng.int(8000, 12000), "typing", ["Rough cut", "Captions on the word", "On the beat", "Picture lock"]),
  { kind: "go", station: "render" },
  work(rng.int(4000, 6000), "working"),
  { kind: "progress", progress: 0.97, note: "Rendered, 9:16" },
  { kind: "finish", failRate: 0.06 },
  { kind: "quip", chance: 0.25 },
];

/**
 * A Skippy submind conducts its room from its command podium floating high in the back-right corner (the can-throne): sits there
 * looking the room over, directs whoever is working (the world turns it toward them and gives it the baton, see
 * SubmindDirector), passes remarks, and once in a few minutes swoops down to check on someone up close before going
 * back to the podium. It floats out over the middle of the room to give an order when work starts there
 * (Simulator.command). Never naps: subminds
 * don't, like the mind they came from. ("waiting" is the conducting pose on the admiral can.)
 */
export const submindConduct: Script = ({ rng }) => {
  const steps: Step[] = [
    { kind: "go", station: "post" },
    { kind: "do", activity: "waiting", ms: rng.int(6000, 10000), prop: null },
    { kind: "quip", chance: 0.2 },
    { kind: "do", activity: rng.pick(["idle", "staring"]), ms: rng.int(4000, 7000) },
    { kind: "do", activity: "waiting", ms: rng.int(5000, 8000) },
  ];
  if (rng.chance(0.08)) {
    steps.push({ kind: "checkin" }, { kind: "do", activity: "staring", ms: rng.int(3500, 5500) }, { kind: "quip", chance: 0.6 }, { kind: "go", station: "post" });
  }
  return steps;
};

/** Kevin is always on break. Kevin is thriving. Sometimes he takes it on the warm side of the boiler. */
export const breakroomRegular: Script = ({ rng }) => [
  { kind: "go", station: "couch" },
  { kind: "do", activity: "idle", ms: rng.int(4000, 8000) },
  { kind: "go", station: "coffee-machine" },
  { kind: "do", activity: "waiting", ms: 3000, prop: null },
  { kind: "quip", text: rng.pick(["Coffee machine, please.", "It said 'no' in binary.", "It's sentient. Just unmotivated. Relatable."]) },
  { kind: "go", station: "server-rack" },
  { kind: "do", activity: "napping", ms: rng.int(9000, 15000) },
  { kind: "go", station: "ping-pong" },
  { kind: "do", activity: "celebrating", ms: 2000 },
  { kind: "go", station: "window" },
  { kind: "do", activity: "staring", ms: 4000 },
  { kind: "quip", chance: 0.5 },
  ...(rng.chance(0.2)
    ? [
        { kind: "go", station: "warm-side", room: "boiler" } as const,
        { kind: "do", activity: "napping", ms: rng.int(12000, 20000) } as const,
        { kind: "quip", text: "Spiritual maintenance." } as const,
      ]
    : []),
];

/** Breaks taken without leaving the room (Nikita: agents stay in their own rooms about three quarters of the time). */
export const STAY_ON_BREAK = 0.75;

/** Any agent, any time: a breather. Usually at their own spot with a mug; now and then a trip to the Break Room. */
export const coffeeBreak: Script = ({ rng, agent }) => {
  // Subminds never nap (Skippy doesn't either); everyone else might.
  const sleeps = !isSubmind(agent.id) && rng.chance(0.4);
  if (rng.chance(STAY_ON_BREAK)) {
    return [
      { kind: "go", station: agent.home.station, room: agent.home.room },
      { kind: "do", activity: "waiting", ms: 2500, prop: "mug" },
      { kind: "quip", chance: 0.4 },
      { kind: "do", activity: rng.pick(["idle", "staring"]), ms: 3000, prop: null },
      { kind: "set", activity: "idle", prop: null },
    ];
  }
  return [
    { kind: "go", station: "coffee-machine", room: "breakroom" },
    { kind: "do", activity: "waiting", ms: 2500, prop: "mug" },
    { kind: "quip", chance: 0.6 },
    sleeps ? { kind: "do", activity: "napping", ms: 5000, prop: null } : { kind: "do", activity: "idle", ms: 2500, prop: null },
    { kind: "set", activity: "idle", prop: null },
  ];
};

export const SCRIPTS = {
  foundryIdle,
  foundryFixing,
  foundryReady,
  foundryStuck,
  foundryUpkeep,
  foundryIdeas,
  foundryWatch,
  foundryWatchClose,
  foundryHandUp,
  foundryDrafting,
  foundryBuilding,
  submindConduct,
  spireOperator,
  exchangeQuant,
  greenCoach,
  greenPlayer,
  relayClerk,
  relaySwitchboard,
  archiveScribe,
  archiveDiceRoller,
  archiveResearcher,
  breakroomRegular,
  boilerKeeper,
  boilerCompliance,
  workshopPainter,
  workshopSculptor,
  studioWriter,
  studioHost,
  studioEditor,
} as const;
export type ScriptId = keyof typeof SCRIPTS;
