/**
 * The Key Vault, reached with the Function App's managed identity over Key Vault's REST API (no extra SDK: a token
 * from DefaultAzureCredential, as the blob store uses, and plain fetch). Two faces:
 *
 *   keyWriter  what the Desk's Keys form gets (#330, api/_keys/vault.ts): set a secret, and the vault's list of names
 *              with their dates. It has no way to read a value, list values or delete.
 *   readSecret what the key refresh uses (./keys.ts) to load an allowlisted key's new value into this instance, the
 *              way the platform's Key Vault references do at start-up. Never reachable from a route.
 *
 * Settings: KEY_VAULT_URI (the template sets it to the vault's own address). Writing needs Key Vault Secrets Officer
 * on the vault; the list and the reads need only Secrets User, which the template already gives (docs/AZURE.md).
 */

import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import type { KeyWriter, SecretDates } from "../../api/_keys/vault.js";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const API = "api-version=7.4";
const SCOPE = "https://vault.azure.net/.default";
/** A vault's own address and nothing else: https, one *.vault.azure.net host, no path. */
const VAULT_URI = /^https:\/\/[a-z0-9-]{3,24}\.vault\.azure\.net\/?$/i;
/** A secret name Key Vault accepts. The route only ever passes allowlisted ones. */
const NAME = /^[a-z0-9-]{1,127}$/i;

export interface Vault {
  base: string;
  credential: TokenCredential;
  fetch: Fetch;
}

/** The vault named by KEY_VAULT_URI, or null when it is missing or isn't a vault address. */
export function vaultFromEnv(env: Env, credential: TokenCredential = new DefaultAzureCredential(), f: Fetch = fetch): Vault | null {
  const uri = env.KEY_VAULT_URI?.trim() ?? "";
  if (!VAULT_URI.test(uri)) return null;
  return { base: uri.replace(/\/$/, ""), credential, fetch: f };
}

async function call(v: Vault, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await v.credential.getToken(SCOPE);
  if (!token) throw new Error("no Key Vault token");
  return v.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(8_000) });
}

const secs = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n * 1000 : null);

/** Every secret's name with its dates, following the vault's pages (only ever on the vault's own host). */
export async function secretDates(v: Vault): Promise<Map<string, SecretDates>> {
  const out = new Map<string, SecretDates>();
  let url: string | null = `${v.base}/secrets?${API}&maxresults=25`;
  for (let page = 0; url && page < 20; page++) {
    const res = await call(v, url);
    if (!res.ok) throw new Error(`Key Vault list answered ${res.status}`);
    const got = (await res.json()) as { value?: { id?: string; attributes?: { enabled?: boolean; updated?: number } }[]; nextLink?: string | null };
    for (const s of got.value ?? []) {
      const name = s.id?.split("/secrets/")[1]?.split("/")[0];
      if (name) out.set(name, { enabled: s.attributes?.enabled !== false, updated: secs(s.attributes?.updated) });
    }
    const next: string | null = got.nextLink ?? null;
    url = next && new URL(next).origin === new URL(v.base).origin ? next : null;
  }
  return out;
}

/** Writes a new version. The vault's answer repeats the value; only its date is kept, and the rest is dropped here. */
export async function setSecret(v: Vault, name: string, value: string): Promise<{ updated: number | null }> {
  if (!NAME.test(name)) throw new Error("not a secret name");
  const res = await call(v, `${v.base}/secrets/${name}?${API}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
  if (!res.ok) throw new Error(`Key Vault set answered ${res.status}`);
  const got = (await res.json().catch(() => ({}))) as { attributes?: { updated?: number } };
  return { updated: secs(got.attributes?.updated) };
}

/** One secret's current value, or null when it is missing or disabled. Only the key refresh calls this. */
export async function readSecret(v: Vault, name: string): Promise<string | null> {
  if (!NAME.test(name)) throw new Error("not a secret name");
  const res = await call(v, `${v.base}/secrets/${name}?${API}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Key Vault read answered ${res.status}`);
  const got = (await res.json()) as { value?: unknown; attributes?: { enabled?: boolean } };
  return got.attributes?.enabled === false || typeof got.value !== "string" ? null : got.value;
}

/** The Keys form's face of the vault: set and dates, nothing more. */
export function keyWriter(v: Vault, onSet?: (name: string, value: string, updated: number | null) => void): KeyWriter {
  return {
    dates: () => secretDates(v),
    async set(name, value) {
      const done = await setSecret(v, name, value);
      onSet?.(name, value, done.updated);
      return done;
    },
  };
}
