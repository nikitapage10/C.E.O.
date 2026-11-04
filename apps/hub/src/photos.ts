import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanPng, emailPhotoHash, MAX_PHOTOS, PHOTO_PX, photoIdOf } from "../../../api/_relay/photos.ts";
import type { BlueBubbles } from "./bluebubbles.ts";
import type { Site } from "./site.ts";
import type { RelayState } from "./store.ts";

/**
 * Contact photos from the Mac (#642, docs/RELAY-PRIVACY.md, "Contact photos: the one exception"). Once a day, and at
 * start: BlueBubbles' contact data gives each contact's picture; macOS's own `sips` shrinks it to PHOTO_PX and re-encodes
 * it as PNG in a private temp folder (deleted straight after); `cleanPng` keeps only the image chunks, so no EXIF,
 * location, text or colour profile goes; and it is sent under an opaque id (an HMAC of the contact's handle under a key
 * from the hub's own local key, which never leaves the Mac). A photo already sent and unchanged isn't sent again.
 *
 * So an email sender in Mac Contacts gets a photo too, each of the contact's email addresses goes as a keyed hash under
 * the key the site hands the paired hub (never the address): the site hashes each sender the same way to match. No
 * name, number or address travels with a photo; the picture and the pictures' ids are all the site learns.
 */

/** Shrinks one picture to a small PNG; null when it can't. */
export type Resize = (image: Uint8Array) => Promise<Uint8Array | null>;

/** macOS's sips: the longest side to PHOTO_PX, PNG, in a temp folder only this user can read, removed after. */
export const sipsResize: Resize = async (image) => {
  const dir = await mkdtemp(join(tmpdir(), "ceo-relay-photo-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.png");
    await writeFile(src, image, { mode: 0o600 });
    await new Promise<void>((ok, fail) => execFile("/usr/bin/sips", ["-Z", String(PHOTO_PX), "-s", "format", "png", src, "--out", out], { timeout: 15_000 }, (e) => (e ? fail(e) : ok())));
    return new Uint8Array(await readFile(out));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface PhotoSyncDeps {
  bb: Pick<BlueBubbles, "contactPhotos">;
  site: Pick<Site, "photoKey" | "photo" | "photos">;
  /** The Mac's photo key (api/_relay/photos.ts, macPhotoKey). */
  key: Buffer;
  resize: Resize;
}

/** One sync. Returns what the state's `photos` should be now (the ids the site holds, with the hash sent), and a count. */
export async function syncPhotos(d: PhotoSyncDeps, sent: RelayState["photos"]): Promise<{ photos: RelayState["photos"]; count: number }> {
  const contacts = await d.bb.contactPhotos();
  const emailKey = await d.site.photoKey();
  const next: RelayState["photos"] = {};
  const emails: [string, string][] = [];
  for (const c of contacts) {
    if (Object.keys(next).length >= MAX_PHOTOS) break;
    const id = photoIdOf(d.key, c.handles);
    if (!id || next[id]) continue;
    const small = await d.resize(c.image);
    const png = small ? cleanPng(small) : null;
    if (!png) continue;
    const hash = sha256(png);
    if (sent[id] !== hash && !(await d.site.photo(id, png).catch(() => false))) continue;
    next[id] = hash;
    if (emailKey)
      for (const h of c.handles) {
        const k = h.includes("@") ? emailPhotoHash(emailKey, h) : "";
        if (k) emails.push([k, id]);
      }
  }
  const have = new Set(await d.site.photos(Object.keys(next), emails));
  const photos: RelayState["photos"] = {};
  for (const [id, hash] of Object.entries(next)) if (have.has(id)) photos[id] = hash;
  return { photos, count: Object.keys(photos).length };
}
