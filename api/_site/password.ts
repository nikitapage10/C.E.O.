/**
 * The site password's hash (#236, docs/SECURITY.md, "The site password"). Only a salted, slow hash is ever kept:
 * PBKDF2 with SHA-256, 600,000 iterations (OWASP's 2023 floor for PBKDF2-SHA256), a 16-byte random salt and a 32-byte
 * result, written as one string:
 *
 *   pbkdf2-sha256$600000$<salt, base64url>$<hash, base64url>
 *
 * The same string is what SITE_PASSWORD_HASH takes, so a hash made in a browser console (WebCrypto has PBKDF2) works
 * too. Checking compares the derived bytes in constant time, and a hash written with fewer iterations than the floor
 * is refused, so a weak hash can't be slipped in through the variable.
 *
 * Server only (node:crypto). Underscore folder: Vercel never serves it as a function.
 */

import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";

export const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** The fewest characters a new site password may have, and the most (a bound on the hashing work per try). */
export const MIN_LENGTH = 10;
export const MAX_LENGTH = 256;

const PREFIX = "pbkdf2-sha256";

export interface ParsedHash {
  iterations: number;
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer, iterations: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(password.normalize("NFC"), salt, iterations, length, "sha256", (err, key) => (err ? reject(err) : resolve(key))));
}

/** The stored form of a new password, with a fresh salt. */
export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, iterations, HASH_BYTES);
  return `${PREFIX}$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** A stored hash's parts, or null when it isn't one this file wrote (or is weaker than the floor). */
export function parseHash(stored: unknown): ParsedHash | null {
  if (typeof stored !== "string" || stored.length > 300) return null;
  const parts = stored.trim().split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX || !/^\d{6,8}$/.test(parts[1]!)) return null;
  const iterations = Number(parts[1]);
  if (iterations < ITERATIONS || iterations > 10_000_000) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2]!) || !/^[A-Za-z0-9_-]+$/.test(parts[3]!)) return null;
  const salt = Buffer.from(parts[2]!, "base64url");
  const hash = Buffer.from(parts[3]!, "base64url");
  if (salt.length < 16 || hash.length < 32) return null;
  return { iterations, salt, hash };
}

/** Whether a typed password matches a stored hash. Compared in constant time; anything malformed is a no. */
export async function verifyPassword(given: unknown, stored: unknown): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || typeof given !== "string" || given.length === 0 || given.length > MAX_LENGTH) return false;
  const got = await derive(given, parsed.salt, parsed.iterations, parsed.hash.length);
  return got.length === parsed.hash.length && timingSafeEqual(got, parsed.hash);
}

/** Why a new password is refused, or null when it will do. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "missing";
  if ([...password].length < MIN_LENGTH) return "too-short";
  if (password.length > MAX_LENGTH) return "too-long";
  if (!password.trim()) return "blank";
  return null;
}
