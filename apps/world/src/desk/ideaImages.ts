/** Pictures on ideas: shrink in the browser, then upload to the Desk's Blob store (api/foundry-image.ts). */

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

/** Shrinks and uploads one picture; resolves to its public link, or null when it didn't work. */
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
