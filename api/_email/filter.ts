/**
 * What the email agent leaves alone (#323, docs/GMAIL.md, "What it skips"), decided before any Claude call:
 *
 *   1. A private skip list (EMAIL_SKIP_TERMS, a Key Vault secret): a mail whose sender, subject or body holds one of
 *      its terms is counted as skipped and nothing else. No summary, no draft, no item, no heads-up.
 *   2. Money and legal mail (bills, payments, debts, bank and card statements, invoices, receipts, collections,
 *      contracts and legal notices), by its sender and subject: counted as skipped, never read by a model, never
 *      kept as an item. The exception is an urgent one (a fraud alert, a final or overdue notice, a legal deadline,
 *      a locked account): it becomes a one-line heads-up, the sender and a generic reason, never an amount, an
 *      account number, a detail of the mail or a draft.
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

/** Whether any term is in the sender, the subject or the body (case-insensitive). Never says which. */
export function onSkipList(terms: readonly string[], mail: Pick<MailForSort, "from" | "fromAddress" | "subject">, body: string): boolean {
  if (!terms.length) return false;
  const hay = `${mail.from}\n${mail.fromAddress}\n${mail.subject}\n${body}`.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

/** Senders whose mail is money by its address: banks, cards, payment and billing services, collections. */
const MONEY_DOMAIN =
  /(?:^|\.)(?:chase|bankofamerica|bofa|wellsfargo|capitalone|americanexpress|aexp|amex|discover|citi|citibank|usbank|ally|schwab|fidelity|vanguard|sofi|synchrony|barclays|barclaycard|navyfederal|paypal|venmo|zelle|cash\.app|squareup|stripe|intuit|quickbooks|billtrust|bill\.com|paymentus|doxo|experian|equifax|transunion|creditkarma|affirm|klarna|afterpay)\.[a-z.]{2,12}$|(?:^|[.-])(?:bank|banking|billing|invoice|invoices|payments?|collections?|creditunion)\.[a-z.]{2,12}$/i;
/** Address local parts that are billing desks. */
const MONEY_USER = /^(?:billing|bills?|invoices?|receipts?|payments?|statements?|accounts?-?payable|collections?|autopay|payroll)(?:[._+-]|$)/i;
/** Subjects that are money. */
const MONEY_SUBJECT =
  /\b(?:invoice|receipt|statement|your bill|new bill|bill is (?:ready|due|available)|billing|payment|paid|autopay|direct debit|balance|amount due|past due|overdue|refund|charge[ds]?|transaction|debt|collections?|loan|mortgage|credit (?:card|limit|score|report)|tax (?:return|form|document)|1099|w-?2|order (?:confirmation|#)|your order)\b/i;
/** Subjects that are legal or contracts. */
const LEGAL_SUBJECT = /\b(?:contract|agreement|lawsuit|legal notice|subpoena|summons|court|attorney|settlement|docusign|e-?signature|sign(?:ature)? requested|notice of (?:claim|default|intent)|jury)\b/i;
const LEGAL_DOMAIN = /(?:^|\.)(?:docusign|hellosign|adobesign|pandadoc|courts?|uscourts|law|legal|attorneys?)\.[a-z.]{2,12}$|\.(?:law|legal|attorney)$/i;

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
  const user = mail.fromAddress.split("@")[0] ?? "";
  const money = MONEY_DOMAIN.test(mail.fromDomain) || MONEY_USER.test(user) || MONEY_SUBJECT.test(mail.subject);
  const legal = LEGAL_DOMAIN.test(mail.fromDomain) || LEGAL_SUBJECT.test(mail.subject);
  if (!money && !legal) return { kind: "pass" };
  for (const [re, reason] of URGENT) if (re.test(mail.subject)) return { kind: "heads-up", reason };
  return { kind: "skip" };
}
