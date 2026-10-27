/**
 * What the email agent leaves alone (#323, docs/GMAIL.md, "What it skips"), decided before any Claude call:
 *
 *   1. A private skip list (EMAIL_SKIP_TERMS, a Key Vault secret): a mail whose sender, subject or body holds one of
 *      its terms is counted as skipped and nothing else. No summary, no draft, no item, no heads-up.
 *   2. Money and legal mail (bills, payments, debts, bank and card statements, invoices, receipts, collections,
 *      contracts and legal notices), by its sender and subject: counted as skipped, never read by a model, never
 *      kept as an item. An urgent one (a fraud alert, a final or overdue notice, a legal deadline, a locked
 *      account) is counted too, as an urgent alert (#415): no item, no sender, nothing kept but the count.
 *
 * Mail that passes both goes to Dialtone, whose instructions carry the same money and legal rule (./sort.ts).
 * Nothing here logs, and nothing says which term or pattern matched.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { MailForSort } from "./gmail.js";

/** The generic reasons a heads-up may give: fixed words, never anything from the mail. */
export const HEADS_UP_REASONS = {
  fraud: "Possible fraud alert, check your app",
  overdue: "Final or overdue notice, check your account",
  legal: "Legal deadline, check the notice",
  account: "Account problem, check your app",
} as const;
export type HeadsUpReason = keyof typeof HEADS_UP_REASONS;

export type Verdict = { kind: "pass" } | { kind: "skip" } | { kind: "heads-up"; reason: HeadsUpReason };

const KEY_VAULT_PREFIX = "@microsoft.keyvault(";

/**
 * The private skip list from its setting: comma-separated, each term trimmed and lower-cased, empty ones dropped.
 * Missing, empty or an unresolved Key Vault reference (azure/src/env.ts drops those too) is an empty list.
 */
