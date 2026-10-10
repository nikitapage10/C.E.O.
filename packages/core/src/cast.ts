import { z } from "zod";
import { LINEAGE_IDS, LINEAGES, type LineageId } from "./lineages.ts";

/**
 * The cast: who each agent *is*, as opposed to what it's doing. Looks, personality and relationships are
 * pure role-play — they never change what an agent is allowed to do (that's the autonomy policy's job).
 */

export const HEADS = ["helmet", "dome", "crt", "cube"] as const;
export const HATS = ["none", "cap", "tophat", "headphones", "crown", "cowboy", "wizard", "beanie", "halo", "hood"] as const;
export const FACES = ["visor", "eyes", "screen", "shades", "glasses", "mustache"] as const;
export const OUTFITS = ["none", "tie", "scarf", "cape", "jacket", "labcoat", "trenchcoat", "overalls", "jumpsuit", "robe", "vest"] as const;
export const EXTRAS = ["none", "backpack", "sword", "guitar", "jetpack", "clipboard", "hoverboard", "tank"] as const;

export const LookSchema = z.object({
  /** The preset this look started from, if any (purely informational). */
  preset: z.string().optional(),
  head: z.enum(HEADS),
  hat: z.enum(HATS),
  face: z.enum(FACES),
  outfit: z.enum(OUTFITS),
  extra: z.enum(EXTRAS),
  shell: z.string().regex(/^#[0-9a-f]{6}$/i),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  /** Hat / outfit / prop colour. */
  trim: z.string().regex(/^#[0-9a-f]{6}$/i),
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
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CastSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), ProfileSchema),
  relationships: z.array(RelationshipSchema),
});
export type Cast = z.infer<typeof CastSchema>;

/** The default finish for each lineage (what an agent looks like before you dress it up). */
export const LINEAGE_LOOK: Record<LineageId, Look> = {
  claudari: { head: "helmet", hat: "halo", face: "visor", outfit: "none", extra: "none", shell: "#e7dfd3", accent: LINEAGES.claudari.accent, trim: "#c9a25c" },
  gepetti: { head: "helmet", hat: "none", face: "visor", outfit: "none", extra: "none", shell: "#1d2026", accent: LINEAGES.gepetti.accent, trim: "#b48c60" },
  cursori: { head: "helmet", hat: "none", face: "visor", outfit: "none", extra: "none", shell: "#3b4556", accent: LINEAGES.cursori.accent, trim: "#cfd9e6" },
  manusi: { head: "helmet", hat: "none", face: "visor", outfit: "none", extra: "none", shell: "#cdc6e4", accent: LINEAGES.manusi.accent, trim: "#f1eefa" },
  unforked: { head: "helmet", hat: "none", face: "visor", outfit: "none", extra: "none", shell: "#9aa3ad", accent: LINEAGES.unforked.accent, trim: "#e6e9ed" },
};

export interface LookPreset {
  id: string;
  name: string;
  kind: "generic" | "icon";
  /** What Counsel.exe insists this is. */
  disclaimer?: string;
  look: Omit<Look, "preset">;
}

/**
 * Avatar presets. "icon" ones are Ready-Player-One-style costumes: unmistakable silhouettes, legally distinct
 * names. Counsel.exe has reviewed all of them and would like to stop being asked.
 */
