/**
 * Whether the site is locked, and with what (#236, docs/SECURITY.md, "The site password").
 *
 * The record lives in the private blob store beside the Desk's passkeys, at `desk/site/password.json`:
 *
 *   { v: 1, hash?: "pbkdf2-sha256$600000$…", sv: "<session version>", set?: "<ISO time>", second?: "passkey" }
 *
 *   hash    the password's salted hash (api/_site/password.ts), never the password
 *   sv      the session version: every site cookie carries it, and a new one (a new password, or "Sign out
 *           everywhere") ends every cookie made before
 *   second  the hook for a second factor later (2FA): when "passkey", a site session also needs a Desk passkey
 *           sign-in. Nothing sets it yet, and nothing in the Desk can; see docs/SECURITY.md
 *
 * SITE_PASSWORD_HASH (optional, same string format) is used when the record has no hash, so the gate can be turned
 * on from Vercel's settings too. SITE_GATE=off turns the gate off whatever is stored: the break-glass switch.
 *
 * With neither a stored hash nor the variable, the gate is OFF: nothing is locked until Nikita sets a password.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { pickBlob, type BlobBackend } from "../_blob.js";
import { deskKeyFor } from "../_desk/keys.js";
import { parseHash } from "./password.js";

type Env = Record<string, string | undefined>;

export const RECORD_PATH = "desk/site/password.json";

export interface SiteRecord {
  v: 1;
  hash?: string;
  sv: string;
  set?: string;
  second?: "passkey";
}

/** What the gate acts on. */
export interface SiteState {
  on: boolean;
  /** Where the password came from: the Desk (blob), Vercel's settings (env), nowhere (none), or switched off (off). */
  source: "blob" | "env" | "none" | "off";
  hash: string | null;
  /** The current session version; a cookie with any other is signed out. */
  sv: string;
  /** The 2FA hook: the factors a site session must carry. Today only ["password"]. */
  factors: Array<"password" | "passkey">;
}

export const newVersion = () => randomBytes(12).toString("base64url");

/** A stored record, checked, or null for anything else. */
export function readRecord(value: unknown): SiteRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.sv !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(r.sv)) return null;
  return {
    v: 1,
    sv: r.sv,
    ...(typeof r.hash === "string" && parseHash(r.hash) && { hash: r.hash }),
    ...(typeof r.set === "string" && { set: r.set.slice(0, 40) }),
    ...(r.second === "passkey" && { second: "passkey" as const }),
  };
}

/** The gate's state from the stored record and the environment. */
export function stateOf(record: SiteRecord | null, env: Env): SiteState {
  const off = (source: SiteState["source"]): SiteState => ({ on: false, source, hash: null, sv: record?.sv ?? "", factors: ["password"] });
  if ((env.SITE_GATE ?? "").trim().toLowerCase() === "off") return off("off");
  const factors: SiteState["factors"] = record?.second === "passkey" ? ["password", "passkey"] : ["password"];
  if (record?.hash) return { on: true, source: "blob", hash: record.hash, sv: record.sv, factors };
  const envHash = env.SITE_PASSWORD_HASH?.trim();
  if (envHash && parseHash(envHash)) {
    // With only the variable, the version is the variable's own fingerprint until "Sign out everywhere" stores one.
    const sv = record?.sv ?? createHash("sha256").update(envHash).digest("base64url").slice(0, 16);
    return { on: true, source: "env", hash: envHash, sv, factors };
  }
  return off("none");
}

/* ── The store ── */

export interface SiteStore {
  read(): Promise<SiteRecord | null>;
  write(record: SiteRecord | null): Promise<void>;
}

