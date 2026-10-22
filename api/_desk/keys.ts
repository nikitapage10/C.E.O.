/**
 * The Desk's signing keys, all derived from the one secret Nikita already set in Vercel (`FOUNDRY_DESK_KEY`), so the
 * sign-in (#132, docs/THREAT-MODEL.md, R3) needs no new variable.
 *
 * The Desk key may be a passphrase a person typed, not a long random string, so it never signs anything directly:
 * it is stretched once per function instance with scrypt (about 32 MB and a tenth of a second), and each use gets
 * its own key from that, by HMAC with a purpose label. Anyone holding a session cookie or a picture link would have
 * to pay scrypt's cost for every guess to work back towards the Desk key, and a key for one purpose can't sign for
 * another. Changing the Desk key in Vercel changes every key here: every session ends, every picture link stops
 * working and enrolling a device needs the new key, while the passkeys already enrolled stay.
 *
 * Server only (node:crypto). Underscore folder: Vercel never serves it as a function.
 */

import { createHash, createHmac, scrypt, timingSafeEqual } from "node:crypto";

/**
 * "site": the site password's session cookies (api/_site/keys.ts, #236), when SITE_SESSION_SECRET isn't set.
 * "gmail": the Connect Gmail state cookie (api/_email/route.ts, #263).
 */
export type KeyPurpose = "session" | "challenge" | "picture" | "client" | "site" | "gmail";

const SALT = "ceo.desk.v1";
/** scrypt's cost: N = 2^15, r = 8, p = 1 (32 MB, roughly 0.1 s on a function), the usual interactive setting. */
const COST = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** The stretched secret per Desk key, kept for the life of the instance (by the key's hash, never the key). */
const stretched = new Map<string, Promise<Buffer>>();

function master(deskKey: string): Promise<Buffer> {
  const id = createHash("sha256").update(deskKey).digest("hex");
  let found = stretched.get(id);
  if (!found) {
    found = new Promise<Buffer>((resolve, reject) => scrypt(deskKey, SALT, 32, COST, (err, key) => (err ? reject(err) : resolve(key))));
    found.catch(() => stretched.delete(id));
    if (stretched.size > 3) stretched.clear();
    stretched.set(id, found);
  }
  return found;
}

/** The key for one purpose, derived from the Desk key. Throws when there is no Desk key: nothing signs without one. */
export async function deskKeyFor(deskKey: string, purpose: KeyPurpose): Promise<Buffer> {
  if (!deskKey) throw new Error("FOUNDRY_DESK_KEY is not set");
  return createHmac("sha256", await master(deskKey)).update(`ceo.desk.${purpose}`).digest();
}

/** The secret the idea pictures' short-lived links are signed with (api/_pictures.ts takes it as a string). */
export async function pictureSecret(deskKey: string): Promise<string> {
  return deskKey ? (await deskKeyFor(deskKey, "picture")).toString("hex") : "";
}

/** Whether a typed key is the Desk key, compared in constant time. Only enrolling a new device asks for it. */
export function keyMatches(given: unknown, deskKey: string): boolean {
  if (typeof given !== "string" || !deskKey) return false;
  // Both sides hashed first, so the comparison takes the same time whatever their lengths.
  const a = createHash("sha256").update(deskKey).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}
