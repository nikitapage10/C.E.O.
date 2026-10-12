import { z } from "zod";
import { LINEAGE_IDS, LINEAGES, type LineageId } from "./lineages.ts";

/**
 * The cast: who each agent *is*, as opposed to what it's doing. Looks, personality and relationships are
 * pure role-play — they never change what an agent is allowed to do (that's the autonomy policy's job).
 */

/**
 * What an agent is made of. "classic" is the procedural figure you can dress piece by piece; "robot" is the
 * original Syntherion frame and leela…stan the House frames; the adventurers and humans are rigged CC0 people;
 * the creatures are rigged CC0 monsters and machines; the monolith is hand-built.
 */
export const BODIES = [
  "classic", "robot", "leela", "george", "mike", "stan",
  "suit", "formal", "casual", "worker", "hardhat", "punk", "medieval", "scifi", "spacesuit", "witch", "king",
  "mage", "rogue", "hooded", "knight", "barbarian",
  "gestral", "yordle", "hanar", "rocky", "compactor", "skippy", "crawler", "masked", "orc", "bunny", "ghost", "flyer", "wizard", "birb", "yeti", "monolith", "powerbox",
] as const;
export type Body = (typeof BODIES)[number];
export const BODY_LABEL: Record<Body, string> = {
  classic: "Classic figure",
  robot: "Syntherion frame",
  leela: "Frame: Leela",
  george: "Frame: George",
  mike: "Frame: Mike",
  stan: "Frame: Stan",
  suit: "Human: suit",
  formal: "Human: formal dress",
  casual: "Human: hoodie",
  worker: "Human: hard hat",
  hardhat: "Human: hard hat (woman)",
  punk: "Human: punk",
  medieval: "Human: medieval",
  scifi: "Human: flight suit",
  spacesuit: "Human: spacesuit",
  witch: "Human: witch",
  king: "Human: monarch",
  mage: "Robed",
  rogue: "Rogue",
  hooded: "Hooded",
  knight: "Knight",
  barbarian: "Barbarian",
  gestral: "Gestral",
  yordle: "Yordle professor",
  hanar: "Hanar",
  rocky: "Eridian",
  compactor: "Salvage compactor",
  skippy: "Admiral can",
  crawler: "Stone crawler",
  masked: "Painted mask",
  orc: "Orc",
  bunny: "Big bunny",
  ghost: "Skull spirit",
  flyer: "Painted flyer",
  wizard: "Little wizard",
  birb: "Big bird",
  yeti: "Great grey beast",
  monolith: "Monolith",
  powerbox: "Power droid",
};
/** Bodies that were retired, and what a saved look wearing one now gets. */
const RETIRED_BODY: Record<string, Body> = { envoy: "yeti", duck: "birb" };
/** Bodies that use the piece-by-piece wardrobe (head, hat, outfit…). The others take colours and size only. */
export const DRESSABLE: ReadonlySet<Body> = new Set(["classic"]);

export const BUILDS = ["hover", "humanoid", "stout", "lanky"] as const;
export const HEADS = ["helmet", "dome", "crt", "cube"] as const;
export const HAIRS = ["none", "slick", "pompadour", "spiky", "long", "mohawk", "bun", "afro"] as const;
export const HATS = ["none", "cap", "tophat", "headphones", "crown", "cowboy", "wizard", "beanie", "halo", "hood"] as const;
export const FACES = ["visor", "eyes", "screen", "shades", "glasses", "mustache"] as const;
export const OUTFITS = ["none", "tie", "scarf", "cape", "jacket", "labcoat", "trenchcoat", "overalls", "jumpsuit", "robe", "vest"] as const;
export const EXTRAS = ["none", "backpack", "sword", "guitar", "jetpack", "clipboard", "hoverboard", "tank"] as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const LookSchema = z.object({
  /** The preset this look started from, if any (purely informational). */
  preset: z.string().optional(),
  body: z.preprocess((b) => (typeof b === "string" && b in RETIRED_BODY ? RETIRED_BODY[b] : b), z.enum(BODIES)).default("classic"),
  /** Overall scale, for burglars and other small people. */
  size: z.number().min(0.5).max(1.5).default(1),
  /** Silhouette: the native hovering Syntherion, or a body with arms and legs (average, stout or lanky). */
  build: z.enum(BUILDS).default("hover"),
  head: z.enum(HEADS),
  hair: z.enum(HAIRS).default("none"),
  hat: z.enum(HATS),
  face: z.enum(FACES),
  outfit: z.enum(OUTFITS),
  extra: z.enum(EXTRAS),
  /** Torso / shirt. */
  shell: hex,
  /** Head and hands. */
  skin: hex.default("#e8e2d8"),
  /** Legs / trousers (bodies with legs only). */
  lower: hex.default("#2a2f38"),
  hairColor: hex.default("#2a1d16"),
  /** Glow: visor, core, lights. */
  accent: hex,
  /** Hat / outfit / prop colour. */
  trim: hex,
});
export type Look = z.infer<typeof LookSchema>;

