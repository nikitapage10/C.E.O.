/**
 * PayPal's Invoicing API v2 for the Spire (#279, docs/PAYPAL.md): Nikita's own invoices, made as drafts from the Desk
 * and sent to a client only when he taps Send. Azure only: the REST app's client id and secret live only in the
 * Function App's settings (Key Vault references), and nothing here runs on Vercel.
 *
 * Checked against PayPal's published spec (developer.paypal.com/api/invoicing/v2/schema.json, 2026-10-22):
 *   POST /v1/oauth2/token                          client credentials (Basic id:secret), grant_type=client_credentials
 *                                                  → { access_token, token_type, expires_in (s) }
 *   POST /v2/invoicing/generate-next-invoice-number → { invoice_number }
 *   POST /v2/invoicing/invoices                    an `invoice` (detail.currency_code required; invoicer left out, so
 *                                                  PayPal fills it from the account) → 201, the invoice itself with
 *                                                  `Prefer: return=representation`, otherwise a link to it
 *   POST /v2/invoicing/invoices/{id}/send          a `notification` ({ send_to_recipient, send_to_invoicer }) → 200 or
 *                                                  202 with a link
 *   GET  /v2/invoicing/invoices?page&page_size     (page_size at most 100) → { items, total_items, total_pages }
 *   GET  /v2/invoicing/invoices/{id}               → the invoice
 *   POST /v2/invoicing/invoices/{id}/cancel        a `notification` → 204 (only for a sent invoice)
 *
 * Every call has a timeout, refuses redirects and caps the body it reads. Nothing here logs: not a token, a client's
 * name or email, an item or an amount. Errors carry a short code, never PayPal's message (which can echo input).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const PAYPAL_BASE = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } as const;
export type PaypalEnv = keyof typeof PAYPAL_BASE;

export interface PaypalClient {
  env: PaypalEnv;
  clientId: string;
  clientSecret: string;
}

type Env = Record<string, string | undefined>;

/** PayPal's REST app ids and secrets are long URL-safe strings. */
const CRED = /^[A-Za-z0-9_-]{16,256}$/;

/** The REST app from the settings, or null until PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are both set and sane. */
export function paypalFrom(env: Env): PaypalClient | null {
  const clientId = (env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!CRED.test(clientId) || !CRED.test(clientSecret)) return null;
  // Anything but an explicit "live" stays in the sandbox: a typo never sends a real invoice.
  const mode = (env.PAYPAL_ENV ?? "").trim().toLowerCase() === "live" ? "live" : "sandbox";
  return { env: mode, clientId, clientSecret };
}

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
/** A token is dropped this long before PayPal says it expires, so a call never goes out on one about to lapse. */
const TOKEN_MARGIN_S = 120;

/** A PayPal call that didn't work, by kind only. */
export class PaypalError extends Error {
  constructor(
    readonly code: "auth" | "refused" | "not-found" | "unavailable" | "bad-answer",
    readonly status = 0,
  ) {
    super(`paypal: ${code}`);
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new PaypalError("bad-answer", res.status);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PaypalError("bad-answer", res.status);
  }
}

interface CachedToken {
  key: string;
  token: string;
  expires: number;
}

/** One token per REST app (and environment), kept until shortly before it expires. Module-level: a warm instance reuses it. */
let cached: CachedToken | null = null;

/** Forget the cached token (tests, and after PayPal refuses one). */
export function dropToken(): void {
  cached = null;
}

const tokenKey = (c: PaypalClient) => `${c.env}\u0000${c.clientId}`;

/** An access token for the REST app: the cached one while it is good, otherwise a fresh client-credentials grant. */
export async function accessToken(fetcher: Fetcher, client: PaypalClient, now = Date.now()): Promise<string> {
  const key = tokenKey(client);
  if (cached && cached.key === key && cached.expires > now) return cached.token;
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetcher(`${PAYPAL_BASE[client.env]}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new PaypalError("unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new PaypalError("auth", res.status);
  if (!res.ok) throw new PaypalError("unavailable", res.status);
  const body = (await readJson(res)) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof body?.access_token === "string" && /^[\w.~+/=-]{8,4096}$/.test(body.access_token) ? body.access_token : null;
  if (!token) throw new PaypalError("bad-answer", res.status);
  const life = typeof body?.expires_in === "number" && body.expires_in > 0 ? Math.min(body.expires_in, 12 * 3600) : 300;
  cached = { key, token, expires: now + Math.max(0, life - TOKEN_MARGIN_S) * 1000 };
  return token;
}

/** PayPal's invoice ids: INV2- and four groups of four. */
export const INVOICE_ID = /^INV2-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Only these paths are ever called; anything else throws before a token is used. */
const PATHS = [
  /^\/v2\/invoicing\/generate-next-invoice-number$/,
  /^\/v2\/invoicing\/invoices$/,
  /^\/v2\/invoicing\/invoices\/INV2-[A-Z0-9-]{19}$/,
  /^\/v2\/invoicing\/invoices\/INV2-[A-Z0-9-]{19}\/(send|cancel)$/,
];

/** One authorised call. Retries once with a fresh token when PayPal says the cached one is no good. */
export async function paypalCall(
  fetcher: Fetcher,
  client: PaypalClient,
  method: "GET" | "POST",
  path: string,
  opts: { query?: URLSearchParams; body?: unknown; prefer?: string; now?: number } = {},
): Promise<{ status: number; body: unknown }> {
  if (!PATHS.some((p) => p.test(path))) throw new Error("not an invoicing path");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(fetcher, client, opts.now);
    const qs = opts.query?.toString();
    let res: Response;
    try {
      res = await fetcher(`${PAYPAL_BASE[client.env]}${path}${qs ? `?${qs}` : ""}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(opts.body !== undefined && { "Content-Type": "application/json" }),
          ...(opts.prefer && { Prefer: opts.prefer }),
        },
        ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw new PaypalError("unavailable");
    }
    if (res.status === 401 && attempt === 0) {
      dropToken();
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new PaypalError("auth", res.status);
    if (res.status === 404) throw new PaypalError("not-found", res.status);
    if (res.status === 400 || res.status === 422) throw new PaypalError("refused", res.status);
    if (!res.ok) throw new PaypalError("unavailable", res.status);
    return { status: res.status, body: res.status === 204 ? null : await readJson(res) };
  }
  throw new PaypalError("auth", 401);
}

