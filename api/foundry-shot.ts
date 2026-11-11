/**
 * Screenshots of the page Nikita is looking at (#1027, api/_skippy/shots.ts). Private: kept only in the private store,
 * never on GitHub or behind a public link. A Foundry issue Skippy files about a glitch names the shot by its opaque id
 * ("shot-…"); the Builder reads it with its read key.
 *
 * POST  raw image body (image/jpeg, png or webp, at most 3 MB; its type is read from its bytes), passkey session only
 *       → { ok, id }. The Desk posts one only when Skippy asked to look at the screen (look_at_screen), never on every
 *       message.
 * GET   ?id=shot-<20 hex>   a passkey session, or the Builder read key (#800, `x-ceo-builder-key`) → the picture,
 *       private and never cached. 404 for an id that isn't there.
 *
 * Azure only, like every endpoint (azure/src/index.ts).
 */

import { pickBlob, type BlobBackend } from "./_blob.js";
import { requireSession, withCookie, type DeskDeps } from "./_desk/session.js";
import { pickAuthStore } from "./_desk/store.js";
import { builderReads } from "./_site/builderkey.js";
import { BlobShots, SHOT_ID, SHOT_MAX, shotType, type ShotStore } from "./_skippy/shots.js";

type Env = Record<string, string | undefined>;

export interface ShotDeps {
  desk: DeskDeps;
  shots: ShotStore | null;
  env: Env;
  log: (line: string) => void;
}

export function liveShotDeps(env: Env = process.env): ShotDeps {
  const blob: BlobBackend | null = pickBlob(env);
  return { desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() }, shots: blob ? new BlobShots(blob) : null, env, log: (line) => console.log(line) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}

/** GET ?id=: the picture, for a passkey session or the Builder read key. */
export async function shotGet(request: Request, deps: ShotDeps): Promise<Response> {
  const builder = builderReads(request, deps.env);
  const signed = builder ? null : await requireSession(request, deps.desk);
  if (signed && !signed.ok) return signed.response;
  const reply = (res: Response) => (signed && signed.ok ? withCookie(res, signed) : res);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!SHOT_ID.test(id)) return reply(json({ error: "bad-request" }, 400));
  if (!deps.shots) return reply(json({ error: "not-set-up" }, 503));
  const shot = await deps.shots.read(id).catch(() => null);
  if (!shot) return reply(json({ error: "not-found" }, 404));
  // Who read it, never what it shows.
  deps.log(`foundry-shot: read by ${builder ? "the Builder's key" : "a passkey session"}`);
  return reply(new Response(shot.bytes.buffer.slice(shot.bytes.byteOffset, shot.bytes.byteOffset + shot.bytes.byteLength) as ArrayBuffer, { status: 200, headers: { "Content-Type": shot.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${id}"` } }));
}

/** POST: one screenshot from the Desk's own capture, kept privately. */
export async function shotPost(request: Request, deps: ShotDeps): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > SHOT_MAX) return json({ error: "too-big" }, 413);
  if (!/^image\/(?:jpeg|png|webp)\b/.test(request.headers.get("content-type") ?? "")) return json({ error: "bad-request" }, 415);
  const signed = await requireSession(request, deps.desk);
  if (!signed.ok) return signed.response;
  const reply = (body: unknown, status = 200) => withCookie(json(body, status), signed);
  if (!deps.shots) return reply({ error: "not-set-up" }, 503);
  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length > SHOT_MAX) return reply({ error: "too-big" }, 413);
  const type = shotType(bytes);
  if (!type) return reply({ error: "bad-request" }, 415);
  try {
    const id = await deps.shots.save(bytes, type);
    deps.log(`foundry-shot: kept one (${Math.round(bytes.length / 1024)} kB)`);
    return reply({ ok: true, id });
  } catch {
    return reply({ error: "store" }, 503);
  }
}

export const GET = (request: Request) => shotGet(request, liveShotDeps());
export const POST = (request: Request) => shotPost(request, liveShotDeps());
