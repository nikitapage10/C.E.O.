/**
 * How sure a start-or-sit call is (#261): one word the Desk's call cards and the Commentator both use, worked out from
 * the call itself (FantasyPros' margin, whether Sleeper agrees, and the call's flags). Pure, no imports beyond types,
 * so the browser reads it too (apps/world/src/desk/green/league.ts).
 *
 *   low     a split decision, a tiebreak, a late-game risk, or a call on form under 3 points
 *   high    FantasyPros' margin of 3 points or more, with Sleeper not disagreeing
 *   medium  everything else
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { CallSource, GreenCall } from "./types.js";

export type Confidence = "high" | "medium" | "low";

/** The margin, in projected points, at or past which a clean call is a confident one. */
export const SURE_EDGE = 3;

export function callConfidence(c: Pick<GreenCall, "edge" | "split" | "tiebreak" | "lateRisk" | "sleeper">, calls: CallSource): Confidence {
  const edge = Math.abs(c.edge);
  if (c.split || c.tiebreak || c.lateRisk) return "low";
  if (calls === "form") return edge >= SURE_EDGE ? "medium" : "low";
  return edge >= SURE_EDGE && c.sleeper !== "disagrees" ? "high" : "medium";
}
