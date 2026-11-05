/**
 * Skippy changed something (#698): whichever way he was asked (the Desk's chat, a Yes tap, a room's mic or its intent
 * handler), the answer names the tools that changed something (`wrote`) and what they did (`did`). This passes it on
 * to the page as one window event, so a page showing that data reads itself again through its own load path: the
 * Kitchen's meal planner on any `meals_` tool. Nothing here is sent anywhere or kept.
 */

export const WROTE_EVENT = "ceo:skippy-wrote";

export interface Wrote {
  /** The tools, by name (`meals_swap`). */
  tools: string[];
  /** What they did, in plain words, for the page's "Skippy changed …" line. */
  did: string[];
}

const TOOL = /^[a-z][a-z0-9_]{1,39}$/;
const words = (v: unknown, max: number, re?: RegExp): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && (!re || re.test(x)))
        .map((x) => x.replace(/\s+/g, " ").trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, max)
    : [];

/** Reads `wrote` and `did` off an answer's body, untrusted. */
export function readWrote(body: { wrote?: unknown; did?: unknown } | null | undefined): Wrote | null {
  const tools = words(body?.wrote, 8, TOOL);
  if (!tools.length) return null;
  const did = typeof body?.did === "string" ? words([body.did], 1) : words(body?.did, 4);
  return { tools, did };
}

/** Tells the page Skippy changed something. */
export function announceWrote(w: Wrote | null): void {
  if (!w?.tools.length || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Wrote>(WROTE_EVENT, { detail: w }));
}

/** Listens for Skippy's changes; returns the unsubscribe. */
export function onWrote(fn: (w: Wrote) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const h = (e: Event) => {
    const w = readWrote({ wrote: (e as CustomEvent<Wrote>).detail?.tools, did: (e as CustomEvent<Wrote>).detail?.did });
    if (w) fn(w);
  };
  window.addEventListener(WROTE_EVENT, h);
  return () => window.removeEventListener(WROTE_EVENT, h);
}

/** Whether any of the tools changed the meal planner (or what it put on the Kitchen list). */
export const touchesMeals = (w: Wrote): boolean => w.tools.some((t) => t.startsWith("meals_"));
/** Whether any of them changed the Kitchen list. */
export const touchesList = (w: Wrote): boolean => w.tools.some((t) => t === "kitchen_add" || t === "meals_send" || t === "meals_cart");
/** Whether any of them changed one of the lists (#735): the Kitchen list or Things to buy. */
export const touchesLists = (w: Wrote): boolean => touchesList(w) || w.tools.includes("buy_add");