export class BlobSiteStore implements SiteStore {
  constructor(private readonly blob: BlobBackend) {}
  async read(): Promise<SiteRecord | null> {
    // Straight from storage, never a cached copy: a new version must end old sessions as soon as it is read.
    const found = await this.blob.get(RECORD_PATH);
    if (!found) return null;
    return readRecord(await new Response(found.stream).json().catch(() => null));
  }
  async write(record: SiteRecord | null): Promise<void> {
    if (!record) {
      await this.blob.del(RECORD_PATH);
      return;
    }
    await this.blob.put(RECORD_PATH, JSON.stringify(record), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  }
}

export class MemorySiteStore implements SiteStore {
  record: SiteRecord | null = null;
  fail = false;
  reads = 0;
  async read(): Promise<SiteRecord | null> {
    this.reads++;
    if (this.fail) throw new Error("store down");
    return this.record ? structuredClone(this.record) : null;
  }
  async write(record: SiteRecord | null): Promise<void> {
    this.record = record ? structuredClone(record) : null;
  }
}

/** The private blob store's site record, or null when no store is connected (then only SITE_PASSWORD_HASH counts). */
export function pickSiteStore(env: Env = process.env): SiteStore | null {
  const blob = pickBlob(env);
  return blob ? new BlobSiteStore(blob) : null;
}

/* ── The state as the gate reads it, cached per instance ── */

/** How long one instance trusts what it last read (ms): a change reaches every instance within this. */
export const STATE_TTL_MS = 20_000;

/** The least time between two forced re-reads (ms). */
export const REFRESH_MS = 2_000;

let cached: { at: number; record: SiteRecord | null } | null = null;

export function forgetCachedState(): void {
  cached = null;
}

/**
 * The gate's state for a request. Read at most every STATE_TTL_MS per instance. When the store can't be read, the
 * last good read is used however old; with no good read at all, the gate fails closed (`unknown: true`) unless the
 * environment alone decides (SITE_GATE=off, or no store connected).
 */
export async function currentState(env: Env, store: SiteStore | null, now: number, opts: { fresh?: boolean } = {}): Promise<SiteState & { unknown?: boolean }> {
  if (!store) return stateOf(null, env);
  // `fresh`: a signed cookie from another version may be newer than this instance's copy; re-read, at most every 2 s.
  const ttl = opts.fresh ? REFRESH_MS : STATE_TTL_MS;
  if (cached && now - cached.at < ttl) return stateOf(cached.record, env);
  try {
    const record = await store.read();
    cached = { at: now, record };
    return stateOf(record, env);
  } catch {
    if (cached) return stateOf(cached.record, env);
    const fromEnv = stateOf(null, env);
    if (fromEnv.source === "off") return fromEnv;
    return { ...fromEnv, on: true, unknown: true };
  }
}

/** Remember a record just written, so this instance acts on it at once. */
export function rememberState(record: SiteRecord | null, now: number): void {
  cached = { at: now, record };
}

/* ── Keys ── */

export interface SiteKeys {
  /** Signs the site session cookies. */
  session: Buffer;
  /** Hashes addresses for the sign-in rate limits. */
  client: Buffer;
}

const keyCache = new Map<string, Promise<SiteKeys>>();

/**
 * The site's signing keys: from SITE_SESSION_SECRET when it is set (at least 32 characters), else derived from the
 * Desk key (FOUNDRY_DESK_KEY, stretched with scrypt in api/_desk/keys.ts, purpose "site"). Null when neither is set:
 * then no one can sign in, and the login page says it isn't set up.
 */
export function siteKeys(env: Env): Promise<SiteKeys> | null {
  const secret = env.SITE_SESSION_SECRET?.trim();
  const desk = env.FOUNDRY_DESK_KEY?.trim();
  const id = secret && secret.length >= 32 ? `s:${createHash("sha256").update(secret).digest("hex")}` : desk ? `d:${createHash("sha256").update(desk).digest("hex")}` : "";
  if (!id) return null;
  let found = keyCache.get(id);
  if (!found) {
    found = (async () => {
      const root = id.startsWith("s:") ? createHmac("sha256", secret!).update("ceo.site.root").digest() : await deskKeyFor(desk!, "site");
      return {
        session: createHmac("sha256", root).update("ceo.site.session").digest(),
        client: createHmac("sha256", root).update("ceo.site.client").digest(),
      };
    })();
    found.catch(() => keyCache.delete(id));
    if (keyCache.size > 3) keyCache.clear();
    keyCache.set(id, found);
  }
  return found;
}
