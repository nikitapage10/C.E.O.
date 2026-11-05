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
 * Contact photos from the Mac (#642, docs/RELAY-PRIVACY.md, "Contact photos: the one exception"). Every hour (#907), and at
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

/** The HTTP status a site call failed with (./site.ts, httpError), or 0 when it wasn't an HTTP answer. A number only. */
export function statusOf(e: unknown): number {
  const s = e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : 0;
  return typeof s === "number" && Number.isInteger(s) && s >= 100 && s <= 599 ? s : 0;
}

export interface PhotoSyncResult {
  /** What the state's `photos` should be now: the ids the site holds, with the hash sent. */
  photos: RelayState["photos"];
  /** How many the site holds. */
  count: number;
  /** Photos the site didn't take (#891), and the HTTP status of the last such refusal (0: none, or not HTTP). */
  failed: number;
  status: number;
  /** Pictures that couldn't be shrunk or cleaned (left out, never sent). */
  unreadable: number;
}

/** One sync. Throws when the closing list call fails (its HttpError carries the status); a photo's failure is counted. */
export async function syncPhotos(d: PhotoSyncDeps, sent: RelayState["photos"]): Promise<PhotoSyncResult> {
  const contacts = await d.bb.contactPhotos();
  const emailKey = await d.site.photoKey();
  const next: RelayState["photos"] = {};
  const emails: [string, string][] = [];
  let failed = 0;
  let status = 0;
  let unreadable = 0;
  for (const c of contacts) {
    if (Object.keys(next).length >= MAX_PHOTOS) break;
    const id = photoIdOf(d.key, c.handles);
    if (!id || next[id]) continue;
    const small = await d.resize(c.image);
    const png = small ? cleanPng(small) : null;
    if (!png) {
      unreadable += 1;
      continue;
    }
    const hash = sha256(png);
    if (sent[id] !== hash) {
      const ok = await d.site.photo(id, png).catch((e: unknown) => {
        status = statusOf(e) || status;
        return false;
      });
      if (!ok) {
        failed += 1;
        continue;
      }
    }
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
  return { photos, count: Object.keys(photos).length, failed, status, unreadable };
}

const minutesAgo = (at: number, now: number) => Math.max(0, Math.round((now - at) / 60_000));

/**
 * `relay check`'s word on the photo sync (#891): running, or what went wrong last time. Times, counts and an HTTP status
 * only. Null when the last sync was clean, or none has run.
 */
export function photoSyncLine(state: Pick<RelayState, "photosAt" | "photosRun" | "photosFail">, now: number): string | null {
  if (state.photosRun !== null && state.photosRun >= (state.photosAt ?? 0)) return `Relay: a photo sync started ${minutesAgo(state.photosRun, now)} minutes ago and hasn't finished (it shrinks each picture first).`;
  const f = state.photosFail;
  if (!f) return null;
  const why = f.status ? `the site answered ${f.status}` : "the site didn't answer";
  return f.failed ? `Relay: the last photo sync, ${minutesAgo(f.at, now)} minutes ago, sent the list but ${f.failed} photos weren't taken (${why}).` : `Relay: the last photo sync failed ${minutesAgo(f.at, now)} minutes ago (${why}).`;
}
