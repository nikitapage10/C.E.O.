/**
 * One step of the living Lattice (docs/WORLD.md): an hour in Ilyr. Load the world, read the hour's real events, write
 * the hour (one Claude call for the whole Lattice, or the scripted stand-in), apply it, and save the state and its page
 * of history. Idempotent per hour: if the last step is under 55 minutes old, nothing happens and the saved hour comes
 * back, so anyone may trigger it (the hourly GitHub Actions run does) without a secret.
 */

import { addSpend, canSpend, stepCost, WORLD_BUDGET_USD, type StepUsage } from "./budget.js";
import { WORLD_CAST } from "./cast.js";
import { digestEvents, type Feed } from "./digest.js";
import { answerSchema, applyChanges, buildPrompt, keepRecent, readAnswer, type Hour, type Prompt } from "./prompt.js";
import { scriptedHour } from "./scripted.js";
import type { WorldStore } from "./store.js";
import type { HistoryEntry, WorldCast, WorldState } from "./types.js";

/** A step only runs when the last one is at least this old: the hourly cron's slack, and the idempotency rule. */
export const STEP_EVERY_MS = 55 * 60_000;
/** How far back a step reads real events when the world has been still for a while. */
const MAX_LOOKBACK_MS = 6 * 3_600_000;
const DAYS_KEPT = 120;
const REMARKS_KEPT = 60;

/** Claude's answer to one step: the raw JSON (null when unusable) and the call's token use (null when it never answered). */
export interface Asked {
  answer: unknown;
  usage: StepUsage | null;
}
export type Ask = (prompt: Prompt, schema: ReturnType<typeof answerSchema>) => Promise<Asked>;

export interface StepDeps {
  store: WorldStore;
  now: number;
  readFeed: (since: number) => Promise<Feed>;
  /** Claude, when it is set up; null writes every hour from the scripted lines. */
  ask: Ask | null;
  /** The world's share of the month's Claude API cap (budget.ts). */
  budget?: number;
  cast?: WorldCast;
}

export type StepResult = { stepped: false; entry: HistoryEntry | null; nextAt: string } | { stepped: true; entry: HistoryEntry; state: WorldState };

const MT = "America/Denver";

/** The Mountain-time day a moment falls in: "2026-10-13". The Chronicle's pages, and when a day ends. */
export function dayOf(at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** Ilyr's clock for the prompt: "Tuesday 13 October, 3 pm". */
export function clockOf(at: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString("en-GB", { timeZone: MT, weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("en-US", { timeZone: MT, hour: "numeric" }).toLowerCase();
  return `${date.replace(",", "")}, ${time}`;
}

/** The world before its first step: the cast's own relationships, nothing remembered yet. */
export function initialState(cast: WorldCast = WORLD_CAST): WorldState {
  return { version: 1, step: 0, at: null, relationships: cast.relationships.map((r) => ({ ...r })), recent: [], days: [], recapped: null, spend: {}, remarks: [] };
}

/** When the next step is due after a state's last one. */
export const nextAt = (state: Pick<WorldState, "at">, now: number) => new Date(state.at ? Date.parse(state.at) + STEP_EVERY_MS : now).toISOString();

export async function runStep(deps: StepDeps): Promise<StepResult> {
  const { store, now } = deps;
  const cast = deps.cast ?? WORLD_CAST;
  const state = (await store.loadState()) ?? initialState(cast);
  if (state.at && now - Date.parse(state.at) < STEP_EVERY_MS) return { stepped: false, entry: state.recent.at(-1) ?? null, nextAt: nextAt(state, now) };

  // The hour's real events, since the last step (at most six hours back).
  const from = Math.max(state.at ? Date.parse(state.at) : now - 3_600_000, now - MAX_LOOKBACK_MS);
  const feed = await deps.readFeed(from).catch((): Feed => ({ issues: [], comments: [], runs: [] }));
  const digest = digestEvents(feed, from, now);

  // The first step after midnight (Mountain time) also writes the day in Ilyr for the day that ended.
  const day = dayOf(now);
  const lastDay = state.recent.at(-1)?.day ?? null;
  const recapDay = lastDay && lastDay !== day && state.recapped !== lastDay ? lastDay : null;
  const recapSummaries = recapDay ? state.recent.filter((e) => e.day === recapDay).map((e) => e.summary) : [];

  let hour: Hour | null = null;
  let cost: HistoryEntry["cost"] = null;
  if (deps.ask && canSpend(state, now, deps.budget ?? WORLD_BUDGET_USD)) {
    const prompt = buildPrompt({ cast, state, digest, clock: clockOf(now), recap: recapDay ? { day: recapDay, summaries: recapSummaries } : null });
    const asked = await deps.ask(prompt, answerSchema(cast)).catch((): Asked => ({ answer: null, usage: null }));
    if (asked.usage) cost = stepCost(asked.usage);
    hour = readAnswer(asked.answer, cast, state.relationships, digest);
  }
  const source = hour ? "claude" : "scripted";
  const fallback = () => scriptedHour(cast, state.relationships, digest, state.step + 1, recapDay, recapSummaries);
  if (!hour) hour = fallback();
  else if (recapDay && !hour.recap) hour = { ...hour, recap: fallback().recap };

  const at = new Date(now).toISOString();
  const entry: HistoryEntry = {
    step: state.step + 1,
    at,
    day,
    source,
    summary: hour.summary,
    scenes: hour.scenes,
    changes: hour.changes,
    remarks: hour.remarks,
    events: digest.lines,
    ...(recapDay && hour.recap ? { recap: { day: recapDay, text: hour.recap } } : {}),
    cost,
  };
  const next: WorldState = {
    ...state,
    step: entry.step,
    at,
    relationships: applyChanges(state.relationships, hour.changes, at),
    recent: keepRecent(state.recent, entry),
    days: [day, ...state.days.filter((d) => d !== day)].slice(0, DAYS_KEPT),
    recapped: recapDay ?? state.recapped,
    spend: addSpend(state.spend, now, cost, source),
    remarks: [...hour.remarks.map((r) => ({ ...r, at })), ...state.remarks].slice(0, REMARKS_KEPT),
  };

  // The state first: if another step landed meanwhile, this one stops here (StaleStateError) and writes no history.
  await store.saveState(next);
  await store.appendHistory(entry);
  if (entry.recap) await store.putRecap(entry.recap.day, entry.recap.text);
  return { stepped: true, entry, state: next };
}
