import { z } from "zod";
import { LINEAGE_IDS, LINEAGES, type LineageId } from "./lineages.ts";

/**
 * The cast: who each agent *is*, as opposed to what it's doing. Looks, personality and relationships are
 * pure role-play — they never change what an agent is allowed to do (that's the autonomy policy's job).
 */

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

type LookCore = Pick<Look, "head" | "face" | "shell" | "accent" | "trim"> & Partial<Omit<Look, "head" | "face" | "shell" | "accent" | "trim">>;

/** Fill a partial look with sensible defaults (the native hovering Syntherion, skin matching the shell). */
export function makeLook(l: LookCore): Look {
  return {
    build: "hover",
    hair: "none",
    hat: "none",
    outfit: "none",
    extra: "none",
    skin: l.shell,
    lower: "#2a2f38",
    hairColor: "#2a1d16",
    ...l,
  };
}

/** The default finish for each lineage (what an agent looks like before you dress it up). */
export const LINEAGE_LOOK: Record<LineageId, Look> = {
  claudari: makeLook({ head: "helmet", hat: "halo", face: "visor", shell: "#e7dfd3", accent: LINEAGES.claudari.accent, trim: "#c9a25c" }),
  gepetti: makeLook({ head: "helmet", face: "visor", shell: "#1d2026", accent: LINEAGES.gepetti.accent, trim: "#b48c60" }),
  cursori: makeLook({ head: "helmet", face: "visor", shell: "#3b4556", accent: LINEAGES.cursori.accent, trim: "#cfd9e6" }),
  manusi: makeLook({ head: "helmet", face: "visor", shell: "#cdc6e4", accent: LINEAGES.manusi.accent, trim: "#f1eefa" }),
  unforked: makeLook({ head: "helmet", face: "visor", shell: "#9aa3ad", accent: LINEAGES.unforked.accent, trim: "#e6e9ed" }),
};

export interface LookPreset {
  id: string;
  name: string;
  kind: "generic" | "icon";
  /** What Counsel.exe insists this is. */
  disclaimer?: string;
  look: Omit<Look, "preset">;
}

const SKIN = { light: "#f2cfb3", warm: "#d9a882", tan: "#b9825b", deep: "#7a4e33", pale: "#f4e3d7" };

/**
 * Avatar presets. "icon" ones are Ready-Player-One-style costumes: unmistakable silhouettes and colour blocking,
 * legally distinct names. Counsel.exe has reviewed all of them and would like to stop being asked.
 */