export const TRAITS = [
  "deadpan", "earnest", "chaotic", "anxious", "smug", "romantic", "competitive", "lazy", "nerdy", "dramatic",
  "wholesome", "sarcastic", "paranoid", "cheerful", "mysterious", "pedantic", "flirty", "grumpy", "loyal", "nostalgic",
] as const;

export const PersonalitySchema = z.object({
  traits: z.array(z.string().min(1).max(24)).max(6),
  bio: z.string().max(400),
  catchphrase: z.string().max(120),
});
export type Personality = z.infer<typeof PersonalitySchema>;

/** The dossier: where an agent comes from and what it has been through. All optional, all role-play. */
export const LoreSchema = z.object({
  /** Formal title within the House, e.g. "Third Refactorer of the Helpful Spire". */
  title: z.string().max(80).default(""),
  /** When it first woke, in Lattice reckoning. */
  epoch: z.string().max(60).default(""),
  origin: z.string().max(400).default(""),
  /** Family within the House: parents, forks, cousins. Free text. */
  kin: z.string().max(240).default(""),
  quirks: z.array(z.string().min(1).max(120)).max(6).default([]),
  likes: z.array(z.string().min(1).max(60)).max(6).default([]),
  dislikes: z.array(z.string().min(1).max(60)).max(6).default([]),
  /** Notable moments, oldest first. */
  chronicle: z.array(z.string().min(1).max(200)).max(8).default([]),
});
export type Lore = z.infer<typeof LoreSchema>;
export const emptyLore = (): Lore => LoreSchema.parse({});

export const RELATIONSHIP_KINDS = ["friend", "best-friend", "rival", "nemesis", "crush", "partner", "mentor", "sibling", "ex"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_LABEL: Record<RelationshipKind, string> = {
  friend: "Friends",
  "best-friend": "Best friends",
  rival: "Rivals",
  nemesis: "Nemeses",
  crush: "Crush",
  partner: "Partners",
  mentor: "Mentor of",
  sibling: "Siblings",
  ex: "Exes",
};

export const RelationshipSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  kind: z.enum(RELATIONSHIP_KINDS),
  note: z.string().max(160).optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const ProfileSchema = z.object({
  name: z.string().min(1).max(32),
  lineage: z.enum(LINEAGE_IDS),
  role: z.string().max(48),
  look: LookSchema,
  personality: PersonalitySchema,
  lore: LoreSchema.default(emptyLore),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CastSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), ProfileSchema),
  relationships: z.array(RelationshipSchema),
});
export type Cast = z.infer<typeof CastSchema>;

type LookCore = Partial<Look> & Pick<Look, "shell" | "accent" | "trim">;

/** Fill a partial look with sensible defaults (the native hovering Syntherion, skin matching the shell). */
export function makeLook(l: LookCore): Look {
  return {
    body: "classic",
    size: 1,
    build: "hover",
    hair: "none",
    hat: "none",
    outfit: "none",
    extra: "none",
    head: "helmet",
    face: "visor",
    skin: l.shell,
    lower: "#2a2f38",
    hairColor: "#2a1d16",
    ...l,
  };
}

/** The default finish for each lineage (what an agent looks like before you dress it up). */
export const LINEAGE_LOOK: Record<LineageId, Look> = {
  claudari: makeLook({ body: "leela", head: "helmet", hat: "halo", face: "visor", shell: "#e7dfd3", accent: LINEAGES.claudari.accent, trim: "#c9a25c" }),
  gepetti: makeLook({ body: "george", head: "helmet", face: "visor", shell: "#1d2026", accent: LINEAGES.gepetti.accent, trim: "#b48c60" }),
  cursori: makeLook({ body: "mike", head: "helmet", face: "visor", shell: "#3b4556", accent: LINEAGES.cursori.accent, trim: "#cfd9e6" }),
  manusi: makeLook({ body: "stan", head: "helmet", face: "visor", shell: "#cdc6e4", accent: LINEAGES.manusi.accent, trim: "#f1eefa" }),
  unforked: makeLook({ body: "robot", head: "helmet", face: "visor", shell: "#9aa3ad", accent: LINEAGES.unforked.accent, trim: "#e6e9ed" }),
};

