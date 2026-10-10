import type { ActionKind, Activity, Agent, Prop, RoomId } from "@ceo/core";
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

const REPOS = ["the-tide", "c.e.o.", "npsite", "tempo", "storyline"];
const CODE_TASKS = [
  "Refactor publication pipeline",
  "Fix flaky e2e test",
  "Add dark mode to the dark mode",
  "Upgrade dependencies (brave)",
  "Rename variable 'thing2'",
  "Write tests for untested tests",
  "Delete dead code, respectfully",
];

export const foundryBuilder: Script = ({ rng }) => {
  const repo = rng.pick(REPOS);
  const title = `${rng.pick(CODE_TASKS)} · ${repo}`;
  const steps: Step[] = [
    { kind: "go", station: "intake" },
    work(1600, "working"),
    { kind: "set", activity: "carrying", prop: "crate" },
    { kind: "task", title },
    { kind: "go", station: "assembler" },
    ...grind(rng, rng.int(5000, 9000), "working", ["Assembling diff", "Reading the codebase (all of it)", "Arguing with the linter"]),
    { kind: "quip", chance: 0.35 },
    { kind: "go", station: "furnace" },
    work(rng.int(2500, 4000), "working"),
    { kind: "finish", failRate: 0.22 },
  ];
  if (rng.chance(0.35)) {
    steps.push(
      { kind: "go", station: "shipping" },
      { kind: "approval", action: "code.merge", summary: `Merge PR into ${repo}`, detail: title, target: repo, risk: "low" },
    );
  } else {
    steps.push({ kind: "go", station: "shipping" });
  }
  steps.push({ kind: "do", activity: "working", ms: 1200, prop: null }, { kind: "go", station: rng.pick(["bench-a", "bench-b"]) });
  steps.push(work(rng.int(2000, 5000), "typing"));
  return steps;
};

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

const MARKETS = [
  { ticker: "RAIN-NYC-SAT", q: "Will it rain in NYC on Saturday?" },
  { ticker: "FED-CUT-DEC", q: "Fed cuts rates in December?" },
  { ticker: "BOXOFFICE-WKND", q: "Weekend box office over $90M?" },
  { ticker: "SNOW-DEN-NOV", q: "Denver snow before Nov 15?" },
];

export const exchangeQuant: Script = ({ rng }) => {
  const m = rng.pick(MARKETS);
  const steps: Step[] = [
    { kind: "go", station: "terminal" },
    { kind: "task", title: `Research ${m.ticker}` },
    ...grind(rng, rng.int(6000, 9000), "typing", ["Reading 40 forecasts", "Model says 63%", "Market says 51%"]),
    { kind: "go", station: rng.pick(["desk-n", "desk-e", "desk-w"]) },
    work(rng.int(2500, 4000), "working"),
    { kind: "finish", failRate: 0.1 },
    { kind: "quip", chance: 0.4 },
  ];
  if (rng.chance(0.55)) {
    const amount = rng.int(2, 25);
    steps.push(
      { kind: "set", activity: "carrying", prop: "coin" },
      { kind: "go", station: "vault" },
      {
        kind: "approval",
        action: "trade.place",
        summary: `Buy YES on ${m.ticker} · $${amount}`,
        detail: m.q,
        amountUsd: amount,
        target: m.ticker,
        risk: amount > 15 ? "high" : "medium",
      },
      { kind: "do", activity: "waiting", ms: 2500, prop: null },
    );
  }
  return steps;
};

const PLAYERS = ["a backup RB with vibes", "a WR coming off a bye", "the kicker everyone forgot", "a TE named after a weather event"];

