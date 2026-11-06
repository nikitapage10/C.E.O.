import { DOCK_CREW, type ChecksState } from "../../../apps/world/src/foundry.ts";
import type { Lane, Stage } from "./forge.ts";
import type { Progress } from "./progress.ts";

/**
 * The Deep Furnace (#813): the Foundry's stage as a forge shaft. Every job starts at the bottom, in the crucible, and
 * rises up the shaft on its builder's chain as it gets built: hammered on the work deck (Work), through the Pictures
 * ring, up through five cooling coils (the checks: typecheck, lint, tests, build, boot check) and out of the hatch at
 * the top (Ship). Height is progress and heat is how far it has left to go. No three.js and no DOM here, so the scene
 * (web/furnaceScene.ts) and its overlay (web/FurnaceStage.tsx) read the same numbers and this is unit tested.
 */

/** A job's Trail, bottom to top: the four zones of the shaft. */
export const TRAIL = ["Work", "Pictures", "Checks", "Ship"] as const;
export type TrailStep = 0 | 1 | 2 | 3;

/** The five checks every change passes (docs/FOUNDRY.md), one cooling coil each, lowest first. */
export const CHECKS = ["typecheck", "lint", "tests", "build", "boot check"] as const;

/**
 * Where things sit up the shaft, as a share of its height (0 the crucible's mouth, 1 the surface hatch). The scene
 * builds its rings at these heights; the overlay's zone labels hang off them.
 */
export const SHAFT = {
  /** The work deck: where a job is hammered before it has a pull request. */
  work: [0.03, 0.27] as const,
  /** The Pictures ring: a pull request open, its pictures taken. */
  pictures: 0.36,
  /** The five coils, typecheck at the bottom. */
  coils: [0.47, 0.53, 0.59, 0.65, 0.71] as const,
  /** The hatch to the surface. */
  ship: 0.9,
};

/** Each stage's step on the Trail. */
export function trailStep(stage: Stage): TrailStep {
  switch (stage) {
    case "waiting":
    case "paused":
    case "building":
    case "stuck":
      return 0;
    case "pr":
      return 1;
    case "checks":
    case "red":
      return 2;
    case "green":
    case "ready":
      return 3;
  }
}

/** How one coil reads for a job: not reached, running, passed or failed. */
export type CoilState = "wait" | "run" | "pass" | "fail";

/**
 * How the five checks read for a job. GitHub reports a pull request's checks summed up (pass, fail, running), not one
 * by one, so all five coils share it: lit amber while they run, green once they pass, red when one has failed (which
 * one is on the pull request's own checks page). Before a job reaches the coils, they wait.
 */
export function coilState(stage: Stage): CoilState {
  if (stage === "red") return "fail";
  if (stage === "checks") return "run";
  if (stage === "green" || stage === "ready") return "pass";
  return "wait";
}

/** main's own checks as a coil: the hatch's ring at the top shows them. */
export function mainCoil(state: ChecksState): CoilState {
  return state === "pass" ? "pass" : state === "fail" ? "fail" : state === "running" ? "run" : "wait";
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/**
 * How high a job hangs in the shaft (0..1): from its stage, and inside the work deck from its real progress (assigned,
 * then its branch pushed). A job waiting its turn sits in the crucible; a red one drops back below the coils until the
 * fix; one waiting for Nikita's OK is held just under the hatch.
 */
export function heightOf(stage: Stage, progress?: Pick<Progress, "step"> | null): number {
  const [w0, w1] = SHAFT.work;
  switch (stage) {
    case "waiting":
      return 0;
    case "paused":
      return w0;
    case "stuck":
      return lerp(w0, w1, 0.45);
    case "building":
      return progress && progress.step >= 2 ? lerp(w0, w1, 0.85) : lerp(w0, w1, 0.4);
    case "pr":
      return SHAFT.pictures;
    case "checks":
      return (SHAFT.coils[0] + SHAFT.coils[4]) / 2;
    case "red":
      return SHAFT.coils[0] - 0.05;
    case "green":
      return SHAFT.coils[4] + 0.07;
    case "ready":
      return SHAFT.ship - 0.07;
  }
}

/** The forge's heat for a height: 1 white-hot in the crucible, 0 cooled at the surface. */
export const heatOf = (u: number) => Math.max(0, Math.min(1, 1 - u / SHAFT.ship));

/** Rusty's hands, one to a slot: Rusty and his dock crew, in their paint. */
export const SLOT_HANDS = ["Rusty", ...DOCK_CREW.map((d) => d.name)] as const;

/** The paint each hand wears in the furnace. Rusty is the salvage compactor's rust; Rocky his carapace's stone; Rivet her hard hat. */
export const PAINT: Record<string, string> = {
  Rusty: "#d0844a",
  ...Object.fromEntries(DOCK_CREW.map((d) => [d.name, d.colour])),
  Rocky: "#c9b48a",
  Rivet: "#f2c230",
};
export const paintOf = (hand: string) => PAINT[hand] ?? "#d0844a";

/** One of the four slots on the work deck: who stands at it, and the job on its chain (null when free). */
export interface Slot {
  /** 0..3, left to right across the deck. */
  i: number;
  /** Who stands at it: whoever has the job, or the dock crew member asleep in its bay. */
  hand: string;
  lane: Lane | null;
}

export interface Furnace {
  /** The four slots (the crew's cap). */
  slots: Slot[];
  /** Rivet's jobs, outside the four on her own mending hoist; the first hangs on it. */
  rivet: Lane[];
  /** Jobs in hand past the four: waiting their turn, or held. */
  more: Lane[];
}

/**
 * The jobs in flight laid out on the furnace: Rivet's apart, on her own hoist outside the four (her fixes and upkeep
 * never wait for the cap); the rest take the four slots in the order forgeLanes gives (running first). Each of Rusty's
 * hands keeps its own slot (Rusty, Dusty, Gusty, Musty, left to right); Rocky takes the first slot nobody holds. A free
 * slot shows the dock crew member who would wake for it, asleep in the bay.
 */
export function furnaceOf(lanes: readonly Lane[], more: readonly Lane[] = []): Furnace {
  const all = [...lanes, ...more];
  const rivet = all.filter((l) => l.who === "semicolon");
  const rest = all.filter((l) => l.who !== "semicolon");
  const held = rest.slice(0, SLOT_HANDS.length);
  const slots: Slot[] = SLOT_HANDS.map((hand, i) => ({ i, hand, lane: null }));
  const homeless: Lane[] = [];
  for (const l of held) {
    const own = SLOT_HANDS.indexOf(l.hand as (typeof SLOT_HANDS)[number]);
    if (own >= 0 && !slots[own]!.lane) slots[own] = { i: own, hand: l.hand, lane: l };
    else homeless.push(l);
  }
  for (const l of homeless) {
    const free = slots.find((s) => !s.lane);
    if (free) slots[free.i] = { i: free.i, hand: l.hand, lane: l };
  }
  return { slots, rivet, more: rest.slice(SLOT_HANDS.length) };
}

