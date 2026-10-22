import { afterEach, describe, expect, it } from "vitest";
import { MemoryAuthStore } from "../_desk/store.ts";
import { TEST_PASSKEY, signedInCookie } from "../_desk/testing.ts";
import { PAYPAL_BASE, accessToken, draftBody, dropToken, paypalCall, paypalFrom, splitName, type Fetcher, type PaypalClient } from "./paypal.ts";
import { GET, INVOICES_PATH, POST, STATUS_FRESH_MS, countsOf, dropStatus, type InvoicesDeps } from "./route.ts";
import { INVOICE_STATUS_KEYS, emptyInvoiceStatus, readInvoiceStatus } from "./status.ts";
import { mountainDate, readDraft, readInvoice, stateOf } from "./validate.ts";

const SITE = "https://ceo.example";
const DESK_KEY = "desk-key-for-tests-0123456789abcdef";
// 2026-10-22 12:00 Mountain.
const NOW = Date.UTC(2026, 9, 22, 18);
const CLIENT: PaypalClient = { env: "sandbox", clientId: "AbCdEfGhIjKlMnOpQrSt", clientSecret: "ZyXwVuTsRqPoNmLkJiHg" };
const SB = PAYPAL_BASE.sandbox;

const ID1 = "INV2-AAAA-BBBB-CCCC-DDDD";
const ID2 = "INV2-EEEE-FFFF-GGGG-HHHH";
const ID3 = "INV2-JJJJ-KKKK-LLLL-MMMM";

/** Made-up client details that must never reach a public answer. */
const SECRETS = ["Stephanie Meyers", "bill-me@example.com", "1234.50", "Yoga mat", "#0042"];

function invoice(id: string, status: string, due: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    detail: { invoice_number: "#0042", invoice_date: "2026-10-01", currency_code: "USD", payment_term: { due_date: due }, metadata: { invoicer_view_url: `https://www.sandbox.paypal.com/invoice/details/${id}` }, viewed_by_recipient: status === "UNPAID" },
    primary_recipients: [{ billing_info: { name: { given_name: "Stephanie", surname: "Meyers" }, email_address: "bill-me@example.com" } }],
    items: [{ name: "Yoga mat", quantity: "1", unit_amount: { currency_code: "USD", value: "1234.50" } }],
    amount: { currency_code: "USD", value: "1234.50" },
    due_amount: { currency_code: "USD", value: "1234.50" },
    ...extra,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A stand-in PayPal: a token endpoint, the invoice list, and the writes, recording every call. */
function fakePaypal(opts: { invoices?: unknown[]; expiresIn?: number; tokenStatus?: number } = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  const invoices = opts.invoices ?? [invoice(ID1, "DRAFT", "2026-11-05"), invoice(ID2, "UNPAID", "2026-10-01"), invoice(ID3, "PAID", "2026-10-10")];
  const fetcher: Fetcher = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    calls.push({ url, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : undefined });
    const ok = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === `${SB}/v1/oauth2/token`) {
      if (opts.tokenStatus) return ok({ error: "invalid_client" }, opts.tokenStatus);
      tokens++;
      return ok({ access_token: `A21AA-token-${tokens}`, token_type: "Bearer", expires_in: opts.expiresIn ?? 32400 });
    }
    if (url === `${SB}/v2/invoicing/generate-next-invoice-number`) return ok({ invoice_number: "0043" });
    if (url === `${SB}/v2/invoicing/invoices` && init.method === "POST") return ok({ ...invoice("INV2-NEWW-DRAF-TTTT-0001", "DRAFT", "2026-11-05") }, 201);
    if (url.startsWith(`${SB}/v2/invoicing/invoices?`)) return ok({ items: invoices, total_items: invoices.length, total_pages: 1 });
    const one = /\/v2\/invoicing\/invoices\/(INV2-[A-Z0-9-]{19})(\/send|\/cancel)?$/.exec(url);
    if (one) {
      const found = invoices.find((i) => (i as { id: string }).id === one[1]);
      if (!found) return ok({ name: "RESOURCE_NOT_FOUND" }, 404);
      if (one[2] === "/send") return ok({ href: `https://www.sandbox.paypal.com/invoice/p/#${one[1]}`, rel: "payer-view", method: "GET" });
      if (one[2] === "/cancel") return ok(null, 204);
      return ok(found);
    }
    return ok({ name: "NOT_FOUND" }, 404);
  };
  return { fetcher, calls, tokens: () => tokens };
}

