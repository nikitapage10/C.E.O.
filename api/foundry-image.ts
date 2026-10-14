/**
 * Pictures for Nikita's ideas on the Desk, as a Vercel function. The Desk shrinks a pasted, attached or dropped
 * image in the browser, then posts it here in its sign-in session (#132); it lands in the project's private Vercel
 * Blob store. The picture stays private (#127, docs/THREAT-MODEL.md, R4): the idea's public issue names it but never
 * links it, and this function serves it back only on a short-lived signed link (api/_pictures.ts), signed with a key
 * derived from the Desk key (api/_desk/keys.ts): here for the Desk's own cards, and in api/foundry.ts for Rivet's
 * shaping call.
 *
 * POST (raw image body, `Content-Type: image/…`, signed in) → { url }: the picture's reference link (unsigned, so
 *      it opens nothing by itself; the Desk hands it back when it files the idea).
 * GET  ?sign=foundry/ideas/a.jpg,foundry/ideas/b.png (signed in) → { links }: short-lived links to show them on the
 *      Desk, good for 10 to 20 minutes.
 * GET  ?p=foundry/ideas/…&u=<expiry, seconds>&s=<signature> → the picture, or 403 without a good, unexpired signature.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   FOUNDRY_DESK_KEY        the root of the Desk's signing keys (as in api/foundry.ts)
 *   BLOB_STORE_ID           set by Vercel when the Blob store is connected to the project; the function signs in
 *                           with Vercel's own OIDC token (a BLOB_READ_WRITE_TOKEN works too)
 */

import { get, put } from "@vercel/blob";
import { pictureSecret } from "./_desk/keys.js";
import { requireSession, withCookie } from "./_desk/session.js";
import { pickAuthStore } from "./_desk/store.js";
import { MAX_PICTURES, PICTURE_PATH, linkUntil, pictureLink, signPicture, verifyPicture } from "./_pictures.js";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const env = (name: string): string => process.env[name] ?? "";
const canStore = () => Boolean(env("BLOB_STORE_ID") || env("BLOB_READ_WRITE_TOKEN"));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const session = (request: Request) => requireSession(request, { deskKey: env("FOUNDRY_DESK_KEY"), store: pickAuthStore(), now: Date.now() });

/** The Desk's own links to a card's pictures, for a signed-in Desk only. */
async function signLinks(request: Request, names: string): Promise<Response> {
  const signed = await session(request);
  if (!signed.ok) return signed.response;
  const until = linkUntil(Date.now());
  const secret = await pictureSecret(env("FOUNDRY_DESK_KEY"));
  const paths = names
    .split(",")
    .filter((p) => PICTURE_PATH.test(p))
    .slice(0, MAX_PICTURES);
  return withCookie(json({ links: await Promise.all(paths.map(async (p) => pictureLink(p, until, await signPicture(secret, p, until)))) }), signed);
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const names = query.get("sign");
  if (names !== null) return canStore() ? signLinks(request, names) : json({ error: "not-set-up" }, 503);
  const path = query.get("p") ?? "";
  if (!PICTURE_PATH.test(path) || !canStore()) return json({ error: "not-found" }, 404);
  const until = Number(query.get("u"));
  const now = Date.now();
  if (!(await verifyPicture(await pictureSecret(env("FOUNDRY_DESK_KEY")), path, until, query.get("s") ?? "", now))) return json({ error: "private" }, 403);
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
  const signed = await session(request);
  if (!signed.ok) return signed.response;
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const ext = TYPES[type];
  if (!ext) return withCookie(json({ error: "not-an-image" }, 415), signed);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return withCookie(json({ error: "too-big" }, 413), signed);
  try {
    const blob = await put(`foundry/ideas/${Date.now()}.${ext}`, body, { access: "private", contentType: type, addRandomSuffix: true });
    return withCookie(json({ url: `${new URL(request.url).origin}/api/foundry-image?p=${encodeURIComponent(blob.pathname)}` }), signed);
  } catch {
    return withCookie(json({ error: "blob" }, 502), signed);
  }
}
