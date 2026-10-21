import { beforeEach, describe, expect, it, vi } from "vitest";

// Vercel Blob, mocked: the calls must be exactly the ones the stores made before api/_blob.ts.
class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}
const calls: Array<[string, ...unknown[]]> = [];
let failPut: Error | null = null;
vi.mock("@vercel/blob", () => ({
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get: async (...a: unknown[]) => (calls.push(["get", ...a]), null),
  head: async (...a: unknown[]) => {
    calls.push(["head", ...a]);
    throw new BlobNotFoundError();
  },
  put: async (path: string, ...a: unknown[]) => {
    calls.push(["put", path, ...a]);
    if (failPut) throw failPut;
    return { pathname: path };
  },
  del: async (...a: unknown[]) => (calls.push(["del", ...a]), undefined),
}));

const { BlobPreconditionError, vercelBlob } = await import("./_blob.ts");
const { BlobStore, StaleStateError } = await import("./_world/store.ts");
const { BlobAuthStore } = await import("./_desk/store.ts");

beforeEach(() => {
  calls.length = 0;
  failPut = null;
});

describe("Vercel Blob behind the blob store", () => {
  it("reads straight from storage unless a cached copy is allowed, and answers a missing file with null", async () => {
    expect(await vercelBlob.get("a.json")).toBeNull();
    expect(await vercelBlob.get("p.jpg", { cached: true })).toBeNull();
    expect(await vercelBlob.etag("a.json")).toBeNull();
    expect(calls).toEqual([
      ["get", "a.json", { access: "private", useCache: false }],
      ["get", "p.jpg", { access: "private" }],
      ["head", "a.json"],
    ]);
  });

  it("writes the world and the Desk's files with the same options as before", async () => {
    await new BlobStore().saveState({ step: 1 } as never);
    await new BlobAuthStore().saveLimits({});
    const json = { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
    expect(calls).toEqual([
      ["put", "world/state.json", '{"step":1}', json],
      ["put", "desk/auth/limits.json", "{}", json],
    ]);
  });

  it("writes pictures with a random suffix and Vercel's default overwrite rule", async () => {
    const body = new Uint8Array([1]).buffer;
    await vercelBlob.put("foundry/ideas/1.jpg", body, { contentType: "image/jpeg", addRandomSuffix: true });
    expect(calls).toEqual([["put", "foundry/ideas/1.jpg", body, { access: "private", contentType: "image/jpeg", addRandomSuffix: true }]]);
  });

  it("turns a lost ifMatch into BlobPreconditionError, and the world store into StaleStateError", async () => {
    failPut = new BlobPreconditionFailedError("changed");
    await expect(vercelBlob.put("x", "1", { contentType: "text/plain", ifMatch: '"1"' })).rejects.toBeInstanceOf(BlobPreconditionError);
    await expect(new BlobStore().saveState({ step: 1 } as never)).rejects.toBeInstanceOf(StaleStateError);
    failPut = new Error("network");
    await expect(vercelBlob.put("x", "1", { contentType: "text/plain" })).rejects.toThrow("network");
  });
});
