/**
 * The crew's own GitHub identity (#138, R2 in docs/THREAT-MODEL.md): every Vercel function that talks to GitHub gets
 * its token here. When the Foundry's GitHub App is set up, the token is a GitHub App installation token: it acts as
 * `ceo-foundry[bot]` rather than as Nikita, reaches only nikitapage10/C.E.O., carries only the permissions the call
 * needs, and expires within the hour. Until then it is `FOUNDRY_GITHUB_TOKEN`, exactly as before.
 *
 * How a token is made (GitHub's "Authenticating as a GitHub App installation"):
 *   1. a JSON Web Token signed with the App's private key (RS256, node:crypto; no dependency), good for 9 minutes;
 *   2. with it, the App's installation on this repo (looked up once, or `FOUNDRY_APP_INSTALLATION_ID`);
 *   3. POST /app/installations/{id}/access_tokens, for this repo only, with a narrow set of permissions;
 *   4. the token is kept while the function stays warm, until 5 minutes before GitHub says it expires.
 * A failed mint is retried at most once a minute; meanwhile the fallback token (or no token) is used, so a broken App
 * setup degrades to how things were, never to a dead Desk.
 *
 * Environment (Vercel → Settings → Environment Variables, Production only; docs/SECURITY.md has the setup):
 *   FOUNDRY_APP_ID               the App's ID (a number, at the top of the App's settings page)
 *   FOUNDRY_APP_PRIVATE_KEY      the App's private key: the .pem file's contents, as is, with "\n" escapes, or base64
 *   FOUNDRY_APP_INSTALLATION_ID  optional: skips the one lookup of the installation
 *   FOUNDRY_GITHUB_TOKEN         the fallback while the App isn't set up: a fine-grained token that acts as Nikita
 *
 * Nothing here logs, returns or throws a key or a token. Errors carry only an HTTP status.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

const OWNER = "nikitapage10";
const REPO_NAME = "C.E.O.";
const API = "https://api.github.com";

/** The account the App acts as. It must match the App's name, `ceo-foundry` (docs/SECURITY.md, "The crew's own identity"). */
export const FOUNDRY_BOT = "ceo-foundry[bot]";

/**
 * What a call needs, and so what its token may do:
 *   read    the feeds and the world step: issues, pull requests, commits, workflow runs, alert counts. Read only.
 *   issues  the Desk's buttons: open issues, comment, change labels. Nothing else.
 */
export type GithubAccess = "read" | "issues";

export const PERMISSIONS: Record<GithubAccess, Record<string, "read" | "write">> = {
  read: {
    metadata: "read",
    contents: "read",
    issues: "read",
    pull_requests: "read",
    actions: "read",
    checks: "read",
    security_events: "read",
    vulnerability_alerts: "read",
  },
  issues: { metadata: "read", issues: "write" },
};

/** Refresh a cached token this long before GitHub's expiry, so no call goes out with one about to lapse. */
export const REFRESH_EARLY_MS = 5 * 60_000;
/** After a failed mint, wait this long before trying again (the fallback is used meanwhile). */
export const RETRY_AFTER_MS = 60_000;

type Env = Record<string, string | undefined>;

export interface TokenDeps {
  env?: Env;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Which identity the functions use right now: the App, the fallback token, or none (anonymous reads only). */
export function githubIdentity(env: Env = process.env): "app" | "token" | "none" {
  if (appConfigured(env)) return "app";
  return env.FOUNDRY_GITHUB_TOKEN ? "token" : "none";
}

/** Whether there is any way to write to GitHub (the Desk's buttons say "not set up" without one). */
export const canWriteGithub = (env: Env = process.env): boolean => githubIdentity(env) !== "none";

const appConfigured = (env: Env): boolean => Boolean(env.FOUNDRY_APP_ID?.trim() && env.FOUNDRY_APP_PRIVATE_KEY?.trim());

/** The App's private key from the environment: a PEM as is, with literal "\n" escapes (one-line .env pastes), or base64. */
export function readPrivateKey(raw: string): KeyObject {
  let pem = raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) pem = Buffer.from(pem, "base64").toString("utf8");
  return createPrivateKey(pem);
}

const b64url = (data: string | Buffer): string => Buffer.from(data).toString("base64url");

/**
 * The App's JSON Web Token (RS256). Issued 60 seconds in the past against clock drift, expiring 9 minutes on (GitHub
 * allows at most 10). `iss` is the App's ID.
 */
