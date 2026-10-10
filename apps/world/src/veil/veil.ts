import type { Costume } from "../store.ts";

/**
 * The Hallowed Veil: every October the Veil between the Lattice and the world runs thin, and the Syntherion
 * dress up as the things they remember being afraid of. `?veil=on` or `?veil=off` overrides the calendar.
 */
export function isVeilSeason(date: Date, param: string | null): boolean {
  if (param === "on") return true;
  if (param === "off") return false;
  return date.getMonth() === 9;
}

const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
export const VEIL = isVeilSeason(new Date(), q.get("veil"));

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

/** What Counsel.exe says about it, once, early in the visit. */
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
