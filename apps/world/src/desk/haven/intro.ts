/**
 * The Haven's camera intro (#676: the sky and the skyline sweeping down to the house) plays once per page load
 * (Nikita, #680): moving between Desk pages and back to the Haven doesn't play it again; a full reload does. A module
 * flag, so it lives exactly as long as the loaded page.
 */
let played = false;

/** True the first time it's asked on this page load (the intro plays), false every time after. */
export function takeIntro(): boolean {
  if (played) return false;
  played = true;
  return true;
}

/** For tests: as if the page had just loaded. */
export function resetIntro(): void {
  played = false;
}
