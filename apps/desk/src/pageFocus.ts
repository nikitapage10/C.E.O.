/**
 * Focus after a menu click (#934, Nikita 2026-11-06 01:11Z): a click on a room in the bar left focus on that link, so
 * holding Space straight away pressed the link (holdToTalk.ts leaves native Space to a focused link) instead of
 * talking. When the page changes, focus moves to the page's main region (`tabIndex={-1}`, no visible ring, no scroll),
 * where Space is hold-to-talk's; Tab still walks back to the bar. Focus a page already put somewhere inside itself (a
 * reply box it opened), or that sits in an open dialogue (Skippy's chat), stays where it is.
 */

interface Focusable {
  focus: (opts?: FocusOptions) => void;
  contains: (other: unknown) => boolean;
}
interface DocLike {
  activeElement: unknown;
  querySelector: (sel: string) => unknown;
}

/** The main region on screen: the one kept room (#759, keptRooms.ts) that isn't hidden. */
export const SHOWN_MAIN = ".desk__main:not([hidden])";

/** Moves focus to the page on screen after a change of page; whether it did. */
export function focusPage(doc: DocLike = document): boolean {
  const main = doc.querySelector(SHOWN_MAIN) as Focusable | null;
  if (!main) return false;
  const at = doc.activeElement as (Element & { closest?: (sel: string) => Element | null }) | null;
  if (at && (at as unknown) !== main && main.contains(at)) return false;
  if (at?.closest?.("dialog, [role='dialog'], [aria-modal='true']")) return false;
  main.focus({ preventScroll: true });
  return true;
}