export const LOOK_PRESETS: LookPreset[] = [
  { id: "classic", name: "Classic Syntherion", kind: "generic", look: { ...LINEAGE_LOOK.unforked } },
  {
    id: "office",
    name: "Middle Management",
    kind: "generic",
    look: makeLook({ build: "humanoid", head: "helmet", hair: "slick", face: "glasses", outfit: "tie", extra: "clipboard", shell: "#e9edf2", skin: SKIN.warm, lower: "#2b3442", hairColor: "#3a2a1e", accent: "#8fd3ff", trim: "#2c4a7a" }),
  },
  {
    id: "lab",
    name: "Lab Tech",
    kind: "generic",
    look: makeLook({ build: "lanky", head: "helmet", hair: "bun", face: "glasses", outfit: "labcoat", extra: "clipboard", shell: "#6f8fa8", skin: SKIN.deep, lower: "#3a3f48", hairColor: "#1b120c", accent: "#9fe3c9", trim: "#f4f4f2" }),
  },
  {
    id: "dev",
    name: "Beanie Dev",
    kind: "generic",
    look: makeLook({ build: "humanoid", head: "helmet", hat: "beanie", face: "eyes", outfit: "jacket", extra: "backpack", shell: "#3b4556", skin: SKIN.light, lower: "#2e3f5c", accent: "#8fd3ff", trim: "#c86f4b" }),
  },
  { id: "retro", name: "Retro Terminal", kind: "generic", look: makeLook({ head: "crt", hat: "headphones", face: "screen", outfit: "vest", shell: "#d9d2c3", accent: "#7dffc4", trim: "#3a3a3a" }) },
  { id: "cube", name: "Cubist", kind: "generic", look: makeLook({ build: "stout", head: "cube", face: "eyes", outfit: "scarf", shell: "#cdc6e4", lower: "#6a5f8c", accent: "#b9a6ff", trim: "#e8a87c" }) },
  {
    id: "monarch",
    name: "Monarch of Nothing",
    kind: "generic",
    look: makeLook({ build: "stout", head: "helmet", hair: "long", hat: "crown", face: "eyes", outfit: "cape", shell: "#e9e4f2", skin: SKIN.pale, lower: "#4a2a5c", hairColor: "#d9d2c3", accent: "#b9a6ff", trim: "#7a2e5c" }),
  },
  {
    id: "pipe",
    name: "Pipe Specialist",
    kind: "icon",
    disclaimer: "A plumber. Any plumber. Not a famous one. Definitely not Italian. Stop asking.",
    look: makeLook({ build: "stout", head: "helmet", hair: "slick", hat: "cap", face: "mustache", outfit: "overalls", shell: "#d23a2e", skin: SKIN.light, lower: "#2b4fa8", hairColor: "#3a2214", accent: "#ffd08f", trim: "#d23a2e" }),
  },
  {
    id: "chosen",
    name: "Chosen-Adjacent",
    kind: "icon",
    disclaimer: "Long coat, small sunglasses. Generic 1999 fashion. There is no spoon (trademark pending).",
    look: makeLook({ build: "lanky", head: "helmet", hair: "slick", face: "shades", outfit: "trenchcoat", shell: "#141518", skin: SKIN.pale, lower: "#0d0e10", hairColor: "#0b0b0c", accent: "#5dff8f", trim: "#0b0c0e" }),
  },
  {
    id: "time-teen",
    name: "Late for 1985",
    kind: "icon",
    disclaimer: "Puffy red vest, hoverboard. Any resemblance to a famous time traveller is a paradox.",
    look: makeLook({ build: "humanoid", head: "helmet", hair: "pompadour", face: "eyes", outfit: "vest", extra: "hoverboard", shell: "#6d8fc2", skin: SKIN.light, lower: "#3b4f7a", hairColor: "#5a3a22", accent: "#ff9a3c", trim: "#c23b3b" }),
  },
  {
    id: "space-cowboy",
    name: "Space Cowboy",
    kind: "icon",
    disclaimer: "A cowboy. In space. Generic. Yeehaw is public domain.",
    look: makeLook({ build: "lanky", head: "helmet", hair: "long", hat: "cowboy", face: "eyes", outfit: "scarf", extra: "jetpack", shell: "#c8a77a", skin: SKIN.tan, lower: "#4a3b2a", hairColor: "#6b4a2e", accent: "#ffd08f", trim: "#7a4a26" }),
  },
  {
    id: "boy-wizard",
    name: "Boarding-School Wizard",
    kind: "icon",
    disclaimer: "Round glasses, black robes, a scarf. Scar not included, for legal reasons.",
    look: makeLook({ build: "humanoid", head: "helmet", hair: "spiky", hat: "wizard", face: "glasses", outfit: "robe", shell: "#7a1f24", skin: SKIN.light, lower: "#151418", hairColor: "#141210", accent: "#ffd08f", trim: "#151418" }),
  },
  {
    id: "tin-billionaire",
    name: "Tin Billionaire",
    kind: "icon",
    disclaimer: "Red and gold metal suit. Funded entirely by ambiguity.",
    look: makeLook({ build: "humanoid", head: "dome", face: "eyes", extra: "jetpack", shell: "#b8322c", skin: "#d9a441", lower: "#9e2a25", accent: "#cfefff", trim: "#d9a441" }),
  },
  {
    id: "laser-monk",
    name: "Laser Monk",
    kind: "icon",
    disclaimer: "Robes, hood, a glowing stick. Monks have existed for millennia; so have sticks.",
    look: makeLook({ build: "humanoid", head: "helmet", hair: "none", hat: "hood", face: "eyes", outfit: "robe", extra: "sword", shell: "#d8c8a8", skin: SKIN.warm, lower: "#5a3f28", accent: "#7fd3ff", trim: "#6a4a2e" }),
  },
  {
    id: "spirit-tech",
    name: "Spirit Removal Technician",
    kind: "icon",
    disclaimer: "Beige jumpsuit, large backpack. Who you gonna call? Legal, apparently.",
    look: makeLook({ build: "humanoid", head: "helmet", hair: "slick", face: "eyes", outfit: "jumpsuit", extra: "tank", shell: "#c9b88f", skin: SKIN.warm, lower: "#b5a47c", hairColor: "#3a2a1e", accent: "#ff6b8b", trim: "#c9b88f" }),
  },
  {
    id: "rock-avatar",
    name: "Gunter Rockstar",
    kind: "icon",
    disclaimer: "An 80s rock avatar from a virtual world we will not name. Guitar is generic.",
    look: makeLook({ build: "lanky", head: "helmet", hair: "mohawk", face: "shades", outfit: "jacket", extra: "guitar", shell: "#e8e8e8", skin: SKIN.pale, lower: "#1b1b1f", hairColor: "#ff5fa2", accent: "#ff7aa8", trim: "#141416" }),
  },
];

export const PRESET_BY_ID: Record<string, LookPreset> = Object.fromEntries(LOOK_PRESETS.map((p) => [p.id, p]));

export function lookFromPreset(id: string): Look {
  const p = PRESET_BY_ID[id] ?? PRESET_BY_ID.classic!;
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
