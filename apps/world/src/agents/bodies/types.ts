import type { Body, LineageId, Look } from "@ceo/core";
import type { RefObject } from "react";
import type { PoseMode } from "../behavior.ts";

/** What the agent is doing right now, written by Agent every frame and read by whichever body it wears. */
export interface Drive {
  mode: PoseMode;
  moving: boolean;
  /** Seconds, from the render clock. */
  t: number;
  /** A speech bubble is up. */
  speaking: boolean;
}

export interface BodyProps {
  look: Look;
  lineage: LineageId;
  drive: RefObject<Drive>;
  phase: number;
}

/** Height of the top of each body (before `size`), so name tags and bubbles sit just above it. */
export const BODY_HEIGHT: Record<Exclude<Body, "classic">, number> = {
  robot: 1.72,
  mage: 2.05,
  rogue: 1.72,
  hooded: 1.78,
  knight: 1.86,
  barbarian: 1.9,
  rocky: 0.95,
  envoy: 2.15,
  gestral: 1.2,
  monolith: 1.78,
  duck: 1.3,
};
