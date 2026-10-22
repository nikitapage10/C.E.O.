/**
 * Where the email agent keeps what it must remember between ticks (#263): three blobs in the private store, beside
 * the world and the Desk's sign-ins (api/_blob.ts; on Azure the `ceo-state` container, reached with the Function
 * App's identity).
 *
 *   email/token.json    the Gmail refresh token, sealed (./seal.ts)
 *   email/state.json    the private state: history id, seen ids, the mail list, the month's spend, sealed
 *   email/status.json   the public counts (./status.ts), plain: the only file /api/world reads
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { seal, sealKey, unseal } from "./seal.js";
import { readEmailStatus, type EmailStatus } from "./status.js";
import { emptyEmailState, readEmailState, type EmailState, type TokenRecord } from "./types.js";

export const TOKEN_PATH = "email/token.json";
export const STATE_PATH = "email/state.json";
export const STATUS_PATH = "email/status.json";

export interface EmailStore {
  /** The state and a version to save against; a fresh state when there is none. */
  load(): Promise<{ state: EmailState; version: string | null }>;
  /** Saves only over `version` (or only when there was none); false when another tick got there first. */
  save(state: EmailState, version: string | null): Promise<boolean>;
  /** The state's current version, without reading it. */
  version(): Promise<string | null>;
  token(): Promise<TokenRecord | null>;
  saveToken(token: TokenRecord): Promise<void>;
  dropToken(): Promise<void>;
  status(): Promise<EmailStatus | null>;
  saveStatus(status: EmailStatus): Promise<void>;
}

async function readJson(blob: BlobBackend, path: string): Promise<unknown> {
  const found = await blob.get(path);
  if (!found) return null;
  try {
    return (await new Response(found.stream).json()) as unknown;
  } catch {
    return null;
  }
}

export class BlobEmailStore implements EmailStore {
  constructor(
    private readonly blob: BlobBackend,
    private readonly secret: string,
  ) {}

  private key(purpose: "token" | "state"): Buffer {
    const k = sealKey(this.secret, purpose);
    if (!k) throw new Error("GMAIL_TOKEN_KEY is not set");
    return k;
  }

  async load(): Promise<{ state: EmailState; version: string | null }> {
    const version = await this.blob.etag(STATE_PATH);
    if (!version) return { state: emptyEmailState(), version: null };
    const got = unseal(this.key("state"), await readJson(this.blob, STATE_PATH));
    return { state: got ? readEmailState(got) : emptyEmailState(), version };
  }

  async save(state: EmailState, version: string | null): Promise<boolean> {
    try {
      await this.blob.put(STATE_PATH, JSON.stringify(seal(this.key("state"), state)), {
        contentType: "application/json",
        ...(version ? { ifMatch: version, allowOverwrite: true } : { allowOverwrite: false }),
      });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionError) return false;
      throw e;
    }
  }

  async version(): Promise<string | null> {
    return this.blob.etag(STATE_PATH);
  }

  async token(): Promise<TokenRecord | null> {
    const got = unseal(this.key("token"), await readJson(this.blob, TOKEN_PATH)) as Partial<TokenRecord> | null;
    return got && typeof got.refresh === "string" && got.refresh ? { refresh: got.refresh, connectedAt: Number(got.connectedAt) || 0 } : null;
  }

  async saveToken(token: TokenRecord): Promise<void> {
    await this.blob.put(TOKEN_PATH, JSON.stringify(seal(this.key("token"), token)), { contentType: "application/json", allowOverwrite: true });
  }

  async dropToken(): Promise<void> {
    await this.blob.del(TOKEN_PATH);
  }

  async status(): Promise<EmailStatus | null> {
    return readEmailStatus(await readJson(this.blob, STATUS_PATH));
  }

  async saveStatus(status: EmailStatus): Promise<void> {
    const clean = readEmailStatus(status);
    if (!clean) throw new Error("email status refused");
    await this.blob.put(STATUS_PATH, JSON.stringify(clean), { contentType: "application/json", allowOverwrite: true, cacheControlMaxAge: 60 });
  }
}

/** For tests: the same contract, in memory, with versions. */
export class MemoryEmailStore implements EmailStore {
  stateJson: string | null = null;
  ver = 0;
  tokenRec: TokenRecord | null = null;
  statusRec: EmailStatus | null = null;
  async load() {
    return this.stateJson ? { state: readEmailState(JSON.parse(this.stateJson)), version: String(this.ver) } : { state: emptyEmailState(), version: null };
  }
  async save(state: EmailState, version: string | null) {
    const now = this.stateJson ? String(this.ver) : null;
    if (now !== version) return false;
    this.stateJson = JSON.stringify(state);
    this.ver += 1;
    return true;
  }
  async version() {
    return this.stateJson ? String(this.ver) : null;
  }
  async token() {
    return this.tokenRec ? { ...this.tokenRec } : null;
  }
  async saveToken(token: TokenRecord) {
    this.tokenRec = { ...token };
  }
  async dropToken() {
    this.tokenRec = null;
  }
  async status() {
    return this.statusRec ? readEmailStatus(this.statusRec) : null;
  }
  async saveStatus(status: EmailStatus) {
    const clean = readEmailStatus(status);
    if (!clean) throw new Error("email status refused");
    this.statusRec = clean;
  }
}

/** The private store with the sealing key, or null when either is missing (the agent then waits). */
export function pickEmailStore(env: Record<string, string | undefined> = process.env): EmailStore | null {
  const blob = pickBlob(env);
  if (!blob || !sealKey(env.GMAIL_TOKEN_KEY, "token")) return null;
  return new BlobEmailStore(blob, env.GMAIL_TOKEN_KEY ?? "");
}

/** Only the public counts, for /api/world: needs no sealing key, reads nothing private. Null off Azure. */
export async function readPublicEmailStatus(env: Record<string, string | undefined> = process.env): Promise<EmailStatus | null> {
  const blob = pickBlob(env);
  if (!blob || blob.kind !== "azureblob") return null;
  try {
    return readEmailStatus(await readJson(blob, STATUS_PATH));
  } catch {
    return null;
  }
}
