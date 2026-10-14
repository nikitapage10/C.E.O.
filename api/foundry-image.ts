/**
 * Pictures for Nikita's ideas on the Desk, as a Vercel function. The Desk shrinks a pasted, attached or dropped
 * image in the browser, then posts it here with the Desk key; it lands in the project's private Vercel Blob store.
 * The picture stays private (#127, docs/THREAT-MODEL.md, R4): the idea's public issue names it but never links it,
 * and this function serves it back only on a short-lived signed link (api/_pictures.ts), which the Desk signs with its
 * key for its own cards and api/foundry.ts signs for Rivet's shaping call.
 *
 * POST (raw image body, `Content-Type: image/…`, header `x-desk-key`) → { url }: the picture's reference link
 *      (unsigned, so it opens nothing by itself; the Desk hands it back when it files the idea).
 * GET  ?p=foundry/ideas/…&u=<expiry, seconds>&s=<signature> → the picture, or 403 without a good, unexpired signature.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY        the Desk's passphrase (as in api/foundry.ts)
 *   BLOB_STORE_ID           set by Vercel when the Blob store is connected to the project; the function signs in
 *                           with Vercel's own OIDC token (a BLOB_READ_WRITE_TOKEN works too)
 */

import { get, put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";
import { PICTURE_PATH, verifyPicture } from "./_pictures.js";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

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
  const query = new URL(request.url).searchParams;
  const path = query.get("p") ?? "";
  if (!PICTURE_PATH.test(path) || !canStore()) return json({ error: "not-found" }, 404);
  const until = Number(query.get("u"));
  const now = Date.now();
  if (!(await verifyPicture(env("FOUNDRY_DESK_KEY"), path, until, query.get("s") ?? "", now))) return json({ error: "private" }, 403);
  try {
    const found = await get(path, { access: "private" });
    if (!found || !found.stream) return json({ error: "not-found" }, 404);
    // Only the viewer's own browser may keep it, and no longer than the link lives; never a shared cache.
    const left = Math.max(0, Math.min(600, until - Math.floor(now / 1000)));
    return new Response(found.stream, { headers: { "Content-Type": found.blob.contentType || "image/jpeg", "Cache-Control": `private, max-age=${left}`, "Referrer-Policy": "no-referrer" } });
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
