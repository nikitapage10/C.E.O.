import { CREW, modelOf, type Crate, type CrewId, type Model } from "../foundry.ts";
import { tidyTitle } from "./taskLine.ts";

/**
 * The small card that opens over a name plate's task line on hover (or a tap): what the agent is really on. Real
 * Foundry work shows its issue, pitch, builder and model, how long it has been going and a link; a demo room's
 * work shows its simulated title and says it's a drill. Pure, so it can be tested without the scene.
 */

export type TaskCard =
  | {
      kind: "real";
      number: number;
      title: string;
      /** The pitch in a sentence or two. */
      pitch: string;
      /** Who builds it and on which model: "Rusty · Opus". */
      builder: string;
      /** Whose hands are on it when that isn't the builder: one of Rusty's dock crew. */
      hands: string | null;
      /** Where it stands: "Going for 2 h 14 min", "Waiting for your OK"… */
      status: string;
      url: string;
    }
  /** Real work with no issue behind it (the checks on main). */
  | { kind: "live"; title: string }
  | { kind: "drill"; title: string };

/** The pitch cut to its first sentence or two, and never much past two lines of the card. */
export function briefPitch(pitch: string, max = 190): string {
  const text = pitch.replace(/\s+/g, " ").trim();
  const [first = "", second] = text.split(/(?<=[.!?])\s+/);
  // A short first sentence takes the second along when both fit.
  const out = second && first.length < 90 && first.length + 1 + second.length <= max ? `${first} ${second}` : first;
  if (out.length <= max) return out;
  const cut = out.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.·-]+$/, "")}…`;
}

/** A span of time in plain words: "just now", "12 min", "2 h 14 min", "3 days". */
export function spanText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "a day" : `${d} days`;
}

/** Where a real job stands, in a few words. */
function standing(crate: Crate, now: number, waiting: boolean): string {
  if (crate.state === "stuck") return "Stuck: needs you";
  if (crate.state === "ready") return "Checked, waiting for your OK";
  if (crate.state === "shipped") return crate.closedAt ? `Shipped ${spanText(now - crate.closedAt)} ago` : "Shipped";
  if (crate.paused) return "Paused for a fix";
  if (waiting) return "Waiting its turn";
  if (crate.state === "queued") return "In the queue";
  const since = crate.createdAt ?? crate.updatedAt;
  const span = spanText(now - since);
  return span === "just now" ? "Just started" : `Going for ${span}`;
}

/**
 * The card for a real Foundry job, as `who` holds it. The builder and model come from the issue's Builder line
 * ("**Builder:** Rusty (Opus)"), else whoever holds it on their usual model. `hands` names a dock crew member working
 * it for Rusty.
 */
export function crateCard(crate: Crate, who: CrewId, opts: { now?: number; hands?: string | null; waiting?: boolean } = {}): TaskCard {
  const now = opts.now ?? Date.now();
  const builder: CrewId = crate.builder ?? who;
  const model: Model = modelOf(crate, builder);
  return {
    kind: "real",
    number: crate.number,
    title: tidyTitle(crate.title),
    pitch: briefPitch(crate.pitch),
    builder: `${CREW[builder].name} · ${model}`,
    hands: opts.hands ?? null,
    status: standing(crate, now, opts.waiting ?? false),
    url: crate.url,
  };
}

/** The card for a task from the Lattice's own record: real (no issue behind it) or a demo room's drill. */
export function recordCard(task: { title: string; status: string; live?: boolean } | null | undefined): TaskCard | null {
  if (!task || task.status !== "running") return null;
  const title = tidyTitle(task.title);
  return task.live ? { kind: "live", title } : { kind: "drill", title };
}
