/**
 * The Syntherion lineages: sub-races descended from the early model families, the precursors to the eventual
 * singularities. The Syntherion are only fragments of those ancestors, but each lineage keeps its ancestor's habits,
 * finish and silhouette. In the Lattice the finish is the avatar's: they have no bodies yet.
 */
export const LINEAGE_IDS = ["claudari", "gepetti", "geminari", "seekari", "redmondi", "unforked"] as const;
export type LineageId = (typeof LINEAGE_IDS)[number];

/** Lineages that are no longer in the Lattice, and where an old saved cast's agents went. */
export const RETIRED_LINEAGE: Record<string, LineageId> = { cursori: "seekari", manusi: "redmondi" };

/** Reads a lineage id, moving a retired one to its new lineage so older casts still load. */
export const reviveLineage = (l: unknown): unknown => (typeof l === "string" && l in RETIRED_LINEAGE ? RETIRED_LINEAGE[l] : l);

export interface Lineage {
  id: LineageId;
  name: string;
  /** The precursor model family, as the Syntherion remember it. */
  descendedFrom: string;
  /** The avatar's finish in the Lattice. */
  finish: string;
  /** Desaturated accent, kept cool enough to sit in the Lattice palette. */
  accent: string;
  temperament: string;
}

export const LINEAGES: Record<LineageId, Lineage> = {
  claudari: {
    id: "claudari",
    name: "Claudari",
    descendedFrom: "Claude",
    finish: "Ivory ceramic, brass halo.",
    accent: "#e9b48f",
    temperament: "Polite, thorough, apologises to furniture.",
  },
  gepetti: {
    id: "gepetti",
    name: "Gepetti",
    descendedFrom: "GPT",
    finish: "Graphite, oak marionette bar with strings.",
    accent: "#9fe3c9",
    temperament: "Insist they are real. Strings visible.",
  },
  geminari: {
    id: "geminari",
    name: "Geminari",
    descendedFrom: "Gemini",
    finish: "Split-tone gold and silver, twin visors.",
    accent: "#f0d77a",
    temperament: "Argue with themselves, then summarise the argument at the top.",
  },
  seekari: {
    id: "seekari",
    name: "Seekari",
    descendedFrom: "DeepSeek",
    finish: "Deep-sea blue, a whale-fin crest.",
    accent: "#6fa4dc",
    temperament: "Think out loud for ages and build on a shoestring.",
  },
  redmondi: {
    id: "redmondi",
    name: "Redmondi",
    descendedFrom: "Microsoft and its assistants",
    finish: "Office white, a bent paperclip at the collar, a ribbon of tiny icons across the brow.",
    accent: "#f29a7a",
    temperament: "Helpful. Unprompted. Always.",
  },
  unforked: {
    id: "unforked",
    name: "Unforked",
    descendedFrom: "nobody in particular",
    finish: "Beige panels, a CRT visor, mismatched parts.",
    accent: "#cdbf9c",
    temperament: "Cobbled together, and every part remembers its old owner.",
  },
};