export const LOOK_PRESETS: LookPreset[] = [
  { id: "classic", name: "Classic Syntherion", kind: "generic", look: { ...LINEAGE_LOOK.unforked } },
  { id: "office", name: "Middle Management", kind: "generic", look: { head: "helmet", hat: "none", face: "glasses", outfit: "tie", extra: "clipboard", shell: "#c9ced6", accent: "#8fd3ff", trim: "#2c4a7a" } },
  { id: "lab", name: "Lab Tech", kind: "generic", look: { head: "dome", hat: "none", face: "glasses", outfit: "labcoat", extra: "clipboard", shell: "#dfe6ee", accent: "#9fe3c9", trim: "#f4f4f2" } },
  { id: "dev", name: "Beanie Dev", kind: "generic", look: { head: "helmet", hat: "beanie", face: "visor", outfit: "jacket", extra: "backpack", shell: "#3b4556", accent: "#8fd3ff", trim: "#c86f4b" } },
  { id: "retro", name: "Retro Terminal", kind: "generic", look: { head: "crt", hat: "headphones", face: "screen", outfit: "vest", extra: "none", shell: "#d9d2c3", accent: "#7dffc4", trim: "#3a3a3a" } },
  { id: "cube", name: "Cubist", kind: "generic", look: { head: "cube", hat: "none", face: "eyes", outfit: "scarf", extra: "none", shell: "#cdc6e4", accent: "#b9a6ff", trim: "#e8a87c" } },
  {
    id: "pipe",
    name: "Pipe Specialist",
    kind: "icon",
    disclaimer: "A plumber. Any plumber. Not a famous one. Definitely not Italian. Stop asking.",
    look: { head: "dome", hat: "cap", face: "mustache", outfit: "overalls", extra: "none", shell: "#f0d9c4", accent: "#ff5a4a", trim: "#d23a2e" },
  },
  {
    id: "chosen",
    name: "Chosen-Adjacent",
    kind: "icon",
    disclaimer: "Long coat, small sunglasses. Generic 1999 fashion. There is no spoon (trademark pending).",
    look: { head: "helmet", hat: "none", face: "shades", outfit: "trenchcoat", extra: "none", shell: "#1a1c20", accent: "#5dff8f", trim: "#0b0c0e" },
  },
  {
    id: "time-teen",
    name: "Late for 1985",
    kind: "icon",
    disclaimer: "Puffy vest, hoverboard. Any resemblance to a famous time traveller is a paradox.",
    look: { head: "helmet", hat: "none", face: "visor", outfit: "vest", extra: "hoverboard", shell: "#e6dccd", accent: "#ff9a3c", trim: "#c23b3b" },
  },
  {
    id: "space-cowboy",
    name: "Space Cowboy",
    kind: "icon",
    disclaimer: "A cowboy. In space. Generic. Yeehaw is public domain.",
    look: { head: "helmet", hat: "cowboy", face: "visor", outfit: "scarf", extra: "jetpack", shell: "#d8cfc0", accent: "#ffd08f", trim: "#8a5a34" },
  },
  {
    id: "boy-wizard",
    name: "Boarding-School Wizard",
    kind: "icon",
    disclaimer: "Round glasses and a scarf. Scar not included, for legal reasons.",
    look: { head: "helmet", hat: "wizard", face: "glasses", outfit: "robe", extra: "none", shell: "#e7dfd3", accent: "#ffd08f", trim: "#7a1f24" },
  },
  {
    id: "tin-billionaire",
    name: "Tin Billionaire",
    kind: "icon",
    disclaimer: "Red and gold metal suit. Funded entirely by ambiguity.",
    look: { head: "dome", hat: "none", face: "eyes", outfit: "none", extra: "jetpack", shell: "#b8322c", accent: "#ffe4a0", trim: "#d9a441" },
  },
  {
    id: "laser-monk",
    name: "Laser Monk",
    kind: "icon",
    disclaimer: "Robes, hood, a glowing stick. Monks have existed for millennia; so have sticks.",
    look: { head: "helmet", hat: "hood", face: "visor", outfit: "robe", extra: "sword", shell: "#c9b89a", accent: "#7fd3ff", trim: "#6a5638" },
  },
  {
    id: "spirit-tech",
    name: "Spirit Removal Technician",
    kind: "icon",
    disclaimer: "Beige jumpsuit, large backpack. Who you gonna call? Legal, apparently.",
    look: { head: "helmet", hat: "none", face: "visor", outfit: "jumpsuit", extra: "tank", shell: "#d8cbb0", accent: "#ff6b8b", trim: "#a8987a" },
  },
  {
    id: "rock-avatar",
    name: "Gunter Rockstar",
    kind: "icon",
    disclaimer: "An 80s rock avatar from a virtual world we will not name. Guitar is generic.",
    look: { head: "helmet", hat: "none", face: "shades", outfit: "jacket", extra: "guitar", shell: "#2a2430", accent: "#ff7aa8", trim: "#1b1b1f" },
  },
  {
    id: "monarch",
    name: "Monarch of Nothing",
    kind: "generic",
    look: { head: "dome", hat: "crown", face: "visor", outfit: "cape", extra: "none", shell: "#e9e4f2", accent: "#b9a6ff", trim: "#7a2e5c" },
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
