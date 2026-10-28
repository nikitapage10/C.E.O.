import { onSkipList, preFilter } from "../../../api/_email/filter.ts";
import type { SettledWhy } from "./store.ts";

/**
 * What the hub settles by rule, on the Mac, without a model (docs/RELAY-PRIVACY.md, "Never sent at all"; #535):
 *
 *   skip        the private skip list (the email line's EMAIL_SKIP_TERMS, fetched over the paired token and held in
 *               memory only), matched against the sender's name, handle and the text. Counted, never read by a model.
 *   money       money and legal texts, by the email line's own pre-filter (api/_email/filter.ts) run over the text.
 *   short-code  a sender that is a short code (3 to 6 digits): banks, carriers, alerts.
 *   code        verification and one-time-code messages.
 *   promo       marketing: "Reply STOP", "msg & data rates", unsubscribe, promo codes.
 *
 * Family is not skipped for texts: those are exactly the threads Relay exists for.
 */

const SHORT_CODE = /^\+?\d{3,6}$/;
const CODE_WORDS = /\b(?:code|passcode|pass code|otp|one[- ]time|verification|verify|2fa|two[- ]factor|security code|login code|sign[- ]in code|pin)\b/i;
const CODE_DIGITS = /\b(?:[A-Z]-)?\d{4,8}\b/;
const PROMO = /\b(?:reply stop|text stop|txt stop|stop to (?:end|opt|quit|cancel|unsubscribe|stop)|msg (?:&|and) data rates|msg&data|unsubscribe|opt[- ]?out|promo code|use code|% off|limited time|shop now|order now|free shipping)\b/i;

export interface Inbound {
  /** The sender's handle: a phone number, email address or short code. */
  handle: string;
  /** The sender's names from Nikita's contacts (may be empty). */
  names: string[];
  text: string;
}

/** The rule that settles a text, or null when it goes on to Dialtone. Never says which term matched. */
export function settleByRule(msg: Inbound, skipTerms: readonly string[]): SettledWhy | null {
  if (onSkipList(skipTerms, { from: msg.names.join(" "), fromAddress: msg.handle.toLowerCase(), subject: "" }, msg.text)) return "skip";
  if (preFilter({ fromAddress: msg.handle.includes("@") ? msg.handle.toLowerCase() : "", fromDomain: msg.handle.includes("@") ? msg.handle.split("@")[1]!.toLowerCase() : "", subject: msg.text.slice(0, 500) }).kind !== "pass") return "money";
  if (SHORT_CODE.test(msg.handle.replace(/[\s-]/g, ""))) return "short-code";
  if (CODE_WORDS.test(msg.text) && CODE_DIGITS.test(msg.text)) return "code";
  if (PROMO.test(msg.text)) return "promo";
  return null;
}
