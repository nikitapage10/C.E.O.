/**
 * What the Spire's invoicing may ever tell the public site (#279, docs/PAYPAL.md): counts, enum states and a
 * timestamp. No client, email, number, amount or currency, and no free string of any kind. The Lattice's Spire room,
 * Systems and the Boiler Room's pipe read this and nothing else.
 *
 * `readInvoiceStatus` is a hand-written allowlist (like the email agent's EmailStatus): an unknown key refuses the
 * whole status, the only strings it takes are the enum values below, counts are small whole numbers, and it returns a
 * fresh object built from the known keys so nothing rides along.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export const INVOICE_STATUS_VERSION = 1;

/** "waiting" until the PayPal keys are set; "live" when the last read worked; "error" when PayPal didn't answer or refused the keys. */
export const PAYPAL_STATES = ["waiting", "live", "error"] as const;
export type PaypalState = (typeof PAYPAL_STATES)[number];

export const PAYPAL_MODES = ["sandbox", "live"] as const;
export type PaypalMode = (typeof PAYPAL_MODES)[number];

export const INVOICE_MAX_COUNT = 9_999;
const EARLIEST = Date.UTC(2026, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);

export interface InvoiceStatus {
  v: typeof INVOICE_STATUS_VERSION;
  /** When it was read (ms). */
  at: number;
  paypal: PaypalState;
  mode: PaypalMode;
  /** Drafts not yet sent. */
  drafts: number;
  /** Sent and not yet paid, overdue ones included. */
  open: number;
  /** Open past their due date. */
  overdue: number;
  /** Paid, among the newest invoices PayPal lists. */
  paid: number;
}

export const INVOICE_STATUS_KEYS = ["v", "at", "paypal", "mode", "drafts", "open", "overdue", "paid"] as const satisfies readonly (keyof InvoiceStatus)[];
const COUNT_KEYS = ["drafts", "open", "overdue", "paid"] as const;

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= INVOICE_MAX_COUNT;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** The status, rebuilt from the allowlist; null for anything else. */
export function readInvoiceStatus(input: unknown): InvoiceStatus | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(INVOICE_STATUS_KEYS as readonly string[]).includes(k))) return null;
  if (o.v !== INVOICE_STATUS_VERSION || typeof o.at !== "number" || !Number.isInteger(o.at) || o.at < EARLIEST || o.at > LATEST) return null;
  if (!oneOf(PAYPAL_STATES, o.paypal) || !oneOf(PAYPAL_MODES, o.mode) || !COUNT_KEYS.every((k) => isCount(o[k]))) return null;
  if ((o.overdue as number) > (o.open as number)) return null;
  return { v: INVOICE_STATUS_VERSION, at: o.at, paypal: o.paypal, mode: o.mode, drafts: o.drafts as number, open: o.open as number, overdue: o.overdue as number, paid: o.paid as number };
}

export function emptyInvoiceStatus(at: number, paypal: PaypalState = "waiting", mode: PaypalMode = "sandbox"): InvoiceStatus {
  return { v: INVOICE_STATUS_VERSION, at, paypal, mode, drafts: 0, open: 0, overdue: 0, paid: 0 };
}
