/**
 * Pictures for Nikita's ideas on the Desk, as a Vercel function. The Desk shrinks a pasted, attached or dropped
 * image in the browser, then posts it here with the Desk key; it lands in Vercel Blob and the public link goes into
 * the idea's issue, where the card, GitHub and Rusty's shaping can all see it.
 *
 * POST (raw image body, `Content-Type: image/…`, header `x-desk-key`) → { url }.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY        the Desk's passphrase (as in api/foundry.ts)
 *   BLOB_READ_WRITE_TOKEN   added by Vercel when a Blob store is connected to the project (Storage → Blob)
 */

import { put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const env = (name: string): string => process.env[name] ?? "";

/** The Blob store's token. Vercel names it BLOB_READ_WRITE_TOKEN unless the store was connected with its own prefix. */
const blobToken = (): string =>
  env("BLOB_READ_WRITE_TOKEN") || (Object.entries(process.env).find(([k, v]) => k.endsWith("_READ_WRITE_TOKEN") && v)?.[1] ?? "");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function keyMatches(given: string): boolean {
  const want = Buffer.from(env("FOUNDRY_DESK_KEY"));
  const got = Buffer.from(given);
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

export async function POST(request: Request): Promise<Response> {
  if (!env("FOUNDRY_DESK_KEY") || !blobToken()) return json({ error: "not-set-up" }, 503);
  if (!keyMatches(request.headers.get("x-desk-key") ?? "")) return json({ error: "wrong-key" }, 401);
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const ext = TYPES[type];
  if (!ext) return json({ error: "not-an-image" }, 415);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json({ error: "too-big" }, 413);
  try {
    const blob = await put(`foundry/ideas/${Date.now()}.${ext}`, body, { access: "public", contentType: type, addRandomSuffix: true, token: blobToken() });
    return json({ url: blob.url });
  } catch {
    return json({ error: "blob" }, 502);
  }
}
