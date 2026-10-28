/**
 * New texts Skippy asks Blasto to write (#536, docs/RELAY-PRIVACY.md, "Texts Skippy writes"): the pieces the site and
 * the Mac hub share. Pure apart from the email line's filter, so both sides run the same rules.
 *
 *   cleanAsk      who and the gist as Skippy's action (or the Talk call) gives them: one plain line, capped.
 *   askRuled      the relay's own rules over an ask, before anything is made of it: the private skip list (the
 *                 email line's EMAIL_SKIP_TERMS) over who and the gist, the money and legal pre-filter and one-time
 *                 codes over the gist. A match means no compose request and no model call: Nikita texts it himself.
 *   matchContacts who → the contacts it could mean, on the Mac only (contacts never leave it).
 *   maskHandle    a handle as a card shows it: "ending 0123" for a number, "r•••@e•••.com" for an address.
 *
 * Underscore folder: never served as a function.
 */

import { onSkipList, preFilter } from "../_email/filter.js";
import { GIST_IN_MAX, MASK, WHO_MAX } from "./texts.js";

/** One plain line: no control or invisible characters, spaces folded, capped. "" when nothing is left. */
export function cleanAsk(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const cleanWho = (v: unknown) => cleanAsk(v, WHO_MAX).replace(/^(?:to\s+)?(?:my\s+)?/i, "");
export const cleanGist = (v: unknown) => cleanAsk(v, GIST_IN_MAX);

const CODE_WORDS = /\b(?:code|passcode|pass code|otp|one[- ]time|verification|verify|2fa|two[- ]factor|security code|login code|sign[- ]in code|pin)\b/i;
const CODE_DIGITS = /\b(?:[A-Z]-)?\d{4,8}\b/;

/** Why the relay's rules keep an ask from the model, or null when it may go on. Never says which term matched. */
export function askRuled(who: string, gist: string, skipTerms: readonly string[], names: readonly string[] = []): "skip" | "money" | "code" | null {
  const terms = skipTerms.map((t) => t.toLowerCase()).filter(Boolean);
  if (onSkipList(terms, { from: [who, ...names].join(" "), fromAddress: "", subject: "" }, gist)) return "skip";
  if (preFilter({ fromAddress: "", fromDomain: "", subject: gist.slice(0, 500) }).kind !== "pass") return "money";
  if (CODE_WORDS.test(gist) && CODE_DIGITS.test(gist)) return "code";
  return null;
}

export interface ContactLike {
  names: string[];
  handles: string[];
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * The contacts `who` could mean: an exact name first ("Mom", "Riley Test"); else every contact with a name holding all
 * of who's words as whole words ("Riley" → "Riley Test" and "Riley Sample"). Contacts without a handle can't be texted
 * and are left out. Never guesses past that: no fuzzy match.
 */
export function matchContacts<C extends ContactLike>(contacts: readonly C[], who: string): C[] {
  const q = norm(who);
  if (!q) return [];
  const usable = contacts.filter((c) => c.handles.some((h) => h.trim()));
  const exact = usable.filter((c) => c.names.some((n) => norm(n) === q));
  if (exact.length) return exact;
  const words = q.split(" ");
  return usable.filter((c) => c.names.some((n) => {
    const have = new Set(norm(n).split(" "));
    return words.every((w) => have.has(w));
  }));
}

/** A handle as a card shows it: the last 4 digits of a number, or an address masked to its first letters. Null if neither. */
export function maskHandle(handle: string): string | null {
  const h = handle.trim();
  if (h.includes("@")) {
    const [user = "", domain = ""] = h.toLowerCase().split("@");
    const dot = domain.lastIndexOf(".");
    const tld = dot > 0 ? domain.slice(dot + 1) : "";
    const m = `${user.slice(0, 1)}•••@${domain.slice(0, 1)}•••.${tld}`;
    return MASK.test(m) ? m : null;
  }
  const digits = h.replace(/\D/g, "");
  return digits.length >= 7 ? `ending ${digits.slice(-4)}` : null;
}
