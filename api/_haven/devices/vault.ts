/**
 * The home devices' logins at rest (#632, docs/HOME-DEVICES.md, "Where the logins live"). Same pattern as the Gmail
 * token (api/_email/seal.ts): AES-256-GCM with a key derived (HKDF-SHA256) from HOME_TOKEN_KEY, a Key Vault secret
 * (`home-token-key`), so the private `ceo-state` container and its nightly backup hold nothing readable.
 *
 *   haven/devices/roborock.json          the Roborock account's rriot credentials and token (from Connect Roborock),
 *                                        with its cached home data (device list, local keys, room names)
 *   haven/devices/roborock-pending.json  a Connect Roborock in progress: the email, region and client id, 10 minutes
 *   haven/devices/whisker.json           the Whisker Cognito tokens (refreshed from the stored refresh token)
 *   haven/devices/petlibro.json          the Petlibro login token
 *   haven/devices/petlibro.lease.json    which instance is signing in to Petlibro right now (a time only, #683)
 *   haven/devices/google-nest.json       the Google refresh token for the Nest thermostat (Connect Nest, #637)
 *   haven/devices/google-tasks.json      the Google refresh token for Google Tasks (Connect Google Tasks, #637)
 *   haven/devices/kroger.json            the Kroger refresh token for the King Soopers cart (Connect King Soopers, #664)
 *
 * The Petlibro and Whisker emails and login digests are never written here: they live only in the Key Vault
 * (`petlibro-email`, `petlibro-login-digest`, `whisker-email`, `whisker-srp-digest`) and reach the app as settings.
 * The device id hash is keyed from the same secret, so an id says nothing about the serial behind it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, hkdfSync } from "node:crypto";
import { BlobPreconditionError, type BlobBackend } from "../../_blob.js";
import { seal, unseal } from "../../_email/seal.js";
import { readJson } from "../json.js";
import type { Vendor } from "./types.js";

/** The shortest HOME_TOKEN_KEY that counts (the paste in docs/HOME-DEVICES.md makes 43 characters). */
export const MIN_HOME_KEY = 32;

/** Each vendor's login, Connect Roborock's pending code, the Haven's two Google grants (#637) and the King Soopers cart grant (#664). */
export type VaultName = Vendor | "roborock-pending" | "google-nest" | "google-tasks" | "kroger";
export const vaultPath = (name: VaultName) => `haven/devices/${name}.json`;
/** A short lease beside a login (#683): it holds only when it runs out, nothing sealed or secret. */
export const leasePath = (name: VaultName) => `haven/devices/${name}.lease.json`;

/** The sealing key, or null when HOME_TOKEN_KEY isn't set (or is too short to trust). */
export function homeKey(secret: string | undefined, purpose: "seal" | "id"): Buffer | null {
  const s = (secret ?? "").trim();
  if (s.length < MIN_HOME_KEY) return null;
  return Buffer.from(hkdfSync("sha256", s, "ceo.home.v1", `ceo.home.${purpose}`, 32));
}

/** A device's opaque id: 12 hex characters of a keyed hash of its vendor and serial. */
export function deviceId(idKey: Buffer, vendor: Vendor, serial: string): string {
  return createHmac("sha256", idKey).update(`${vendor}\n${serial}`).digest("hex").slice(0, 12);
}

/** The sealed store of logins. */
export class HomeVault {
  constructor(
    private readonly blob: BlobBackend,
    private readonly key: Buffer,
  ) {}

  async read<T>(name: VaultName): Promise<T | null> {
    const sealed = await readJson<unknown>(this.blob, vaultPath(name), null);
    return sealed ? (unseal(this.key, sealed) as T | null) : null;
  }

  async write(name: VaultName, value: unknown): Promise<void> {
    await this.blob.put(vaultPath(name), JSON.stringify(seal(this.key, value)), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  }

  /**
   * Takes the login's lease for `ms` unless another instance holds one that hasn't run out (#683), so only one
   * instance at a time signs in to a vendor that keeps one session per account. Create-if-absent, or a write over a
   * lapsed lease at the ETag read, so two instances never both take it.
   */
  async lease(name: VaultName, ms: number, now: number): Promise<boolean> {
    const path = leasePath(name);
    const etag = await this.blob.etag(path);
    if (etag && Number((await readJson<{ until?: unknown }>(this.blob, path, {})).until) > now) return false;
    try {
      await this.blob.put(path, JSON.stringify({ until: now + ms }), { contentType: "application/json", addRandomSuffix: false, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionError) return false;
      throw e;
    }
  }

  /** Lets the lease go once the sign-in is over, done or refused. */
  async release(name: VaultName): Promise<void> {
    await this.blob.del(leasePath(name)).catch(() => undefined);
  }

  async forget(name: VaultName): Promise<void> {
    await this.blob.del(vaultPath(name)).catch(() => undefined);
  }
}
