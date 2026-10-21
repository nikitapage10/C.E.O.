import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDKs, mocked: an in-memory container with ETags and Azure's conditional-write answers. No network.
const files = new Map<string, { bytes: Uint8Array; etag: string; type?: string; cache?: string }>();
let version = 0;
const made: { endpoint?: string; container?: string; credential?: unknown } = {};

class RestError extends Error {
  constructor(public statusCode: number) {
    super(`status ${statusCode}`);
  }
}

function blockBlob(name: string) {
  return {
    async download() {
      const f = files.get(name);
      if (!f) throw new RestError(404);
      const { Readable } = await import("node:stream");
      return { readableStreamBody: Readable.from([Buffer.from(f.bytes)]), etag: f.etag, contentType: f.type };
    },
    async getProperties() {
      const f = files.get(name);
      if (!f) throw new RestError(404);
      return { etag: f.etag };
    },
    async upload(bytes: Uint8Array, length: number, opts: { blobHTTPHeaders?: { blobContentType?: string; blobCacheControl?: string }; conditions?: { ifMatch?: string; ifNoneMatch?: string } } = {}) {
      const was = files.get(name);
      if (opts.conditions?.ifNoneMatch === "*" && was) throw new RestError(409);
      if (opts.conditions?.ifMatch && was?.etag !== opts.conditions.ifMatch) throw new RestError(412);
      expect(length).toBe(bytes.byteLength);
      files.set(name, { bytes, etag: `"v${++version}"`, type: opts.blobHTTPHeaders?.blobContentType, cache: opts.blobHTTPHeaders?.blobCacheControl });
      return {};
    },
    async deleteIfExists() {
      files.delete(name);
      return {};
    },
  };
}

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    constructor(endpoint: string, credential: unknown) {
      made.endpoint = endpoint;
      made.credential = credential;
    }
    getContainerClient(name: string) {
      made.container = name;
      return { getBlockBlobClient: blockBlob };
    }
  },
}));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: class {} }));

const { azureBlobFromEnv, blobEndpoint, withRandomSuffix } = await import("./blob.ts");
const { BlobPreconditionError, pickBlob, registerAzureBlob, vercelBlob } = await import("../../api/_blob.ts");
const { BlobStore, pickStore, StaleStateError } = await import("../../api/_world/store.ts");
const { BlobStoryStore, pickStoryStore } = await import("../../api/_world/story.ts");
const { BlobAuthStore, pickAuthStore } = await import("../../api/_desk/store.ts");

const AZURE = { WORLD_STORE: "azureblob", AZURE_STORAGE_ACCOUNT: "stceotest", AZURE_STORAGE_CONTAINER: "ceo-state" };

beforeEach(() => {
  files.clear();
  registerAzureBlob(azureBlobFromEnv);
});

