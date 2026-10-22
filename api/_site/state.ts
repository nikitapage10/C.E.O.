/**
 * Whether the site is locked (#236, #238; docs/SECURITY.md, "The site lock"). The Desk passkey is the only way in.
 *
 * The record lives in the private blob store beside the Desk's passkeys, at `desk/site/password.json` (the name is
 * kept from #236, so a lock set then still reads):
 *
 *   { v: 1, passkey: true, locked?: "<ISO time>", sv: "<session version>", second?: "approval" }
 *
 *   passkey the site is locked, with the Desk passkey as the way in ("Lock the site" on the Desk)
 *   locked  when it was locked
 *   sv      the session version: every site cookie carries it, and a new one ("Sign out everywhere", locking again)
 *           ends every cookie made before
 *   second  the hook for a second step later (2FA, not built): when "approval", a site session also needs the
 *           "approval" factor, e.g. a new device approved from a signed-in one, or an emailed link. Nothing sets it
 *           and no sign-in makes such a session yet, so setting it by hand would lock every device out
 *
 * A record from #236 (a password's `hash`, no `passkey`) reads as locked with the passkey; its hash is ignored and
 * dropped at the next write. There is no password any more (Nikita, 2026-10-22).
 *
 * SITE_GATE=off turns the gate off whatever is stored: the break-glass switch. With no lock stored, the gate is OFF.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { pickBlob, type BlobBackend } from "../_blob.js";
import { deskKeyFor } from "../_desk/keys.js";

type Env = Record<string, string | undefined>;

export const RECORD_PATH = "desk/site/password.json";

/** How a site session was opened: the Desk passkey; "approval" is the 2FA hook (not built). */
export type Factor = "passkey" | "approval";

export interface SiteRecord {
  v: 1;
  passkey?: true;
  locked?: string;
  sv: string;
  second?: "approval";
}

/** What the gate acts on. */
export interface SiteState {
  on: boolean;
  /** Where the lock came from: the Desk (blob), nowhere (none), or switched off by SITE_GATE=off (off). */
  source: "blob" | "none" | "off";
  /** The current session version; a cookie with any other is signed out. */
  sv: string;
  /** Every factor a site session must carry: ["passkey"], plus "approval" once the 2FA hook is used. */
  factors: Factor[];
}

export const newVersion = () => randomBytes(12).toString("base64url");

/** A stored record, checked, or null for anything else. A #236 password record reads as a passkey lock. */
export function readRecord(value: unknown): SiteRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.sv !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(r.sv)) return null;
  const legacy = typeof r.hash === "string" && r.hash.length > 0;
  const locked = typeof r.locked === "string" ? r.locked : legacy && typeof r.set === "string" ? r.set : undefined;
  return {
    v: 1,
    sv: r.sv,
    ...((r.passkey === true || legacy) && { passkey: true as const }),
    ...(locked && { locked: locked.slice(0, 40) }),
    ...(r.second === "approval" && { second: "approval" as const }),
  };
}

/** The gate's state from the stored record and the environment. */
export function stateOf(record: SiteRecord | null, env: Env): SiteState {
  const factors: Factor[] = record?.second === "approval" ? ["passkey", "approval"] : ["passkey"];
  if ((env.SITE_GATE ?? "").trim().toLowerCase() === "off") return { on: false, source: "off", sv: record?.sv ?? "", factors };
  if (record?.passkey) return { on: true, source: "blob", sv: record.sv, factors };
  return { on: false, source: "none", sv: record?.sv ?? "", factors };
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
    // Read back as the blob store reads it, so an old or odd record is handled the same way.
    return this.record ? readRecord(structuredClone(this.record)) : null;
  }
  async write(record: SiteRecord | null): Promise<void> {
    this.record = record ? structuredClone(record) : null;
  }
}

/** The private blob store's site record, or null when no store is connected (then the site is never locked). */
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
