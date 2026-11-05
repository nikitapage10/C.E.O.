import { TAPBACKS, TAPBACK_FACE, type ShownText, type Tapback } from "../../../api/_relay/texts.ts";

/**
 * Tapbacks and emoji on the Relay card (#888; Nikita, 2026-11-05: "lets me like heart, thumbs up messages, like you
 * would in iMessage"). Pure, so the view only draws.
 *
 *   tapbacks   iMessage's six (heart, thumbs up, thumbs down, haha, !!, ?) on one of their shown lines, the latest by
 *              default. Each tap is one send request (the unlock, single-use, 10 minutes), aimed at the line by its
 *              opaque ref; the Mac alone knows which message that is. Nothing is sent without the tap.
 *   emoji      a small hand-made grid for the composer, put in at the cursor. No library.
 */

export { TAPBACKS, TAPBACK_FACE, type Tapback };

/** Their lines a tapback can go on (#888): those the Mac gave a ref, never Nikita's own, oldest first. */
export const reactable = (messages: readonly ShownText[] | undefined): ShownText[] => (messages ?? []).filter((m) => typeof m.ref === "string" && !m.me);

/** The line a tapback goes on: the one picked, while it is still shown, else their latest. Null when there is none. */
export function tapbackTarget(messages: readonly ShownText[] | undefined, picked: string | null): ShownText | null {
  const lines = reactable(messages);
  return lines.find((m) => m.ref === picked) ?? lines.at(-1) ?? null;
}

/** The line before or after `ref` among their lines, for the card's small stepper; the same line at either end. */
export function stepLine(messages: readonly ShownText[] | undefined, ref: string | null, by: -1 | 1): string | null {
  const lines = reactable(messages);
  if (!lines.length) return null;
  const at = lines.findIndex((m) => m.ref === ref);
  const i = Math.max(0, Math.min(lines.length - 1, (at < 0 ? lines.length - 1 : at) + by));
  return lines[i]!.ref!;
}

/**
 * The composer's emoji (#888): a short, common set in a few rows, picked by hand. Each is one grapheme a phone shows
 * the same way, with a name for the screen reader.
 */
export const EMOJI: readonly { e: string; name: string }[] = [
  { e: "\u{1F602}", name: "tears of joy" },
  { e: "\u{1F923}", name: "rolling on the floor laughing" },
  { e: "\u{1F60A}", name: "smiling" },
  { e: "\u{1F642}", name: "slight smile" },
  { e: "\u{1F609}", name: "wink" },
  { e: "\u{1F60D}", name: "heart eyes" },
  { e: "\u{1F618}", name: "kiss" },
  { e: "\u{1F60E}", name: "sunglasses" },
  { e: "\u{1F914}", name: "thinking" },
  { e: "\u{1F605}", name: "sweat smile" },
  { e: "\u{1F62D}", name: "crying" },
  { e: "\u{1F62E}", name: "surprised" },
  { e: "\u{1F643}", name: "upside-down" },
  { e: "\u{1F644}", name: "eye roll" },
  { e: "\u{1F634}", name: "sleeping" },
  { e: "\u{1F97A}", name: "pleading" },
  { e: "\u{1F44D}", name: "thumbs up" },
  { e: "\u{1F44E}", name: "thumbs down" },
  { e: "\u{1F44F}", name: "clapping" },
  { e: "\u{1F64C}", name: "raised hands" },
  { e: "\u{1F64F}", name: "thank you" },
  { e: "\u{1F44B}", name: "wave" },
  { e: "\u{1F4AA}", name: "flexed arm" },
  { e: "\u{1F91D}", name: "handshake" },
  { e: "❤️", name: "red heart" },
  { e: "\u{1F499}", name: "blue heart" },
  { e: "\u{1F525}", name: "fire" },
  { e: "✨", name: "sparkles" },
  { e: "\u{1F389}", name: "party" },
  { e: "\u{1F382}", name: "birthday cake" },
  { e: "✅", name: "check mark" },
  { e: "\u{1F440}", name: "eyes" },
  { e: "\u{1F4AF}", name: "hundred" },
  { e: "☕", name: "coffee" },
  { e: "\u{1F37B}", name: "cheers" },
  { e: "\u{1F3B6}", name: "music" },
];

/**
 * `emoji` put into `text` at the cursor (`start` to `end`, a selection replaced), and where the cursor goes after it.
 * Positions out of range fall back to the end, as a box that was never focused has its cursor there.
 */
export function insertAt(text: string, start: number | null | undefined, end: number | null | undefined, emoji: string): { text: string; caret: number } {
  const len = text.length;
  const a = typeof start === "number" && start >= 0 && start <= len ? start : len;
  const b = typeof end === "number" && end >= a && end <= len ? end : a;
  return { text: text.slice(0, a) + emoji + text.slice(b), caret: a + emoji.length };
}
