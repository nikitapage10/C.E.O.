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
 *
 * The Petlibro and Whisker email and password are never written here: they live only in the Key Vault
 * (`petlibro-email`, `petlibro-password`, `whisker-email`, `whisker-password`) and reach the app as settings.
 * The device id hash is keyed from the same secret, so an id says nothing about the serial behind it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { createHmac, hkdfSync } from "node:crypto";
import type { BlobBackend } from "../../_blob.js";
import { seal, unseal } from "../../_email/seal.js";
import { readJson } from "../json.js";
import type { Vendor } from "./types.js";

/** The shortest HOME_TOKEN_KEY that counts (the paste in docs/HOME-DEVICES.md makes 43 characters). */
export const MIN_HOME_KEY = 32;

export type VaultName = Vendor | "roborock-pending";
export const vaultPath = (name: VaultName) => `haven/devices/${name}.json`;

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

  async forget(name: VaultName): Promise<void> {
    await this.blob.del(vaultPath(name)).catch(() => undefined);
  }
}