async function deps(fetcher: Fetcher, client: PaypalClient | null = CLIENT): Promise<InvoicesDeps> {
  const auth = new MemoryAuthStore();
  await auth.savePasskeys([TEST_PASSKEY]);
  return { desk: { deskKey: DESK_KEY, store: auth, now: NOW }, client, fetcher, now: NOW };
}

const cookie = (d: InvoicesDeps) => signedInCookie(DESK_KEY, NOW, d.desk.store!);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}${INVOICES_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const goodDraft = {
  clientName: "Stephanie Meyers",
  clientEmail: "bill-me@example.com",
  dueDate: "2026-11-05",
  note: "Thanks for the work.",
  items: [
    { name: "Design", quantity: "2", unitAmount: "150" },
    { name: "Hosting", description: "One year", quantity: "1", unitAmount: "99.99" },
  ],
};

afterEach(() => {
  dropToken();
  dropStatus();
});

describe("PayPal's settings", () => {
  it("needs both keys, and stays in the sandbox unless PAYPAL_ENV says live", () => {
    expect(paypalFrom({})).toBeNull();
    expect(paypalFrom({ PAYPAL_CLIENT_ID: CLIENT.clientId })).toBeNull();
    expect(paypalFrom({ PAYPAL_CLIENT_ID: CLIENT.clientId, PAYPAL_CLIENT_SECRET: "@Microsoft.KeyVault(x)" })).toBeNull();
    expect(paypalFrom({ PAYPAL_CLIENT_ID: CLIENT.clientId, PAYPAL_CLIENT_SECRET: CLIENT.clientSecret })?.env).toBe("sandbox");
    expect(paypalFrom({ PAYPAL_CLIENT_ID: CLIENT.clientId, PAYPAL_CLIENT_SECRET: CLIENT.clientSecret, PAYPAL_ENV: "lvie" })?.env).toBe("sandbox");
    expect(paypalFrom({ PAYPAL_CLIENT_ID: CLIENT.clientId, PAYPAL_CLIENT_SECRET: CLIENT.clientSecret, PAYPAL_ENV: " Live " })?.env).toBe("live");
  });
});

describe("the access token", () => {
  it("is asked for with client credentials and kept until shortly before it expires", async () => {
    const pp = fakePaypal({ expiresIn: 3600 });
    expect(await accessToken(pp.fetcher, CLIENT, NOW)).toBe("A21AA-token-1");
    expect(await accessToken(pp.fetcher, CLIENT, NOW + 30 * 60_000)).toBe("A21AA-token-1");
    expect(pp.tokens()).toBe(1);
    const call = pp.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.body).toBe("grant_type=client_credentials");
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from(`${CLIENT.clientId}:${CLIENT.clientSecret}`).toString("base64")}`);
    // Within two minutes of PayPal's expiry, a fresh one.
    expect(await accessToken(pp.fetcher, CLIENT, NOW + 59 * 60_000)).toBe("A21AA-token-2");
    expect(pp.tokens()).toBe(2);
  });

  it("isn't shared between the sandbox and live", async () => {
    const pp = fakePaypal();
    await accessToken(pp.fetcher, CLIENT, NOW);
    const live = { ...CLIENT, env: "live" as const };
    await expect(accessToken(pp.fetcher, live, NOW)).rejects.toThrow();
    expect(pp.calls[1]!.url).toBe(`${PAYPAL_BASE.live}/v1/oauth2/token`);
  });

  it("retries once with a fresh token when PayPal refuses the cached one", async () => {
    const pp = fakePaypal();
    let first = true;
    const fetcher: Fetcher = async (url, init) => {
      if (url.includes("/v2/") && first) {
        first = false;
        return new Response("{}", { status: 401 });
      }
      return pp.fetcher(url, init);
    };
    await paypalCall(fetcher, CLIENT, "GET", "/v2/invoicing/invoices", { query: new URLSearchParams({ page: "1" }), now: NOW });
    expect(pp.tokens()).toBe(2);
  });

  it("calls only invoicing paths", async () => {
    const pp = fakePaypal();
    await expect(paypalCall(pp.fetcher, CLIENT, "POST", "/v1/payments/payouts", { now: NOW })).rejects.toThrow("not an invoicing path");
    await expect(paypalCall(pp.fetcher, CLIENT, "POST", "/v2/invoicing/invoices/INV2-AAAA-BBBB-CCCC-DDDD/refunds", { now: NOW })).rejects.toThrow("not an invoicing path");
    expect(pp.calls).toHaveLength(0);
  });
});

describe("a new invoice", () => {
  it("is checked on the server", () => {
    const ok = readDraft(goodDraft, NOW);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.draft.currency).toBe("USD");
      expect(ok.draft.invoiceDate).toBe("2026-10-22");
      expect(ok.draft.items[0]).toEqual({ name: "Design", quantity: "2", unitAmount: "150.00" });
    }
    const bad = (patch: Record<string, unknown>) => {
      const r = readDraft({ ...goodDraft, ...patch }, NOW);
      return r.ok ? "ok" : r.error;
    };
    expect(bad({ clientName: "" })).toBe("client-name");
    expect(bad({ clientName: "x".repeat(121) })).toBe("client-name");
    expect(bad({ clientName: "Bad\u0007Name" })).toBe("client-name");
    expect(bad({ clientEmail: "not-an-email" })).toBe("client-email");
    expect(bad({ clientEmail: "a..b@example.com" })).toBe("client-email");
    expect(bad({ clientEmail: "a@example" })).toBe("client-email");
    expect(bad({ currency: "BTC" })).toBe("currency");
    expect(bad({ items: [] })).toBe("items");
    expect(bad({ items: Array.from({ length: 21 }, () => ({ name: "x", unitAmount: "1" })) })).toBe("items");
    expect(bad({ items: [{ name: "x", unitAmount: "0" }] })).toBe("amount");
    expect(bad({ items: [{ name: "x", unitAmount: "-5" }] })).toBe("amount");
    expect(bad({ items: [{ name: "x", unitAmount: "1.999" }] })).toBe("amount");
    expect(bad({ items: [{ name: "x", unitAmount: "1e3" }] })).toBe("amount");
    expect(bad({ items: [{ name: "x", unitAmount: "100000.01" }] })).toBe("amount");
    expect(bad({ items: [{ name: "x", unitAmount: "5", quantity: "0" }] })).toBe("quantity");
    expect(bad({ items: [{ name: "", unitAmount: "5" }] })).toBe("item-name");
    expect(bad({ items: [{ name: "x", unitAmount: "100000", quantity: "3" }] })).toBe("total");
    expect(bad({ dueDate: "2026-10-21" })).toBe("due-date");
    expect(bad({ dueDate: "2026-02-31" })).toBe("due-date");
    expect(bad({ dueDate: "2028-01-01" })).toBe("due-date");
    expect(bad({ note: "n".repeat(1001) })).toBe("note");
    expect(readDraft(null, NOW)).toEqual({ ok: false, error: "bad-request" });
  });

  it("goes to PayPal as a draft: one recipient, two-decimal amounts, a due date and no invoicer", () => {
    const r = readDraft({ ...goodDraft, currency: "CAD" }, NOW);
    if (!r.ok) throw new Error("draft refused");
    const body = draftBody(r.draft, "0043") as { detail: unknown; invoicer?: unknown; primary_recipients: unknown; items: unknown[]; configuration: unknown };
    expect(body.detail).toEqual({ currency_code: "CAD", invoice_number: "0043", invoice_date: "2026-10-22", payment_term: { due_date: "2026-11-05" }, note: "Thanks for the work." });
    expect(body.invoicer).toBeUndefined();
    expect(body.primary_recipients).toEqual([{ billing_info: { name: { given_name: "Stephanie", surname: "Meyers" }, email_address: "bill-me@example.com" } }]);
    expect(body.items[1]).toEqual({ name: "Hosting", description: "One year", quantity: "1", unit_amount: { currency_code: "CAD", value: "99.99" }, unit_of_measure: "QUANTITY" });
    expect(body.configuration).toEqual({ allow_tip: false, tax_inclusive: false });
    expect(splitName("Cher")).toEqual({ given_name: "Cher" });
    expect(splitName("Mary Ann  van Dyke")).toEqual({ given_name: "Mary Ann van", surname: "Dyke" });
  });

  it("create makes a draft and nothing else: no send call", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const res = await POST(post({ action: "create", draft: goodDraft }, { cookie: await cookie(d) }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "INV2-NEWW-DRAF-TTTT-0001" });
    const create = pp.calls.find((c) => c.url === `${SB}/v2/invoicing/invoices` && c.method === "POST")!;
    expect(create.headers.Prefer).toBe("return=representation");
    expect(JSON.parse(create.body!).detail.invoice_number).toBe("0043");
    expect(pp.calls.some((c) => c.url.endsWith("/send"))).toBe(false);
  });

  it("refuses a bad draft before PayPal hears of it", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const res = await POST(post({ action: "create", draft: { ...goodDraft, clientEmail: "nope" } }, { cookie: await cookie(d) }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "client-email" });
    expect(pp.calls).toHaveLength(0);
  });
});

describe("sending", () => {
  it("needs the passkey session", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    expect((await POST(post({ action: "send", id: ID1, confirm: true }), d)).status).toBe(401);
    expect(pp.calls).toHaveLength(0);
  });

  it("needs the Desk's own origin and JSON", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const c = await cookie(d);
    expect((await POST(post({ action: "send", id: ID1, confirm: true }, { cookie: c, origin: "https://evil.example" }), d)).status).toBe(403);
    const form = new Request(`${SITE}${INVOICES_PATH}`, { method: "POST", headers: { "content-type": "text/plain", cookie: c }, body: JSON.stringify({ action: "send", id: ID1, confirm: true }) });
    expect((await POST(form, d)).status).toBe(415);
    expect(pp.calls).toHaveLength(0);
  });

  it("needs confirm: true, exactly", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const c = await cookie(d);
    for (const confirm of [undefined, false, "true", 1]) {
      const res = await POST(post({ action: "send", id: ID1, confirm }, { cookie: c }), d);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "confirm" });
    }
    expect(pp.calls).toHaveLength(0);
  });

  it("sends a confirmed draft to its client, and only a draft", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const c = await cookie(d);
    const res = await POST(post({ action: "send", id: ID1, confirm: true }, { cookie: c }), d);
    expect(res.status).toBe(200);
    const send = pp.calls.find((x) => x.url.endsWith(`/invoices/${ID1}/send`))!;
    expect(JSON.parse(send.body!)).toEqual({ send_to_recipient: true, send_to_invoicer: true });
    // An already-sent invoice isn't sent again.
    const again = await POST(post({ action: "send", id: ID2, confirm: true }, { cookie: c }), d);
    expect(again.status).toBe(409);
    expect(pp.calls.some((x) => x.url.endsWith(`/invoices/${ID2}/send`))).toBe(false);
    // A made-up id never reaches PayPal.
    expect((await POST(post({ action: "send", id: "INV2-../../payouts", confirm: true }, { cookie: c }), d)).status).toBe(400);
  });

  it("cancels only an open invoice, with confirm", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const c = await cookie(d);
    expect((await POST(post({ action: "cancel", id: ID2 }, { cookie: c }), d)).status).toBe(409);
    expect((await POST(post({ action: "cancel", id: ID3, confirm: true }, { cookie: c }), d)).status).toBe(409);
    expect((await POST(post({ action: "cancel", id: ID2, confirm: true }, { cookie: c }), d)).status).toBe(200);
    expect(pp.calls.filter((x) => x.url.endsWith("/cancel")).map((x) => x.url)).toEqual([`${SB}/v2/invoicing/invoices/${ID2}/cancel`]);
  });
});

describe("where each invoice stands", () => {
  it("maps PayPal's statuses, overdue by the due date in Mountain time", () => {
    expect(stateOf("DRAFT", "2026-01-01", "2026-10-22")).toBe("draft");
    expect(stateOf("SENT", "2026-10-22", "2026-10-22")).toBe("unpaid");
    expect(stateOf("UNPAID", "2026-10-21", "2026-10-22")).toBe("overdue");
    expect(stateOf("PARTIALLY_PAID", "2026-10-01", "2026-10-22")).toBe("overdue");
    expect(stateOf("MARKED_AS_PAID", "2026-10-01", "2026-10-22")).toBe("paid");
    expect(stateOf("AUTO_CANCELLED", "", "2026-10-22")).toBe("cancelled");
    expect(stateOf("PARTIALLY_REFUNDED", "", "2026-10-22")).toBe("refunded");
    expect(mountainDate(Date.UTC(2026, 9, 23, 3))).toBe("2026-10-22");
  });

  it("reads PayPal's invoice defensively", () => {
    const item = readInvoice(invoice(ID2, "UNPAID", "2026-10-01"), "2026-10-22")!;
    expect(item).toMatchObject({ id: ID2, number: "#0042", state: "overdue", viewed: true, clientName: "Stephanie Meyers", clientEmail: "bill-me@example.com", total: "1234.50", currency: "USD" });
    expect(item.link).toBe(`https://www.sandbox.paypal.com/invoice/details/${ID2}`);
    const evil = readInvoice(invoice(ID2, "UNPAID", "2026-10-01", { detail: { metadata: { invoicer_view_url: "https://paypal.com.evil.example/x" } } }), "2026-10-22")!;
    expect(evil.link).toBeNull();
    expect(readInvoice({ id: "javascript:alert(1)" }, "2026-10-22")).toBeNull();
  });
});

