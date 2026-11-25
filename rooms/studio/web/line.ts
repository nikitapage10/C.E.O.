/**
 * The Studio's timeline (#311; live since #1227): a step as the page's clips and the stage's monitors (soundstage.ts)
 * both show it, and where a key press moves the playhead. The steps themselves are the selected episode's four stages
 * from the desk (rooms/studio/data/desk.ts); nothing here is planned or made up.
 */

export interface Step {
  k: string;
  t: string;
  s: string;
  w: string;
}

/**
 * Where a key press moves the timeline's selection (the clips are tabs): the arrows step, Home and End jump to the
 * ends, nothing wraps. Null for a key the timeline leaves alone.
 */
export function stepTo(key: string, at: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(last, at + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
