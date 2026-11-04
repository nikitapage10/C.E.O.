/**
 * The meal photo library's generator (#687): one OpenAI images call, and the month's image cap.
 *
 * The call is the demo's (scratchpad gen2.sh, approved by Nikita): `gpt-image-2`, 1024 × 1536, quality medium,
 * streamed with one partial image, and the image is the final `image_generation.completed` event's `b64_json`. When
 * medium fails, low is tried once. The key is the Studio's OpenAI key (Key Vault secret `openai`, OPENAI_STUDIO_KEY;
 * infra/resources.bicep), the project's one OpenAI images key, capped at $10 a month across everything that draws
 * with it: the ledger here (`openai/images-<YYYY-MM>.json` in the private store) is that cap's, so the Studio's own
 * pictures can count against it too when they come.
 *
 * Every attempt is counted before the call at a conservative price per image (more than OpenAI's list price for the
 * size and quality, partial image included), and handed back only when OpenAI answered with an error status (it bills
 * nothing then). Past the cap nothing is called: the library marks the photo "budget".
 *
 * Nothing here logs a prompt, a meal or the key.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../_blob.js";
import { readJson, updateJson } from "./json.js";

export const IMAGE_MODEL = "gpt-image-2";
export const IMAGE_SIZE = "1024x1536";
export const IMAGES_URL = "https://api.openai.com/v1/images/generations";
/** The project's OpenAI images cap, a month (Nikita, #311). */
export const IMAGES_CAP_USD = 10;
/**
 * What one attempt is counted as, conservatively: above the list price of a 1024 × 1536 image at that quality with
 * one partial image, so the real bill stays under the cap even if the price moves a little.
 */
export const IMAGE_COST_USD: Record<Quality, number> = { medium: 0.1, low: 0.03 };
/** How long one call may take (the demo saw 30–90 s). */
export const IMAGE_TIMEOUT_MS = 150_000;

export type Quality = "medium" | "low";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The month a time falls in, UTC, as YYYY-MM. */
export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
export const ledgerPath = (month: string) => `openai/images-${month}.json`;

interface Ledger {
  month: string;
  images: number;
  usd: number;
}

const round = (usd: number) => Math.round(usd * 1000) / 1000;

/** The month's image spend, in the private store. */
export class ImageLedger {
  constructor(
    private readonly blob: BlobBackend,
    private readonly capUsd = IMAGES_CAP_USD,
  ) {}

  async read(now: number): Promise<{ month: string; images: number; usd: number; capUsd: number; left: number; reached: boolean }> {
    const month = monthOf(now);
    const got = await readJson<Partial<Ledger>>(this.blob, ledgerPath(month), {});
    const usd = typeof got.usd === "number" && got.usd >= 0 ? got.usd : 0;
    const images = typeof got.images === "number" && got.images >= 0 ? got.images : 0;
    const left = Math.max(0, Math.floor((this.capUsd - usd + 1e-9) / IMAGE_COST_USD.medium));
    return { month, images, usd: round(usd), capUsd: this.capUsd, left, reached: usd + IMAGE_COST_USD.low > this.capUsd + 1e-9 };
  }

  /** Counts one attempt at `quality` if it fits under the cap; false (nothing counted) when it doesn't. */
  async reserve(quality: Quality, now: number): Promise<boolean> {
    const month = monthOf(now);
    const cost = IMAGE_COST_USD[quality];
    return updateJson<Partial<Ledger>, boolean>(this.blob, ledgerPath(month), {}, (cur) => {
      const usd = typeof cur.usd === "number" ? cur.usd : 0;
      if (usd + cost > this.capUsd + 1e-9) return { next: null, result: false };
      return { next: { month, images: (cur.images ?? 0) + 1, usd: round(usd + cost) }, result: true };
    });
  }

  /** Hands an attempt back (OpenAI answered with an error status, so it billed nothing). */
  async refund(quality: Quality, now: number): Promise<void> {
    const month = monthOf(now);
    await updateJson<Partial<Ledger>, void>(this.blob, ledgerPath(month), {}, (cur) => ({
      next: { month, images: Math.max(0, (cur.images ?? 0) - 1), usd: round(Math.max(0, (cur.usd ?? 0) - IMAGE_COST_USD[quality])) },
      result: undefined,
    }));
  }
}

export type GenResult =
  | { ok: true; bytes: Uint8Array; quality: Quality }
  | { ok: false; error: "budget" | "no-key" | "failed"; detail?: string };

export interface GenDeps {
  key: string;
  fetch: Fetch;
  ledger: ImageLedger;
  now: () => number;
  timeoutMs?: number;
}

/** The last `image_generation.completed` event's image from a streamed answer (server-sent events), or null. */
export function finalImageOf(stream: string): Uint8Array | null {
  let b64: string | null = null;
  for (const line of stream.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]" || !data.includes("image_generation.completed")) continue;
    try {
      const ev = JSON.parse(data) as { type?: unknown; b64_json?: unknown };
      if (ev.type === "image_generation.completed" && typeof ev.b64_json === "string" && ev.b64_json) b64 = ev.b64_json;
    } catch {
      // A line that isn't JSON is skipped.
    }
  }
  if (!b64) return null;
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  return bytes.length > 0 ? bytes : null;
}

/** One attempt at one quality: the image, or why not. */
async function attempt(prompt: string, quality: Quality, deps: GenDeps): Promise<GenResult> {
  if (!(await deps.ledger.reserve(quality, deps.now()))) return { ok: false, error: "budget" };
  const body = JSON.stringify({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, quality, n: 1, stream: true, partial_images: 1 });
  let res: Response;
  try {
    res = await deps.fetch(IMAGES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.key}` },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? IMAGE_TIMEOUT_MS),
    });
  } catch {
    // Never reached OpenAI, or timed out mid-stream: counted, since a cut stream may still have been billed.
    return { ok: false, error: "failed", detail: "network" };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    await deps.ledger.refund(quality, deps.now()).catch(() => undefined);
    return { ok: false, error: "failed", detail: `openai ${res.status}` };
  }
  const text = await res.text().catch(() => "");
  const bytes = finalImageOf(text);
  return bytes ? { ok: true, bytes, quality } : { ok: false, error: "failed", detail: "no image" };
}

/** A photo for this prompt: medium first, low once when medium fails or no longer fits under the cap. */
export async function generateImage(prompt: string, deps: GenDeps): Promise<GenResult> {
  if (!deps.key) return { ok: false, error: "no-key" };
  const first = await attempt(prompt, "medium", deps);
  if (first.ok) return first;
  const second = await attempt(prompt, "low", deps);
  if (second.ok) return second;
  if (second.error === "budget" && first.error === "budget") return second;
  const detail = first.detail ?? second.detail;
  return { ok: false, error: "failed", ...(detail && { detail }) };
}