describe("the public counts", () => {
  it("are counts only, through an allowlist", () => {
    const good = { ...emptyInvoiceStatus(NOW, "live"), open: 2, overdue: 1 };
    expect(readInvoiceStatus(good)).toEqual(good);
    expect(readInvoiceStatus({ ...good, client: "Stephanie" })).toBeNull();
    expect(readInvoiceStatus({ ...good, open: "2" })).toBeNull();
    expect(readInvoiceStatus({ ...good, overdue: 3 })).toBeNull();
    expect(readInvoiceStatus({ ...good, paypal: "connected" })).toBeNull();
    expect(Object.keys(countsOf([], NOW, "sandbox")).sort()).toEqual([...INVOICE_STATUS_KEYS].sort());
  });

  it("need no session, carry no client, email, number or amount, and are cached", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    const res = await GET(new Request(`${SITE}${INVOICES_PATH}?view=status`), d);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(JSON.parse(text).status).toMatchObject({ paypal: "live", mode: "sandbox", drafts: 1, open: 1, overdue: 1, paid: 1 });
    const lists = () => pp.calls.filter((c) => c.url.includes("/v2/invoicing/invoices?")).length;
    await GET(new Request(`${SITE}${INVOICES_PATH}?view=status`), { ...d, now: NOW + STATUS_FRESH_MS - 1 });
    expect(lists()).toBe(1);
    await GET(new Request(`${SITE}${INVOICES_PATH}?view=status`), { ...d, now: NOW + STATUS_FRESH_MS + 1 });
    expect(lists()).toBe(2);
  });

  it("say waiting without the keys, and never call PayPal", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher, null);
    const res = await GET(new Request(`${SITE}${INVOICES_PATH}?view=status`), d);
    expect((await res.json()).status).toMatchObject({ paypal: "waiting", open: 0 });
    expect(pp.calls).toHaveLength(0);
  });

  it("say error, not a made-up zero, when PayPal refuses the keys", async () => {
    const pp = fakePaypal({ tokenStatus: 401 });
    const d = await deps(pp.fetcher);
    const res = await GET(new Request(`${SITE}${INVOICES_PATH}?view=status`), d);
    expect((await res.json()).status.paypal).toBe("error");
  });
});

describe("the private list", () => {
  it("needs the passkey session and is never cached", async () => {
    const pp = fakePaypal();
    const d = await deps(pp.fetcher);
    expect((await GET(new Request(`${SITE}${INVOICES_PATH}`), d)).status).toBe(401);
    expect(pp.calls).toHaveLength(0);
    const res = await GET(new Request(`${SITE}${INVOICES_PATH}`, { headers: { cookie: await cookie(d) } }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const view = await res.json();
    expect(view.env).toBe("sandbox");
    expect(view.items.map((i: { state: string }) => i.state)).toEqual(["draft", "overdue", "paid"]);
  });
});
