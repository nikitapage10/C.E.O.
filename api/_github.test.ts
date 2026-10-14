/**
 * The crew's own GitHub identity (#138): minting App installation tokens, with GitHub mocked. The keys are throwaway
 * ones made for the run; no real key, token or environment value is read or printed.
 */

import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOUNDRY_BOT, PERMISSIONS, REFRESH_EARLY_MS, RETRY_AFTER_MS, appJwt, canWriteGithub, githubIdentity, githubToken, readPrivateKey, resetGithubTokens } from "./_github.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);
const HOUR = 60 * 60_000;

const APP = { FOUNDRY_APP_ID: "123456", FOUNDRY_APP_PRIVATE_KEY: PKCS1 };

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A JWT's three parts. */
function parts(jwt: string): [string, string, string] {
  const [head = "", body = "", sig = ""] = jwt.split(".");
  return [head, body, sig];
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** A GitHub that knows one installation and hands out numbered tokens that last an hour from `now`. */
function github(now: () => number, over: { installation?: number; mint?: number } = {}) {
  let n = 0;
  return vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    if (u === "https://api.github.com/repos/nikitapage10/C.E.O./installation") return over.installation ? json({ message: "no" }, over.installation) : json({ id: 42 });
    if (u === "https://api.github.com/app/installations/42/access_tokens" && init.method === "POST") {
      if (over.mint) return json({ message: "no" }, over.mint);
      n += 1;
      return json({ token: `minted-${n}`, expires_at: new Date(now() + HOUR).toISOString() }, 201);
    }
    return json({ message: "unexpected" }, 500);
  });
}

beforeEach(() => resetGithubTokens());
afterEach(() => vi.restoreAllMocks());

