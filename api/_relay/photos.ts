/**
 * Contact photos from the Mac (#642, docs/RELAY-PRIVACY.md, "Contact photos: the one exception"). The only thing of
 * Nikita's contacts that ever leaves the Mac besides a name: a small picture, with nothing that says whose it is.
 *
 *   on the Mac   the hub reads a contact's picture from BlueBubbles' contact data, shrinks it to PHOTO_PX, re-encodes it
 *                as PNG and keeps only the image itself (`cleanPng`: no EXIF, no text chunks, no colour profile), and
 *                names it by an opaque id: an HMAC of the contact's normalised handle under a key made from the hub's
 *                own local key, which never leaves the Mac. The site can't turn an id back into a number.
 *   email match  so an email sender found in Mac Contacts shows its photo too, the hub also sends a map from
 *                `emailPhotoHash` (an HMAC of the address under `photoEmailKey`, which the site derives from its Key
 *                Vault secret and hands only to the paired hub) to photo ids. The tick hashes each sender's address
 *                the same way, so the site matches without the hub ever sending an address. Phone numbers never get
 *                a site-side key: a short number space could be guessed through one.
 *   on the site  each photo sealed in the private store, one blob per id, and an index (ids and the email map), all
 *                read only by the passkey Desk. Unpair and the wipe delete them all.
 *
 * Pure but for node:crypto. Underscore folder: never served as a function.
 */

import { createHmac, hkdfSync } from "node:crypto";

/** The longest side of a photo, in pixels. */
export const PHOTO_PX = 96;
/** The most one photo may be, after cleaning (bytes). */
export const PHOTO_MAX_BYTES = 40 * 1024;
/** The most photos one pairing keeps, and email map entries. */
export const MAX_PHOTOS = 2_000;
export const MAX_EMAIL_MAP = 4_000;
/** A photo id or an email hash: 32 lowercase hex. */
export const PHOTO_ID = /^[0-9a-f]{32}$/;

const MIN_SECRET = 32;

/** The key email addresses are hashed under for the photo match, from GMAIL_TOKEN_KEY with its own label; null without one. */
export function photoEmailKey(secret: string | undefined): Buffer | null {
  const s = (secret ?? "").trim();
  if (s.length < MIN_SECRET) return null;
  return Buffer.from(hkdfSync("sha256", s, "ceo.relay.v1", "ceo.relay.photo-email", 32));
}

/** An email address's hash for the photo match: lower-cased and trimmed first, 32 hex. "" for no address. */
export function emailPhotoHash(key: Buffer, address: string): string {
  const a = address.trim().toLowerCase();
  if (!a.includes("@")) return "";
  return createHmac("sha256", key).update(`email:${a}`).digest("hex").slice(0, 32);
}

/** A handle as the hub names photos by it: an address lower-cased, a number by its last 10 digits. */
export function normalHandle(h: string): string {
  const t = h.trim().toLowerCase();
  if (t.includes("@")) return t;
  return t.replace(/\D/g, "").slice(-10);
}

/** The Mac's photo key, from the hub's local key (Keychain), which the site never sees. */
export function macPhotoKey(localKey: string): Buffer {
  return Buffer.from(hkdfSync("sha256", localKey, "ceo.relay.v1", "ceo.relay.photo-id", 32));
}

/** A contact's photo id: the HMAC of its first handle (sorted, normalised) under the Mac's key. "" with no handle. */
export function photoIdOf(key: Buffer, handles: readonly string[]): string {
  const first = handles.map(normalHandle).filter((h) => h.length >= 5).sort()[0];
  return first ? createHmac("sha256", key).update(`handle:${first}`).digest("hex").slice(0, 32) : "";
}

/* ── PNG, cleaned ── */

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The only chunks a cleaned PNG keeps: the image itself. Text, time, EXIF, colour profiles and the rest are dropped. */
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

/**
 * A PNG with every ancillary chunk taken out, or null when it isn't a small, well-formed PNG (a bad signature, IHDR not
 * first, a chunk running past the end, no IEND, larger than PHOTO_PX * 1.5 on a side, or over PHOTO_MAX_BYTES after).
 */
export function cleanPng(input: Uint8Array): Uint8Array | null {
  if (input.length < 8 + 25 + 12 || input.length > 2 * 1024 * 1024) return null;
  for (let i = 0; i < 8; i++) if (input[i] !== SIG[i]) return null;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const parts: Uint8Array[] = [input.subarray(0, 8)];
  let at = 8;
  let first = true;
  let ended = false;
  let size = 8;
  while (at + 12 <= input.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(input[at + 4]!, input[at + 5]!, input[at + 6]!, input[at + 7]!);
    const end = at + 12 + len;
    if (len > input.length || end > input.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (first) {
      if (type !== "IHDR" || len !== 13) return null;
      const w = view.getUint32(at + 8);
      const h = view.getUint32(at + 12);
      if (!w || !h || w > PHOTO_PX * 1.5 || h > PHOTO_PX * 1.5) return null;
      first = false;
    }
    if (KEEP.has(type)) {
      parts.push(input.subarray(at, end));
      size += end - at;
    }
    at = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || size > PHOTO_MAX_BYTES) return null;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ── the index the site keeps ── */

export interface PhotoIndex {
  /** The photo ids this pairing has, each with when it was last sent. */
  ids: Record<string, number>;
  /** emailPhotoHash → photo id. */
  emails: Record<string, string>;
  at: number;
}

export const emptyPhotoIndex = (): PhotoIndex => ({ ids: {}, emails: {}, at: 0 });

/** The index read back, every key and value checked; anything odd dropped. */
export function readPhotoIndex(v: unknown): PhotoIndex {
  const o = v as Record<string, unknown> | null;
  const out = emptyPhotoIndex();
  if (!o || typeof o !== "object") return out;
  const ids = o.ids && typeof o.ids === "object" ? (o.ids as Record<string, unknown>) : {};
  for (const [k, t] of Object.entries(ids).slice(0, MAX_PHOTOS)) if (PHOTO_ID.test(k) && typeof t === "number") out.ids[k] = t;
  const emails = o.emails && typeof o.emails === "object" ? (o.emails as Record<string, unknown>) : {};
  for (const [k, p] of Object.entries(emails).slice(0, MAX_EMAIL_MAP)) if (PHOTO_ID.test(k) && typeof p === "string" && out.ids[p] !== undefined) out.emails[k] = p;
  out.at = typeof o.at === "number" ? o.at : 0;
  return out;
}

/** What the hub sends with its photos: the ids it has now and the email map. Checked whole; null when off the shape. */
export function readPhotoList(v: unknown): { keep: string[]; emails: [string, string][] } | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "keep" && k !== "emails")) return null;
  if (!Array.isArray(o.keep) || o.keep.length > MAX_PHOTOS || !o.keep.every((k) => typeof k === "string" && PHOTO_ID.test(k))) return null;
  if (!Array.isArray(o.emails) || o.emails.length > MAX_EMAIL_MAP) return null;
  const emails: [string, string][] = [];
  for (const e of o.emails) {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string" || typeof e[1] !== "string" || !PHOTO_ID.test(e[0]) || !PHOTO_ID.test(e[1])) return null;
    emails.push([e[0], e[1]]);
  }
  return { keep: [...new Set(o.keep as string[])], emails };
}
