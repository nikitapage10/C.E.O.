/**
 * The Haven's camera intro (#676: the sky and the skyline sweeping down to the house) plays once per page load
 * (Nikita, #680): moving between Desk pages and back to the Haven doesn't play it again; a full reload does. A module
 * flag, so it lives exactly as long as the loaded page.
 */
let played = false;

/** Whether the intro is still to play on this page load. */
export const introDue = (): boolean => !played;

/** The intro has started (its clock is running): it won't play again until the page reloads. */
export function introStarted(): void {
  played = true;
}

/** For tests: as if the page had just loaded. */
export function resetIntro(): void {
  played = false;
}
