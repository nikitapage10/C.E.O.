/**
 * Test support only: an in-memory stand-in for the private Vercel Blob store, with no imports of its own so a test
 * can mock the real one with it: `vi.mock("@vercel/blob", async () => (await import("./_desk/fakeBlob.ts")).fakeBlob)`.
 * Never imported by a function.
 */

/** What the fake store holds, by path. */
export const blobFiles = new Map<string, { body: Uint8Array; type: string }>();

async function bytesOf(body: unknown): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return new Uint8Array();
}

class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}

export const fakeBlob = {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  head: async (path: string) => {
    const found = blobFiles.get(path);
    if (!found) throw new BlobNotFoundError(path);
    return { etag: `"${found.body.length}"`, pathname: path };
  },
  del: async (path: string) => {
    blobFiles.delete(path);
  },
  get: async (path: string) => {
    const found = blobFiles.get(path);
    if (!found) return null;
    return { stream: new Blob([found.body.slice()]).stream(), blob: { contentType: found.type, etag: `"${found.body.length}"`, pathname: path } };
  },
  put: async (path: string, body: unknown, opts: { contentType?: string; addRandomSuffix?: boolean } = {}) => {
    const name = opts.addRandomSuffix ? path.replace(/(\.\w+)$/, "-r4nd0m$1") : path;
    blobFiles.set(name, { body: await bytesOf(body), type: opts.contentType ?? "application/octet-stream" });
    return { pathname: name, url: `https://blob.test/${name}` };
  },
};