describe("the Azure blob store", () => {
  it("signs in with DefaultAzureCredential on the account's endpoint and container", () => {
    const blob = azureBlobFromEnv({ AZURE_STORAGE_ACCOUNT: "stceotest" });
    expect(blob.kind).toBe("azureblob");
    expect(made.endpoint).toBe("https://stceotest.blob.core.windows.net/");
    expect(made.container).toBe("ceo-state");
    expect(made.credential?.constructor.name).toBe("DefaultAzureCredential");
    expect(blobEndpoint({ AZURE_STORAGE_BLOB_ENDPOINT: "https://x.blob.core.windows.net" })).toBe("https://x.blob.core.windows.net/");
    expect(() => blobEndpoint({ AZURE_STORAGE_ACCOUNT: "Not/An/Account" })).toThrow();
  });

  it("reads, writes, deletes and answers missing files with null", async () => {
    const blob = azureBlobFromEnv(AZURE);
    expect(await blob.get("world/state.json")).toBeNull();
    expect(await blob.etag("world/state.json")).toBeNull();
    await blob.put("world/state.json", '{"a":1}', { contentType: "application/json", allowOverwrite: true, cacheControlMaxAge: 60 });
    const got = await blob.get("world/state.json");
    expect(await new Response(got!.stream).json()).toEqual({ a: 1 });
    expect(got!.contentType).toBe("application/json");
    expect(got!.etag).toBe(await blob.etag("world/state.json"));
    expect(files.get("world/state.json")!.cache).toBe("private, max-age=60");
    await blob.del("world/state.json");
    expect(await blob.get("world/state.json")).toBeNull();
  });

  it("keeps Vercel Blob's write rules: no overwrite unless allowed, ifMatch only over that version", async () => {
    const blob = azureBlobFromEnv(AZURE);
    await blob.put("c.claim", "1", { contentType: "application/json" });
    await expect(blob.put("c.claim", "2", { contentType: "application/json" })).rejects.toBeInstanceOf(BlobPreconditionError);
    await expect(blob.put("c.claim", "2", { contentType: "application/json", ifMatch: '"stale"' })).rejects.toBeInstanceOf(BlobPreconditionError);
    await blob.put("c.claim", "3", { contentType: "application/json", ifMatch: (await blob.etag("c.claim"))! });
    expect(new TextDecoder().decode(files.get("c.claim")!.bytes)).toBe("3");
  });

  it("adds a random suffix before the extension, inside the picture names' alphabet", async () => {
    const blob = azureBlobFromEnv(AZURE);
    const { pathname } = await blob.put("foundry/ideas/1.jpg", new Uint8Array([1, 2]).buffer, { contentType: "image/jpeg", addRandomSuffix: true });
    expect(pathname).toMatch(/^foundry\/ideas\/1-[a-f0-9]{21}\.jpg$/);
    expect(files.has(pathname)).toBe(true);
    expect(withRandomSuffix("noext")).toMatch(/^noext-[a-f0-9]{21}$/);
  });

  it("refuses a second save on a stale state, as on Vercel", async () => {
    const store = pickStore(AZURE)!;
    expect(store).toBeInstanceOf(BlobStore);
    expect(await store.loadState()).toBeNull();
    const state = { step: 1 } as never;
    await store.saveState(state);
    const a = pickStore(AZURE)!;
    const b = pickStore(AZURE)!;
    await a.loadState();
    await b.loadState();
    await a.saveState(state);
    await expect(b.saveState(state)).rejects.toBeInstanceOf(StaleStateError);
  });
});

describe("choosing the store", () => {
  it("WORLD_STORE=azureblob uses Azure for the world, stories, Desk sign-ins and pictures", () => {
    expect(pickBlob(AZURE)?.kind).toBe("azureblob");
    expect(pickStore(AZURE)).toBeInstanceOf(BlobStore);
    expect(pickStoryStore(AZURE)).toBeInstanceOf(BlobStoryStore);
    expect(pickAuthStore(AZURE)).toBeInstanceOf(BlobAuthStore);
  });

  it("reuses one client for the same settings", () => {
    expect(pickBlob(AZURE)).toBe(pickBlob(AZURE));
    expect(pickBlob({ ...AZURE, AZURE_STORAGE_CONTAINER: "other" })).not.toBe(pickBlob(AZURE));
  });

  it("azureblob without an account, or outside the Azure package, is not set up (never Vercel Blob)", () => {
    expect(pickBlob({ WORLD_STORE: "azureblob", BLOB_STORE_ID: "store_x" })).toBeNull();
    expect(pickStore({ WORLD_STORE: "azureblob" })).toBeNull();
    expect(pickAuthStore({ WORLD_STORE: "azureblob" })).toBeNull();
    registerAzureBlob(null);
    expect(pickBlob(AZURE)).toBeNull();
  });

  it("everything else is Vercel Blob exactly as before", () => {
    expect(pickBlob({ BLOB_STORE_ID: "store_x" })).toBe(vercelBlob);
    expect(pickBlob({ WORLD_STORE: "blob", BLOB_READ_WRITE_TOKEN: "t" })).toBe(vercelBlob);
    expect(pickBlob({ AZURE_STORAGE_ACCOUNT: "stceotest", BLOB_STORE_ID: "store_x" })).toBe(vercelBlob);
    expect(pickBlob({})).toBeNull();
    // memory and supabase change only the world store; sign-ins and pictures stay on Vercel Blob, as they did.
    expect(pickAuthStore({ WORLD_STORE: "memory", BLOB_STORE_ID: "store_x" })).toBeInstanceOf(BlobAuthStore);
    expect(pickStore({ WORLD_STORE: "memory", AZURE_STORAGE_ACCOUNT: "stceotest" })?.kind).toBe("memory");
  });
});
