/**
 * The lights the Haven leaves out (#1002, Nikita: "I don't even use" them): whole names as the apps name them, any
 * case. They still work (Skippy can switch them); the Lights panel and the house don't show them, and since #1077
 * the server never reads their states either. "Island Lights" is that light alone: "Island Underlights" stays.
 * Shared by the server (./lights.ts) and the browser (rooms/haven/web/lights.ts), so it imports nothing.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const HIDDEN_LIGHTS: readonly string[] = ["Bar Lights", "Christmas Tree", "Island Lights"];

const wordsOf = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** A light the Haven shows: not one of `hidden`. */
export const isShown = (name: string, hidden: readonly string[] = HIDDEN_LIGHTS) => !hidden.some((h) => wordsOf(h) === wordsOf(name));

/** The lights the Haven shows: all but `hidden`. */
export function shownLights<L extends { name: string }>(lights: readonly L[], hidden: readonly string[] = HIDDEN_LIGHTS): L[] {
  return lights.filter((l) => isShown(l.name, hidden));
}
