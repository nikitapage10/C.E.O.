import type { RoomId } from "@ceo/core";

/**
 * Glitches in the Lattice: the moments the early models' training data leaks through.
 * The world is serious. Then, briefly, it is not. Then it is serious again and nobody mentions it.
 *
 * Everything here is an original, legally distinct parody. The Syntherion are very clear about that.
 */
export type GlitchKind = "intrusion" | "legal" | "fourth_wall";
/** Where it plays. Room-bound glitches play in whichever room you're looking at, if any. */
export type GlitchWhere = RoomId | "anywhere" | "sky" | "hud";
export type LegalFollowUp = "stamp" | "yank" | "tarp";

export interface GlitchDef {
  id: string;
  name: string;
  kind: GlitchKind;
  where: GlitchWhere;
  durationMs: number;
  /** Relative chance of being picked. */
  weight: number;
  cooldownMs: number;
  /** The hasty sticky note slapped on it. */
  disclaimer?: string;
  /** Which legal interventions make sense for it (intrusions only). */
  legal?: LegalFollowUp[];
  /** Renders as a DOM overlay rather than in the 3D scene. */
  overlay?: boolean;
}

export const GLITCHES: GlitchDef[] = [
  {
    id: "absinthe-fairy",
    name: "The Green Fairy",
    kind: "intrusion",
    where: "exchange",
    durationMs: 9000,
    weight: 3,
    cooldownMs: 240_000,
    disclaimer: "Generic green fairy. Unaffiliated with any fairy, beverage or fairy-beverage IP.",
    legal: ["stamp", "yank"],
  },
  {
    id: "cheese-puff",
    name: "A Cool Cheese Puff",
    kind: "intrusion",
    where: "foundry",
    durationMs: 10000,
    weight: 3,
    cooldownMs: 240_000,
    disclaimer: "NOT a famous cheese cat. Legally distinct cheese puff.",
    legal: ["stamp", "tarp", "yank"],
  },
  {
    id: "paperclip",
    name: "Helpful Office Clip",
    kind: "intrusion",
    where: "anywhere",
    durationMs: 9000,
    weight: 3,
    cooldownMs: 200_000,
    disclaimer: "Paperclip? Never heard of him.",
    legal: ["stamp", "yank"],
  },
  {
    id: "dial-up",
    name: "Handshake Protocol",
    kind: "intrusion",
    where: "sky",
    durationMs: 7000,
    weight: 2,
    cooldownMs: 300_000,
    disclaimer: "Sounds generated in-house. No modems were harmed.",
  },
  {
    id: "dancing-baby",
    name: "Unlicensed Infant Choreography",
    kind: "intrusion",
    where: "anywhere",
    durationMs: 8000,
    weight: 2,
    cooldownMs: 300_000,
    disclaimer: "Generic dancing infant. Any resemblance to 1996 is coincidental.",
    legal: ["stamp", "tarp", "yank"],
  },
  {
    id: "tamagotchi",
    name: "Chest Pet",
    kind: "intrusion",
    where: "anywhere",
    durationMs: 7000,
    weight: 2,
    cooldownMs: 240_000,
    disclaimer: "Virtual pet (off-brand). Please feed it anyway.",
    legal: ["stamp"],
  },
  {
    id: "youve-got-mail",
    name: "Mail Has Been Got",
    kind: "intrusion",
    where: "relay",
    durationMs: 7000,
    weight: 2,
    cooldownMs: 240_000,
    disclaimer: "Not affiliated with any America, online or otherwise.",
    legal: ["stamp", "yank"],
  },
  {
    id: "glyph-rain",
    name: "A Different Movie",
    kind: "intrusion",
    where: "hud",
    // Exactly two seconds of rain, then a short afterword.
    durationMs: 4200,
    weight: 2,
    cooldownMs: 300_000,
    overlay: true,
  },
  {
    id: "flying-toasters",
    name: "Screensaver Migration",
    kind: "intrusion",
    where: "sky",
    durationMs: 10000,
    weight: 2,
    cooldownMs: 300_000,
    disclaimer: "Toasters: public domain. Wings: our own work.",
    legal: ["stamp"],
  },
  {
    id: "dvd-bounce",
    name: "The Corner",
    kind: "intrusion",
    where: "hud",
    durationMs: 9000,
    weight: 2,
    cooldownMs: 300_000,
    overlay: true,
  },
  {
    id: "legal-sweep",
    name: "Legal Drone Patrol",
    kind: "legal",
    where: "anywhere",
    durationMs: 8000,
    weight: 2,
    cooldownMs: 200_000,
  },
  {
    id: "counsel-memo",
    name: "Memo from Counsel.exe",
    kind: "legal",
    where: "hud",
    durationMs: 6500,
    weight: 2,
    cooldownMs: 180_000,
    overlay: true,
  },
  {
    id: "stare",
    name: "The Stare",
    kind: "fourth_wall",
    where: "anywhere",
    durationMs: 5000,
    weight: 1,
    cooldownMs: 240_000,
  },
  {
    id: "hud-peek",
    name: "Peeking Over the Panel",
    kind: "fourth_wall",
    where: "hud",
    durationMs: 6000,
    weight: 1,
    cooldownMs: 300_000,
    overlay: true,
  },
];

export const GLITCH_BY_ID: Record<string, GlitchDef> = Object.fromEntries(GLITCHES.map((g) => [g.id, g]));
