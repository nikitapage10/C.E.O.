import { onSkipList, preFilter } from "../../../api/_email/filter.ts";
import type { SettledWhy } from "./store.ts";

/**
 * What the hub settles by rule, on the Mac, without a model (docs/RELAY-PRIVACY.md, "Never sent at all"; #535):
 *
 *   skip        the private skip list (the email line's EMAIL_SKIP_TERMS, fetched over the paired token and held in
 *               memory only), matched against the sender's name, handle and the text. Counted, never read by a model.
 *   money       money and legal texts: a money or legal sender by the email line's pre-filter (api/_email/filter.ts),
 *               or a text with real money or legal matter (TEXT_MONEY, TEXT_LEGAL; #950 narrowed it from the email
 *               line's subject words, which set aside everyday texts).
 *   short-code  a sender that is a short code (3 to 6 digits): banks, carriers, alerts.
 *   code        verification and one-time-code messages.
 *   promo       marketing: "Reply STOP", "msg & data rates", unsubscribe, promo codes.
 *
 * Family is not skipped for texts: those are exactly the threads Relay exists for.
 */

const SHORT_CODE = /^\+?\d{3,6}$/;
const CODE_WORDS = /\b(?:code|passcode|pass code|otp|one[- ]time|verification|verify|2fa|two[- ]factor|security code|login code|sign[- ]in code|pin)\b/i;
const CODE_DIGITS = /\b(?:[A-Z]-)?\d{4,8}\b/;
/**
 * A text that carries money (#950 audit, Nikita 2026-11-06: 21 one-to-one chats set aside was suspicious). The email
 * line's money subjects matched everyday texts ("I paid", "rent", "balance", "transfer", "your order"), so a text is
 * money only for a bill, an account, a card, a loan, tax forms, debt or an amount of money.
 */
const TEXT_MONEY =
  /\b(?:invoice|receipt|(?:bank|account|card) statement|your (?:bill|statement|payment|balance)|new bill|bill (?:is|was) (?:ready|due|available|overdue)|billing|payment (?:due|of|is|was|failed|declined|received|scheduled|plan)|autopay|direct debit|amount due|past due|balance (?:due|of|is)|loan|mortgage|credit (?:card|limit|score|report)|tax (?:return|form|document|bill)|1099|w-?2|debt|collections? (?:agency|notice)|account (?:number|ending|balance)|card ending|routing number|wire transfer|social security number|ssn)\b|\$\s?\d/i;
/** A text that carries legal matter (#950 audit). "court" alone is a game; "court date" or "court order" is the law. */
const TEXT_LEGAL = /\b(?:lawsuit|legal notice|subpoena|summons|attorney|lawyer|court (?:date|order|hearing|case|appearance)|docusign|e-?signature|notice of (?:claim|default|intent)|jury duty|(?:court )?settlement (?:agreement|offer|check|papers?)|contract)\b/i;
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
  // Money and legal (#950 audit): a bank's or a law firm's address, by the email line's sender rules, or a text that
  // carries real money or legal matter (TEXT_MONEY, TEXT_LEGAL). The email line's subject words ("paid", "rent",
  // "court", "transfer", "order") set aside ordinary texts between people, so they no longer run over a text's words.
  const at = msg.handle.includes("@");
  if (preFilter({ fromAddress: at ? msg.handle.toLowerCase() : "", fromDomain: at ? msg.handle.split("@")[1]!.toLowerCase() : "", subject: "" }).kind !== "pass") return "money";
  const words = msg.text.slice(0, 500);
  if (TEXT_MONEY.test(words) || TEXT_LEGAL.test(words)) return "money";
  if (SHORT_CODE.test(msg.handle.replace(/[\s-]/g, ""))) return "short-code";
  if (CODE_WORDS.test(msg.text) && CODE_DIGITS.test(msg.text)) return "code";
  if (PROMO.test(msg.text)) return "promo";
  return null;
}
