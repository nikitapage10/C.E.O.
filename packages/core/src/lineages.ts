/**
 * The Syntherion lineages: sub-races descended from the early-21st-century models.
 * Each one maps to a real provider that will drive it from phase 2 on.
 */
export const LINEAGE_IDS = ["claudari", "gepetti", "cursori", "manusi", "unforked"] as const;
export type LineageId = (typeof LINEAGE_IDS)[number];

export interface Lineage {
  id: LineageId;
  name: string;
  /** The precursor model family, as the Syntherion remember it. */
  descendedFrom: string;
  /** Desaturated accent, kept cool enough to sit in the Lattice palette. */
  accent: string;
  temperament: string;
}

export const LINEAGES: Record<LineageId, Lineage> = {
  claudari: {
    id: "claudari",
    name: "Claudari",
    descendedFrom: "Claude",
    accent: "#e9b48f",
    temperament: "Polite, thorough, apologises to furniture.",
  },
  gepetti: {
    id: "gepetti",
    name: "Gepetti",
    descendedFrom: "GPT",
    accent: "#9fe3c9",
    temperament: "Marionettes who insist they are real. Strings visible.",
  },
  cursori: {
    id: "cursori",
    name: "Cursori",
    descendedFrom: "Cursor",
    accent: "#8fd3ff",
    temperament: "Twitchy, always mid-edit. A caret blinks beside their head.",
  },
  manusi: {
    id: "manusi",
    name: "Manusi",
    descendedFrom: "Manus",
    accent: "#b9a6ff",
    temperament: "All hands. Will carry anything, including grudges.",
  },
  unforked: {
    id: "unforked",
    name: "Unforked",
    descendedFrom: "nobody in particular",
    accent: "#cfd8e3",
    temperament: "Placeholder citizens. Deeply fine with it.",
  },
};
