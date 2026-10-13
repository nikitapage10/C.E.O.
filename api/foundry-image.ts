/**
 * Pictures for Nikita's ideas on the Desk, as a Vercel function. The Desk shrinks a pasted, attached or dropped
 * image in the browser, then posts it here with the Desk key; it lands in the project's private Vercel Blob store,
 * and this function serves it back at its own link, which goes into the idea's issue so the card, GitHub and
 * Rusty's shaping can all see it.
 *
 * POST (raw image body, `Content-Type: image/…`, header `x-desk-key`) → { url }.
 * GET  ?p=foundry/ideas/… → the picture.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY        the Desk's passphrase (as in api/foundry.ts)
 *   BLOB_STORE_ID           set by Vercel when the Blob store is connected to the project; the function signs in
 *                           with Vercel's own OIDC token (a BLOB_READ_WRITE_TOKEN works too)
 */

import { get, put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const PATH = /^foundry\/ideas\/[\w.-]+$/;

const env = (name: string): string => process.env[name] ?? "";
const canStore = () => Boolean(env("BLOB_STORE_ID") || env("BLOB_READ_WRITE_TOKEN"));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function keyMatches(given: string): boolean {
  const want = Buffer.from(env("FOUNDRY_DESK_KEY"));
  const got = Buffer.from(given);
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get("p") ?? "";
  if (!PATH.test(path) || !canStore()) return json({ error: "not-found" }, 404);
  try {
    const found = await get(path, { access: "private" });
    if (!found || !found.stream) return json({ error: "not-found" }, 404);
    // Each picture's name is unique and never changes, so it can be cached for good.
    return new Response(found.stream, { headers: { "Content-Type": found.blob.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return json({ error: "blob" }, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!env("FOUNDRY_DESK_KEY") || !canStore()) return json({ error: "not-set-up" }, 503);
  if (!keyMatches(request.headers.get("x-desk-key") ?? "")) return json({ error: "wrong-key" }, 401);
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const ext = TYPES[type];
  if (!ext) return json({ error: "not-an-image" }, 415);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json({ error: "too-big" }, 413);
  try {
    const blob = await put(`foundry/ideas/${Date.now()}.${ext}`, body, { access: "private", contentType: type, addRandomSuffix: true });
    return json({ url: `${new URL(request.url).origin}/api/foundry-image?p=${encodeURIComponent(blob.pathname)}` });
  } catch {
    return json({ error: "blob" }, 502);
  }
}