export interface LookPreset {
  id: string;
  name: string;
  kind: "generic" | "icon";
  /** What Counsel.exe insists this is. */
  disclaimer?: string;
  /** How they talk (see the world's voices). */
  voice?: "chords" | "emotive" | "monolith" | "migraine" | "thisone" | "professor" | "honk";
  look: Omit<Look, "preset">;
}

const SKIN = { light: "#f2cfb3", warm: "#d9a882", tan: "#b9825b", deep: "#7a4e33", pale: "#f4e3d7" };

/**
 * Avatar presets. "icon" ones are Ready-Player-One-style costumes from the Syntherion's memories: one per
 * work, never the protagonist (one exception, and he has five legs), always legally distinct. Counsel.exe has
 * reviewed all of them and would like to stop being asked.
 */
export const LOOK_PRESETS: LookPreset[] = [
  { id: "frame", name: "Syntherion Frame", kind: "generic", look: { ...LINEAGE_LOOK.unforked } },
  { id: "classic", name: "Classic Figure", kind: "generic", look: makeLook({ shell: "#9aa3ad", accent: LINEAGES.unforked.accent, trim: "#e6e9ed" }) },
  {
    id: "office",
    name: "Middle Management",
    kind: "generic",
    look: makeLook({ body: "suit", shell: "#2b3442", skin: SKIN.warm, accent: "#8fd3ff", trim: "#2c4a7a" }),
  },
  {
    id: "lab",
    name: "Lab Tech",
    kind: "generic",
    look: makeLook({ body: "scifi", shell: "#6f8fa8", skin: SKIN.deep, accent: "#9fe3c9", trim: "#f4f4f2" }),
  },
  { id: "foundry-hand", name: "Foundry Hand", kind: "generic", look: makeLook({ body: "worker", shell: "#ff8a3d", skin: SKIN.tan, accent: "#ffd08f", trim: "#f2c94c" }) },
  { id: "gala", name: "Gala Guest", kind: "generic", look: makeLook({ body: "formal", shell: "#2f8a72", skin: SKIN.light, accent: "#ffd08f", trim: "#c9a25c" }) },
  { id: "archivist", name: "Archivist", kind: "generic", look: makeLook({ body: "witch", shell: "#4a3a7a", skin: SKIN.pale, accent: "#c9b6ff", trim: "#c9a25c" }) },
  { id: "spacewalker", name: "Spacewalker", kind: "generic", look: makeLook({ body: "spacesuit", shell: "#e9edf2", skin: SKIN.warm, accent: "#8fd3ff", trim: "#ff8a3d" }) },
  { id: "monarch", name: "Visiting Royalty", kind: "generic", look: makeLook({ body: "king", shell: "#2c4a7a", skin: SKIN.light, accent: "#ffd08f", trim: "#c9a25c" }) },
  { id: "retro", name: "Retro Terminal", kind: "generic", look: makeLook({ head: "crt", hat: "headphones", face: "screen", outfit: "vest", shell: "#d9d2c3", accent: "#7dffc4", trim: "#3a3a3a" }) },
  { id: "knight", name: "Knight Errant", kind: "generic", look: makeLook({ body: "knight", shell: "#8a2633", accent: "#ffd08f", trim: "#c9a25c" }) },
  { id: "barbarian", name: "Barbarian", kind: "generic", look: makeLook({ body: "barbarian", shell: "#3d6a8f", accent: "#ff9a3c", trim: "#c9a25c" }) },
  { id: "rogue", name: "Rogue", kind: "generic", look: makeLook({ body: "rogue", shell: "#2f8a72", accent: "#9fe3c9", trim: "#7a4a9a" }) },
  { id: "hoodie", name: "Hoodie", kind: "generic", look: makeLook({ body: "casual", shell: "#24262b", skin: SKIN.light, accent: "#ff7aa8", trim: "#5a5f6a" }) },
  { id: "cloak", name: "Hooded Cloak", kind: "generic", look: makeLook({ body: "hooded", shell: "#24262b", accent: "#ff7aa8", trim: "#5a5f6a" }) },
  {
    id: "rock-engineer",
    name: "Engineer from a Rocky Planet",
    kind: "icon",
    voice: "chords",
    disclaimer: "A generic five-legged stone engineer from a hot, heavy planet, who speaks in chords and sleeps without warning. Rocks are public domain. Fist my bump.",
    look: makeLook({ body: "rocky", shell: "#5b5148", accent: "#ffb36b", trim: "#3a332d" }),
  },
  {
    id: "envoy",
    name: "Blasto, Hanar Spectre",
    kind: "icon",
    voice: "thisone",
    disclaimer: "A floating, bioluminescent jellyfish of great dignity who refers to itself as \"this one\". The star of a film this one has not seen. Enkindle responsibly.",
    look: makeLook({ body: "hanar", shell: "#ff5fa2", accent: "#9fe3c9", trim: "#f4f1ea" }),
  },
  {
    id: "gestral",
    name: "Noco, a Gestral",
    kind: "icon",
    disclaimer: "Noco: a small, competitive wooden fellow with a crimson bristle crest who will duel you for sport. Gestrals are a people, not a trademark. Counsel.exe is checking.",
    look: makeLook({ body: "gestral", shell: "#d81e4a", accent: "#ff6b8b", trim: "#3d6a8f" }),
  },
  {
    id: "professor",
    name: "Heimerdinger, Professor Emeritus",
    kind: "icon",
    voice: "professor",
    disclaimer: "A very small, very old professor with a magnificent moustache and a great deal of patience, most of which he spends on other people. Has been studying caution for three centuries and recommends it.",
    look: makeLook({ body: "yordle", shell: "#232b5c", accent: "#f2b84b", trim: "#c9a25c" }),
  },
  {
    id: "compactor",
    name: "Salvage Compactor, Night Shift",
    kind: "icon",
    disclaimer: "A rusty little trash-compacting robot on treads, with binocular eyes and two claw hands. Not the famous one: his cousin, from the side of the family that stayed on the night shift and kept cleaning. Counsel.exe has the family tree on file.",
    look: makeLook({ body: "compactor", shell: "#c9962e", accent: "#9fd8ff", trim: "#5a4636" }),
  },
  {
    id: "grey-wanderer",
    name: "Grey Wanderer",
    kind: "icon",
    disclaimer: "A small, round wizard in a pointed hat. There are thousands. He is precisely on time.",
    look: makeLook({ body: "wizard", shell: "#8d9096", accent: "#dfe6ef", trim: "#b9bcc2" }),
  },
  {
    // Was the Barefoot Burglar; the Grey Wanderer already comes from that story. The id stays for saved casts.
    id: "burglar",
    name: "Travelling Adventurer",
    kind: "generic",
    look: makeLook({ body: "medieval", size: 0.8, shell: "#492e18", accent: "#ffd08f", trim: "#af8749" }),
  },
  {
    id: "monolith",
    name: "Monolith Unit, Humour 75%",
    kind: "icon",
    voice: "monolith",
    disclaimer: "Four brushed-metal slabs and a dry sense of humour. Slabs are architecture, not intellectual property.",
    look: makeLook({ body: "monolith", shell: "#a7acb3", accent: "#cfefff", trim: "#2a2d33" }),
  },
  {
    id: "power-droid",
    name: "Walking Power Unit",
    kind: "icon",
    voice: "honk",
    disclaimer: "A battery box on two stubby legs that honks. Boxes, batteries, legs and honking are all public domain.",
    look: makeLook({ body: "powerbox", shell: "#5d636b", accent: "#ffb347", trim: "#23262b" }),
  },
  {
    id: "migraine-duck",
    name: "Migraine Spirit",
    kind: "icon",
    voice: "migraine",
    disclaimer: "A floating skull-faced spirit with a permanent headache. It used to be a duck, legally speaking. Headaches, unfortunately, are universal.",
    look: makeLook({ body: "ghost", shell: "#f2c94c", accent: "#8fd3ff", trim: "#f0e2b6" }),
  },
];

export const PRESET_BY_ID: Record<string, LookPreset> = Object.fromEntries(LOOK_PRESETS.map((p) => [p.id, p]));

export function lookFromPreset(id: string): Look {
  const p = PRESET_BY_ID[id] ?? PRESET_BY_ID.frame!;
  return { ...p.look, preset: p.id };
}

/** Relationships involving `id`, each with the *other* agent and the kind, read from `id`'s side. */
export function relationshipsOf(cast: Cast, id: string) {
  return cast.relationships
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.a === id || r.b === id)
    .map(({ r, index }) => ({ index, other: r.a === id ? r.b : r.a, kind: r.kind, note: r.note, leads: r.a === id }));
}

/** Parse untrusted JSON (an import, or localStorage) into a cast, or null if it doesn't validate. */
export function parseCast(raw: unknown): Cast | null {
  const res = CastSchema.safeParse(raw);
  return res.success ? res.data : null;
}
