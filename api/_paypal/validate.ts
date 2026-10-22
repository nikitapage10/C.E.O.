/**
 * The Spire's invoices, checked on the server (#279, docs/PAYPAL.md): what the Desk sends to make a draft, and what
 * PayPal sends back about an invoice. The Desk checks the same things for a friendly message, but only this counts.
 *
 * A new invoice: a client name (1 to 120 characters) and email (PayPal's own restrictive pattern, at most 254), 1 to
 * 20 lines (a name of 1 to 120, an optional description up to 300, a quantity above 0 up to 9,999 with at most two
 * decimals, a unit price above 0 up to 100,000 with at most two decimals), a due date from today (Mountain) up to a
 * year out, an optional note up to 1,000, and a currency from a short list (USD unless given). The total stays at or
 * under 250,000. Control characters are refused, not stripped, so what Nikita sees is what PayPal gets.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { INVOICE_ID, type DraftInput } from "./paypal.js";
import type { InvoiceItem, InvoiceState } from "./types.js";

export const MAX_ITEMS = 20;
export const MAX_NAME = 120;
export const MAX_ITEM_NAME = 120;
export const MAX_DESCRIPTION = 300;
export const MAX_NOTE = 1000;
export const MAX_QUANTITY = 9_999;
export const MAX_UNIT = 100_000;
export const MAX_TOTAL = 250_000;
export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** PayPal's `restrictive_email_address`: a dot-atom local part of 1 to 64, a domain with a dot and a letter TLD. */
export const EMAIL = /^(?!\.)(?:[A-Za-z0-9!#$&'*/=?^`{|}~_%+-]|\.(?!\.)){1,64}(?<!\.)@(?:[A-Za-z0-9-]|\.(?!\.))+\.[A-Za-z]{2,}$/;
/** A positive amount with at most two decimals. */
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

export type DraftError =
  | "client-name"
  | "client-email"
  | "items"
  | "item-name"
  | "item-description"
  | "quantity"
  | "amount"
  | "total"
  | "due-date"
  | "note"
  | "currency"
  | "bad-request";

/** Today's date in Mountain time (where Nikita is), as YYYY-MM-DD. */
export function mountainDate(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

const dayNumber = (ymd: string): number | null => {
  if (!DATE.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  // Date.parse rolls 2026-02-31 over; a real date reads back the same.
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === ymd ? Math.round(t / 86_400_000) : null;
};

/** A string field: trimmed, within its length, with no control characters; "" when absent and allowed. */
function text(v: unknown, max: number, required: boolean): string | null {
  if (v === undefined || v === null || v === "") return required ? null : "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  if ((required && !t) || t.length > max || CONTROL.test(t)) return null;
  return t;
}

/** An amount as PayPal takes it ("12.50"), or null when it isn't above 0 with at most two decimals, within `max`. */
export function money(v: unknown, max: number): string | null {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!MONEY.test(s)) return null;
  const n = Number(s);
  if (!(n > 0) || n > max) return null;
  return n.toFixed(2);
}

/** Cents, exactly, from a two-decimal string. */
const cents = (s: string) => Math.round(Number(s) * 100);

/** The draft Nikita asked for, checked; or the first thing wrong with it. */
export function readDraft(input: unknown, now: number): { ok: true; draft: DraftInput } | { ok: false; error: DraftError } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bad-request" };
  const o = input as Record<string, unknown>;
  const clientName = text(o.clientName, MAX_NAME, true);
  if (clientName === null) return { ok: false, error: "client-name" };
  const clientEmail = text(o.clientEmail, 254, true);
  if (clientEmail === null || !EMAIL.test(clientEmail)) return { ok: false, error: "client-email" };
  const currency = o.currency === undefined || o.currency === "" ? "USD" : o.currency;
  if (typeof currency !== "string" || !(CURRENCIES as readonly string[]).includes(currency)) return { ok: false, error: "currency" };
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > MAX_ITEMS) return { ok: false, error: "items" };
  const items: DraftInput["items"] = [];
  let total = 0;
  for (const raw of o.items as unknown[]) {
    const it = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = text(it.name, MAX_ITEM_NAME, true);
    if (name === null) return { ok: false, error: "item-name" };
    const description = text(it.description, MAX_DESCRIPTION, false);
    if (description === null) return { ok: false, error: "item-description" };
    const quantity = money(it.quantity ?? "1", MAX_QUANTITY);
    if (quantity === null) return { ok: false, error: "quantity" };
    const unitAmount = money(it.unitAmount, MAX_UNIT);
    if (unitAmount === null) return { ok: false, error: "amount" };
    total += Math.round((cents(quantity) * cents(unitAmount)) / 100);
    // PayPal takes up to five decimals on a quantity; "2.00" reads cleaner to a client as "2".
    items.push({ name, ...(description && { description }), quantity: String(Number(quantity)), unitAmount });
  }
  if (total / 100 > MAX_TOTAL) return { ok: false, error: "total" };
  const today = mountainDate(now);
  const due = typeof o.dueDate === "string" ? dayNumber(o.dueDate) : null;
  const start = dayNumber(today)!;
  if (due === null || due < start || due > start + 366) return { ok: false, error: "due-date" };
  const note = text(o.note, MAX_NOTE, false);
  if (note === null) return { ok: false, error: "note" };
  return { ok: true, draft: { clientName, clientEmail, currency, invoiceDate: today, dueDate: o.dueDate as string, ...(note && { note }), items } };
}

/** An invoice id from the Desk, or null. */
export const readId = (v: unknown): string | null => (typeof v === "string" && INVOICE_ID.test(v) ? v : null);

/* ── What PayPal says about an invoice, made into the Desk's shape ── */

// Everything else (SENT, UNPAID, SCHEDULED, PARTIALLY_PAID, PAYMENT_PENDING, SHARED, and any status PayPal adds) is open.
const PAID = new Set(["PAID", "MARKED_AS_PAID", "PAID_EXTERNAL"]);
const CANCELLED = new Set(["CANCELLED", "AUTO_CANCELLED"]);
const REFUNDED = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED", "REFUNDED_EXTERNAL"]);

/** The Desk's state for PayPal's status, and the due date against today (Mountain). Unknown statuses count as unpaid. */
export function stateOf(status: string, dueDate: string, today: string): InvoiceState {
  if (status === "DRAFT") return "draft";
  if (PAID.has(status)) return "paid";
  if (CANCELLED.has(status)) return "cancelled";
  if (REFUNDED.has(status)) return "refunded";
  const due = dayNumber(dueDate);
  const now = dayNumber(today);
  return due !== null && now !== null && due < now ? "overdue" : "unpaid";
}

const str = (v: unknown, max: number) => (typeof v === "string" && !CONTROL.test(v) ? v.slice(0, max) : "");
const amount = (v: unknown) => {
  const value = (v as { value?: unknown } | null)?.value;
  return typeof value === "string" && /^-?\d{1,12}(\.\d{1,5})?$/.test(value) ? value : "";
};
/** Nikita's view on paypal.com, only when it really is paypal.com (sandbox or live). */
function paypalLink(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "www.paypal.com" || u.hostname === "www.sandbox.paypal.com") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** One invoice from PayPal's list or GET, made into the Desk's shape; null when it isn't one. */
export function readInvoice(raw: unknown, today: string): InvoiceItem | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || !INVOICE_ID.test(o.id)) return null;
  const detail = (o.detail ?? {}) as Record<string, unknown>;
  const term = (detail.payment_term ?? {}) as Record<string, unknown>;
  const meta = (detail.metadata ?? {}) as Record<string, unknown>;
  const recipient = (Array.isArray(o.primary_recipients) ? o.primary_recipients[0] : null) as { billing_info?: Record<string, unknown> } | null;
  const billing = recipient?.billing_info ?? {};
  const name = (billing.name ?? {}) as Record<string, unknown>;
  const clientName = str(name.full_name, 200) || [str(name.given_name, 140), str(name.surname, 140)].filter(Boolean).join(" ") || str(billing.business_name, 200);
  const status = typeof o.status === "string" ? o.status : "";
  const dueDate = typeof term.due_date === "string" && DATE.test(term.due_date) ? term.due_date : "";
  const total = (o.amount ?? {}) as Record<string, unknown>;
  const currency = typeof total.currency_code === "string" && /^[A-Z]{3}$/.test(total.currency_code) ? total.currency_code : typeof detail.currency_code === "string" && /^[A-Z]{3}$/.test(detail.currency_code) ? detail.currency_code : "";
  return {
    id: o.id,
    number: str(detail.invoice_number, 25),
    state: stateOf(status, dueDate, today),
    viewed: detail.viewed_by_recipient === true,
    partial: status === "PARTIALLY_PAID",
    clientName,
    clientEmail: str(billing.email_address, 254),
    total: amount(o.amount),
    due: amount(o.due_amount),
    currency,
    invoiceDate: typeof detail.invoice_date === "string" && DATE.test(detail.invoice_date) ? detail.invoice_date : "",
    dueDate,
    link: paypalLink(meta.invoicer_view_url),
  };
}
