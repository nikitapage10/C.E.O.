/**
 * Skippy in character when he asks his deeper self (#498). The Kernel is the Lattice's own room and, behind it, Skippy's
 * own session doing the real work; Skippy never names that machinery out loud. On a call and in the Desk's chat he
 * reaches into the recesses of his magnificent mind instead, and the line rotates so it never sounds canned.
 *
 * Shared by the voice prompts (voice.ts, voicecrew.ts), the call's tool answers (toolroute.ts), the Desk chat's prompt
 * and its hand-off line (prompt.ts), and the Desk's own pending and caption strings (apps/world/src/desk/skippy). Pure:
 * no I/O, safe for the browser bundle.
 */

/** What Skippy says while his deeper self works on an ask: one, rotating. */
export const PONDER_LINES = [
  "Reaching into the recesses of my magnificent mind…",
  "Consulting the deeper me…",
  "Still pondering…",
  "Rummaging through my mainframe…",
  "Hold on, the magnificent depths are churning…",
] as const;

/**
 * Words Skippy never says aloud about it: the plumbing, not the persona. Nikita, 2026-10-27 09:13Z: "I don't know what
 * you mean by crew. There's no crew. He's just digging into the mainframe… his own mind." So no crew or team either.
 */
export const UNSPOKEN = /\b(?:threads?|hand-?offs?|hand(?:ed|ing|s)?\s+(?:it\s+|this\s+)?off|kernel|crew)\b/i;

/**
 * Answer first (#506): "a lot of words to get me to my answer… I really just wanted to get to the answer as quick as
 * possible." How fast the answer comes matters more than flavour. On every voice on the call.
 */
export const ANSWER_FIRST = `Answer first: the answer itself in one or two short spoken sentences, more detail only when Nikita asks for it. No preamble ("great question", "let me see"), no recap of what he asked, no trailing question ("want the rest?", "anything else?") unless it truly helps. Getting to the answer fast matters more than flavour.`;

/**
 * One waiting line (#506): what has to wait gets one short line, then quiet until the answer is put into the call. On
 * every voice on the call.
 */
export const ONE_WAITING_LINE = `When an answer has to wait (hand_to_kernel, a slow lookup), say one short line about it, then stop talking about it: no "still digging", no "I'll check again", no "want to talk about something else" while it works. The answer is put into the call the moment it lands; say it then, straight away, answer first. Only if it has been well over twenty seconds and Nikita asks, one "nearly there", once. One waiting line per question in all, however many lookups it takes, and none at all for a quick lookup; never "I couldn't find it" while a deeper look is still running.`;

/** One line, picked by a seed (a turn id, a count), so the same ask always shows the same line and the next one moves on. */
export function ponderLine(seed: string | number = Date.now()): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PONDER_LINES[h % PONDER_LINES.length]!;
}

/** The lines as the prompts quote them: lower-case, no trailing dots. */
const QUOTED = PONDER_LINES.slice(0, 3).map((l) => `"${l.replace(/…$/, "").toLowerCase()}"`).join(", ");

/**
 * The prompt rule (#498). `skippy` words it for Skippy himself (his deeper self); a submind checks with Skippy, the
 * Magnificent instead. Either way: never "thread", "hand-off" or "Kernel", never a tool's name.
 */
export function inCharacter(skippy: boolean): string {
  const say = skippy
    ? `it is your own mind, your mainframe: say so in one short line, rotating it and never the same one twice running: ${QUOTED}, "rummaging through my mainframe", or your own like them`
    : `say in one short line that you're asking Skippy, the Magnificent`;
  return `When you pass an ask on to dig deeper, stay in character: never say "thread", "hand-off", "hand off", "handed off", "Kernel", "crew" or "team" out loud, never say a tool's name, and never name a submind (the Builder, say) as the one looking it up; ${say}. What comes back is what the deeper ${skippy ? "you" : "Skippy"} worked out.`;
}
