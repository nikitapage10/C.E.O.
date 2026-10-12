import type { Body, LineageId, Look } from "@ceo/core";
import type { RefObject } from "react";
import type { Vector3 } from "three";
import type { PoseMode } from "../behavior.ts";

/** What the agent is doing right now, written by Agent every frame and read by whichever body it wears. */
export interface Drive {
  mode: PoseMode;
  moving: boolean;
  /** Seconds, from the render clock. */
  t: number;
  /** A speech bubble is up. */
  speaking: boolean;
  /**
   * How fast the body's animation clock runs: the Lattice's speed while walking (at 4× they cover ground four
   * times as fast, so their feet must keep up), 1 otherwise.
   */
  rate?: number;
  /**
   * Written back by bodies that hold things in their own limbs (a hanar's tentacles, an Eridian's hands): where the
   * carried thing should sit, in the body's frame before `size`. Null to use CARRY_AT.
   */
  hold?: Vector3 | null;
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
  leela: 1.62,
  george: 1.95,
  mike: 1.7,
  stan: 1.82,
  suit: 1.8,
  formal: 1.74,
  casual: 1.8,
  worker: 1.82,
  hardhat: 1.76,
  punk: 1.86,
  medieval: 1.78,
  scifi: 1.76,
  spacesuit: 1.86,
  witch: 1.95,
  king: 1.86,
  mage: 2.05,
  rogue: 1.72,
  hooded: 1.78,
  knight: 1.86,
  barbarian: 1.9,
  gestral: 1.3,
  yordle: 0.95,
  hanar: 2.1,
  rocky: 1.0,
  compactor: 1.3,
  crawler: 1.0,
  masked: 1.45,
  orc: 1.9,
  bunny: 1.55,
  ghost: 1.3,
  flyer: 1.6,
  wizard: 1.2,
  birb: 1.45,
  yeti: 2.1,
  monolith: 1.78,
  powerbox: 1.05,
};

/** Where a body holds what it carries, [height, distance in front], before `size`. Default: half its height, 0.42 out. */
export const CARRY_AT: Partial<Record<Exclude<Body, "classic">, [number, number]>> = {
  hanar: [0.95, 0.3],
  rocky: [0.55, 0.42],
  compactor: [0.62, 0.5],
};
