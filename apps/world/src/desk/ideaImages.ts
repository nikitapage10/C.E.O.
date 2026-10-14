/** Pictures on ideas: shrink in the browser, then upload to the Desk's Blob store (api/foundry-image.ts). */

import { useEffect, useState } from "react";
import { PICTURE_PATH, pictureLink, signPicture } from "../../../../api/_pictures.ts";

export const MAX_IMAGES = 4;
const MAX_BYTES = 4 * 1024 * 1024;
const LONG_SIDE = 1600;

export const isImage = (f: File) => f.type.startsWith("image/") && !/svg|heic|heif/.test(f.type);

type Decoded = { width: number; height: number; close?: () => void } & CanvasImageSource;

/** createImageBitmap where it works, an <img> where it doesn't (some browsers refuse certain files). */
async function decode(file: File): Promise<Decoded> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** A JPEG at most 1600 px on the long side. GIFs under 4 MB go up as they are. */
export async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif" && file.size < MAX_BYTES) return file;
  const bitmap = await decode(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // JPEG has no transparency: put pictures with clear parts on white.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size >= MAX_BYTES) throw new Error("too big");
  return blob;
}

/** Shrinks and uploads one picture; resolves to its reference link (which opens nothing by itself: the picture stays private), or null when it didn't work. */
export async function uploadImage(file: File, key: string): Promise<string | null> {
  try {
    const body = await shrink(file);
    const res = await fetch("/api/foundry-image", { method: "POST", headers: { "Content-Type": body.type || "image/jpeg", "x-desk-key": key }, body });
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url?: string };
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/** How far ahead the Desk signs its picture links: to the end of the next ten-minute window, so a link stays put. */
const WINDOW_S = 600;

/** The expiry the Desk signs links with at `now` (ms): 10 to 20 minutes ahead, the same for a whole window. */
export const linkUntil = (now: number) => (Math.floor(now / 1000 / WINDOW_S) + 2) * WINDOW_S;

/**
 * Short-lived links to an idea's pictures, signed in the browser with the Desk key (#127): relative to the site, so
 * they only ever reach the Desk's own picture function, and only these names from the private store. Nothing to
 * show until the key is on this device.
 */
export async function pictureLinks(paths: string[], key: string, now = Date.now()): Promise<string[]> {
  if (!key) return [];
  const until = linkUntil(now);
  const own = paths.filter((p) => PICTURE_PATH.test(p)).slice(0, MAX_IMAGES);
  return Promise.all(own.map(async (p) => pictureLink(p, until, await signPicture(key, p, until))));
}

/** The signed links for a card's pictures, renewed as each window passes. */
export function usePictureLinks(paths: string[] | undefined, key: string): string[] {
  const [links, setLinks] = useState<string[]>([]);
  const names = (paths ?? []).join("\n");
  const slot = Math.floor(Date.now() / 1000 / WINDOW_S);
  useEffect(() => {
    let live = true;
    const list = names ? names.split("\n") : [];
    pictureLinks(list, key)
      .then((l) => live && setLinks(l))
      .catch(() => live && setLinks([]));
    return () => {
      live = false;
    };
  }, [names, key, slot]);
  return links;
}
