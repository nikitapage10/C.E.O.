/**
 * Sealing the email agent's blobs at rest (#263, docs/GMAIL.md, "Where the token lives"): AES-256-GCM with a key
 * derived (HKDF-SHA256) from the GMAIL_TOKEN_KEY app setting, a Key Vault reference on Azure. The refresh token and
 * the private state (subjects, senders, summaries, drafts) are written to the private `ceo-state` container only in
 * this form, so a copy of the container (the nightly backup included) holds nothing readable without the vault.
 *
 * Why not Key Vault itself for the token: the Function App's identity reads secrets (Key Vault Secrets User) and may
 * write only the Keys form's twelve third-party secrets, each by its own role (#330, docs/AZURE.md); writing the token
 * would need Secrets Officer on one more secret, refreshed from a background job with no passkey. A sealed blob keeps
 * the identity read-only on everything else in the vault.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** The shortest GMAIL_TOKEN_KEY that counts (the paste in docs/GMAIL.md makes 43 characters). */
export const MIN_TOKEN_KEY = 32;

export interface Sealed {
  v: 1;
  /** base64url: the 12-byte nonce, the ciphertext and the 16-byte tag. */
  iv: string;
  data: string;
  tag: string;
}

/** The sealing key for one purpose, or null when GMAIL_TOKEN_KEY isn't set (or is too short to trust). */
export function sealKey(secret: string | undefined, purpose: "token" | "state"): Buffer | null {
  const s = (secret ?? "").trim();
  if (s.length < MIN_TOKEN_KEY) return null;
  return Buffer.from(hkdfSync("sha256", s, "ceo.email.v1", `ceo.email.${purpose}`, 32));
}

export function seal(key: Buffer, value: unknown): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64url"), data: data.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

/** The value, or null when it isn't ours, was changed, or the key is wrong. Never throws. */
export function unseal(key: Buffer, sealed: unknown): unknown {
  const s = sealed as Partial<Sealed> | null;
  if (!s || s.v !== 1 || typeof s.iv !== "string" || typeof s.data !== "string" || typeof s.tag !== "string") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(s.tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(s.data, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
