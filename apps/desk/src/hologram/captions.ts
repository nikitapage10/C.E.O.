/**
 * The call's caption follows the speech (#952, Nikita 2026-11-06: "call captions don't scroll with long lines, they
 * truncate"). The caption box shows two lines; a longer line scrolls a line at a time at the pace it is spoken, so the
 * line being said is always the one in view, and the whole of it is seen by the time he stops. No "…" ever.
 *
 * Pure: the stage (HologramStage.tsx) measures the box and counts the speaking time.
 */

/** How fast the voice speaks, in characters a second (ElevenLabs' pace for Skippy, a little ahead rather than behind). */
export const SPEECH_CPS = 15;
/** The lines the caption box shows at once. */
export const CAPTION_LINES = 2;

/** How much of a line of `chars` characters has been said after `spokenMs` of speaking, 0 to 1. */
export function spokenShare(
  spokenMs: number,
  chars: number,
  cps = SPEECH_CPS,
): number {
  if (chars <= 0) return 1;
  return Math.max(0, Math.min(1, ((spokenMs / 1000) * cps) / chars));
}

/**
 * The first line in view for a caption of `lines` lines once `share` of it is said: the line being said is kept as the
 * bottom one in view, from the start until the last lines show. 0 when it fits.
 */
export function captionTop(
  share: number,
  lines: number,
  shown = CAPTION_LINES,
): number {
  if (lines <= shown) return 0;
  const reading = Math.min(
    lines - 1,
    Math.floor(Math.max(0, Math.min(1, share)) * lines),
  );
  return Math.max(0, Math.min(lines - shown, reading - (shown - 1)));
}
