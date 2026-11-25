/**
 * The Studio's render kit (#1235): the episode engine and its art, kept private in the site's blob store, so a render
 * can run on Nikita's PC with its graphics card (his pick, 2026-11-25: "how do we set up number one?") and send the
 * finished cut back. No key ever sits on the PC: the Director's thread signs short-lived links for exactly the files
 * a render needs, and the PC uses only those links.
 *
 *   PUT  /api/studio-kit  (x-kit-path: ep3/engine/episode.js)   the feed key: stores one file (or one part of a pack).
 *   POST /api/studio-kit  { method: "GET" | "PUT", paths, ttl? } the feed key: signed links, one per path.
 *   GET  /api/studio-kit?p=…&e=…&s=…                            a signed link: the file.
 *   PUT  /api/studio-kit?p=out/…&e=…&s=…                        a signed upload link: a finished cut (only under out/).
 *
 * Signatures are an HMAC of the method, path and expiry with the Desk key (FOUNDRY_DESK_KEY); a link lasts two days
 * at most. The gate lets a correctly signed link through (api/_site/gate.ts) and the handler checks it again.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { pickBlob, type BlobBackend } from "../_blob.js";
import { roomKeyOf, STUDIO_KIT_PATH } from "../_site/roomkeys.js";

export { STUDIO_KIT_PATH };
type Env = Record<string, string | undefined>;
const PREFIX = "studio/kit/";
/** One request's body: under the Functions host's 100 MB cap. Bigger packs go up in parts. */
export const PART_MAX = 95 * 1024 * 1024;
const TTL_MAX = 2 * 24 * 3600;
const PATH = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,8}$/;

export const isKitPath = (p: unknown): p is string => typeof p === "string" && p.length <= 200 && PATH.test(p);

/** The signature for a link: method, path and expiry (seconds since 1970) under the Desk key. */
export function kitSig(method: "GET" | "PUT", path: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`studio-kit|${method}|${path}|${exp}`).digest("base64url").slice(0, 43);
}

/** Whether this request is a signed kit link, unexpired, for its own method (a PUT only under out/). */
export function kitSigned(request: Request, env: Env, now: number): boolean {
  const url = new URL(request.url);
  if (url.pathname !== STUDIO_KIT_PATH) return false;
  const key = env.FOUNDRY_DESK_KEY?.trim();
  if (!key) return false;
  const keys = [...url.searchParams.keys()].sort().join(",");
  if (keys !== "e,p,s") return false;
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (method !== "GET" && method !== "PUT") return false;
  const p = url.searchParams.get("p") ?? "";
  const e = Number(url.searchParams.get("e"));
  const s = url.searchParams.get("s") ?? "";
  if (!isKitPath(p) || !Number.isInteger(e) || e * 1000 < now || e * 1000 > now + TTL_MAX * 1000 + 60_000) return false;
  if (method === "PUT" && !p.startsWith("out/")) return false;
  const want = Buffer.from(kitSig(method, p, e, key));
  const got = Buffer.from(s);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface KitDeps {
  env: Env;
  blob: BlobBackend | null;
  now: number;
  origin?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function store(blob: BlobBackend, path: string, request: Request): Promise<Response> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > PART_MAX) return json({ error: "too-big" }, 413);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > PART_MAX) return json({ error: body.byteLength ? "too-big" : "empty" }, body.byteLength ? 413 : 400);
  await blob.put(PREFIX + path, body, { contentType: "application/octet-stream", allowOverwrite: true });
  return json({ ok: true, path, bytes: body.byteLength });
}

export async function kitGet(request: Request, deps: KitDeps): Promise<Response> {
  if (!kitSigned(request, deps.env, deps.now)) return json({ error: "unauthorized" }, 401);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const p = new URL(request.url).searchParams.get("p")!;
  const got = await deps.blob.get(PREFIX + p);
  if (!got) return json({ error: "gone" }, 404);
  return new Response(got.stream, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function kitPut(request: Request, deps: KitDeps): Promise<Response> {
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const url = new URL(request.url);
  if (url.search !== "") {
    if (!kitSigned(request, deps.env, deps.now)) return json({ error: "unauthorized" }, 401);
    return store(deps.blob, url.searchParams.get("p")!, request);
  }
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  const p = request.headers.get("x-kit-path");
  if (!isKitPath(p)) return json({ error: "bad-path" }, 400);
  return store(deps.blob, p, request);
}

export async function kitPost(request: Request, deps: KitDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== "" || roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  const key = deps.env.FOUNDRY_DESK_KEY?.trim();
  if (!key) return json({ error: "not-set-up" }, 503);
  const raw = await request.text().catch(() => "");
  if (raw.length > 64_000) return json({ error: "too-big" }, 413);
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const method = b.method === "PUT" ? "PUT" : b.method === "GET" ? "GET" : null;
  const paths = b.paths;
  const ttl = b.ttl === undefined ? 24 * 3600 : b.ttl;
  if (!method || !Array.isArray(paths) || paths.length === 0 || paths.length > 400 || !paths.every(isKitPath) || typeof ttl !== "number" || ttl < 60 || ttl > TTL_MAX) return json({ error: "bad-request" }, 400);
  if (method === "PUT" && !paths.every((p) => p.startsWith("out/"))) return json({ error: "bad-request" }, 400);
  const exp = Math.floor(deps.now / 1000) + Math.floor(ttl);
  const origin = deps.origin ?? url.origin;
  const urls: Record<string, string> = {};
  for (const p of paths) urls[p] = `${origin}${STUDIO_KIT_PATH}?p=${encodeURIComponent(p)}&e=${exp}&s=${kitSig(method, p, exp, key)}`;
  return json({ ok: true, exp, urls });
}

const live = (request: Request): KitDeps => ({ env: process.env, blob: pickBlob(process.env), now: Date.now(), origin: process.env.SITE_ORIGIN?.trim() || new URL(request.url).origin });
export const GET = (request: Request) => kitGet(request, live(request));
export const PUT = (request: Request) => kitPut(request, live(request));
export const POST = (request: Request) => kitPost(request, live(request));
