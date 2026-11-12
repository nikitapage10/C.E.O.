/**
 * An answer that lands on a live Talk call (#952). Nikita, 2026-11-06: the election answer landed in the chat at about
 * 20 s, the call said "Still pondering" instead, and a second spoken answer came a minute later.
 *
 * Why: the call asked two ways at once. Its own web_search said "still searching, call again, then hand it on", so the
 * agent was mid tool call (polling the search) when the deeper answer landed; the turn asked for then went in while a
 * tool was out, and the agent answered the tool's "still searching" with a waiting line instead of the answer. When the
 * search finally came back, it was said as a second answer.
 *
 * So, in the browser: an answer that lands while one of the call's tools is out is held and put in the moment the tool
 * comes back (`toolsDone`), and the same answer is never put in twice. What is spoken is short, its first sentence or
 * two; the whole answer stays in the chat. The server side (api/_skippy/toolroute.ts) no longer polls a slow search: it
 * passes the question on once and answers a repeat of it with silence. Pure, for the tests.
 */

/** The most of a landed answer put into the call to be said: a sentence or two; the rest is in the chat. */
export const SPOKEN_MAX = 280;

/** The first sentence or two of an answer, at most SPOKEN_MAX characters, cut at a sentence end when it can be. */
export function shortSpoken(text: string, max = SPOKEN_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  const sentences = t.match(/[^.!?]+[.!?]+(?:["”’)]+)?(?:\s|$)/g)?.map((s) => s.trim()) ?? [];
  if (!sentences.length) return t.length <= max ? t : `${t.slice(0, t.lastIndexOf(" ", max) > 0 ? t.lastIndexOf(" ", max) : max).trimEnd()}`;
  let out = sentences[0]!;
  if (sentences[1] && `${out} ${sentences[1]}`.length <= max) out = `${out} ${sentences[1]}`;
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).trimEnd();
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240);

/** One call's landings: what is held until a tool is back, and what has been said already. */
export function createLanding() {
  const said = new Set<string>();
  let held: string | null = null;
  return {
    /** An answer landed: the text to put in now, or null (held behind a tool that is out, or said already). */
    landed(text: string, toolOut: boolean): string | null {
      const key = norm(text);
      if (!key || said.has(key)) return null;
      if (toolOut) {
        held = text;
        return null;
      }
      said.add(key);
      held = null;
      return text;
    },
    /** The call's tools are all back: the held answer, to put in now, or null. */
    toolsDone(): string | null {
      const h = held;
      held = null;
      if (h === null || said.has(norm(h))) return null;
      said.add(norm(h));
      return h;
    },
    reset() {
      said.clear();
      held = null;
    },
  };
}

/**
 * The call's own seatbelt (#1054): the server keeps a final answer on every passed-on question within 45 s, an honest
 * "couldn't get it" when nothing came (api/_skippy/calldeliver.ts). Should even that never land (the instance went
 * away), the call stops waiting after this long and says so plainly, once, instead of filling the line.
 */
export const CALL_GIVE_UP_MS = 70_000;

/** What Skippy is told when a question's answer never landed: say it plainly, once, and stop. */
export const GIVE_UP_NOTE =
  "The deeper you couldn't get an answer to what Nikita asked you to look into. Tell him plainly, in one short sentence in character, that you couldn't get it this time and he can ask again or type it into the chat. No guess at the answer, no waiting line, and stop talking about it.";
