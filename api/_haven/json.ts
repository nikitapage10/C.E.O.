/**
 * A small JSON file in the private blob store (api/_blob.ts), read and changed with an ETag check so two writes at
 * once both land (the same pattern as the chat's ledger, api/_skippy/budget.ts). Used by Hey Skippy's stores (#627).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

/** The file's JSON, or `fallback` when there is none or it doesn't parse. */
export async function readJson<T>(blob: BlobBackend, path: string, fallback: T): Promise<T> {
  const found = await blob.get(path);
  if (!found) return fallback;
  return ((await new Response(found.stream).json().catch(() => fallback)) as T) ?? fallback;
}

/**
 * Read, change, write: `change` gets the current value (or `fallback`) and returns the next value and a result. A
 * write that loses a race is tried again (three tries in all). `next: null` writes nothing.
 */
export async function updateJson<T, R>(blob: BlobBackend, path: string, fallback: T, change: (cur: T) => { next: T | null; result: R }): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const etag = await blob.etag(path);
    const cur = etag ? await readJson(blob, path, fallback) : fallback;
    const { next, result } = change(cur);
    if (next === null) return result;
    try {
      await blob.put(path, JSON.stringify(next), { contentType: "application/json", addRandomSuffix: false, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
      return result;
    } catch (e) {
      if (attempt >= 2 || !(e instanceof BlobPreconditionError || etag === null)) throw e;
    }
  }
}
