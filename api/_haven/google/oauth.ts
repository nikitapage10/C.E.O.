/**
 * The Haven's Google sign-in (#637, docs/HOME-DEVICES.md): one OAuth client (HAVEN_GOOGLE_CLIENT_ID and
 * HAVEN_GOOGLE_CLIENT_SECRET, Key Vault secrets) and two separate grants, each sealed on its own in the private store
 * (api/_haven/devices/vault.ts) under HOME_TOKEN_KEY:
 *
 *   nest    `sdm.service`, through Google's Partner Connections Manager for the Device Access project
 *           (HAVEN_NEST_PROJECT_ID), where Nikita picks which Nest devices to share
 *   tasks   `tasks`, through Google's usual consent page: read the chosen list and mark imported items completed
 *
 * Two grants, not one, so Tasks works without the Device Access project and either can be disconnected alone. Each
 * grant must hold exactly its own scope: a wider one is refused (and its access simply expires). The same pattern as
 * Connect Gmail (api/_email/gmail.ts, api/_email/route.ts): the code is traded server-side, the refresh token never
 * reaches the browser, and nothing here logs a code or a token.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { AZURE_HOST, isSiteHost } from "../../_site/hosts.js";
import type { Fetch } from "../devices/http.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const PCM_URL = "https://nestservices.google.com/partnerconnections";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const SDM_SCOPE = "https://www.googleapis.com/auth/sdm.service";
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export type Grant = "nest" | "tasks";
export const GRANTS: readonly Grant[] = ["nest", "tasks"];
export const isGrant = (v: unknown): v is Grant => v === "nest" || v === "tasks";
export const SCOPE: Record<Grant, string> = { nest: SDM_SCOPE, tasks: TASKS_SCOPE };

export const CALLBACK_PATH = "/api/haven/google-callback";
export const DEFAULT_REDIRECT = `https://${AZURE_HOST}${CALLBACK_PATH}`;

const TIMEOUT_MS = 10_000;

export interface HavenClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Env = Record<string, string | undefined>;

/** The OAuth client from the settings, or null until both are set. */
export function havenClientFrom(env: Env): HavenClient | null {
  const clientId = (env.HAVEN_GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.HAVEN_GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: DEFAULT_REDIRECT };
}

/** The Device Access project id (a UUID), or null. */
export function nestProjectFrom(env: Env): string | null {
  const id = (env.HAVEN_NEST_PROJECT_ID ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** The callback on the host the connect started on (the state cookie is per host), when it is one of the site's. */
export function redirectFor(client: HavenClient, request: Request): HavenClient {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.port || !isSiteHost(url.hostname)) return client;
  return { ...client, redirectUri: `https://${url.hostname.toLowerCase()}${CALLBACK_PATH}` };
}

/** Where a connect sends the browser: the Partner Connections Manager for Nest, Google's consent page for Tasks. */
export function authUrl(grant: Grant, client: Pick<HavenClient, "clientId" | "redirectUri">, state: string, nestProject: string | null): string | null {
  const q = new URLSearchParams({
    redirect_uri: client.redirectUri,
    access_type: "offline",
    // Always consent, so Google always hands back a refresh token.
    prompt: "consent",
    client_id: client.clientId,
    response_type: "code",
    scope: SCOPE[grant],
    state,
  });
  if (grant === "nest") return nestProject ? `${PCM_URL}/${nestProject}/auth?${q.toString()}` : null;
  q.set("include_granted_scopes", "false");
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

async function postForm(fetchFn: Fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = text.length < 200_000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body: body && typeof body === "object" ? (body as Record<string, unknown>) : {} };
}

/** Google refused the refresh token: revoked, expired, or a Testing app's week ran out. Reconnect. */
export class GrantRefusedError extends Error {
  constructor() {
    super("google grant refused");
    this.name = "GrantRefusedError";
  }
}

/** Trades the callback's code for a refresh token. Only a grant of exactly this grant's scope is kept. */
export async function exchangeCode(fetchFn: Fetch, grant: Grant, client: HavenClient, code: string): Promise<string> {
  const { status, body } = await postForm(fetchFn, TOKEN_URL, { code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri, grant_type: "authorization_code" });
  if (status !== 200 || typeof body.refresh_token !== "string" || !body.refresh_token) throw new Error(`google code exchange ${status}`);
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];
  if (scopes.length !== 1 || scopes[0] !== SCOPE[grant]) throw new Error("google scope not allowed");
  return body.refresh_token;
}

/** Access tokens kept in this instance, by grant (a refresh token's last few characters guard a reconnect). */
const kept = new Map<string, { token: string; until: number }>();

/** Refreshes under way, by the same slot: calls at once share one trade with Google instead of racing their own. */
const inflight = new Map<string, Promise<string>>();

/** A short-lived access token for a grant, cached until a minute before it ends. */
export async function accessToken(fetchFn: Fetch, client: Pick<HavenClient, "clientId" | "clientSecret">, grant: Grant, refresh: string, now: number): Promise<string> {
  const slot = `${grant}:${refresh.slice(-12)}`;
  const hit = kept.get(slot);
  if (hit && hit.until > now) return hit.token;
  const going = inflight.get(slot);
  if (going) return going;
  const trade = refreshToken(fetchFn, client, slot, refresh, now).finally(() => inflight.delete(slot));
  inflight.set(slot, trade);
  return trade;
}

/** One trade of the refresh token for an access token. Only Google's own invalid_grant (or a client it no longer
 * knows) is a refusal; anything else (a 5xx, a timeout, a 429) is a hiccup and the grant stands. */
async function refreshToken(fetchFn: Fetch, client: Pick<HavenClient, "clientId" | "clientSecret">, slot: string, refresh: string, now: number): Promise<string> {
  const { status, body } = await postForm(fetchFn, TOKEN_URL, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refresh, grant_type: "refresh_token" });
  if ((status === 400 || status === 401) && (body.error === "invalid_grant" || body.error === "unauthorized_client")) {
    kept.delete(slot);
    throw new GrantRefusedError();
  }
  if (status !== 200 || typeof body.access_token !== "string") throw new Error(`google token ${status}`);
  const life = typeof body.expires_in === "number" && body.expires_in > 120 ? body.expires_in : 600;
  kept.set(slot, { token: body.access_token, until: now + (life - 60) * 1000 });
  return body.access_token;
}

/** Forgets every cached access token (tests, and a disconnect). */
export function forgetTokens(): void {
  kept.clear();
  inflight.clear();
}

/** Asks Google to forget a grant (Disconnect). Best effort. */
export async function revoke(fetchFn: Fetch, refresh: string): Promise<void> {
  await postForm(fetchFn, REVOKE_URL, { token: refresh }).catch(() => undefined);
}

/** A grant as sealed in the store. */
export interface StoredGrant {
  refresh: string;
  connectedAt: number;
  /** Google refused the refresh token: the Desk says to reconnect. */
  refused?: boolean;
}
