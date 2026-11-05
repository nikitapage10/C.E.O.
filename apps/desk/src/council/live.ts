import type { HistoryEntry } from "../../../world/src/chronicle.ts";
import { CREW, type Change } from "../../../world/src/foundry.ts";
import { ideaTitle } from "../IdeaCard.tsx";
import type { RoomPulse } from "../roomPulse.ts";

/** A member of the Council: one of the ten rooms' pulses, or one of the Desk's own (deskPulses.ts). */
export type CouncilPulse = Omit<RoomPulse, "id"> & { id: string };

/**
 * When a member of the Council is lit, and what it says (#717). Nikita: the Skippies "should be much darker unless
 * something is happening for them", and each shows "little messages about what it's doing". Pure and shared, so any
 * Today design can use it: a member is lit only while its room has live, real activity (work under way, something down,
 * or a real event in the last few minutes), and its lines come from the same real feed Today already shows (the
 * room's status, the Foundry's bench and changelog, the Archive's hours of Ilyr). Never a name, an amount or a message's
 * contents: only what the pulses and the public feed already say.
 */

/** Skippy's model, the one every member wears (councilScene.ts). */
export const SKIPPY_MODEL = "lib/custom/Skippy.glb";

/** How long a real event keeps its member lit. */
export const LIT_MS = 20 * 60_000;

/**
 * The rooms whose knots are their own real work (a change shipped, an hour of Ilyr written). Elsewhere the knots are
 * routine checks or scenes set there in Ilyr, which light nobody.
 */
const WORK_EVENTS = new Set(["foundry", "archive"]);

/** 0..1: how lit a member is now. 0 while nothing is happening for it, or while its room isn't connected. */
export function memberLive(p: CouncilPulse, now: number): number {
  if (!p.real || p.state === "sim") return 0;
  if (p.state === "busy" || p.state === "down") return 1;
  if (!WORK_EVENTS.has(p.id)) return 0;
  const last = p.events.filter((t) => t <= now).reduce((a, b) => Math.max(a, b), 0);
  if (!last || now - last > LIT_MS) return 0;
  // Fades over the window, never below a clear glow while it's in it.
  return 0.55 + 0.45 * (1 - (now - last) / LIT_MS);
}

/** Skippy himself: lit as brightly as the liveliest of his Council, a little at the least while anyone is. */
export const kernelLive = (lives: number[]) => (lives.some((v) => v > 0) ? Math.max(0.5, ...lives) : 0);

export interface CouncilLine {
  room: string;
  text: string;
  /** When it happened, or now for what's under way. */
  at: number;
}

const clip = (s: string, n = 72) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/[\s,;:.]+\S*$/, "")}…` : t;
};

/**
 * Each lit member's lines, newest first. `changes` is the Foundry's changelog, `ilyr` the living Lattice's recent hours
 * (the Archive's); everything else comes from the room's own pulse.
 */
export function councilLines({ pulses, changes, ilyr, now }: { pulses: CouncilPulse[]; changes: Change[]; ilyr: HistoryEntry[]; now: number }): Record<string, CouncilLine[]> {
  const out: Record<string, CouncilLine[]> = {};
  for (const p of pulses) {
    if (!memberLive(p, now)) continue;
    const lines: CouncilLine[] = [];
    const add = (text: string, at: number) => text && lines.push({ room: p.id, text: clip(text), at });
    if (p.id === "foundry") {
      if (p.doing) add(p.doing, now);
      else if (p.state === "busy" || p.state === "down") add(p.status, now);
      for (const c of changes) if (c.at <= now && now - c.at <= LIT_MS) add(`Shipped${c.issue ? ` #${c.issue.number}` : ""} ${c.short || ideaTitle(c.title)}${c.by && CREW[c.by] ? ` · ${CREW[c.by].name}` : ""}`, c.at);
    } else if (p.id === "archive") {
      for (const e of ilyr) {
        const at = Date.parse(e.at);
        if (at <= now && now - at <= LIT_MS) add(e.summary ? `New hour of Ilyr: ${e.summary}` : "An hour of Ilyr written", at);
      }
      if (!lines.length) add(p.status, now);
    } else add(p.status, now);
    lines.sort((a, b) => b.at - a.at);
    if (lines.length) out[p.id] = lines.slice(0, 3);
  }
  return out;
}