export const greenCoach: Script = ({ rng }) => {
  const player = rng.pick(PLAYERS);
  const steps: Step[] = [
    { kind: "go", station: "depth-chart" },
    { kind: "task", title: "Review projections & injury report" },
    ...grind(rng, rng.int(5000, 8000), "working", ["Pulled league rosters", "Projections loaded", "Injury report: 'questionable'"]),
    { kind: "finish", failRate: 0.05 },
    { kind: "quip", chance: 0.35 },
  ];
  if (rng.chance(0.5)) {
    steps.push(
      { kind: "set", activity: "carrying", prop: "envelope" },
      { kind: "go", station: "mailbox" },
      { kind: "approval", action: "waiver.claim", summary: `Claim ${player}`, detail: "FAAB bid: $3. Drop: whoever's sad.", risk: "low" },
      { kind: "do", activity: "working", ms: 1500, prop: null },
    );
  } else {
    steps.push(
      { kind: "go", station: "sideline" },
      { kind: "approval", action: "lineup.set", summary: "Swap FLEX for this week", detail: `Start ${player}. Sleeper's API is read-only, so you tap it in.`, risk: "low" },
    );
  }
  return steps;
};

export const greenPlayer: Script = ({ rng }) => [
  { kind: "go", station: "huddle" },
  { kind: "do", activity: "carrying", ms: 1200, prop: "ball" },
  { kind: "go", station: "sideline" },
  { kind: "do", activity: "celebrating", ms: 1800 },
  { kind: "quip", chance: 0.3 },
  { kind: "go", station: rng.pick(["huddle", "bench"]) },
  { kind: "do", activity: "idle", ms: rng.int(2000, 4000), prop: null },
];

const CONTACTS = ["Mom", "Group chat (8)", "Landlord", "Best friend", "Unknown number"];

export const relayClerk: Script = ({ rng }) => {
  const who = rng.pick(CONTACTS);
  return [
    { kind: "go", station: "tubes" },
    work(1500, "working"),
    { kind: "set", activity: "carrying", prop: "envelope" },
    { kind: "task", title: `Draft reply to ${who}` },
    { kind: "go", station: "draft-desk" },
    ...grind(rng, rng.int(4000, 7000), "typing", ["Reading the thread", "Matching your tone", "Deleting 'per my last text'"]),
    { kind: "finish", failRate: 0.04 },
    { kind: "go", station: "outbox" },
    {
      kind: "approval",
      action: "message.send",
      summary: `Reply to ${who}`,
      detail: rng.pick(["“Sounds good! See you at 7.”", "“Haha yes. Also no.”", "“On my way (I am not on my way).”"]),
      target: who,
      risk: who === "Unknown number" ? "medium" : "low",
    },
    { kind: "do", activity: "waiting", ms: 2000, prop: null },
    { kind: "quip", chance: 0.3 },
  ];
};

export const relaySwitchboard: Script = ({ rng }) => [
  { kind: "go", station: "switchboard" },
  { kind: "do", activity: "typing", ms: rng.int(4000, 7000) },
  { kind: "quip", chance: 0.25 },
  { kind: "go", station: "tubes" },
  { kind: "do", activity: "working", ms: 2000 },
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

/** Kevin is always on break. Kevin is thriving. */
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
];

/** Any agent, any time: a quick trip to the Break Room. */
export const coffeeBreak: Script = ({ rng }) => [
  { kind: "go", station: "coffee-machine", room: "breakroom" },
  { kind: "do", activity: "waiting", ms: 2500, prop: "mug" },
  { kind: "quip", chance: 0.6 },
  rng.chance(0.4)
    ? { kind: "do", activity: "napping", ms: 5000, prop: null }
    : { kind: "do", activity: "idle", ms: 2500, prop: null },
  { kind: "set", activity: "idle", prop: null },
];

export const SCRIPTS = {
  foundryBuilder,
  spireOperator,
  exchangeQuant,
  greenCoach,
  greenPlayer,
  relayClerk,
  relaySwitchboard,
  archiveScribe,
  archiveDiceRoller,
  breakroomRegular,
} as const;
export type ScriptId = keyof typeof SCRIPTS;
