import type { GlitchDef, LegalFollowUp } from "./registry.ts";

export type GlitchLevel = "off" | "normal" | "unhinged";

/** Real-time gap between glitches, in ms. */
export const LEVEL_GAPS: Record<GlitchLevel, { min: number; max: number } | null> = {
  off: null,
  normal: { min: 70_000, max: 150_000 },
  unhinged: { min: 12_000, max: 28_000 },
};

type Random = () => number;

export function nextDelay(level: GlitchLevel, random: Random): number | null {
  const gap = LEVEL_GAPS[level];
  return gap ? gap.min + random() * (gap.max - gap.min) : null;
}

/** Weighted pick among glitches that are off cooldown. Returns null if everything is cooling down. */
export function pickGlitch(
  defs: readonly GlitchDef[],
  random: Random,
  now: number,
  lastFired: Readonly<Record<string, number>>,
): GlitchDef | null {
  const ready = defs.filter((d) => lastFired[d.id] === undefined || now - lastFired[d.id]! >= d.cooldownMs);
  const total = ready.reduce((sum, d) => sum + d.weight, 0);
  if (total <= 0) return null;
  let r = random() * total;
  for (const d of ready) {
    r -= d.weight;
    if (r < 0) return d;
  }
  return ready[ready.length - 1] ?? null;
}

/** Counsel.exe gets involved in a little under half of all intrusions. */
export function legalFollowUp(def: GlitchDef, random: Random): LegalFollowUp | null {
  if (def.kind !== "intrusion" || !def.legal?.length) return null;
  if (random() >= 0.45) return null;
  return def.legal[Math.floor(random() * def.legal.length)] ?? null;
}

/** When the legal intervention lands, as a fraction of the glitch's duration. */
export const LEGAL_AT: Record<LegalFollowUp, number> = { stamp: 0.5, tarp: 0.55, yank: 0.45 };
