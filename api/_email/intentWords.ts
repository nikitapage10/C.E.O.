/**
 * The Relay's free first look at what Nikita says (#642): the phrases that need no model at all. Pure, no node
 * imports, so the Desk (rooms/relay/data/thread.ts) and the server (./intent.ts) read the same words.
 *
 *   closingOf     "already did it", "sent it", "done", "handled", "no worries", "taken care of": the item is done.
 *                 No draft, no question back.
 *   skipOf        "skip", "pass", "nah", "not this one": the item is gone, like Done, until the sender writes again.
 *   draftAsk      "draft it", "draft a reply", "write back": Blasto drafts from his own advice.
 *   quickIntent   the three together, as the intent the model would have given. Anything else goes to Dialtone's one
 *                 Haiku call (./intent.ts), which never sees a line this already settled.
 */

export type Disposition = "done" | "skip" | "later";

/** A line made comparable: case, curly quotes, punctuation and spaces folded. */
export const normWords = (w: string): string =>
  w
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.!,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TAIL = "(?: (?:already|now|then|thanks|thank you|mate|man|dude|ok|okay))*";
const LEAD = "(?:(?:oh|ah|yeah|yep|nah|no worries|no problem|no|ok|okay|it's fine|all good)(?: |$))*";

/** Lines that say the thing is already handled. Each whole line, so "done with the old draft, now say…" isn't one. */
const CLOSING = new RegExp(
  `^${LEAD}(?:` +
    [
      "(?:i )?already (?:did|done|sent|replied|answered|handled|called|texted|emailed|paid|sorted|dealt with|took care of|responded)(?: (?:it|that|this|them|him|her|to (?:it|them|him|her)))?",
      "(?:i )?(?:did|sent|handled|answered|sorted|replied to) (?:it|that|this|them)(?: already)?",
      "(?:i )?(?:replied|responded|answered|called them|texted them|wrote back)(?: already)?",
      "(?:it's |that's |all |i'm )?(?:done|handled|sorted|dealt with|taken care of|covered)",
      "(?:i )?took care of (?:it|that|this)",
      "no worries",
      "nothing to do(?: here)?",
      "(?:mark (?:it|this) )?(?:as )?done",
      "close (?:it|this)(?: out)?",
    ].join("|") +
    `)${TAIL}$`,
);

const SKIP = /^(?:skip(?: (?:it|this|this one|that))?|pass|nah|nope|not this one|next|leave it|ignore (?:it|this)|not now nope)(?: (?:please|thanks))?$/;
const LATER = /^(?:later|not now|remind me later|ask me later|come back to (?:it|this)(?: later)?|after|tomorrow)(?: (?:please|thanks))?$/;
const DRAFT = /^(?:(?:ok |okay |yes |sure )?(?:draft|write|do)(?: (?:it|one|me one|a reply|a response|back|the reply|something))?(?: for me)?(?: please)?|reply|draft it up|write back|answer (?:it|them))$/;

/** "done" when a line says the thing is already handled; null otherwise. */
export function closingOf(raw: string): "done" | null {
  const w = normWords(raw);
  if (!w || /\?/.test(raw)) return null;
  return CLOSING.test(w) ? "done" : null;
}

/** "skip" for "skip / pass / nah / not this one". */
export function skipOf(raw: string): "skip" | null {
  return SKIP.test(normWords(raw)) ? "skip" : null;
}

/** Whether a line only asks Blasto to draft (no words of its own for the reply). */
export function draftAsk(raw: string): boolean {
  return DRAFT.test(normWords(raw));
}

/** What a line means without a model, or null when Dialtone has to read it. */
export type QuickIntent = { kind: "disposition"; disposition: Disposition } | { kind: "draft" };

export function quickIntent(raw: string): QuickIntent | null {
  if (closingOf(raw)) return { kind: "disposition", disposition: "done" };
  if (skipOf(raw)) return { kind: "disposition", disposition: "skip" };
  if (LATER.test(normWords(raw))) return { kind: "disposition", disposition: "later" };
  if (draftAsk(raw)) return { kind: "draft" };
  return null;
}

/** Short closing replies Nikita sends ("no worries", "sounds good", "see you then"): after one, an acknowledgement owes nothing. */
const CLOSING_REPLY = /^(?:no worries|no problem|np|sounds good|perfect|great|cool|ok(?:ay)?|thanks?(?: you)?(?: so much)?|ty|cheers|see you(?: then| there| soon| tomorrow)?|see ya|talk soon|night|good ?night|will do|got it|done|deal|love you|ly|you too|same|haha|lol|👍|🙏|❤️|😊)(?: [^\w\s]{1,3})?$/u;
/** An acknowledgement that asks nothing back. */
const ACK = /^(?:ok(?:ay)?|k|kk|cool|great|perfect|nice|thanks?(?: you)?|ty|cheers|np|no worries|sounds good|you too|same|haha|lol|see you(?: then)?|night|good ?night|love you|yes|yep|yeah|👍|🙏|❤️|😊|😂|👌|🙌)(?: [^\w\s]{1,3})?$/u;

/** Whether Nikita's own text closed the conversation. */
export const closingReply = (text: string): boolean => CLOSING_REPLY.test(normWords(text)) || closingOf(text) !== null;

/** Whether every text in a run is only an acknowledgement (nothing asked, nothing new). */
export const onlyAcks = (texts: readonly string[]): boolean => texts.length > 0 && texts.every((t) => ACK.test(normWords(t)));