export function appJwt(appId: string, key: KeyObject, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${b64url(signature)}`;
}

class MintError extends Error {
  constructor(readonly status: number) {
    super(`GitHub App token: ${status}`);
  }
}

const headers = (bearer: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${bearer}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "ceo-foundry",
});

interface Cached {
  token: string;
  expiresAt: number;
}

/** Warm-function state: tokens by access, the installation, the last failure and any mint in flight. */
const state = {
  tokens: new Map<GithubAccess, Cached>(),
  inFlight: new Map<GithubAccess, Promise<string>>(),
  installation: null as string | null,
  failedAt: null as number | null,
  /** Which App the cache belongs to: a new ID or key in the environment starts afresh. */
  owner: "",
};

/** Forget every cached token and failure (tests, and a changed App in the environment). */
export function resetGithubTokens(): void {
  state.tokens.clear();
  state.inFlight.clear();
  state.installation = null;
  state.failedAt = null;
  state.owner = "";
}

async function mint(access: GithubAccess, env: Env, doFetch: typeof fetch, nowMs: number): Promise<Cached> {
  const appId = env.FOUNDRY_APP_ID!.trim();
  const jwt = appJwt(appId, readPrivateKey(env.FOUNDRY_APP_PRIVATE_KEY!), nowMs);
  let installation = env.FOUNDRY_APP_INSTALLATION_ID?.trim() || state.installation;
  if (!installation) {
    const res = await doFetch(`${API}/repos/${OWNER}/${encodeURIComponent(REPO_NAME)}/installation`, { headers: headers(jwt) });
    if (!res.ok) throw new MintError(res.status);
    const id = ((await res.json()) as { id?: unknown }).id;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) throw new MintError(502);
    installation = String(id);
    state.installation = installation;
  }
  if (!/^\d+$/.test(installation)) throw new MintError(400);
  const res = await doFetch(`${API}/app/installations/${installation}/access_tokens`, {
    method: "POST",
    headers: headers(jwt),
    body: JSON.stringify({ repositories: [REPO_NAME], permissions: PERMISSIONS[access] }),
  });
  if (!res.ok) {
    // The App was reinstalled (a new installation ID): look it up again next time.
    if (res.status === 404) state.installation = null;
    throw new MintError(res.status);
  }
  const got =(await res.json()) as { token?: unknown; expires_at?: unknown };
  const expiresAt = typeof got.expires_at === "string" ? Date.parse(got.expires_at) : NaN;
  if (typeof got.token !== "string" || !got.token || !Number.isFinite(expiresAt)) throw new MintError(502);
  return { token: got.token, expiresAt };
}

/**
 * A token for GitHub's API with the given access: the App's installation token when the App is set up and GitHub
 * gives one, else `FOUNDRY_GITHUB_TOKEN`, else "" (anonymous reads; writes will be refused).
 */
export async function githubToken(access: GithubAccess, deps: TokenDeps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  const fallback = env.FOUNDRY_GITHUB_TOKEN ?? "";
  if (!appConfigured(env)) return fallback;
  const now = (deps.now ?? Date.now)();
  const owner = `${env.FOUNDRY_APP_ID}:${env.FOUNDRY_APP_PRIVATE_KEY?.length}:${env.FOUNDRY_APP_INSTALLATION_ID ?? ""}`;
  if (state.owner !== owner) {
    resetGithubTokens();
    state.owner = owner;
  }
  const cached = state.tokens.get(access);
  if (cached && cached.expiresAt - REFRESH_EARLY_MS > now) return cached.token;
  if (state.failedAt !== null && now - state.failedAt < RETRY_AFTER_MS) return fallback;
  let pending = state.inFlight.get(access);
  if (!pending) {
    pending = mint(access, env, deps.fetch ?? fetch, now)
      .then((got) => {
        state.tokens.set(access, got);
        state.failedAt = null;
        return got.token;
      })
      .finally(() => state.inFlight.delete(access));
    state.inFlight.set(access, pending);
  }
  try {
    return await pending;
  } catch (e) {
    state.failedAt = now;
    // A status only: never the key, the JWT or a token.
    const status = e instanceof MintError ? e.status : "error";
    console.warn(`GitHub App token unavailable (${status}); using ${fallback ? "FOUNDRY_GITHUB_TOKEN" : "no token"} for now.`);
    return fallback;
  }
}
