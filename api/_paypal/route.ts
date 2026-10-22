/**
 * The Spire's invoices (#279, docs/PAYPAL.md). Azure only: azure/src/index.ts registers it behind the same site gate
 * as every function, and Vercel has no route for it, so the Vercel copy's Desk says invoicing lives on the Azure copy.
 *
 *   GET  /api/invoices?view=status   the public counts (InvoiceStatus): drafts, open, overdue, paid. No session. Read
 *                                    from PayPal at most every five minutes per warm instance.
 *   GET  /api/invoices               the private list (InvoicesView): clients, emails, amounts, due dates. Passkey
 *                                    session only, `private, no-store`.
 *   POST /api/invoices { action }    passkey session only, JSON only, from the Desk's own pages (requireSession's
 *                                    same-origin check; the JSON content type also forces a CORS preflight):
 *          "create", draft          → { ok, id }: a PayPal DRAFT. Nothing reaches the client.
 *          "send", id, confirm:true → sends that draft to its client. The only action that does.
 *          "cancel", id, confirm:true → cancels a sent invoice (PayPal tells the client).
 *
 * Send and cancel need `confirm: true` in the body as well as the Desk's in-page "Yes, send it" step: a stray click,
 * a replayed create or a script that only knows the action name can't reach a client. Nothing here logs.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore } from "../_desk/store.js";
import { PaypalError, cancelInvoice, createDraft, getInvoice, listInvoices, paypalFrom, sendInvoice, type Fetcher, type PaypalClient } from "./paypal.js";
import { emptyInvoiceStatus, type InvoiceStatus } from "./status.js";
import type { InvoiceItem, InvoicesView } from "./types.js";
import { mountainDate, readDraft, readId, readInvoice } from "./validate.js";

export const INVOICES_PATH = "/api/invoices";
/** How long a warm instance keeps the public counts before asking PayPal again. */
export const STATUS_FRESH_MS = 5 * 60_000;
/** How many of the newest invoices the Desk lists (PayPal's page size, at most 100). */
export const LIST_SIZE = 50;

type Env = Record<string, string | undefined>;

export interface InvoicesDeps {
  desk: DeskDeps;
  /** The PayPal REST app, or null until its keys are set. */
  client: PaypalClient | null;
  fetcher: Fetcher;
  now: number;
}

export function liveInvoicesDeps(env: Env = process.env): InvoicesDeps {
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    client: paypalFrom(env),
    fetcher: (url, init) => fetch(url, init),
    now: Date.now(),
  };
}

function json(body: unknown, status = 200, cache = "private, no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache } });
}

/** The counts from a list: what may go public. */
export function countsOf(items: InvoiceItem[], at: number, mode: InvoiceStatus["mode"]): InvoiceStatus {
  const s = emptyInvoiceStatus(at, "live", mode);
  for (const i of items) {
    if (i.state === "draft") s.drafts++;
    else if (i.state === "unpaid") s.open++;
    else if (i.state === "overdue") {
      s.open++;
      s.overdue++;
    } else if (i.state === "paid") s.paid++;
  }
  return s;
}

/** The last public counts this instance worked out, and when. */
let lastStatus: InvoiceStatus | null = null;

/** Forget the cached counts (tests, and after a create, send or cancel). */
export function dropStatus(): void {
  lastStatus = null;
}

async function readList(deps: InvoicesDeps, client: PaypalClient): Promise<InvoiceItem[]> {
  const today = mountainDate(deps.now);
  const raw = await listInvoices(deps.fetcher, client, LIST_SIZE, deps.now);
  return raw.map((r) => readInvoice(r, today)).filter((x): x is InvoiceItem => x !== null);
}

async function publicStatus(deps: InvoicesDeps): Promise<InvoiceStatus> {
  const client = deps.client;
  if (!client) return emptyInvoiceStatus(deps.now, "waiting");
  if (lastStatus && lastStatus.mode === client.env && deps.now - lastStatus.at < STATUS_FRESH_MS) return lastStatus;
  try {
    lastStatus = countsOf(await readList(deps, client), deps.now, client.env);
  } catch {
    // Keep the counts PayPal last gave, marked as not answering; never a made-up zero that looks live.
    lastStatus = { ...(lastStatus && lastStatus.mode === client.env ? lastStatus : emptyInvoiceStatus(deps.now, "error", client.env)), at: deps.now, paypal: "error" };
  }
  return lastStatus;
}

const ERROR_STATUS: Record<PaypalError["code"], number> = { auth: 502, refused: 422, "not-found": 404, unavailable: 502, "bad-answer": 502 };

export async function GET(request: Request, deps: InvoicesDeps = liveInvoicesDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "status") {
    if ([...url.searchParams.keys()].length !== 1) return json({ error: "bad-request" }, 400, "no-store");
    return json({ ok: true, status: await publicStatus(deps) }, 200, "no-store");
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if ([...url.searchParams.keys()].length) return withCookie(json({ error: "bad-request" }, 400), signed);
  const client = deps.client;
  if (!client) {
    const view: InvoicesView = { ok: true, status: emptyInvoiceStatus(deps.now, "waiting"), env: "sandbox", items: [] };
    return withCookie(json(view), signed);
  }
  try {
    const items = await readList(deps, client);
    lastStatus = countsOf(items, deps.now, client.env);
    const view: InvoicesView = { ok: true, status: lastStatus, env: client.env, items };
    return withCookie(json(view), signed);
  } catch (e) {
    const code = e instanceof PaypalError ? e.code : "unavailable";
    return withCookie(json({ error: code === "auth" ? "paypal-keys" : "paypal" }, 502), signed);
  }
}

export async function POST(request: Request, deps: InvoicesDeps = liveInvoicesDeps()): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const text = await request.text().catch(() => "");
  if (text.length > 32_000) return reply({ error: "bad-request" }, 413);
  let body: Record<string, unknown> | null;
  try {
    const parsed = JSON.parse(text) as unknown;
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return reply({ error: "bad-request" }, 400);
  const client = deps.client;
  if (!client) return reply({ error: "not-set-up" }, 503);

  try {
    if (body.action === "create") {
      const checked = readDraft(body.draft, deps.now);
      if (!checked.ok) return reply({ error: checked.error }, 400);
      const id = await createDraft(deps.fetcher, client, checked.draft, deps.now);
      dropStatus();
      return reply({ ok: true, id });
    }

    if (body.action === "send" || body.action === "cancel") {
      const id = readId(body.id);
      if (!id) return reply({ error: "bad-request" }, 400);
      // The explicit second step: without it nothing reaches a client.
      if (body.confirm !== true) return reply({ error: "confirm" }, 409);
      const current = readInvoice(await getInvoice(deps.fetcher, client, id, deps.now), mountainDate(deps.now));
      if (!current) return reply({ error: "paypal" }, 502);
      if (body.action === "send") {
        if (current.state !== "draft") return reply({ error: "not-a-draft" }, 409);
        await sendInvoice(deps.fetcher, client, id, deps.now);
      } else {
        if (current.state !== "unpaid" && current.state !== "overdue") return reply({ error: "not-open" }, 409);
        await cancelInvoice(deps.fetcher, client, id, deps.now);
      }
      dropStatus();
      return reply({ ok: true });
    }
  } catch (e) {
    const code = e instanceof PaypalError ? e.code : "unavailable";
    return reply({ error: code === "auth" ? "paypal-keys" : code === "refused" ? "paypal-refused" : code === "not-found" ? "not-found" : "paypal" }, ERROR_STATUS[code]);
  }

  return reply({ error: "bad-request" }, 400);
}
