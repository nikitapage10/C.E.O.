import { createHash } from "node:crypto";
import { LEARN_CAPS, type LearnInput, type VoiceStats } from "../../../api/_relay/voice.ts";
import type { Contact } from "./bluebubbles.ts";
import { Placeholders } from "./placeholders.ts";
import { settleByRule } from "./rules.ts";

/**
 * "Learn from my texts" on the Mac (#758, docs/RELAY-PRIVACY.md, "Learning Nikita's voice"). Pure: the engine reads
 * the last 12 months of messages from BlueBubbles into memory and hands them here, once, then drops them.
 *
 *   voiceStats   numbers over every one of Nikita's sent texts it was given (length, capitals, emoji, punctuation,
 *                sign-offs, double texts, reply speed). No text comes out: only numbers, which may go with each draft.
 *   sampleSent   the sample for the one style call: Nikita's own texts to the people they text most, one-to-one only,
 *                30 per contact at most and about 1,000 in all, spread over the year, each through every rule (money
 *                and legal, codes, promos, the skip list), placeholdered, and grouped under "C1", "C2"… A contact on
 *                the skip list, or not in Nikita's contacts at all (a stranger, a business, a short code), gives none.
 */

/** One message as the learn pass reads it. Memory only. */
export interface Said {
  chat: string;
  group: boolean;
  fromMe: boolean;
  text: string;
  at: number;
  /** The sender's handle for someone else's; "" for Nikita's own. */
  handle: string;
}

export const LEARN_WINDOW_MS = 365 * 24 * 60 * 60_000;
/** The fewest usable texts a learn needs before it calls the model. */
export const LEARN_MIN = 20;
/** Replies further apart than this aren't counted for reply speed (a conversation picked up again, not an answer). */
const REPLY_GAP_MS = 7 * 24 * 60 * 60_000;
/** Texts sent within this of each other count as one burst (a double text). */
const BURST_MS = 3 * 60_000;
/** Common last words that are not a sign-off. */
const NOT_SIGNOFF = new Set(["you", "it", "the", "to", "me", "that", "this", "now", "too", "ok", "okay", "yes", "yeah", "no", "lol", "haha", "a", "and", "is", "so", "there", "here", "up", "out", "on", "in", "for", "of", "at", "yet", "then", "today", "tomorrow", "tonight"]);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const pctile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) / 100 : 0);
const lastWord = (t: string) => /([\p{L}]{1,12})[\s\p{P}\p{Extended_Pictographic}]*$/u.exec(t.trim())?.[1]?.toLowerCase() ?? "";
/** Words with letters in them (an emoji on its own is not a word). */
const words = (t: string) => t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

/** The numbers, over everything given (oldest first or not). */
export function voiceStats(all: readonly Said[]): VoiceStats {
  const mine = all.filter((m) => m.fromMe && m.text.trim());
  const n = mine.length;
  const lengths = mine.map((m) => m.text.trim().length);
  const count = (f: (t: string) => boolean) => mine.filter((m) => f(m.text.trim())).length;
  // Sign-offs: a last word (after at least two others) that ends 3% or more of the texts, 5 at least, not a filler word.
  const ends = new Map<string, number>();
  for (const m of mine) {
    const t = m.text.trim();
    if (words(t) < 3) continue;
    const w = lastWord(t);
    if (w && !NOT_SIGNOFF.has(w)) ends.set(w, (ends.get(w) ?? 0) + 1);
  }
  const signs = new Set([...ends].filter(([, c]) => c >= 5 && c >= n * 0.03).map(([w]) => w));
  // Reply speed and double texts: one-to-one chats only, in time order per chat.
  const byChat = new Map<string, Said[]>();
  for (const m of all) if (!m.group) byChat.set(m.chat, [...(byChat.get(m.chat) ?? []), m]);
  const replies: number[] = [];
  let runs = 0;
  let doubles = 0;
  for (const list of byChat.values()) {
    list.sort((a, b) => a.at - b.at);
    let lastTheirs: number | null = null;
    let run = 0;
    let runAt = 0;
    for (const m of list) {
      if (!m.fromMe) {
        if (run) {
          runs++;
          if (run > 1) doubles++;
        }
        run = 0;
        lastTheirs = m.at;
        continue;
      }
      if (lastTheirs !== null) {
        const gap = m.at - lastTheirs;
        if (gap >= 0 && gap < REPLY_GAP_MS) replies.push(gap / 60_000);
        lastTheirs = null;
        run = 1;
        runAt = m.at;
      } else if (run && m.at - runAt < BURST_MS) {
        run++;
        runAt = m.at;
      }
    }
    if (run) {
      runs++;
      if (run > 1) doubles++;
    }
  }
  return {
    texts: n,
    length: n ? median(lengths) : 0,
    long: n ? pctile(lengths, 0.9) : 0,
    capitals: share(count((t) => /^\p{Lu}/u.test(t)), n),
    lowercase: share(count((t) => /\p{L}/u.test(t) && !/\p{Lu}/u.test(t)), n),
    emoji: share(count((t) => /\p{Extended_Pictographic}/u.test(t)), n),
    stops: share(count((t) => /[^.]\.$/.test(t)), n),
    exclaims: share(count((t) => t.includes("!")), n),
    questions: share(count((t) => t.includes("?")), n),
    ellipses: share(count((t) => /\.\.\.|…/.test(t)), n),
    signOffs: share(count((t) => words(t) >= 3 && signs.has(lastWord(t))), n),
    doubles: share(doubles, runs),
    replyMinutes: replies.length >= 5 ? Math.min(43_200, Math.round(median(replies))) : null,
    replyHour: replies.length >= 5 ? share(replies.filter((x) => x <= 60).length, replies.length) : null,
  };
}

