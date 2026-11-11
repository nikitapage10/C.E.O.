/**
 * Screenshots of the page Nikita is looking at (#1027), for Skippy's look_at_screen and the Foundry issues he files
 * about a glitch. The Desk captures the page in the browser (no prompt; @ceo/engine/web/screenshot.ts) only when
 * Skippy asks for it, and posts it to /api/foundry-shot in its passkey session. It is kept here, in the private store
 * (`desk/skippy/shots/<id>.<ext>`, the `ceo-state` container on Azure), and nowhere else: never GitHub, never a public
 * link. A Foundry issue carries only the opaque id; a passkey session or the Builder read key (#800) reads it back.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";

/** A screenshot's opaque id: random, and says nothing about the picture. */
export const SHOT_ID = /^shot-[0-9a-f]{20}$/;
/** The largest screenshot kept (the browser sends a JPEG of about 200–600 kB). */
export const SHOT_MAX = 3 * 1024 * 1024;

export type ShotType = "image/jpeg" | "image/png" | "image/webp";
const EXT: Record<ShotType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The picture's type from its first bytes, never from what the request claimed; null when it isn't one of ours. */
export function shotType(b: Uint8Array): ShotType | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const newShotId = (): string => `shot-${randomBytes(10).toString("hex")}`;

async function bytesOf(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface Shot {
  bytes: Uint8Array;
  type: ShotType;
}

export interface ShotStore {
  save(bytes: Uint8Array, type: ShotType): Promise<string>;
  read(id: string): Promise<Shot | null>;
}

/** The private store's screenshots. Each is written once under a fresh id; the id's extension is tried in turn. */
export class BlobShots implements ShotStore {
  constructor(private readonly blob: BlobBackend) {}
  async save(bytes: Uint8Array, type: ShotType): Promise<string> {
    const id = newShotId();
    await this.blob.put(`desk/skippy/shots/${id}.${EXT[type]}`, bytes, { contentType: type });
    return id;
  }
  async read(id: string): Promise<Shot | null> {
    if (!SHOT_ID.test(id)) return null;
    for (const type of Object.keys(EXT) as ShotType[]) {
      const got = await this.blob.get(`desk/skippy/shots/${id}.${EXT[type]}`).catch(() => null);
      if (!got) continue;
      const bytes = await bytesOf(got.stream, SHOT_MAX);
      return bytes && shotType(bytes) === type ? { bytes, type } : null;
    }
    return null;
  }
}

/** A store in memory, for tests. */
export class MemoryShots implements ShotStore {
  items = new Map<string, Shot>();
  async save(bytes: Uint8Array, type: ShotType): Promise<string> {
    const id = newShotId();
    this.items.set(id, { bytes, type });
    return id;
  }
  async read(id: string): Promise<Shot | null> {
    return this.items.get(id) ?? null;
  }
}
