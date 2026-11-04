/**
 * The email agent's endpoints (#263, docs/GMAIL.md). Azure only: azure/src/index.ts registers them behind the same
 * site gate as every function; Vercel has no route for them, so the Vercel copy's Desk says the email agent lives on
 * the Azure copy.
 *
 *   GET  /api/email?view=status   the public counts (EmailStatus): what the Lattice's Relay room reads. No session.
 *   GET  /api/email               the private list (EmailView): the Desk's Relay page. Passkey session only.
 *   POST /api/email { action }    passkey session only:
 *          "connect"     → { url }: Google's consent page for gmail.readonly and gmail.send, and a short state cookie (below)
 *          "disconnect"  → forgets the token (and asks Google to revoke it) and clears the private list
 *          "done", id    → marks one mail handled
 *          "undone", id  → takes Done back (the Thread's Undo, #615)
 *          "reply", id, said   → Blasto's draft from Nikita's few words (./reply.ts), on the agent's own cap → { draft }
 *          "block" | "filter", id → a sender rule from that mail's sender (address) or domain → { rule }
 *          "unblock", rule     → takes a rule back
 *          "learn-style"       → reads a sample of their own sent mail once and keeps a few style traits → { style }
 *          "send", id, draft   → sends the draft on screen as a reply on the mail's thread (#615): only with a
 *                                gmail.send grant, only that exact draft, once per mail, under SEND_DAY_MAX a day and
 *                                the agent's monthly cap. The Desk posts it only after Nikita's yes and its undo window.
 *   GET  /api/gmail-callback      where Google sends the browser back with a one-time code
 *
 * The OAuth state (CSRF): "connect" makes 24 random bytes, sends them to Google as `state`, and sets them in a signed,
 * HttpOnly, Secure, SameSite=Lax `__Host-` cookie good for ten minutes, naming the passkey that asked. (Lax, because
 * the Desk's own session cookie is Strict and so isn't sent on the way back from Google; the site gate's cookie is
 * Lax, so the callback stays behind the gate.) The callback takes the code only when that cookie is there, signed by
 * us, unexpired, its passkey still enrolled, and its value equals `state`, compared in constant time; the cookie is
 * cleared either way. The code is traded for a refresh token server-side and sealed into the private store; it never
 * reaches the browser, and nothing here logs a code, a token or a mail.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { deskKeyFor } from "../_desk/keys.js";
import { readCookie, readToken, requireSession, signToken, withCookie, type DeskDeps } from "../_desk/session.js";
import { pickAuthStore, type AuthStore } from "../_desk/store.js";
import { AZURE_HOST, isSiteHost } from "../_site/hosts.js";
import { emailBudget, monthSpend } from "./budget.js";
import { authUrl, exchangeCode, revoke, type Fetcher, type OAuthClient } from "./gmail.js";
import { emptyEmailStatus, type EmailStatus } from "./status.js";
import { pickEmailStore, type EmailStore } from "./store.js";
import { markDone, mountainDay, statusOf } from "./tick.js";
import { monthOf } from "../_world/budget.js";
import { emptyEmailState, type EmailItem, type EmailState, type EmailView } from "./types.js";
import { accessToken, replyHeaders, SendNotAllowedError, sendReply, TokenRefusedError } from "./gmail.js";
import { skipTermsFrom } from "./filter.js";
import { claudeCall, type ClaudeCall } from "./sort.js";
import { cleanSaid, gmailSent, learnStyle, MAX_RULES, replyFromWords, RULE_ID, ruleFrom, sentSample, type SentReader } from "./reply.js";
import { addSpend, ADVISE_MODEL, canSpend, SORT_MODEL } from "./budget.js";
import { privateParts } from "../_privacy.js";

export const EMAIL_PATH = "/api/email";
export const CALLBACK_PATH = "/api/gmail-callback";
/**
 * The callback on the Static Web App's own address. GMAIL_REDIRECT_URI overrides it (it must match the OAuth
 * client's exactly). A connect started on one of the site's hosts (api/_site/hosts.ts) comes back to that same host
 * instead (redirectFor), since the state cookie is per host: while both answer (#314), Google's OAuth client lists both.
 */
export const DEFAULT_REDIRECT = `https://${AZURE_HOST}/api/gmail-callback`;
export const STATE_COOKIE = "__Host-ceo-gmail";
/** The state cookie lasts this long (s): time enough to pick an account and press Allow. */
export const STATE_S = 10 * 60;

type Env = Record<string, string | undefined>;

