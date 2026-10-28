/**
 * The privacy check on Desk text (#127, docs/THREAT-MODEL.md, R4). Everything Nikita types or dictates on the Desk
 * (a suggested idea, revise notes, an answer to Rivet) is written into a public GitHub issue, and an idea's title can
 * reach the public Lattice. Before any of it is sent anywhere, this reads it and names what looks private: email
 * addresses, phone numbers, street addresses, card, bank and ID numbers, keys, tokens and passwords, and people's
 * names where a cheap cue gives them away ("my friend Sam Reyes", "Mrs. Jane Doe", "Sam Reyes's number").
 *
 * On a hit, nothing is posted: api/foundry.ts answers 422 with the kinds it found, and the Desk asks Nikita to say it
 * another way. Holding back beats redacting: an idea with holes in it isn't what Nikita meant, and nothing private
 * reaches GitHub, Claude or the Lattice either way. It is deterministic and offline (no model call), so it costs
 * nothing and runs the same every time. It catches the usual forms and the usual disguises (full-width letters,
 * zero-width splits, "name [at] host [dot] com", spelled-out digits); a determined person can always write around a
 * pattern, which is fine: this is a seatbelt for slips, not a lock.
 *
 * Underscore file: Vercel never serves it as a function.
 */

import { unmask } from "./_world/digest.js";

export type PrivateKind = "email" | "phone" | "address" | "card" | "account" | "key" | "name";

/** How the Desk names each kind to Nikita. */
export const PRIVATE_LABEL: Record<PrivateKind, string> = {
  email: "an email address",
  phone: "a phone number",
  address: "a street address",
  card: "a card number",
  account: "a bank, account or ID number",
  key: "a key, token or password",
  name: "a person's name",
};

const ORDER: PrivateKind[] = ["email", "phone", "address", "card", "account", "key", "name"];

/** Digits said as words ("five five five …"), which dictation sometimes writes out. */
const DIGIT_WORD: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const DIGIT_WORDS = new RegExp(`\\b(?:${Object.keys(DIGIT_WORD).join("|")})(?:[\\s,.-]{1,3}(?:${Object.keys(DIGIT_WORD).join("|")})){6,}\\b`, "gi");

/** The Luhn checksum every payment card number passes. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[A-Za-z]{2,24}\b/g;
/** Machine addresses that aren't anyone's inbox. */
const NOT_A_PERSON = /^(?:git|noreply|no-reply)@/i;
const SPELLED_EMAIL = /\b[\w.+-]{1,64}\s*[[(]\s*at\s*[\])]\s*[\w-]{1,64}(?:\s*[[(]\s*dot\s*[\])]\s*[\w-]{1,64})+/i;
const SPOKEN_EMAIL = /\b[\w.+-]{1,64}\s+at\s+[\w-]{1,64}\s+dot\s+(?:com|net|org|io|co|me|dev|edu|gov|uk|us|ca|de|fr|app|ai)\b/i;

/** North American numbers (+1 555 867 5309, (555) 867-5309, 555.867.5309) and a plain run of 10 or 11 digits. */
const PHONE_NA = /(?<![\w.])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?![\w])|(?<![\w.+-])\d{10,11}(?![\w.])/;
/** International numbers start with a +: +44 20 7946 0958, +49-30-1234567. */
const PHONE_INTL = /(?<![\w])\+\d{1,3}(?:[\s.-]?\(?\d{1,5}\)?){2,6}/g;

const STREET_TYPES = "street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|parkway|pkwy|circle|cir|highway|hwy|square|sq|crescent";
const STREET = new RegExp(`(?<![\\w.])\\d{1,6}[A-Za-z]?\\s+((?:[A-Za-z][\\w'’.-]{0,30}\\s+){1,3})(?:${STREET_TYPES})\\b`, "gi");
/** Words that turn "5 minute drive" or "3 steps down the road" into a measure, not an address. */
const MEASURE = /\b(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|miles?|km|kilometres?|kilometers?|metres?|meters?|steps?|blocks?|more|times?|tb|gb|mb|kb|hard|disk|test|of|the|a|an|to|down|up|in|on|per|x)\b/i;
const PO_BOX = /\bP\.?\s?O\.?\s+Box\s+\d+/i;
const UNIT = /\b(?:apt|apartment|suite|unit|flat)\.?\s*#?\s*\d+[A-Za-z]?\b/i;

