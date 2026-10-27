import type { Body } from "@ceo/core";

/**
 * How the portrait studio frames each body. Heights are fractions of the sitter's measured height (0 = the floor,
 * 1 = the top of it): the picture runs from `bottom` to `top`, plus `margin` of breathing room, nudged down by
 * `lift` (of the span) so there's air over the head. `tilt` is how far above the frame's centre the camera sits
 * (radians). The Desk shows these as small circles, so the sitter has to fit the circle, not just the square:
 * people get head and shoulders; creatures that read by their shape (a can, a stone engineer, a box on legs)
 * get more of themselves.
 */
export interface Framing {
  top: number;
  bottom: number;
  margin: number;
  lift: number;
  tilt: number;
}

const BUST: Partial<Framing> = { bottom: 0.55, margin: 0.3 };
const WHOLE: Partial<Framing> = { bottom: 0, margin: 0.3 };

export const FRAMING: { default: Framing } & Partial<Record<Body, Partial<Framing>>> = {
  default: { top: 1, bottom: 0.4, margin: 0.26, lift: 0.02, tilt: 0.1 },
  suit: BUST,
  hardhat: BUST,
  punk: BUST,
  medieval: BUST,
  worker: BUST,
  formal: BUST,
  casual: BUST,
  scifi: BUST,
  spacesuit: BUST,
  witch: BUST,
  king: BUST,
  classic: { bottom: 0.32, margin: 0.3 },
  mage: { bottom: 0.3, margin: 0.26, lift: -0.04 },
  rocky: { ...WHOLE, margin: 0.36, tilt: 0.3 },
  compactor: { bottom: 0.04, margin: 0.3 },
  astromech: WHOLE,
  protocol: { bottom: 0.5, margin: 0.3 },
  monolith: { bottom: 0.04, margin: 0.28 },
  skippy: { bottom: 0.1, margin: 0.36 },
  hanar: { bottom: 0.4, margin: 0.3 },
  crawler: WHOLE,
  ghost: { bottom: 0.15, margin: 0.3 },
  flyer: { bottom: 0.05, margin: 0.3 },
  wizard: { bottom: 0, margin: 0.3, tilt: 0.04 },
  gestral: { bottom: 0.22, margin: 0.3 },
  yordle: { bottom: 0.25, margin: 0.3 },
  orc: { bottom: 0.42, margin: 0.34 },
  bunny: { bottom: 0.28, margin: 0.3 },
};