export function skipTermsFrom(raw: string | undefined): string[] {
  const v = (raw ?? "").trim();
  if (!v || v.toLowerCase().startsWith(KEY_VAULT_PREFIX)) return [];
  return [...new Set(v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Nikita's own priority list (EMAIL_PRIORITY, several lines) from its setting: control characters other than newlines
 * dropped, trimmed, at most 4,000 characters. Missing, empty or an unresolved Key Vault reference is "" (no list, and
 * the agent then behaves as it always did). It only ever informs Dialtone, after the hard rules (./sort.ts).
 */
export function priorityFrom(raw: string | undefined): string {
  const v = (raw ?? "").replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n]/gu, " ").replace(/\p{Cf}/gu, "").trim();
  if (!v || v.toLowerCase().startsWith(KEY_VAULT_PREFIX)) return "";
  return v.slice(0, 4_000);
}

/** Mail Nikita sent to himself: from and every recipient are his own address (no model, #522). */
export function selfSent(mail: { fromAddress: string; to?: readonly string[] }, own: string): boolean {
  return Boolean(own) && mail.fromAddress === own && !!mail.to?.length && mail.to.every((a) => a === own);
}

/** Whether any term is in the sender, the subject or the body (case-insensitive). Never says which. */
export function onSkipList(terms: readonly string[], mail: Pick<MailForSort, "from" | "fromAddress" | "subject">, body: string): boolean {
  if (!terms.length) return false;
  const hay = `${mail.from}\n${mail.fromAddress}\n${mail.subject}\n${body}`.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

/** Senders whose mail is money by its address: banks, cards, payment and billing services, collections. */
const MONEY_DOMAIN =
  /(?:^|\.)(?:chase|bankofamerica|bofa|wellsfargo|capitalone|americanexpress|aexp|amex|discover|citi|citibank|usbank|ally|schwab|fidelity|vanguard|sofi|synchrony|barclays|barclaycard|navyfederal|paypal|venmo|zelle|squareup|stripe|intuit|quickbooks|billtrust|bill\.com|paymentus|doxo|experian|equifax|transunion|creditkarma|affirm|klarna|afterpay|robinhood|coinbase|etrade|webull|kraken|gemini|polymarket|kalshi|chime|wise|revolut|geico|progressive|statefarm|allstate|lemonade|mrcooper|nelnet|navient|mohela|aidvantage|lendingclub|rocketmortgage|quickenloans|loandepot|turbotax|hrblock|taxact|freetaxusa|irs|duke-?energy|xcelenergy|coned)\.[a-z.]{2,12}$|(?:^|\.)cash\.app$|(?:^|[.-])(?:bank|banking|billing|invoice|invoices|payments?|collections?|creditunion|insurance|loans?|mortgages?|lending|utility|utilities|electric|energy|tax|taxes)\.[a-z.]{2,12}$/i;
/** Address local parts that are billing desks. */
const MONEY_USER = /^(?:billing|bills?|invoices?|receipts?|payments?|statements?|accounts?-?payable|collections?|autopay|payroll)(?:[._+-]|$)/i;
/** Subjects that are money. */
const MONEY_SUBJECT =
  /\b(?:invoice|receipt|statement|your bill|new bill|bill is (?:ready|due|available)|billing|payment|paid|autopay|direct debit|balance|amount due|past due|overdue|refund|charge[ds]?|transaction|debt|collections?|loan|mortgage|credit (?:card|limit|score|report)|tax (?:return|form|document)|1099|w-?2|order (?:confirmation|#)|your order|deposits?|withdrawals?|transfers?|you sent|you received|purchases?|renewals?|trades?|dividends?|premiums?|claims?|rents?|wallets?|crypto|account alert)\b|\$\s?\d/i;
/** Subjects that are legal or contracts. */
const LEGAL_SUBJECT = /\b(?:contract|agreement|lawsuit|legal notice|subpoena|summons|court|attorney|settlement|docusign|e-?signature|sign(?:ature)? requested|notice of (?:claim|default|intent)|jury|terms (?:of (?:service|use)|and conditions|& conditions)|privacy (?:policy|notice)|(?:updates?|changes?) to (?:our|your|the) terms)\b/i;
const LEGAL_DOMAIN = /(?:^|\.)(?:docusign|hellosign|adobesign|pandadoc|courts?|uscourts|law|legal|attorneys?)\.[a-z.]{2,12}$|\.(?:law|legal|attorney)$/i;
/** Mail that is money or legal by its sender or subject, urgent or not. */
const moneyOrLegal = (mail: Pick<MailForSort, "fromAddress" | "fromDomain" | "subject">) => {
  const user = mail.fromAddress.split("@")[0] ?? "";
  return MONEY_DOMAIN.test(mail.fromDomain) || MONEY_USER.test(user) || MONEY_SUBJECT.test(mail.subject) || LEGAL_DOMAIN.test(mail.fromDomain) || LEGAL_SUBJECT.test(mail.subject);
};

/** Urgent patterns, only ever looked at for mail already found to be money or legal. */
const URGENT: [RegExp, HeadsUpReason][] = [
  [/\b(?:fraud|suspicious (?:activity|transaction|charge|purchase|sign-?in|login)|unusual activity|did you (?:make|authori[sz]e)|unrecogni[sz]ed (?:charge|transaction))\b/i, "fraud"],
  [/\b(?:final notice|past due|overdue|last notice|missed payment|payment failed|declined|disconnection notice|shut-?off)\b/i, "overdue"],
  [/\b(?:deadline|respond by|court date|hearing|summons|subpoena|due by)\b/i, "legal"],
  [/\b(?:account (?:locked|suspended|frozen|closed|restricted|on hold)|action required|urgent)\b/i, "account"],
];

/**
 * The cheap first look, before any model: sender and subject only. "skip" for money or legal mail, "heads-up" with
 * a generic reason for an urgent one, "pass" for everything else (which Dialtone then sorts).
 */
export function preFilter(mail: Pick<MailForSort, "fromAddress" | "fromDomain" | "subject">): Verdict {
  if (!moneyOrLegal(mail)) return { kind: "pass" };
  for (const [re, reason] of URGENT) if (re.test(mail.subject)) return { kind: "heads-up", reason };
  return { kind: "skip" };
}

/** The minimal shape of a stored item, which keeps no address of its own, only the sender's display name or address. */
type Stored = { from: string; subject: string; summary: string };

/**
 * Whether a mail already kept as an item would be skipped today (#415): on the skip list, a money or legal sender or
 * subject, or an old heads-up (they are no longer kept at all). A display name stands in for its domain ("Name" is
 * tried as name.com), since an item keeps no address. Run over the stored list on every tick, so a wider filter also
 * clears what an older one let in.
 */
export function storedMailSkipped(terms: readonly string[], item: Stored): boolean {
  if ((Object.values(HEADS_UP_REASONS) as string[]).includes(item.subject)) return true;
  const at = item.from.lastIndexOf("@");
  const fromAddress = at > 0 ? item.from.replace(/^.*</, "").replace(/>.*$/, "").trim() : "";
  const domain = fromAddress.includes("@") ? fromAddress.slice(fromAddress.lastIndexOf("@") + 1).toLowerCase() : `${item.from.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  if (onSkipList(terms, { from: item.from, fromAddress, subject: item.subject }, item.summary)) return true;
  return preFilter({ fromAddress, fromDomain: domain, subject: item.subject }).kind !== "pass";
}

/** Local parts of automated senders: nobody reads a reply sent there. */
const AUTOMATED_USER = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|security|account-?security|receipts?|shipping|shipment|tracking|newsletter|digest|mailer|mailer-daemon|bounce[sd]?|auto(?:mated)?)(?:[._+-]|$)/i;
/** Subjects of automated notices: sign-in and security alerts, codes, shipping, digests. */
const AUTOMATED_SUBJECT =
  /\b(?:new (?:sign-?in|login|device)|sign-?in (?:alert|attempt|from|to)|login (?:alert|from|attempt)|security (?:alert|notice|code)|verification code|one-time (?:code|passcode|password)|(?:has )?shipped|out for delivery|delivered|tracking (?:number|update)|receipt|weekly (?:digest|summary)|daily (?:digest|summary)|newsletter)\b/i;
/** Words that mean the mail may genuinely ask Nikita to do something. */
const EXPLICIT_ASK = /\b(?:action required|confirm|verify|update (?:your|the) (?:card|payment|billing)|payment (?:failed|declined)|locked|suspend(?:ed)?|expires?|reply|respond|rsvp|sign (?:by|before)|approve|review and)\b/i;

/**
 * Mail from an automated sender (no-reply, notifications, alerts, security, receipts, shipping) or a mailing list
 * (List-Unsubscribe) by its sender, subject and header only (#495). It defaults to FYI unless the model finds an
 * explicit ask (./sort.ts tells it so).
 */
export function automatedMail(mail: Pick<MailForSort, "fromAddress" | "subject"> & { bulk?: boolean }): boolean {
  const user = mail.fromAddress.split("@")[0] ?? "";
  return mail.bulk === true || AUTOMATED_USER.test(user) || AUTOMATED_SUBJECT.test(mail.subject);
}

/**
 * Whether a mail already kept would not be kept today (#495): anything stored as FYI, and needs-you mail from an
 * automated sender whose subject and summary hold no explicit ask. Free: no model. A display name has no address, so
 * only the subject and summary are looked at then.
 */
export function storedNotAction(item: Stored & { kind: string }, keepFyi = false): boolean {
  // With a priority list (#522) Can wait (fyi) mail is kept on the Relay page.
  if (item.kind === "fyi") return !keepFyi;
  if (item.kind !== "needs-you") return false;
  const at = item.from.lastIndexOf("@");
  const fromAddress = at > 0 ? item.from.replace(/^.*</, "").replace(/>.*$/, "").trim().toLowerCase() : "";
  if (!automatedMail({ fromAddress, subject: item.subject })) return false;
  return !EXPLICIT_ASK.test(`${item.subject}\n${item.summary}`);
}