/* ── The invoices ── */

/** A line on a new invoice, already checked (./validate.ts). Amounts are strings with two decimals, as PayPal takes them. */
export interface DraftLine {
  name: string;
  description?: string;
  quantity: string;
  unitAmount: string;
}

/** A new invoice, already checked (./validate.ts). */
export interface DraftInput {
  clientName: string;
  clientEmail: string;
  currency: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  note?: string;
  items: DraftLine[];
}

/** The given name and surname PayPal asks for, from one "client name" field. */
export function splitName(full: string): { given_name: string; surname?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { given_name: parts[0] ?? full };
  return { given_name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1]! };
}

/**
 * The body for POST /v2/invoicing/invoices: a draft for one recipient. No invoicer block (PayPal fills it from the
 * account the token belongs to), no tips, no partial payments, and a due date rather than a term type (the spec takes
 * one or the other, not both).
 */
export function draftBody(input: DraftInput, invoiceNumber: string | null): Record<string, unknown> {
  return {
    detail: {
      currency_code: input.currency,
      ...(invoiceNumber && { invoice_number: invoiceNumber }),
      invoice_date: input.invoiceDate,
      payment_term: { due_date: input.dueDate },
      ...(input.note && { note: input.note }),
    },
    primary_recipients: [{ billing_info: { name: splitName(input.clientName), email_address: input.clientEmail } }],
    items: input.items.map((i) => ({
      name: i.name,
      ...(i.description && { description: i.description }),
      quantity: i.quantity,
      unit_amount: { currency_code: input.currency, value: i.unitAmount },
      unit_of_measure: "QUANTITY",
    })),
    configuration: { allow_tip: false, tax_inclusive: false },
  };
}

/** The next free invoice number, or null (PayPal then numbers it itself). */
export async function nextInvoiceNumber(fetcher: Fetcher, client: PaypalClient, now?: number): Promise<string | null> {
  try {
    const { body } = await paypalCall(fetcher, client, "POST", "/v2/invoicing/generate-next-invoice-number", { now });
    const n = (body as { invoice_number?: unknown } | null)?.invoice_number;
    return typeof n === "string" && n.length > 0 && n.length <= 25 ? n : null;
  } catch {
    return null;
  }
}

/** Makes the draft. Returns its id. Nothing is sent to the client. */
export async function createDraft(fetcher: Fetcher, client: PaypalClient, input: DraftInput, now?: number): Promise<string> {
  const number = await nextInvoiceNumber(fetcher, client, now);
  const { body } = await paypalCall(fetcher, client, "POST", "/v2/invoicing/invoices", { body: draftBody(input, number), prefer: "return=representation", now });
  const b = body as { id?: unknown; href?: unknown } | null;
  if (typeof b?.id === "string" && INVOICE_ID.test(b.id)) return b.id;
  // Without the representation PayPal answers with a link to the new invoice.
  const fromHref = typeof b?.href === "string" ? /\/invoices\/(INV2-[A-Z0-9-]{19})$/.exec(b.href)?.[1] : undefined;
  if (fromHref && INVOICE_ID.test(fromHref)) return fromHref;
  throw new PaypalError("bad-answer");
}

/** Sends a draft to its client (and a copy to Nikita). The only call that reaches a client. */
export async function sendInvoice(fetcher: Fetcher, client: PaypalClient, id: string, now?: number): Promise<void> {
  if (!INVOICE_ID.test(id)) throw new PaypalError("refused");
  await paypalCall(fetcher, client, "POST", `/v2/invoicing/invoices/${id}/send`, { body: { send_to_recipient: true, send_to_invoicer: true }, now });
}

/** Cancels a sent invoice, telling the client it's cancelled. */
export async function cancelInvoice(fetcher: Fetcher, client: PaypalClient, id: string, now?: number): Promise<void> {
  if (!INVOICE_ID.test(id)) throw new PaypalError("refused");
  await paypalCall(fetcher, client, "POST", `/v2/invoicing/invoices/${id}/cancel`, { body: { send_to_recipient: true, send_to_invoicer: true }, now });
}

/** One invoice by id, as PayPal has it. */
export async function getInvoice(fetcher: Fetcher, client: PaypalClient, id: string, now?: number): Promise<unknown> {
  if (!INVOICE_ID.test(id)) throw new PaypalError("refused");
  return (await paypalCall(fetcher, client, "GET", `/v2/invoicing/invoices/${id}`, { now })).body;
}

/** The newest invoices (PayPal's first page, newest first), up to 100. */
export async function listInvoices(fetcher: Fetcher, client: PaypalClient, pageSize = 50, now?: number): Promise<unknown[]> {
  const query = new URLSearchParams({ page: "1", page_size: String(Math.max(1, Math.min(100, pageSize))), total_required: "true" });
  const { body } = await paypalCall(fetcher, client, "GET", "/v2/invoicing/invoices", { query, now });
  const items = (body as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.slice(0, 100) : [];
}
