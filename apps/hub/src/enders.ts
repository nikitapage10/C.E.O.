/**
 * Conversation-enders (#950, Nikita 2026-11-06 02:00Z): a read chat whose last text from them only closes the
 * conversation ("ok cool", "lol", "haha", "sounds good", a thumbs-up, a tapback) waits on no one. This is the cheap
 * pre-pass on the Mac, without a model: only an obvious ender is caught here; anything with a question, a request or
 * news goes on to Dialtone (the site's Claude call, within the cap), which judges whether it needs a reply. An unread
 * chat skips the judgment, unless its unread text is over UNREAD_ENDER_MS old (the Mac's read state can lag the phone's,
 * so an old "ok cool" mustn't sit in the list for ever).
 */

/** An unread text older than this still goes through the ender check (#950). */
export const UNREAD_ENDER_MS = 3 * 24 * 60 * 60_000;

/** Words that only acknowledge. Each text must be made of these alone (and a little punctuation or emoji). */
const ACK_WORDS = new Set(
  "ok okay okk okie k kk cool coolio great perfect nice awesome amazing sweet dope bet yes yep yeah ya yea yup sure thanks thx ty tysm cheers np gotcha understood noted alright aight lol lmao lmfao rofl haha hahaha hehe heh ha gn".split(
    " ",
  ),
);
/** Whole phrases that only close (normalised: lower case, no punctuation). */
const ACK_PHRASES = /^(?:sounds (?:good|great|perfect)|no worries|no problem|all good|got it|will do|see you(?: then| soon| there)?|talk soon|love you|same here|for sure|of course|thank you(?: so much)?|thanks so much|good night|have fun|you too|ha+|(?:ha){2,}h?|(?:he){2,}|lo+l)$/;

const norm = (t: string) =>
  t
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a text is only emoji, symbols or punctuation (a thumbs-up, a heart, "!!"), with no question mark. */
const onlySymbols = (t: string) => !/[\p{L}\p{N}?]/u.test(t) && /\S/.test(t);

/** Whether one text only ends the conversation: no question, nothing asked, nothing new. Six words at most. */
export function isEnder(text: string): boolean {
  // Invisible characters (zero-width spaces, joiners) say nothing either way: a text of only those is not an ender.
  const raw = text.replace(/[\p{Cf}]/gu, "").trim();
  if (!raw || raw.length > 60 || raw.includes("?")) return false;
  if (onlySymbols(raw)) return true;
  const n = norm(raw);
  if (!n || n.includes("?")) return false;
  if (ACK_PHRASES.test(n)) return true;
  const words = n.split(" ");
  if (words.length > 6) return false;
  return words.every((w) => ACK_WORDS.has(w) || /^(?:ha){2,}h?$|^lo+l$|^o+k+$|^k+$|^ye+s$|^nice+$|^cool+$/.test(w));
}
