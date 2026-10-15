/**
 * Idea pictures as short-lived private links (#127, docs/THREAT-MODEL.md, R4). The pictures live in the project's
 * private Vercel Blob store and only ever come back through the Desk's own picture function (api/foundry-image.ts),
 * and only on a link signed for a few minutes: an HMAC of the picture's name and an expiry time, keyed with a secret
 * derived from the Desk key (`pictureSecret` in api/_desk/keys.ts). Only the server signs (#132): the picture
 * function signs the Desk's own links for a signed-in Desk, api/foundry.ts signs one for Rivet's shaping call, and an
 * unsigned or expired link gets nothing, so a picture in a public issue can't be opened by anyone.
 *
 * Shared by the function and the Desk, so it uses only Web Crypto (Node 20+ and every browser), never `node:` APIs.
 * Underscore file: Vercel never serves it as a function.
 */

/** The Desk's own picture function. */
export const PICTURE_ROUTE = "/api/foundry-image";
/** Where idea pictures live in the store. */
export const PICTURE_PATH = /^foundry\/ideas\/[\w.-]+$/;
/** The longest a signed link may live, in seconds: anything signed further ahead is refused. */
export const LINK_MAX_S = 30 * 60;
/** At most this many pictures on an idea. */
export const MAX_PICTURES = 4;

/** How far ahead the Desk's links are signed: to the end of the next ten-minute window, so a link stays put. */
const WINDOW_S = 600;

/** The expiry the Desk's links are signed with at `now` (ms): 10 to 20 minutes ahead, the same for a whole window. */
export const linkUntil = (now: number) => (Math.floor(now / 1000 / WINDOW_S) + 2) * WINDOW_S;

/** The window a time (ms) falls in: the Desk asks for fresh links when it changes. */
export const linkWindow = (now: number) => Math.floor(now / 1000 / WINDOW_S);

const enc = new TextEncoder();

async function hmacKey(secret: string, use: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);
}

const message = (path: string, until: number) => enc.encode(`foundry-image\n${path}\n${until}`);
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The signature for one picture until `until` (seconds since the epoch), as hex. */
export async function signPicture(secret: string, path: string, until: number): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), message(path, until)));
}

/**
 * Whether a link's signature is good for this picture and still in date (`now` in ms). Compared by Web Crypto's own
 * verify, in constant time; a link signed more than LINK_MAX_S ahead is refused, so no link lives long.
 */
export async function verifyPicture(secret: string, path: string, until: number, sig: string, now: number): Promise<boolean> {
  if (!secret || !PICTURE_PATH.test(path) || !Number.isSafeInteger(until) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const left = until - Math.floor(now / 1000);
  if (left <= 0 || left > LINK_MAX_S) return false;
  const bytes = new Uint8Array(sig.match(/../g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), bytes, message(path, until));
}

/** A signed link to a picture, relative to the site, so it can only ever point at the Desk's own function. */
export function pictureLink(path: string, until: number, sig: string): string {
  return `${PICTURE_ROUTE}?p=${encodeURIComponent(path)}&u=${until}&s=${sig}`;
}

/**
 * The store name of a picture link the Desk's own function handed out ("…/api/foundry-image?p=foundry%2Fideas%2Fa.jpg"
 * → "foundry/ideas/a.jpg"), or null for anything else. The host is never kept: whatever a link says, the picture is
 * fetched from this site's own function.
 */
export function pictureRef(link: string): string | null {
  const m = /\/api\/foundry-image\?p=([\w.%/-]+)/i.exec(link);
  const path = m ? m[1]!.replace(/%2F/gi, "/") : PICTURE_PATH.test(link) ? link : "";
  return PICTURE_PATH.test(path) ? path : null;
}

/** The line an idea's issue carries for its pictures: how many, and their names in the private store, never a link. */
export function picturesLine(paths: string[]): string {
  if (!paths.length) return "";
  return `**Pictures:** ${paths.length}, kept private and shown only on the Desk (${paths.join(", ")})`;
}

/**
 * The pictures an issue body names, as store names: from its `**Pictures:**` line, and from picture links the Desk
 * used to write (`![Picture 1](…/api/foundry-image?p=…)`). Pictures from any other host are dropped, so the Desk shows
 * only Nikita's own.
 */
export function ownPictures(body: string): string[] {
  const found: string[] = [];
  for (const m of body.matchAll(/\/api\/foundry-image\?p=[\w.%/-]+/gi)) {
    const ref = pictureRef(m[0]);
    if (ref) found.push(ref);
  }
  const line = /^\*\*Pictures:\*\*[^\n]*$/m.exec(body)?.[0] ?? "";
  for (const m of line.matchAll(/foundry\/ideas\/[\w.-]+/g)) if (PICTURE_PATH.test(m[0])) found.push(m[0]);
  return [...new Set(found)].slice(0, MAX_PICTURES);
}
