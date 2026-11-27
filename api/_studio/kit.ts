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
 *   POST /api/studio-kit { join: "out/ep2-v8.part", count, to }  the feed key (#1243): parts out/…part00, part01, … joined
 *                                                               into one review file, media/<to>, on the server.
 *   GET  /api/studio-kit?m=ep2-v8.mp4                           a passkey session (#1243): that review file, with byte
 *                                                               ranges so the Desk's players can seek. The Desk plays
 *                                                               cuts from here; Zernio only gets one for a post draft.
 *
 * Signatures are an HMAC of the method, path and expiry with the Desk key (FOUNDRY_DESK_KEY); a link lasts two days
 * at most. The gate lets a correctly signed link through (api/_site/gate.ts) and the handler checks it again.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { pickBlob, type BlobBackend } from "../_blob.js";
import { pickAuthStore } from "../_desk/store.js";
import { requireSession, withCookie, type DeskDeps } from "../_desk/session.js";
import { roomKeyOf, STUDIO_KIT_PATH } from "../_site/roomkeys.js";
import { locked, reviewLinkOpened } from "../_site/gate.js";

export { STUDIO_KIT_PATH };
type Env = Record<string, string | undefined>;
const PREFIX = "studio/kit/";
/** One request's body: under the Functions host's 100 MB cap. Bigger packs go up in parts. */
export const PART_MAX = 95 * 1024 * 1024;
const TTL_MAX = 2 * 24 * 3600;
const PATH = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,8}$/;

export const isKitPath = (p: unknown): p is string => typeof p === "string" && p.length <= 200 && PATH.test(p);
/** A review file's name under media/ (#1243). */
const MEDIA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(mp4|m4a|mp3|jpg|png|json)$/;
export const isMediaName = (m: unknown): m is string => typeof m === "string" && MEDIA.test(m) && !m.includes("..");
/** The most one answer carries (the Functions host buffers answers): about ten seconds of a review cut. */
export const MEDIA_SLICE = 8 * 1024 * 1024;
const MEDIA_TYPE: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4", mp3: "audio/mpeg", jpg: "image/jpeg", png: "image/png", json: "application/json" };
export const mediaType = (m: string) => MEDIA_TYPE[m.slice(m.lastIndexOf(".") + 1)] ?? "application/octet-stream";

/** A Range header's one span ("bytes=a-b", "bytes=a-" or "bytes=-n") against a size, or null for none or one we don't serve. */
export function parseRange(h: string | null, size: number): { start: number; end: number } | null {
  const m = h ? /^bytes=(\d*)-(\d*)$/.exec(h.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return null;
  if (m[1] === "") { const n = Math.min(Number(m[2]), size); return n > 0 ? { start: size - n, end: size - 1 } : null; }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

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
  /** The passkey session check, for the review files (#1243). */
  desk?: DeskDeps;
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

/** GET /api/studio-kit?m=…: a review file for the signed-in Desk, in byte ranges when asked (Safari's player always asks). */
async function media(request: Request, deps: KitDeps, name: string): Promise<Response> {
  if (!deps.desk) return json({ error: "not-set-up" }, 503);
  const signed = await requireSession(request, deps.desk);
  // A review link tapped in a browser with the site cookie but no Desk session (the Claude app's own browser): the
  // passkey login page, which signs the Desk in too and comes back to the file. The player's fetches keep the JSON.
  if (!signed.ok) return reviewLinkOpened(request) ? locked(request) : signed.response;
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  const path = PREFIX + "media/" + name;
  const head = { "Content-Type": mediaType(name), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
  const want = request.headers.get("range");
  if (deps.blob.range) {
    const first = await deps.blob.range(path, 0, 0);
    if (!first) return json({ error: "gone" }, 404);
    await first.stream.cancel().catch(() => undefined);
    const size = first.size;
    const r = want ? parseRange(want, size) : null;
    if (want && !r) return withCookie(new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${size}` } }), signed);
    // The Functions host holds a whole answer in memory, so a long cut goes out a slice at a time: players ask again.
    const start = r?.start ?? 0;
    const end = Math.min(r?.end ?? size - 1, start + MEDIA_SLICE - 1);
    const partial = Boolean(r) || end < size - 1;
    const got = await deps.blob.range(path, start, end);
    if (!got) return json({ error: "gone" }, 404);
    const headers = { ...head, "Content-Length": String(got.end - got.start + 1), ...(partial ? { "Content-Range": `bytes ${got.start}-${got.end}/${size}` } : {}) };
    return withCookie(new Response(request.method === "HEAD" ? null : got.stream, { status: partial ? 206 : 200, headers }), signed);
  }
  const got = await deps.blob.get(path);
  if (!got) return json({ error: "gone" }, 404);
  return withCookie(new Response(got.stream, { headers: head }), signed);
}

export async function kitGet(request: Request, deps: KitDeps): Promise<Response> {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].join(",") === "m") {
    const m = url.searchParams.get("m");
    return isMediaName(m) ? media(request, deps, m) : json({ error: "bad-request" }, 400);
  }
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
  if (b.join !== undefined) return join(b, deps, url);
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

/** The feed key's join (#1243): out/<join>00 … out/<join>NN become media/<to>, one block each, on the server. */
async function join(b: Record<string, unknown>, deps: KitDeps, url: URL): Promise<Response> {
  const { join: prefix, count, to } = b;
  if (!isKitPath(prefix) || !prefix.startsWith("out/") || typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100 || !isMediaName(to)) return json({ error: "bad-request" }, 400);
  if (!deps.blob) return json({ error: "not-set-up" }, 503);
  if (!deps.blob.join) return json({ error: "not-supported" }, 501);
  const sources = Array.from({ length: count }, (_, i) => PREFIX + prefix + String(i).padStart(2, "0"));
  for (const s of sources) if (!(await deps.blob.etag(s))) return json({ error: "missing-part", part: s.slice(PREFIX.length) }, 404);
  const done = await deps.blob.join(PREFIX + "media/" + to, sources, mediaType(to));
  const origin = deps.origin ?? url.origin;
  return json({ ok: true, bytes: done.bytes, url: `${origin}${STUDIO_KIT_PATH}?m=${encodeURIComponent(to)}` });
}

const live = (request: Request): KitDeps => {
  const env = process.env;
  const now = Date.now();
  return { env, blob: pickBlob(env), now, origin: env.SITE_ORIGIN?.trim() || new URL(request.url).origin, desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now } };
};
export const GET = (request: Request) => kitGet(request, live(request));
export const PUT = (request: Request) => kitPut(request, live(request));
export const POST = (request: Request) => kitPost(request, live(request));