/** 13 to 19 digits, in one run or in the groups cards print them in (4-4-4-4, 4-6-5), checked with Luhn so a long count or a timestamp isn't a card. */
const CARD = /(?<!\d)(?:\d{13,19}|\d{4}(?:[\s-]\d{4}){2,3}(?:[\s-]\d{1,4})?|\d{4}[\s-]\d{6}[\s-]\d{4,5})(?!\d)/g;
const SSN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/;
const ACCOUNT_CUE = /\b(?:account|acct|routing|sort code|iban|swift|bic|ssn|social security|passport|licen[cs]e|tax id|national insurance)(?:\s+(?:number|no\.?|num|#))?\s*(?:is|:|=|#)?\s*(?:[A-Z]{1,3}\s?)?\d[\d\s-]{4,30}\d/i;

const KEY_PREFIX =
  /\b(?:sk|pk|rk)[-_](?:live_|test_|ant-|proj-)?[\w-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_\w{20,}|\bglpat-[\w-]{20,}|\bxox[abpr]-[\w-]{10,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[\w-]{30,}|\b(?:hf|npm)_[A-Za-z0-9]{30,}|\bshpat_[a-f0-9]{32}/;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
/** "password: hunter2", "the PIN is 4821", "token = 'abcd…'": a cue word and a value with a digit in it, or quoted. */
const SECRET_CUE = /\b(?:password|passcode|passphrase|pass phrase|pin|secret|api key|desk key|token)\s*(?:is|:|=)\s*(?:(?=[^\s"'`]*\d)[^\s"'`]{4,}|["'`][^\s"'`]{4,}["'`])/i;
/** A long run of letters and digits with both in it: a key or token without a known prefix. */
const LONG_RUN = /(?<![\w-])[A-Za-z0-9_-]{32,}(?![\w-])/g;
/** A git commit hash is long and random but public. */
const GIT_SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

const NAME = "[A-Z][a-z'’-]{1,30}";
const RELATIONS =
  "friend|best friend|wife|husband|partner|girlfriend|boyfriend|fianc[ée]e?|mom|mum|mother|dad|father|sister|brother|son|daughter|aunt|uncle|cousin|grandma|grandmother|grandpa|grandfather|niece|nephew|boss|manager|colleague|coworker|co-worker|neighbou?r|roommate|flatmate|landlord|landlady|doctor|therapist|lawyer|accountant|client|ex";
const RELATION_NAME = new RegExp(`\\b(?:my|our)\\s+(?:${RELATIONS})\\s*,?\\s+(${NAME}(?:\\s+${NAME})?)`, "g");
const HONORIFIC_NAME = new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mx)\\.?\\s+${NAME}\\s+${NAME}`);
const CONTACT_OF = new RegExp(`\\b${NAME}\\s+${NAME}['’]s\\s+(?:phone|number|cell|mobile|email|e-mail|address|house|home|birthday|account|password)\\b`);
/** C.E.O.'s own cast and words, which a relation cue may name without it being a person ("my friend Rusty"). */
const OWN_NAMES = new Set(["Skippy", "Rivet", "Rusty", "Rocky", "Dusty", "Gusty", "Musty", "Ember", "Nikita", "Claude", "Relay", "Lattice", "Desk", "Foundry", "The", "A"]);

function hasPhone(text: string): boolean {
  if (PHONE_NA.test(text)) return true;
  for (const m of text.matchAll(PHONE_INTL)) {
    const n = m[0].replace(/\D/g, "").length;
    if (n >= 8 && n <= 15) return true;
  }
  return false;
}

function hasAddress(text: string): boolean {
  if (PO_BOX.test(text) || UNIT.test(text)) return true;
  for (const m of text.matchAll(STREET)) if (!MEASURE.test(m[1]!)) return true;
  return false;
}

function hasCard(text: string): boolean {
  for (const m of text.matchAll(CARD)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits)) return true;
  }
  return false;
}

function hasKey(text: string): boolean {
  if (KEY_PREFIX.test(text) || JWT.test(text) || PEM.test(text) || SECRET_CUE.test(text)) return true;
  for (const m of text.matchAll(LONG_RUN)) {
    const run = m[0];
    if (/[A-Za-z]/.test(run) && /\d/.test(run) && !GIT_SHA.test(run)) return true;
  }
  return false;
}

function hasName(text: string): boolean {
  for (const m of text.matchAll(RELATION_NAME)) {
    const first = m[1]!.split(/\s+/)[0]!;
    if (!OWN_NAMES.has(first)) return true;
  }
  return HONORIFIC_NAME.test(text) || CONTACT_OF.test(text);
}

/**
 * What in a piece of Desk text looks private, by kind, in a fixed order; empty when it's clean. Reads the text with
 * its disguises off (`unmask`, NFKC), and once more with spoken digits turned into numbers.
 */
export function privateParts(raw: string): PrivateKind[] {
  const text = unmask(raw.normalize("NFKC"));
  const spoken = text.replace(DIGIT_WORDS, (m) => m.toLowerCase().split(/[\s,.-]+/).map((w) => DIGIT_WORD[w] ?? "").join(""));
  const found = new Set<PrivateKind>();
  if ([...text.matchAll(EMAIL)].some((m) => !NOT_A_PERSON.test(m[0])) || SPELLED_EMAIL.test(text) || SPOKEN_EMAIL.test(text)) found.add("email");
  if (hasPhone(text) || (spoken !== text && hasPhone(spoken))) found.add("phone");
  if (hasAddress(text)) found.add("address");
  if (hasCard(text) || (spoken !== text && hasCard(spoken))) found.add("card");
  if (SSN.test(text) || IBAN.test(text) || ACCOUNT_CUE.test(text)) found.add("account");
  if (hasKey(text)) found.add("key");
  if (hasName(text)) found.add("name");
  return ORDER.filter((k) => found.has(k));
}

/** "an email address and a phone number": the kinds in plain words, for the Desk's message. */
export function heldWords(kinds: PrivateKind[]): string {
  const words = kinds.map((k) => PRIVATE_LABEL[k]);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * The same patterns, for Relay's hub (#535, docs/RELAY-PRIVACY.md, "Names and numbers become placeholders"): it
 * swaps what they match for `[phone]`, `[email]`… before any model call, rather than holding the text back.
 */
export const PRIVACY_PATTERNS = {
  email: [EMAIL, SPELLED_EMAIL, SPOKEN_EMAIL],
  phone: [PHONE_INTL, PHONE_NA],
  address: [STREET, PO_BOX, UNIT],
  card: [CARD],
  account: [ACCOUNT_CUE, IBAN, SSN],
  key: [KEY_PREFIX, JWT, PEM, SECRET_CUE],
} as const;
