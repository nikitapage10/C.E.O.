/**
 * The private blob store every function keeps its files in (the world, its stories, the Desk's sign-ins, idea
 * pictures), behind one small interface so the same code runs on Vercel and on Azure (docs/AZURE.md):
 *
 *   Vercel  the project's private Vercel Blob store (@vercel/blob), signed in with Vercel's OIDC token. The calls
 *           below are exactly the ones the stores made before this file existed.
 *   Azure   WORLD_STORE=azureblob: the `ceo-state` container in the Function App's storage account, reached with
 *           its managed identity. The Azure SDKs live only in the `azure/` package, which registers that backend
 *           at start-up (registerAzureBlob), so they never ship with a Vercel function or the Desk.
 *
 * Underscore file: Vercel never serves it as a function.
 */

import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } from "@vercel/blob";

type Env = Record<string, string | undefined>;

/** A file read from the store. */
export interface StoredBlob {
  stream: ReadableStream<Uint8Array>;
  /** The store's own ETag, the one `ifMatch` compares against. */
  etag: string;
  contentType: string;
}

export interface PutOptions {
  contentType: string;
  /** Add a random suffix to the name (before the extension), so two uploads never collide. Default false. */
  addRandomSuffix?: boolean;
  /** Replace a file already there. Left unset, Vercel Blob's own default applies (no overwrite). */
  allowOverwrite?: boolean;
  /** Only write when the file still has this ETag; otherwise throw BlobPreconditionError. */
  ifMatch?: string;
  /** How long a CDN or browser may keep a copy, in seconds. */
  cacheControlMaxAge?: number;
}

/** The store's operations, the same on every platform. */
export interface BlobBackend {
  readonly kind: "vercel" | "azureblob";
  /** The file, or null when there is none. `cached: true` allows a CDN copy (Vercel); default is straight from storage. */
  get(path: string, opts?: { cached?: boolean }): Promise<StoredBlob | null>;
  /** The file's current ETag, or null when there is none. */
  etag(path: string): Promise<string | null>;
  /** Write a file; returns the name it was stored under. Throws BlobPreconditionError when a condition fails. */
  put(path: string, body: string | ArrayBuffer | Uint8Array, opts: PutOptions): Promise<{ pathname: string }>;
  del(path: string): Promise<void>;
}

/** A conditional write lost: the file changed (ifMatch) or was already there (no overwrite). */
export class BlobPreconditionError extends Error {
  constructor(message = "blob precondition failed") {
    super(message);
    this.name = "BlobPreconditionError";
  }
}

/* ── Vercel Blob ── */

export const vercelBlob: BlobBackend = {
  kind: "vercel",
  async get(path, opts = {}) {
    try {
      const found = await get(path, opts.cached ? { access: "private" } : { access: "private", useCache: false });
      if (!found || !found.stream) return null;
      return { stream: found.stream, etag: found.blob.etag, contentType: found.blob.contentType ?? "" };
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  },
  async etag(path) {
    try {
      return (await head(path)).etag;
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  },
  async put(path, body, opts) {
    try {
      const blob = await put(path, typeof body === "string" || body instanceof ArrayBuffer || Buffer.isBuffer(body) ? body : Buffer.from(body), {
        access: "private",
        contentType: opts.contentType,
        addRandomSuffix: opts.addRandomSuffix ?? false,
        ...(opts.allowOverwrite !== undefined && { allowOverwrite: opts.allowOverwrite }),
        ...(opts.cacheControlMaxAge !== undefined && { cacheControlMaxAge: opts.cacheControlMaxAge }),
        ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}),
      });
      return { pathname: blob.pathname };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new BlobPreconditionError(e.message);
      throw e;
    }
  },
  async del(path) {
    await del(path);
  },
};

/** Whether a Vercel Blob store is connected to the project (Vercel sets BLOB_STORE_ID; a read-write token also works). */
export const blobReady = (env: Env) => Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN);

/* ── Azure Blob Storage, registered by the azure/ package ── */

let azureFactory: ((env: Env) => BlobBackend) | null = null;
let azureCached: { key: string; backend: BlobBackend } | null = null;

/** Called once by the Azure Functions entry (azure/src/index.ts) with its Azure Blob Storage backend. */
export function registerAzureBlob(factory: ((env: Env) => BlobBackend) | null): void {
  azureFactory = factory;
  azureCached = null;
}

/** Whether the settings name an Azure storage account to use. */
export const azureReady = (env: Env) => Boolean(env.AZURE_STORAGE_ACCOUNT || env.AZURE_STORAGE_BLOB_ENDPOINT);

/** What WORLD_STORE asks for, lower-cased; Vercel Blob when unset. */
export const storeKind = (env: Env) => (env.WORLD_STORE ?? "blob").trim().toLowerCase();

/**
 * The blob store for these settings, or null when none is set up:
 *   WORLD_STORE=azureblob  Azure Blob Storage, when the azure/ package registered it and an account is named
 *   anything else          Vercel Blob, when a store is connected (as before: memory and supabase only change the
 *                          world store, never the Desk's sign-ins or the pictures)
 */
export function pickBlob(env: Env = process.env): BlobBackend | null {
  if (storeKind(env) === "azureblob") {
    if (!azureFactory || !azureReady(env)) return null;
    const key = `${env.AZURE_STORAGE_ACCOUNT ?? ""}|${env.AZURE_STORAGE_BLOB_ENDPOINT ?? ""}|${env.AZURE_STORAGE_CONTAINER ?? ""}`;
    if (azureCached?.key !== key) azureCached = { key, backend: azureFactory(env) };
    return azureCached.backend;
  }
  return blobReady(env) ? vercelBlob : null;
}
