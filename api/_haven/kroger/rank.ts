/**
 * Which King Soopers product a Kitchen list item gets by default (#677). Kroger's search is broad: "Lobster" brings
 * back imitation lobster, Red Lobster biscuit mix, lobster ravioli and crab alongside the lobster tails. A small score
 * puts the real thing first: the item's words in the description, best as its main noun ("Lobster Tails", "Organic
 * Lemons"); down for imitation, flavoured, "style", mixes and seasonings, for a hit that's only the brand's name, and
 * for out of stock. Ties keep Kroger's order. Pure: no calls, no state.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { Product } from "./api.js";

/** One word, folded: lower case, no apostrophes, a plain plural made singular. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/['’]/g, "");
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const UNIT = /^(\d.*|oz|lb|lbs|ct|pk|pack|count|fl|gal|ml|l|g|kg|each|ea)$/;
const words = (text: string) => text.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean).map(stem).filter((w) => !UNIT.test(w));

/** Container and unit words a product can match on without being food. */
const CONTAINER = /\b(?:cups?|oz|ounces?|cans?|jars?|bags?)\b/i;

/** Words that make a product something other than the item itself, unless the item names them too. */
const OFF: Record<string, number> = { imitation: 14, flavored: 7, flavor: 6, flavour: 6, style: 6, mix: 7, seasoning: 7, ravioli: 4, soup: 4, bisque: 4, sauce: 4, dip: 4, chip: 4, cracker: 4, broth: 3, spread: 3 };
/** Words after the item's word that keep it the main thing: lobster tails, lobster meat, chicken breasts. */
const FORM = new Set(["tail", "meat", "fillet", "filet", "breast", "thigh", "steak", "whole", "fresh", "frozen", "raw", "cooked", "bunch", "bag", "box", "loose", "organic"]);

/** How well one product fits a list item's search term: higher is better. */
export function scoreProduct(term: string, p: Pick<Product, "description" | "brand" | "stock">): number {
  const want = words(term);
  if (!want.length) return 0;
  const desc = words(p.description);
  const brand = words(p.brand);
  // The description without the brand's own words at its start ("Red Lobster Cheddar Bay Biscuit Mix").
  const lead = brand.length && brand.every((w, i) => desc[i] === w) ? brand.length : 0;
  const body = desc.slice(lead);
  let score = 0;

  const found = want.filter((w) => body.includes(w)).length;
  if (found === want.length) score += 10;
  else if (found) score += 4 * (found / want.length);
  else {
    score -= desc.some((w) => want.includes(w)) ? 12 : 20; // only in the brand's name, or not at all
    // A hit on a unit word alone ("panko, 1 cup" finding a plastic cup, #737): the container, not the food.
    if (CONTAINER.test(p.description)) score -= 10;
  }

  // The main noun: the item's last word ends the description, or only a form word follows it.
  const at = body.lastIndexOf(want[want.length - 1]!);
  if (at >= 0) {
    const after = body.slice(at + 1);
    if (!after.length) score += 3;
    else if (after.every((w) => FORM.has(w))) score += 2;
  }

  for (const w of new Set(desc)) if (OFF[w] && !want.includes(w)) score -= OFF[w]!;
  if (p.stock === "out") score -= 30;
  else if (p.stock === "low") score -= 1;
  return score;
}

/** The products best first for a term (ties in Kroger's order): the first is the default pick, the rest to swap to. */
export function rankProducts<P extends Pick<Product, "description" | "brand" | "stock">>(term: string, found: P[]): P[] {
  return found
    .map((p, i) => ({ p, i, s: scoreProduct(term, p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}