describe("the App's JSON Web Token", () => {
  it("is RS256, signed by the App's key, with iss the App's ID, issued a minute back and good for under ten minutes", () => {
    const jwt = appJwt("123456", readPrivateKey(PKCS1), T0);
    const [head, body, sig] = parts(jwt);
    expect(decode(head)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decode(body);
    expect(claims).toEqual({ iat: T0 / 1000 - 60, exp: T0 / 1000 + 540, iss: "123456" });
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(600);
    expect(verify("RSA-SHA256", Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("reads the key as a PEM (PKCS#1 or PKCS#8), with \\n escapes from a one-line paste, or as base64", () => {
    const forms = [PKCS1, PKCS8, PKCS1.replace(/\n/g, "\\n"), `"${PKCS1.replace(/\n/g, "\\n")}"`, Buffer.from(PKCS1).toString("base64")];
    for (const form of forms) {
      const [head, body, sig] = parts(appJwt("1", readPrivateKey(form), T0));
      expect(verify("RSA-SHA256", Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    }
  });
});

describe("githubToken", () => {
  it("without the App, falls back to FOUNDRY_GITHUB_TOKEN exactly as before, and calls nobody", async () => {
    const fetch = vi.fn();
    expect(await githubToken("issues", { env: { FOUNDRY_GITHUB_TOKEN: "fallback" }, fetch })).toBe("fallback");
    expect(await githubToken("read", { env: {}, fetch })).toBe("");
    expect(await githubToken("read", { env: { FOUNDRY_APP_ID: "123456", FOUNDRY_GITHUB_TOKEN: "fallback" }, fetch })).toBe("fallback");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mints an installation token for this repo only, with only the permissions the call needs", async () => {
    const now = T0;
    const fetch = github(() => now);
    expect(await githubToken("issues", { env: APP, fetch, now: () => now })).toBe("minted-1");
    expect(fetch).toHaveBeenCalledTimes(2);
    const [lookupUrl, lookup] = fetch.mock.calls[0] as [string, RequestInit];
    expect(lookupUrl).toBe("https://api.github.com/repos/nikitapage10/C.E.O./installation");
    const jwt = String((lookup.headers as Record<string, string>).Authorization).replace(/^Bearer /, "");
    expect(decode(parts(jwt)[1]).iss).toBe("123456");
    const [, mint] = fetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(mint.body))).toEqual({ repositories: ["C.E.O."], permissions: { metadata: "read", issues: "write" } });

    // The read token is its own, read only, and the installation isn't looked up again.
    expect(await githubToken("read", { env: APP, fetch, now: () => now })).toBe("minted-2");
    expect(fetch).toHaveBeenCalledTimes(3);
    const readBody = JSON.parse(String((fetch.mock.calls[2] as [string, RequestInit])[1].body)) as { permissions: Record<string, string> };
    expect(Object.values(readBody.permissions).every((p) => p === "read")).toBe(true);
    expect(readBody.permissions).toEqual(PERMISSIONS.read);
  });

  it("never asks for Administration, Workflows or write access to code", () => {
    for (const perms of Object.values(PERMISSIONS)) {
      expect(perms).not.toHaveProperty("administration");
      expect(perms).not.toHaveProperty("workflows");
      expect(perms.contents ?? "read").toBe("read");
    }
  });

  it("keeps the token until five minutes before it expires, then mints a fresh one", async () => {
    let now = T0;
    const fetch = github(() => now);
    const deps = { env: APP, fetch, now: () => now };
    expect(await githubToken("issues", deps)).toBe("minted-1");
    now = T0 + HOUR - REFRESH_EARLY_MS - 1000;
    expect(await githubToken("issues", deps)).toBe("minted-1");
    expect(fetch).toHaveBeenCalledTimes(2);
    now = T0 + HOUR - REFRESH_EARLY_MS + 1000;
    expect(await githubToken("issues", deps)).toBe("minted-2");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shares one mint between calls that arrive together", async () => {
    const fetch = github(() => T0);
    const deps = { env: APP, fetch, now: () => T0 };
    const got = await Promise.all([githubToken("read", deps), githubToken("read", deps), githubToken("read", deps)]);
    expect(got).toEqual(["minted-1", "minted-1", "minted-1"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses a given installation ID without looking it up", async () => {
    const fetch = github(() => T0);
    expect(await githubToken("issues", { env: { ...APP, FOUNDRY_APP_INSTALLATION_ID: "42" }, fetch, now: () => T0 })).toBe("minted-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back when GitHub refuses, says only the status, and tries again after a minute", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let now = T0;
    const refusing = github(() => now, { mint: 422 });
    const env = { ...APP, FOUNDRY_GITHUB_TOKEN: "fallback" };
    expect(await githubToken("read", { env, fetch: refusing, now: () => now })).toBe("fallback");
    expect(warn).toHaveBeenCalledTimes(1);
    const said = String(warn.mock.calls[0]?.[0]);
    expect(said).toContain("422");
    for (const secret of ["fallback", "BEGIN", APP.FOUNDRY_APP_ID]) expect(said).not.toContain(secret);

    // Within the minute: no new attempt.
    const calls = refusing.mock.calls.length;
    now = T0 + RETRY_AFTER_MS - 1;
    expect(await githubToken("read", { env, fetch: refusing, now: () => now })).toBe("fallback");
    expect(refusing.mock.calls.length).toBe(calls);

    // After it, GitHub answers again and the App's token takes over.
    now = T0 + RETRY_AFTER_MS + 1;
    const working = github(() => now);
    expect(await githubToken("read", { env, fetch: working, now: () => now })).toBe("minted-1");
  });

  it("falls back when the App isn't installed on the repo, and when the network is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await githubToken("issues", { env: { ...APP, FOUNDRY_GITHUB_TOKEN: "fallback" }, fetch: github(() => T0, { installation: 404 }), now: () => T0 })).toBe("fallback");
    resetGithubTokens();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await githubToken("issues", { env: APP, fetch: down, now: () => T0 })).toBe("");
  });

  it("falls back on a key that isn't a key, without echoing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn();
    expect(await githubToken("issues", { env: { FOUNDRY_APP_ID: "1", FOUNDRY_APP_PRIVATE_KEY: "not-a-key-at-all", FOUNDRY_GITHUB_TOKEN: "fallback" }, fetch, now: () => T0 })).toBe("fallback");
    expect(fetch).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("not-a-key-at-all");
  });

  it("starts afresh when the App in the environment changes", async () => {
    const fetch = github(() => T0);
    expect(await githubToken("issues", { env: APP, fetch, now: () => T0 })).toBe("minted-1");
    expect(await githubToken("issues", { env: { ...APP, FOUNDRY_APP_ID: "654321" }, fetch, now: () => T0 })).toBe("minted-2");
  });
});

describe("which identity", () => {
  it("is the App once both its values are set, else the fallback token, else none", () => {
    expect(githubIdentity(APP)).toBe("app");
    expect(githubIdentity({ FOUNDRY_APP_ID: "1", FOUNDRY_GITHUB_TOKEN: "x" })).toBe("token");
    expect(githubIdentity({})).toBe("none");
    expect(canWriteGithub(APP)).toBe(true);
    expect(canWriteGithub({})).toBe(false);
  });

  it("acts as the bot account the trusted-author lists name", () => {
    expect(FOUNDRY_BOT).toBe("ceo-foundry[bot]");
  });
});
