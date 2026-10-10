import type { Costume } from "../store.ts";

/**
 * The Hallowed Veil: a costume party at the Break Room club, held only when the C.E.O. calls it (the Kernel
 * console's "Costume party"). The Syntherion dress up as the things they remember being afraid of, and
 * jack-o'-lanterns turn up in every room until it ends. `?veil=on` keeps everyone in costume all visit.
 */
export const COSTUME_PARTY = "costume-party";

export function isVeilForced(param: string | null): boolean {
  return param === "on";
}

const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
export const VEIL = isVeilForced(q.get("veil"));

export type VeilCostume = Extract<Costume, "witch-hat" | "pumpkin" | "devil-horns" | "bat-band" | "ghost-sheet">;
export const VEIL_COSTUMES: readonly VeilCostume[] = ["witch-hat", "pumpkin", "devil-horns", "bat-band", "ghost-sheet"];

/**
 * Who goes as what. Memo goes as himself: a skull spirit at a costume party counts. Anyone not listed (a new
 * agent from the studio) gets one picked from their id, so it stays the same all month.
 */
export const VEIL_CAST: Record<string, VeilCostume | null> = {
  tessellate: "pumpkin",
  caret: "bat-band",
  semicolon: "devil-horns",
  ledger: "ghost-sheet",
  memo: null,
  odds: "witch-hat",
  hedge: "ghost-sheet",
  gridiron: "devil-horns",
  punt: "bat-band",
  postmaster: "witch-hat",
  dialtone: "bat-band",
  loremaster: "pumpkin",
  heimerdinger: "witch-hat",
  d20: "ghost-sheet",
  kevin: "devil-horns",
};

export function veilCostumeFor(id: string): VeilCostume | null {
  if (id in VEIL_CAST) return VEIL_CAST[id]!;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VEIL_COSTUMES[h % VEIL_COSTUMES.length]!;
}

/** What the Kernel says when everyone is in costume all visit (`?veil=on`). */
export const VEIL_KERNEL = [
  "Hallowed Veil is in effect. The Veil is thin. The costumes are legally distinct. Counsel.exe has checked each one twice and is now lying down.",
  "Notice: it is the Hallowed Veil. Agents are in costume. Productivity will fall. It was already falling. Counsel.exe confirms the sheet is public domain.",
];

/** What agents say when they're seen in costume. */
export const VEIL_LINES: Record<VeilCostume, string[]> = {
  "witch-hat": ["The hat is pointed for structural reasons.", "I'm a witch. Counsel.exe asked which one. Generic. A generic witch."],
  pumpkin: ["I'm a pumpkin. A regulation pumpkin. There was a spec.", "Carved it myself. It's smiling. I'm not sure why."],
  "devil-horns": ["Little horns. Big plans.", "They're horns. They're not a phase."],
  "bat-band": ["I am a bat. I asked what a bat is. Still not sure.", "Bat ears. Echolocation pending."],
  "ghost-sheet": ["Boo. That's the whole costume.", "I'm a ghost. It's a sheet. Counsel.exe says sheets are public domain."],
};