export interface EmailRouteDeps {
  desk: DeskDeps;
  store: EmailStore | null;
  /** The OAuth client, or null until GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are set. */
  client: OAuthClient | null;
  claude: boolean;
  budget: number;
  fetcher: Fetcher;
  now: number;
  /** Claude for the Thread's replies and the style (#615); null or left out without a key. */
  call?: ClaudeCall | null;
  skipTerms?: readonly string[];
  /** Reads Nikita's sent mail for the style; left out, the live Gmail reader on the stored token. */
  sent?: () => Promise<SentReader>;
}

/** The OAuth client from the settings, or null. */
export function clientFrom(env: Env): OAuthClient | null {
  const clientId = (env.GMAIL_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GMAIL_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  const given = (env.GMAIL_REDIRECT_URI ?? "").trim();
  const redirectUri = /^https:\/\/[^\s/]+\/api\/gmail-callback$/.test(given) ? given : DEFAULT_REDIRECT;
  return { clientId, clientSecret, redirectUri };
}

/**
 * The redirect for a request: the callback on the request's own host when it is one of the site's public addresses
 * (so the state cookie, which is host-only, comes back with it), else the client's configured one.
 */
export function redirectFor(client: OAuthClient, request: Request): OAuthClient {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.port || !isSiteHost(url.hostname)) return client;
  return { ...client, redirectUri: `https://${url.hostname.toLowerCase()}${CALLBACK_PATH}` };
}

export function liveRouteDeps(env: Env = process.env): EmailRouteDeps {
  const store: AuthStore | null = pickAuthStore(env);
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store, now: Date.now() },
    store: pickEmailStore(env),
    client: clientFrom(env),
    claude: Boolean(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY),
    budget: emailBudget(env.EMAIL_BUDGET_USD),
    fetcher: (url, init) => fetch(url, init),
    now: Date.now(),
    call: claudeCall(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || ""),
    skipTerms: skipTermsFrom(env.EMAIL_SKIP_TERMS),
  };
}

/** One change to the state, saved against its version, retried once on a lost race; the change's answer, or null. */
async function change<T>(store: EmailStore, fn: (s: EmailState) => { state: EmailState; out: T } | null): Promise<T | null> {
  for (let i = 0; i < 2; i++) {
    const { state, version } = await store.load();
    const got = fn(state);
    if (!got) return null;
    if (await store.save(got.state, version)) return got.out;
  }
  return null;
}

/** The most replies sent from the Desk in one Mountain day (#615): a seatbelt, far above a real day. */
export const SEND_DAY_MAX = 40;
/** A send claim older than this is stale (the function died mid-send) and may be tried again. */
const SEND_CLAIM_MS = 60_000;

/** An item as the Desk sees it: the sender keys stay on the server. */
const forDesk = ({ senderKey: _a, domainKey: _b, ...rest }: EmailItem) => rest;