const digits = (h: string) => h.replace(/\D/g, "").slice(-10);
/** A handle as one key: an address lower-cased, a number by its last 10 digits. */
export const normalHandle = (h: string) => (h.includes("@") ? h.trim().toLowerCase() : digits(h));
/**
 * The key a learned relation is kept under in the state file (16 hex of the SHA-256 of the normalised handle). The
 * file already holds chat ids, so this hides nothing from someone holding it; it only keeps the file's map from
 * being a list of numbers in the clear.
 */
export const handleKey = (h: string) => createHash("sha256").update(`relay-voice:${normalHandle(h)}`).digest("hex").slice(0, 16);

/** The other person of a one-to-one chat id (iMessage;-;+1555…): its last part. */
export const chatPerson = (chat: string) => chat.split(";").pop() ?? "";

export interface Sample {
  input: LearnInput;
  /** Each label's contact, to map the model's relations back on the Mac (never sent). */
  labels: Map<string, Contact>;
  /** Texts in the sample, and contacts. */
  from: number;
  contacts: number;
}

/** `k` of `list` (in time order), spread evenly across it. */
function spread<T>(list: T[], k: number): T[] {
  if (k >= list.length) return list;
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(list[Math.floor(((i + 0.5) * list.length) / k)]!);
  return out;
}

/**
 * How many to take from each contact (most-texted first): the same "level" for all, never above what they have or
 * LEARN_CAPS.perContact, so the total comes to `total` at most. Stratified: a contact with 500 texts gives no more
 * than one with 40 once the level is reached.
 */
export function allot(counts: number[], total: number = LEARN_CAPS.texts, cap: number = LEARN_CAPS.perContact): number[] {
  let level = 0;
  const sum = (l: number) => counts.reduce((a, c) => a + Math.min(c, l), 0);
  while (level < cap && sum(level + 1) <= total && sum(level + 1) > sum(level)) level++;
  const out = counts.map((c) => Math.min(c, level));
  // Hand out what is left under `total`, one each, from the most-texted down.
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; i < out.length && left > 0; i++) {
    if (out[i]! < Math.min(counts[i]!, cap)) {
      out[i]!++;
      left--;
    }
  }
  return out;
}

/**
 * The sample for the one style call. `contactOf` finds a handle's contact on the Mac; `skipTerms` is the private skip
 * list; `everyone` is every name in Nikita's contacts (for "Person N"). Only Nikita's own one-to-one texts from the
 * last 12 months, each through the rules, from contacts in Nikita's contacts and off the skip list.
 */
export function sampleSent(all: readonly Said[], contactOf: (handle: string) => Contact | undefined, skipTerms: readonly string[], everyone: readonly Contact[], now: number): Sample {
  const per = new Map<Contact, { handle: string; texts: Said[] }>();
  for (const m of all) {
    if (!m.fromMe || m.group || now - m.at > LEARN_WINDOW_MS || m.text.trim().length < 2) continue;
    const handle = chatPerson(m.chat);
    const contact = contactOf(handle);
    // Not in Nikita's contacts: a stranger, a business or a short code. Never sampled.
    if (!contact) continue;
    // A skip-listed contact gives nothing at all; a text a rule matches (money, legal, a code, a promo) is left out.
    if (settleByRule({ handle, names: contact.names, text: "" }, skipTerms)) continue;
    if (settleByRule({ handle, names: contact.names, text: m.text }, skipTerms)) continue;
    const got = per.get(contact) ?? { handle, texts: [] };
    got.texts.push(m);
    per.set(contact, got);
  }
  const ranked = [...per].sort((a, b) => b[1].texts.length - a[1].texts.length).slice(0, LEARN_CAPS.contacts);
  const take = allot(ranked.map(([, v]) => v.texts.length));
  const labels = new Map<string, Contact>();
  const contacts: LearnInput["contacts"] = [];
  let chars = 0;
  let from = 0;
  ranked.forEach(([contact, v], i) => {
    if (!take[i]) return;
    const ph = new Placeholders({ contact: { names: contact.names, handle: v.handle }, others: everyone.filter((c) => c !== contact).flatMap((c) => c.names) });
    const texts: string[] = [];
    for (const m of spread([...v.texts].sort((a, b) => a.at - b.at), take[i]!)) {
      if (chars >= LEARN_CAPS.totalChars) break;
      const x = ph.swap(m.text).replace(/\s+/g, " ").trim().slice(0, Math.min(LEARN_CAPS.eachChars, LEARN_CAPS.totalChars - chars));
      if (!x) continue;
      texts.push(x);
      chars += x.length;
    }
    if (!texts.length) return;
    const label = `C${contacts.length + 1}`;
    labels.set(label, contact);
    contacts.push({ label, texts });
    from += texts.length;
  });
  return { input: { contacts }, labels, from, contacts: contacts.length };
}
