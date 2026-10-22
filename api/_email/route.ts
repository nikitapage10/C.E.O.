/**
 * The email agent's endpoints (#263, docs/GMAIL.md). Azure only: azure/src/index.ts registers them behind the same
 * site gate as every function; Vercel has no route for them, so the Vercel copy's Desk says the email agent lives on
 * the Azure copy.
 *
 *   GET  /api/email?view=status   the public counts (EmailStatus): what the Lattice's Relay room reads. No session.
 *   GET  /api/email               the private list (EmailView): the Desk's Relay page. Passkey session only.
 *   POST /api/email { action }    passkey session only:
 *          "connect"     → { url }: Google's consent page for gmail.readonly, and a short state cookie (below)
 *          "disconnect"  → forgets the token (and asks Google to revoke it) and clears the private list
 *          "done", id    → marks one mail handled
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
import { emailBudget, monthSpend } from "./budget.js";
import { authUrl, exchangeCode, revoke, type Fetcher, type OAuthClient } from "./gmail.js";
import { emptyEmailStatus, type EmailStatus } from "./status.js";
import { pickEmailStore, type EmailStore } from "./store.js";
import { markDone, statusOf } from "./tick.js";
import { emptyEmailState, type EmailView } from "./types.js";

export const EMAIL_PATH = "/api/email";
export const CALLBACK_PATH = "/api/gmail-callback";
/** The Azure copy's own address; GMAIL_REDIRECT_URI overrides it (it must match the OAuth client's exactly). */
export const DEFAULT_REDIRECT = "https://thankful-forest-019308c1e.5.azurestaticapps.net/api/gmail-callback";
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
  };
}

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
      items: state.items,
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
    const res = withCookie(json({ ok: true, url: authUrl(deps.client, nonce) }), signed);
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

  return withCookie(json({ error: "bad-request" }, 400), signed);
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
    const refresh = await exchangeCode(deps.fetcher, deps.client, code);
    await deps.store.saveToken({ refresh, connectedAt: deps.now });
    // Start the history afresh on the next tick, from the new connection.
    for (let i = 0; i < 2; i++) {
      const { state, version } = await deps.store.load();
      if (await deps.store.save({ ...state, historyId: null, gmail: "connected", lastError: null }, version)) break;
    }
    return back("connected");
  } catch {
    return back("failed");
  }
}