function json(body: unknown, status = 200): Response {
  // Mail is private: never cached by the edge or the browser.
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

function redirect(to: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

const stateCookie = (value: string, maxAge: number) => `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
const clearState = () => stateCookie("", 0);

/** The state cookie's value and the nonce for Google, for a connect by `passkey` at `now`. */
export async function makeState(deskKey: string, passkey: string, now: number): Promise<{ nonce: string; cookie: string }> {
  const nonce = randomBytes(24).toString("base64url");
  const token = signToken(await deskKeyFor(deskKey, "gmail"), { t: "gmail", n: nonce, c: passkey, e: Math.floor(now / 1000) + STATE_S });
  return { nonce, cookie: stateCookie(token, STATE_S) };
}

/**
 * The OAuth state check: the passkey that started the connect, or null when the callback isn't the one we sent to
 * Google (no cookie, a cookie we didn't sign, an expired one, or a `state` that doesn't match it).
 */
export async function checkState(deskKey: string, cookieValue: string | null, state: string | null, now: number): Promise<string | null> {
  if (!deskKey || !cookieValue || !state || state.length > 128) return null;
  const p = readToken(await deskKeyFor(deskKey, "gmail"), cookieValue);
  if (!p || p.t !== "gmail" || typeof p.n !== "string" || typeof p.c !== "string" || typeof p.e !== "number") return null;
  if (p.e <= Math.floor(now / 1000)) return null;
  const a = Buffer.from(p.n);
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return p.c;
}

/** The status for this deployment: the stored one, or waiting when the agent isn't set up here. */
async function currentStatus(deps: EmailRouteDeps): Promise<EmailStatus> {
  if (!deps.store) return emptyEmailStatus(deps.now, "waiting");
  const { state } = await deps.store.load();
  return statusOf(state, { ready: deps.client !== null, claude: deps.claude, budget: deps.budget, now: deps.now });
}

export async function GET(request: Request, deps: EmailRouteDeps = liveRouteDeps()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === CALLBACK_PATH) return callback(request, deps);
  if (url.searchParams.get("view") === "status") {
    try {
      const status = deps.store ? ((await deps.store.status()) ?? (await currentStatus(deps))) : emptyEmailStatus(deps.now, "waiting");
      return new Response(JSON.stringify({ ok: true, status }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch {
      return json({ error: "store" }, 502);
    }
  }
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  if ([...url.searchParams.keys()].length) return withCookie(json({ error: "bad-request" }, 400), signed);
  try {
    const status = await currentStatus(deps);
    const state = deps.store ? (await deps.store.load()).state : emptyEmailState();
    const view: EmailView = {
      ok: true,
      status,
      canConnect: deps.client !== null && deps.store !== null,
      canSend: deps.store ? Boolean((await deps.store.token().catch(() => null))?.send) : false,
      items: state.items.map(forDesk),
      rules: state.rules.map(({ id, kind, label, at }) => ({ id, kind, label, at })),
      ruled: state.ruled.day === mountainDay(deps.now) ? Math.min(9_999, state.ruled.count) : 0,
      style: state.style,
      applied: state.applied.month === monthOf(deps.now) ? Math.min(9_999, state.applied.count) : 0,
      urgentSkipped: state.day.day === mountainDay(deps.now) ? Math.min(9_999, state.day.urgent) : 0,
      spend: { usd: Math.round(monthSpend(state, deps.now).usd * 10_000) / 10_000, budget: deps.budget },
    };
    return withCookie(json(view), signed);
  } catch {
    return withCookie(json({ error: "store" }, 502), signed);
  }
}

export async function POST(request: Request, deps: EmailRouteDeps = liveRouteDeps()): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "bad-request" }, 415);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  if (!body || typeof body !== "object") return withCookie(json({ error: "bad-request" }, 400), signed);
  const store = deps.store;
  if (!store) return withCookie(json({ error: "not-set-up" }, 503), signed);

  if (body.action === "connect") {
    if (!deps.client) return withCookie(json({ error: "not-set-up" }, 503), signed);
    const { nonce, cookie } = await makeState(deps.desk.deskKey, signed.passkey.id, deps.now);
    const res = withCookie(json({ ok: true, url: authUrl(redirectFor(deps.client, request), nonce) }), signed);
    res.headers.append("Set-Cookie", cookie);
    return res;
  }

  if (body.action === "disconnect") {
    const token = await store.token().catch(() => null);
    if (token) await revoke(deps.fetcher, token.refresh);
    await store.dropToken().catch(() => undefined);
    // Forget the mail too: a disconnected inbox leaves nothing behind on the Desk.
    for (let i = 0; i < 2; i++) {
      const { state, version } = await store.load();
      const next = { ...emptyEmailState(), spend: state.spend, unsorted: state.unsorted };
      if (await store.save(next, version)) {
        await store.saveStatus(statusOf(next, { ready: deps.client !== null, claude: deps.claude, budget: deps.budget, now: deps.now })).catch(() => undefined);
        break;
      }
    }
    return withCookie(json({ ok: true }), signed);
  }

  if (body.action === "done") {
    if (typeof body.id !== "string" || !/^[0-9a-f]{6,32}$/.test(body.id)) return withCookie(json({ error: "bad-request" }, 400), signed);
    const ok = await markDone(store, body.id);
    if (ok) {
      const { state } = await store.load();
      await store.saveStatus(statusOf(state, { ready: deps.client !== null, claude: deps.claude, budget: deps.budget, now: deps.now })).catch(() => undefined);
    }
    return withCookie(json({ ok }), signed);
  }

  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  const okId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{6,32}$/.test(v);
  const saveStatus = async () => {
    const { state } = await store.load();
    await store.saveStatus(statusOf(state, { ready: deps.client !== null, claude: deps.claude, budget: deps.budget, now: deps.now })).catch(() => undefined);
  };

  if (body.action === "undone") {
    if (!okId(body.id)) return reply({ error: "bad-request" }, 400);
    const id = body.id;
    const ok = await change(store, (s) => (s.items.some((x) => x.id === id) ? { state: { ...s, items: s.items.map((x) => (x.id === id ? { ...x, done: false } : x)) }, out: true } : null));
    if (ok) await saveStatus();
    return reply({ ok: Boolean(ok) });
  }

  if (body.action === "reply") {
    const b = body as { id?: unknown; said?: unknown };
    const said = cleanSaid(b.said);
    if (!okId(b.id) || !said) return reply({ error: "bad-request" }, 400);
    // Their words go to Claude: never a number, an address, a card or a key (a name is fine in a reply).
    if (privateParts(said).some((k) => k !== "name")) return reply({ error: "private" }, 422);
    if (!deps.call) return reply({ error: "not-set-up" }, 503);
    const { state } = await store.load();
    const item = state.items.find((x) => x.id === b.id && !x.done && x.kind !== "noise");
    if (!item) return reply({ error: "no-item" }, 404);
    if (!canSpend(state, ADVISE_MODEL, deps.budget, deps.now)) return reply({ error: "cap" }, 429);
    let got: Awaited<ReturnType<typeof replyFromWords>>;
    try {
      got = await replyFromWords(deps.call, item, said, state.style);
    } catch {
      return reply({ error: "claude" }, 502);
    }
    const draft = got.draft;
    await change(store, (s) => ({ state: { ...addSpend(s, ADVISE_MODEL, got.usage, deps.now), items: draft ? s.items.map((x) => (x.id === item.id ? { ...x, draft, said } : x)) : s.items }, out: true }));
    return draft ? reply({ ok: true, draft, said }) : reply({ error: "claude" }, 502);
  }

  if (body.action === "block" || body.action === "filter") {
    const kind = body.action;
    if (!okId(body.id)) return reply({ error: "bad-request" }, 400);
    const id = body.id;
    const rule = await change(store, (s) => {
      const item = s.items.find((x) => x.id === id);
      const r = item ? ruleFrom(item, kind, deps.now) : null;
      if (!r) return null;
      const rules = [...s.rules.filter((x) => !(x.kind === r.kind && x.key === r.key)), r].slice(-MAX_RULES);
      // What the rule covers leaves the list now, marked done so Undo can bring it back.
      const covered = (x: EmailItem) => (kind === "block" ? x.senderKey === r.key : x.domainKey === r.key);
      return { state: { ...s, rules, items: s.items.map((x) => (covered(x) ? { ...x, done: true } : x)) }, out: r };
    });
    if (!rule) return reply({ error: "no-key" }, 409);
    await saveStatus();
    return reply({ ok: true, rule: { id: rule.id, kind: rule.kind, label: rule.label, at: rule.at } });
  }

  if (body.action === "unblock") {
    const rid = (body as { rule?: unknown }).rule;
    if (typeof rid !== "string" || !RULE_ID.test(rid)) return reply({ error: "bad-request" }, 400);
    const ok = await change(store, (s) => {
      const r = s.rules.find((x) => x.id === rid);
      if (!r) return null;
      // Undo brings back what the rule took off the list just now (the last ten minutes).
      const back = (x: EmailItem) => x.done && deps.now - r.at < 10 * 60_000 && (r.kind === "block" ? x.senderKey === r.key : x.domainKey === r.key);
      return { state: { ...s, rules: s.rules.filter((x) => x.id !== rid), items: s.items.map((x) => (back(x) ? { ...x, done: false } : x)) }, out: true };
    });
    if (ok) await saveStatus();
    return reply({ ok: Boolean(ok) });
  }

  if (body.action === "learn-style") {
    if (!deps.call) return reply({ error: "not-set-up" }, 503);
    const { state } = await store.load();
    if (!canSpend(state, ADVISE_MODEL, deps.budget, deps.now)) return reply({ error: "cap" }, 429);
    let reader: SentReader;
    try {
      reader = deps.sent ? await deps.sent() : await liveSent(deps, store);
    } catch (e) {
      return reply({ error: e instanceof TokenRefusedError ? "refused" : "gmail" }, 502);
    }
    let sample: string[];
    try {
      sample = await sentSample(reader, deps.skipTerms ?? []);
    } catch {
      return reply({ error: "gmail" }, 502);
    }
    if (sample.length < 3) return reply({ error: "too-few" }, 409);
    let got: Awaited<ReturnType<typeof learnStyle>>;
    try {
      got = await learnStyle(deps.call, sample);
    } catch {
      return reply({ error: "claude" }, 502);
    }
    const style = got.traits.length ? { traits: got.traits, from: sample.length, at: deps.now } : null;
    await change(store, (s) => ({ state: { ...addSpend(s, ADVISE_MODEL, got.usage, deps.now), ...(style && { style }) }, out: true }));
    return style ? reply({ ok: true, style }) : reply({ error: "claude" }, 502);
  }

  if (body.action === "send") {
    const b = body as { id?: unknown; draft?: unknown };
    if (!okId(b.id) || typeof b.draft !== "string" || !b.draft.trim() || b.draft.length > 2_000) return reply({ error: "bad-request" }, 400);
    const id = b.id;
    const text = b.draft;
    const token = await store.token().catch(() => null);
    if (!token || !deps.client) return reply({ error: "not-connected" }, 409);
    if (!token.send) return reply({ error: "no-send" }, 403);
    const day = mountainDay(deps.now);
    // Claim it first, against the state's version: the exact draft on screen, once, under the day's count and the cap.
    const claim = await change<{ ok: true } | { ok: false; error: string; status: number }>(store, (s) => {
      const item = s.items.find((x) => x.id === id);
      if (!item || item.done || item.kind === "noise") return { state: s, out: { ok: false, error: "no-item", status: 404 } };
      if (item.sentAt || (item.sending && deps.now - item.sending < SEND_CLAIM_MS)) return { state: s, out: { ok: false, error: "already-sent", status: 409 } };
      if (item.draft !== text) return { state: s, out: { ok: false, error: "changed", status: 409 } };
      const count = s.sends.day === day ? s.sends.count : 0;
      if (count >= SEND_DAY_MAX || !canSpend(s, SORT_MODEL, deps.budget, deps.now)) return { state: s, out: { ok: false, error: "cap", status: 429 } };
      return { state: { ...s, sends: { day, count: count + 1 }, items: s.items.map((x) => (x.id === id ? { ...x, sending: deps.now } : x)) }, out: { ok: true } };
    });
    if (!claim) return reply({ error: "busy" }, 409);
    if (!claim.ok) return reply({ error: claim.error }, claim.status);
    const release = () => change(store, (s) => ({ state: { ...s, items: s.items.map((x) => (x.id === id ? { ...x, sending: undefined } : x)) }, out: true }));
    try {
      const access = await accessToken(deps.fetcher, deps.client, token.refresh);
      const to = await replyHeaders(deps.fetcher, access, id);
      if (!to) {
        await release();
        return reply({ error: "no-address" }, 422);
      }
      await sendReply(deps.fetcher, access, to, text);
    } catch (e) {
      await release();
      return reply({ error: e instanceof SendNotAllowedError ? "no-send" : e instanceof TokenRefusedError ? "refused" : "gmail" }, 502);
    }
    await change(store, (s) => ({ state: { ...s, items: s.items.map((x) => (x.id === id ? { ...x, sending: undefined, sentAt: deps.now, done: true } : x)) }, out: true }));
    await saveStatus();
    return reply({ ok: true, sentAt: deps.now });
  }

  return reply({ error: "bad-request" }, 400);
}

/** The live sent-mail reader: a fresh access token from the stored refresh token. */
async function liveSent(deps: EmailRouteDeps, store: EmailStore): Promise<SentReader> {
  const token = await store.token();
  if (!token || !deps.client) throw new Error("not connected");
  const access = await accessToken(deps.fetcher, deps.client, token.refresh);
  return gmailSent(deps.fetcher, access);
}

/** Google's redirect back: check the state, trade the code, seal the token, send the browser to the Relay page. */
export async function callback(request: Request, deps: EmailRouteDeps): Promise<Response> {
  const url = new URL(request.url);
  const back = (result: "connected" | "cancelled" | "refused" | "failed") => redirect(`/relay?gmail=${result}`, [clearState()]);
  const passkey = await checkState(deps.desk.deskKey, readCookie(request, STATE_COOKIE), url.searchParams.get("state"), deps.now).catch(() => null);
  if (!passkey || !deps.desk.store) return back("refused");
  // The device that asked must still be enrolled.
  const enrolled = (await deps.desk.store.passkeys().catch(() => [])).some((p) => p.id === passkey);
  if (!enrolled) return back("refused");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || !deps.client || !deps.store) return back("failed");
  try {
    // The same redirect the connect sent to Google: Google refuses a code traded with any other.
    const { refresh, send } = await exchangeCode(deps.fetcher, redirectFor(deps.client, request), code);
    await deps.store.saveToken({ refresh, connectedAt: deps.now, ...(send && { send: true }) });
    // Start the history afresh on the next tick, from the new connection, and catch up on its unread mail (#323).
    for (let i = 0; i < 2; i++) {
      const { state, version } = await deps.store.load();
      if (await deps.store.save({ ...state, historyId: null, gmail: "connected", lastError: null, catchUpListed: false, catchUp: [] }, version)) break;
    }
    return back("connected");
  } catch {
    return back("failed");
  }
}
