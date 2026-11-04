/**
 * The phones that may talk to Skippy (#627, docs/HEY-SKIPPY.md): each one holds a capture key, a random 32-byte token
 * shown once on the Desk when the phone is added, and sent by the iPhone's "Skippy" shortcut as
 * `Authorization: Bearer <key>` to POST /api/capture.
 *
 *   - Only a hash is kept: HMAC-SHA256 of the key under a pepper derived from FOUNDRY_DESK_KEY (`deskKeyFor(…, "phone")`,
 *     api/_desk/keys.ts: scrypt-stretched, then split by purpose, so it is no new secret and never the Desk key
 *     itself). A copy of the store alone can't be turned back into a key, or checked against a guess, without the
 *     Desk key from the Key Vault.
 *   - Each phone keeps a label, when it was added, when it was last used and, once revoked, when. A revoked key opens
 *     nothing. Changing the Desk key in the vault revokes every phone at once (their hashes no longer match).
 *   - Each key is paced: at most PHONE_RATE.max captures an hour (a sliding window of times, kept with the phone).
 *   - The file is `haven/phones.json` in the private blob store. It never holds a key or anything dictated.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { readJson, updateJson } from "./json.js";
import { KEY_PREFIX, KEY_SHAPE } from "./links.js";

export const PHONES_PATH = "haven/phones.json";
/** Captures per key: at most 30 in any hour. */
export const PHONE_RATE = { max: 30, ms: 60 * 60_000 } as const;
/** The most phones that can hold a live key at once. */
export const MAX_PHONES = 5;
/** A phone's label: plain, short. */
export const LABEL_MAX = 40;
export { KEY_PREFIX, KEY_SHAPE } from "./links.js";

export interface Phone {
  id: string;
  label: string;
  /** HMAC-SHA256 of the key under the phone pepper, hex. Never sent to the Desk. */
  hash: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
  /** The times (ms) of the last hour's captures, for the pace. */
  hits: number[];
}

/** What the Desk is shown: never the hash or the key. */
export interface PhoneView {
  id: string;
  label: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
}

export const viewOf = (p: Phone): PhoneView => ({ id: p.id, label: p.label, created: p.created, lastUsed: p.lastUsed, revoked: p.revoked });

/** The hash a key is kept as. */
export const keyHash = (pepper: Buffer, key: string) => createHmac("sha256", pepper).update(`phone:${key}`).digest("hex");

/** A fresh key: the prefix and 32 random bytes. */
export const mintKey = () => `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;

/** A label from anywhere: one plain line, capped; "iPhone" when empty. */
export function cleanLabel(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX) : "";
  return s || "iPhone";
}

const isPhone = (v: unknown): v is Phone => {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return typeof p.id === "string" && typeof p.hash === "string" && /^[0-9a-f]{64}$/.test(p.hash) && typeof p.label === "string" && typeof p.created === "string";
};

/** The stored list, checked. */
export function cleanPhones(raw: unknown): Phone[] {
  return (Array.isArray(raw) ? raw : []).filter(isPhone).map((p) => ({
    id: p.id,
    label: cleanLabel(p.label),
    hash: p.hash,
    created: p.created,
    lastUsed: typeof p.lastUsed === "string" ? p.lastUsed : null,
    revoked: typeof p.revoked === "string" ? p.revoked : null,
    hits: Array.isArray(p.hits) ? p.hits.filter((h): h is number => typeof h === "number" && Number.isFinite(h)) : [],
  }));
}

/** Two hashes compared in constant time. */
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** What checking a key came to. */
export type KeyCheck = { ok: true; phone: PhoneView } | { ok: false; why: "bad" | "slow"; wait?: number };

/**
 * The phones, in the private store. `pepper` is the phone key from `deskKeyFor(deskKey, "phone")`.
 */
export class PhoneKeys {
  constructor(
    private readonly blob: BlobBackend,
    private readonly pepper: Buffer,
  ) {}

  async list(): Promise<PhoneView[]> {
    return cleanPhones(await readJson(this.blob, PHONES_PATH, [])).map(viewOf);
  }

  /** Adds a phone: the key comes back once, here, and only its hash is kept. Null when MAX_PHONES are live. */
  async add(label: unknown, now: number): Promise<{ phone: PhoneView; key: string } | null> {
    const key = mintKey();
    const phone: Phone = { id: randomBytes(6).toString("hex"), label: cleanLabel(label), hash: keyHash(this.pepper, key), created: new Date(now).toISOString(), lastUsed: null, revoked: null, hits: [] };
    return updateJson(this.blob, PHONES_PATH, [] as unknown, (raw) => {
      const cur = cleanPhones(raw);
      if (cur.filter((p) => !p.revoked).length >= MAX_PHONES) return { next: null, result: null };
      // Revoked phones are kept for the record, the last ten.
      const revoked = cur.filter((p) => p.revoked).slice(-10);
      return { next: [...cur.filter((p) => !p.revoked), ...revoked, phone], result: { phone: viewOf(phone), key } };
    });
  }

  /** Revokes a phone: its key opens nothing from now on. False when there is no such live phone. */
  async revoke(id: unknown, now: number): Promise<boolean> {
    if (typeof id !== "string") return false;
    return updateJson(this.blob, PHONES_PATH, [] as unknown, (raw) => {
      const cur = cleanPhones(raw);
      const found = cur.find((p) => p.id === id && !p.revoked);
      if (!found) return { next: null, result: false };
      return { next: cur.map((p) => (p === found ? { ...p, revoked: new Date(now).toISOString(), hits: [] } : p)), result: true };
    });
  }

  /**
   * Checks a key from an Authorization header and, when it is good, counts the capture against its pace and marks it
   * used. A key of the wrong shape is refused before the store is read.
   */
  async use(key: string | null, now: number): Promise<KeyCheck> {
    if (!key || !KEY_SHAPE.test(key)) return { ok: false, why: "bad" };
    const want = keyHash(this.pepper, key);
    return updateJson(this.blob, PHONES_PATH, [] as unknown, (raw): { next: Phone[] | null; result: KeyCheck } => {
      const cur = cleanPhones(raw);
      // Every live phone is compared, so the time taken doesn't say which one (or whether any) matched.
      let found: Phone | null = null;
      for (const p of cur) if (sameHash(p.hash, want) && !p.revoked) found = p;
      if (!found) return { next: null, result: { ok: false, why: "bad" } };
      const hits = found.hits.filter((h) => h > now - PHONE_RATE.ms);
      if (hits.length >= PHONE_RATE.max) return { next: null, result: { ok: false, why: "slow", wait: Math.max(1, Math.ceil((hits[0]! + PHONE_RATE.ms - now) / 1000)) } };
      const used: Phone = { ...found, lastUsed: new Date(now).toISOString(), hits: [...hits, now] };
      return { next: cur.map((p) => (p === found ? used : p)), result: { ok: true, phone: viewOf(used) } };
    });
  }
}
