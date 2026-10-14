/** Pictures on ideas: shrink in the browser, then upload to the Desk's Blob store (api/foundry-image.ts). */

import { useEffect, useState } from "react";
import { PICTURE_PATH, PICTURE_ROUTE, linkWindow } from "../../../../api/_pictures.ts";
import { useDeskAuth } from "./signin.ts";

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
export async function uploadImage(file: File): Promise<string | null> {
  try {
    const body = await shrink(file);
    const res = await fetch("/api/foundry-image", { method: "POST", headers: { "Content-Type": body.type || "image/jpeg" }, body, credentials: "same-origin" });
    if (res.status === 401) useDeskAuth.getState().lost();
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url?: string };
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/** Only Nikita's own pictures, a few per card: the names the picture function is asked to sign. */
export const ownNames = (paths: string[]) => paths.filter((p) => PICTURE_PATH.test(p)).slice(0, MAX_IMAGES);

/**
 * Short-lived links to an idea's pictures (#127), signed by the picture function for a signed-in Desk (#132):
 * relative to the site, so they only ever reach the Desk's own picture function, and only these names from the
 * private store. Nothing to show while signed out.
 */
export async function pictureLinks(paths: string[]): Promise<string[]> {
  const own = ownNames(paths);
  if (!own.length) return [];
  const res = await fetch(`${PICTURE_ROUTE}?sign=${own.map(encodeURIComponent).join(",")}`, { credentials: "same-origin" });
  if (res.status === 401) useDeskAuth.getState().lost();
  if (!res.ok) return [];
  const { links } = (await res.json()) as { links?: unknown };
  return Array.isArray(links) ? links.filter((l): l is string => typeof l === "string" && l.startsWith(`${PICTURE_ROUTE}?p=`)) : [];
}

/** The signed links for a card's pictures while signed in, renewed as each ten-minute window passes. */
export function usePictureLinks(paths: string[] | undefined): string[] {
  const [links, setLinks] = useState<string[]>([]);
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  const names = (paths ?? []).join("\n");
  const slot = linkWindow(Date.now());
  useEffect(() => {
    let live = true;
    const list = names ? names.split("\n") : [];
    (signedIn && list.length ? pictureLinks(list) : Promise.resolve([]))
      .then((l) => live && setLinks(l))
      .catch(() => live && setLinks([]));
    return () => {
      live = false;
    };
  }, [names, signedIn, slot]);
  return links;
}
