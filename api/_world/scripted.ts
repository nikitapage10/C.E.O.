/**
 * The scripted hour (docs/WORLD.md): what the world step writes when it can't or mustn't call Claude (over the month's
 * budget, no key, or Claude didn't answer). Built from the cast's own lines (packages/simulator/src/quips.ts, through
 * api/_world/cast.ts): two scenes between agents with history, the builders' stock remark for anything that shipped,
 * and the real events in the Historian's summary. Free, and the world still moves.
 */

import type { Digest } from "./digest.js";
import type { Hour } from "./prompt.js";
import type { Scene, WorldCast, WorldRelationship } from "./types.js";

/** A small seeded random, so a step's scripted hour is the same if it is ever rerun. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scriptedHour(cast: WorldCast, relationships: WorldRelationship[], digest: Digest, step: number, recapDay: string | null, recapSummaries: string[] = []): Hour {
  const rand = rng(step * 7919 + 17);
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  const member = new Map(cast.members.map((m) => [m.id, m]));
  const lineFor = (id: string, other: string) => {
    const own = cast.scripted.quips[id] ?? [];
    const conduct = cast.scripted.conduct[id] ?? [];
    const name = member.get(other)?.name ?? other;
    const options = [...own, ...conduct.map((l) => l.replaceAll("{other}", name)), member.get(id)?.catchphrase ?? ""].filter(Boolean);
    return pick(options) ?? "…";
  };

  const scenes: Scene[] = [];
  const used = new Set<string>();
  const pool = relationships.filter((r) => member.has(r.a) && member.has(r.b));
  for (let tries = 0; scenes.length < 2 && tries < 20 && pool.length; tries++) {
    const r = pick(pool)!;
    if (used.has(r.a) || used.has(r.b)) continue;
    used.add(r.a);
    used.add(r.b);
    const a = member.get(r.a)!;
    const b = member.get(r.b)!;
    const room = a.room === b.room ? a.room : "breakroom";
    const first = lineFor(a.id, b.id);
    let second = lineFor(b.id, a.id);
    if (second === first) second = b.catchphrase;
    scenes.push({ room, title: `${a.name} and ${b.name}`, lines: [{ who: a.id, text: first }, { who: b.id, text: second }] });
  }

  const remarks = digest.shipped.map((job) => ({
    issue: job.issue,
    title: job.title,
    who: job.who,
    text: (pick(cast.scripted.shipped[job.who] ?? cast.scripted.shipped.tessellate ?? []) ?? "{title}. Shipped.").replaceAll("{title}", job.title),
  }));

  const quiet = pick(cast.scripted.summaries) ?? "An hour in Ilyr.";
  const real = digest.lines.length ? ` For the record: ${digest.lines.slice(0, 3).join(" ")}` : "";
  const recap = recapDay ? `The day in Ilyr, ${recapDay}, as the Historian has it: ${recapSummaries.length} hours entered in the Chronicle.${recapSummaries.length ? ` It began: ${recapSummaries[0]}` : ""} Sourced, footnoted, filed.` : "";
  return { summary: `${quiet}${real}`, scenes, changes: [], remarks, recap };
}
