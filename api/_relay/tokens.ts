/**
 * Relay's texts line (#535, docs/RELAY-PRIVACY.md, "Pairing"): the three short secrets that join the Mac hub to the
 * site, all derived from the Desk key, so pairing adds no new secret to the Key Vault.
 *
 *   pair code    8 characters ("K7QF-M2XP"), shown once on the signed-in Desk's Relay page, good for 10 minutes and
 *                5 tries. The installer on the Mac asks for it and trades it (POST /api/relay-pair) for the two below.
 *                The site keeps only its hash.
 *   hub token    `rh1.<pairId>.<mac>`: the bearer on every hub call to /api/relay-hub (its status, its list, its model
 *                snippets, its poll for requests and their results, the skip terms). Signed by a key derived from the
 *                Desk key, so the site gate can check it with the environment
 *                alone; the route then checks its hash against the one pairing on record, so "Unpair" ends it at once.
 *                The hub keeps it in the Mac's login Keychain; the site keeps its SHA-256 only.
 *   send key     handed to the hub once, at pairing, and kept in its Keychain. Every request the signed-in Desk writes
 *                for the hub (send, later, done, restyle) is signed with it (`signRequest`), so the hub acts only on
 *                requests the site made, unchanged, within their 10 minutes.
 *
 * Pure node:crypto, so the hub bundle (apps/hub) imports the same code to check requests. Underscore folder: never
 * served as a function.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const HUB_PREFIX = "rh1";
/** A pair code lives this long, and allows this many wrong tries before it is dropped. */
export const PAIR_CODE_MS = 10 * 60_000;
export const PAIR_TRIES = 5;
/** A Desk request (send, later, done, restyle) lives this long; a send not taken by then is "not sent, Mac was offline". */
export const REQUEST_MS = 10 * 60_000;
/** One fresh passkey check unlocks sending on that device for this long (Nikita, 2026-10-28: 72 hours). */
export const UNLOCK_MS = 72 * 60 * 60_000;

/** 32 characters with no 0/O or 1/I look-alikes: 8 of them are 40 bits. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const B64 = /^[A-Za-z0-9_-]+$/;

const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The key hub tokens are signed with, from the Desk key (16 characters at least), or null. */
export function hubKey(deskKey: string): Buffer | null {
  const k = deskKey.trim();
  return k.length >= 16 ? createHmac("sha256", k).update("ceo-relay-hub-v1").digest() : null;
}

/** A fresh pairing: its id, the hub's token and the send key (base64url). Null without a Desk key. */
export function mintPairing(deskKey: string): { pairId: string; token: string; sendKey: string } | null {
  const key = hubKey(deskKey);
  if (!key) return null;
  const pairId = randomBytes(12).toString("base64url");
  const body = `${HUB_PREFIX}.${pairId}`;
  return { pairId, token: `${body}.${mac(key, body)}`, sendKey: sendKeyFor(key, pairId).toString("base64url") };
}

/** The send key of one pairing. */
export function sendKeyFor(key: Buffer, pairId: string): Buffer {
  return createHmac("sha256", key).update(`send:${pairId}`).digest();
}

/** The pairing id of a hub token this Desk key signed, or null. The gate's sync check. */
export function hubTokenPair(token: string | null | undefined, deskKey: string): string | null {
  if (!token || token.length > 160) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== HUB_PREFIX || !B64.test(parts[1]!) || !B64.test(parts[2]!)) return null;
  const key = hubKey(deskKey);
  if (!key) return null;
  return same(mac(key, `${parts[0]}.${parts[1]}`), parts[2]!) ? parts[1]! : null;
}

/** The bearer token of a request, or null. */
export function bearer(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

/**
 * What a Desk request carries to the hub, signed with the pairing's send key: the request id, its kind, the thread,
 * the draft it was made from, the hash of its text and when it ends. The hub checks the signature before it acts, so a
 * request changed in the store (or made anywhere but the signed-in Desk) is refused.
 */
export interface SignedFields {
  rid: string;
  kind: string;
  thread: string;
  draftAt: number;
  text: string;
  until: number;
  /** A compose's who (#536): signed too, so a request can't be pointed at someone else in the store. */
  who?: string;
}

const requestBody = (f: SignedFields) => [`rq1`, f.rid, f.kind, f.thread, String(Math.floor(f.draftAt)), sha256(f.text), String(Math.floor(f.until)), ...(f.who === undefined ? [] : [sha256(f.who)])].join("|");

export function signRequest(sendKey: Buffer, f: SignedFields): string {
  return mac(sendKey, requestBody(f));
}

/** Whether `sig` is the send key's signature over exactly these fields. */
export function requestSigned(sendKey: Buffer, f: SignedFields, sig: unknown): boolean {
  return typeof sig === "string" && B64.test(sig) && same(mac(sendKey, requestBody(f)), sig);
}

/** A fresh pair code, 8 characters from CODE_ALPHABET. */
export function mintPairCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** A typed code as stored: upper case, spaces and dashes dropped. Null unless 8 characters of the alphabet. */
export function normalCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length === 8 && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}

/** How the Desk shows a code: two groups of four. */
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
