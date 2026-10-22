/**
 * The Spire's invoices as the Desk sees them (#279, docs/PAYPAL.md). `InvoiceItem` is private: a client's name and
 * email and the amounts reach only the Desk's passkey session. Only `InvoiceStatus` (./status.ts) ever leaves it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { InvoiceStatus } from "./status.js";

/**
 * Where an invoice stands, in the Desk's words. "unpaid" is sent and waiting (PayPal's SENT, UNPAID, SCHEDULED,
 * PARTIALLY_PAID, PAYMENT_PENDING); "overdue" is unpaid past its due date; "refunded" covers PayPal's refunds.
 */
export const INVOICE_STATES = ["draft", "unpaid", "overdue", "paid", "cancelled", "refunded"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export interface InvoiceItem {
  /** PayPal's id, INV2-…. */
  id: string;
  /** The invoice number PayPal shows the client. */
  number: string;
  state: InvoiceState;
  /** Whether the client has opened it, when PayPal says. */
  viewed: boolean;
  /** Part-paid: some money is in, some still due. */
  partial: boolean;
  clientName: string;
  clientEmail: string;
  /** The total, as PayPal's decimal string, and its currency. */
  total: string;
  due: string;
  currency: string;
  /** YYYY-MM-DD, or "" when none. */
  invoiceDate: string;
  dueDate: string;
  /** Nikita's own view of it on paypal.com, when PayPal gives one (checked to be paypal.com). */
  link: string | null;
}

/** GET /api/invoices in the passkey session. */
export interface InvoicesView {
  ok: true;
  status: InvoiceStatus;
  /** "sandbox" while testing; "live" once Nikita switches it. */
  env: "sandbox" | "live";
  items: InvoiceItem[];
}
