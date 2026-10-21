/**
 * Where the Desk's sign-in keeps what it must remember between function instances (#132): the enrolled passkeys and
 * the failed-attempt counters, and the devices that turned pings on (#135). All live in the project's private blob store (Vercel Blob, or Azure Blob Storage on Azure: api/_blob.ts), beside the world and the idea
 * pictures, never in the repo. A passkey record is public data only: the credential's id, its public key, its
 * signature counter, how it connects, a device label Nikita picks and two dates. No private key ever leaves the
 * device, and the counters keep a keyed hash of the address, never the address.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob, vercelBlob, type BlobBackend } from "../_blob.js";
import type { Limits } from "./limits.js";
import type { PingState } from "./pings.js";

export interface Passkey {
  /** The credential id, base64url, as the browser reports it. */
  id: string;
  /** The credential's public key (COSE), base64url. */
  publicKey: string;
  /** The authenticator's signature counter (many passkeys keep it at 0). */
  counter: number;
  transports?: string[];
  /** What Nikita called the device ("Windows PC", "iPhone"). */
  label: string;
  /** ISO time it was enrolled, and last used to sign in. */
  added: string;
  used?: string;
}

export interface AuthStore {
  passkeys(): Promise<Passkey[]>;
  savePasskeys(list: Passkey[]): Promise<void>;
  limits(): Promise<Limits>;
  saveLimits(limits: Limits): Promise<void>;
  /** The devices that turned pings on, and what has been pinged already (#135, api/_desk/pings.ts). */
  pings(): Promise<PingState>;
  savePings(state: PingState): Promise<void>;
}

/** At most this many devices: enough for every PC, phone and key Nikita owns, and a bound on the record. */
export const MAX_PASSKEYS = 10;

const PASSKEYS = "desk/auth/passkeys.json";
const LIMITS = "desk/auth/limits.json";
/** Beside the passkeys: each device's push subscription, and the keys of what was pinged (#135). */
const PINGS = "desk/auth/pings.json";

const pingsOf = (got: Partial<PingState> | null | undefined): PingState => ({
  subs: Array.isArray(got?.subs) ? got.subs : [],
  sent: got?.sent && typeof got.sent === "object" && !Array.isArray(got.sent) ? got.sent : {},
  ...(typeof got?.scanned === "number" && Number.isFinite(got.scanned) && { scanned: got.scanned }),
});

async function readJson<T>(blob: BlobBackend, path: string, empty: T): Promise<T> {
  // Straight from storage, never a cached copy: a removed device or a fresh failure must count at once.
  const found = await blob.get(path);
  if (!found) return empty;
  return ((await new Response(found.stream).json()) as T) ?? empty;
}

async function writeJson(blob: BlobBackend, path: string, value: unknown): Promise<void> {
  await blob.put(path, JSON.stringify(value), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
}

export class BlobAuthStore implements AuthStore {
  /** Vercel Blob unless told otherwise (pickAuthStore hands it Azure's on Azure). */
  constructor(private readonly blob: BlobBackend = vercelBlob) {}
  async passkeys(): Promise<Passkey[]> {
    const got = await readJson<{ passkeys?: Passkey[] }>(this.blob, PASSKEYS, {});
    return Array.isArray(got.passkeys) ? got.passkeys : [];
  }
  async savePasskeys(list: Passkey[]): Promise<void> {
    await writeJson(this.blob, PASSKEYS, { passkeys: list.slice(0, MAX_PASSKEYS) });
  }
  async limits(): Promise<Limits> {
    const got = await readJson<Limits>(this.blob, LIMITS, {});
    return got && typeof got === "object" ? got : {};
  }
  async saveLimits(limits: Limits): Promise<void> {
    await writeJson(this.blob, LIMITS, limits);
  }
  async pings(): Promise<PingState> {
    return pingsOf(await readJson<Partial<PingState>>(this.blob, PINGS, {}));
  }
  async savePings(state: PingState): Promise<void> {
    await writeJson(this.blob, PINGS, state);
  }
}

/** For tests and local runs: the same shape, in memory. */
export class MemoryAuthStore implements AuthStore {
  keys: Passkey[] = [];
  counters: Limits = {};
  async passkeys(): Promise<Passkey[]> {
    return structuredClone(this.keys);
  }
  async savePasskeys(list: Passkey[]): Promise<void> {
    this.keys = structuredClone(list.slice(0, MAX_PASSKEYS));
  }
  async limits(): Promise<Limits> {
    return structuredClone(this.counters);
  }
  async saveLimits(limits: Limits): Promise<void> {
    this.counters = structuredClone(limits);
  }
  pingState: PingState = { subs: [], sent: {} };
  async pings(): Promise<PingState> {
    return pingsOf(structuredClone(this.pingState));
  }
  async savePings(state: PingState): Promise<void> {
    this.pingState = structuredClone(state);
  }
}

/**
 * The private Blob store when it is connected (Vercel sets BLOB_STORE_ID; on Azure, WORLD_STORE=azureblob and the
 * storage account), else nothing: no store, no sign-in.
 */
export function pickAuthStore(env: Record<string, string | undefined> = process.env): AuthStore | null {
  const blob = pickBlob(env);
  return blob ? new BlobAuthStore(blob) : null;
}
