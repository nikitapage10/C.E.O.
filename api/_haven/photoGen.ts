/**
 * The meal photo library's generator (#687): one OpenAI images call, and the month's image cap.
 *
 * The call is the demo's (scratchpad gen2.sh, approved by Nikita), streamed, and the image is the final
 * `image_generation.completed` event's `b64_json`. gpt-image-2 shuts off on 2027-02-10, so since #1016 a recipe's
 * photo (the plated or prepped meal) and the Gym's art are made by `gpt-image-2.6-sunburst`, OpenAI's quality model,
 * 1024 × 1536 with one partial image, and a cook step's picture by `gpt-image-2.6-flare`, the fast and cheap one,
 * 1024 × 1024 with none. A recipe's photo asks for quality high first (Nikita, #1016: "the recipes could be higher
 * quality"), then medium, then low once; the Gym's art stays medium then low; a cook step is low, one try. The key is the Studio's OpenAI key (Key Vault secret `openai`, OPENAI_STUDIO_KEY;
 * infra/resources.bicep), the project's one OpenAI images key, capped at $10 a month across everything that draws
 * with it: the ledger here (`openai/images-<YYYY-MM>.json` in the private store) is that cap's, so the Studio's own
 * pictures can count against it too when they come.
 *
 * Cook steps' pictures have their own $3 a month inside that cap (#1016, `STEP_CAP_USD`, `stepUsd` in the same
 * ledger), so the recipe photos always keep at least $7 of it.
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

/** OpenAI's quality image model (#1016): the recipes' photos and the Gym's art. */
export const IMAGE_MODEL = "gpt-image-2.6-sunburst";
/** OpenAI's fast, cheap image model (#1016): the cook steps' pictures. */
export const STEP_MODEL = "gpt-image-2.6-flare";
export const IMAGE_SIZE = "1024x1536";
export const IMAGES_URL = "https://api.openai.com/v1/images/generations";
/** The project's OpenAI images cap, a month (Nikita, #311). */
export const IMAGES_CAP_USD = 10;
/** Cook steps' share of it, a month (#1016): step pictures stop here; everything else keeps the rest of the cap. */
export const STEP_CAP_USD = 3;
/**
 * What one attempt is counted as, conservatively, so the real bill stays under the cap even if the price moves a
 * little. OpenAI prices the 2.6 models by token, not by image ($30 per million image output tokens, $5 per million text
 * input tokens, the models' pages, November 2026), and publishes no per-image table. A 1024 × 1024 low image measured
 * 824 output tokens on flare and 901 on sunburst (#1016, about $0.025 and $0.027). For a 1024 × 1536 sunburst image
 * with one partial image: high counted at $0.30 (10,000 output tokens; gpt-image-1 used about 6,200 for that size at
 * high), medium $0.10 (3,300 tokens), low $0.05 (1,600 tokens).
 */
export const IMAGE_COST_USD: Record<Quality, number> = { high: 0.3, medium: 0.1, low: 0.05 };
/** How long one call may take (the demo saw 30–90 s at medium; high takes longer). */
export const IMAGE_TIMEOUT_MS = 150_000;
export const HIGH_TIMEOUT_MS = 200_000;

export type Quality = "high" | "medium" | "low";
/** Which part of the cap an attempt draws on: a cook step's picture, or anything else. */
export type CapKind = "step" | "photo";

/** How one photo is made: its size, the qualities tried in order, and what each attempt is counted as. */
export interface GenPlan {
  model: string;
  size: string;
  /** Partial images streamed before the final one (each is billed). */
  partials: number;
  qualities: readonly Quality[];
  cost: Partial<Record<Quality, number>>;
  /** The part of the cap it draws on ("photo" when left out). */
  kind?: CapKind;
}

/** A recipe's photo (#1016): the demo's 1024 × 1536, high first, then medium, then low once. */
export const PHOTO_PLAN: GenPlan = { model: IMAGE_MODEL, size: IMAGE_SIZE, partials: 1, qualities: ["high", "medium", "low"], cost: IMAGE_COST_USD };
/** The Gym's exercise art (#718): the demo's 1024 × 1536, medium then low once. */
export const WORKOUT_PLAN: GenPlan = { model: IMAGE_MODEL, size: IMAGE_SIZE, partials: 1, qualities: ["medium", "low"], cost: IMAGE_COST_USD };
/**
 * A cook step's picture (#1010, on flare since #1016): square 1024 × 1024 (the smallest the model takes: 512 × 512 is
 * "below the current minimum pixel budget") at low quality, no partial image, one try, counted at $0.03 (measured 824
 * output tokens, about $0.025), so a five-step recipe counts about $0.15, against the steps' own $3 (`STEP_CAP_USD`,
 * about 100 pictures a month).
 */
export const STEP_PLAN: GenPlan = { model: STEP_MODEL, size: "1024x1024", partials: 0, qualities: ["low"], cost: { low: 0.03 }, kind: "step" };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The month a time falls in, UTC, as YYYY-MM. */
export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
export const ledgerPath = (month: string) => `openai/images-${month}.json`;

interface Ledger {
  month: string;
  images: number;
  usd: number;
  /** What the cook steps' pictures took of `usd` (#1016). */
  stepUsd?: number;
}

const round = (usd: number) => Math.round(usd * 1000) / 1000;

/** The month's image spend, in the private store. */
export class ImageLedger {
  constructor(
    private readonly blob: BlobBackend,
    private readonly capUsd = IMAGES_CAP_USD,
    private readonly stepCapUsd = STEP_CAP_USD,
  ) {}

  async read(now: number): Promise<{ month: string; images: number; usd: number; capUsd: number; left: number; reached: boolean; stepUsd: number; stepCapUsd: number; stepReached: boolean }> {
    const month = monthOf(now);
    const got = await readJson<Partial<Ledger>>(this.blob, ledgerPath(month), {});
    const usd = typeof got.usd === "number" && got.usd >= 0 ? got.usd : 0;
    const stepUsd = typeof got.stepUsd === "number" && got.stepUsd >= 0 ? got.stepUsd : 0;
    const images = typeof got.images === "number" && got.images >= 0 ? got.images : 0;
    const left = Math.max(0, Math.floor((this.capUsd - usd + 1e-9) / IMAGE_COST_USD.high));
    const stepCost = STEP_PLAN.cost.low ?? IMAGE_COST_USD.low;
    return {
      month,
      images,
      usd: round(usd),
      capUsd: this.capUsd,
      left,
      reached: usd + IMAGE_COST_USD.low > this.capUsd + 1e-9,
      stepUsd: round(stepUsd),
      stepCapUsd: this.stepCapUsd,
      stepReached: stepUsd + stepCost > this.stepCapUsd + 1e-9 || usd + stepCost > this.capUsd + 1e-9,
    };
  }

  /**
   * Counts one attempt at `quality` (at `cost`) if it fits under the cap, and for a cook step (`kind` "step") under
   * the steps' own share too; false (nothing counted) when it doesn't.
   */
  async reserve(quality: Quality, now: number, cost = IMAGE_COST_USD[quality], kind: CapKind = "photo"): Promise<boolean> {
    const month = monthOf(now);
    return updateJson<Partial<Ledger>, boolean>(this.blob, ledgerPath(month), {}, (cur) => {
      const usd = typeof cur.usd === "number" ? cur.usd : 0;
      const stepUsd = typeof cur.stepUsd === "number" ? cur.stepUsd : 0;
      if (usd + cost > this.capUsd + 1e-9) return { next: null, result: false };
      if (kind === "step" && stepUsd + cost > this.stepCapUsd + 1e-9) return { next: null, result: false };
      return { next: { month, images: (cur.images ?? 0) + 1, usd: round(usd + cost), stepUsd: round(stepUsd + (kind === "step" ? cost : 0)) }, result: true };
    });
  }

  /** Hands an attempt back (OpenAI answered with an error status, so it billed nothing). */
  async refund(quality: Quality, now: number, cost = IMAGE_COST_USD[quality], kind: CapKind = "photo"): Promise<void> {
    const month = monthOf(now);
    await updateJson<Partial<Ledger>, void>(this.blob, ledgerPath(month), {}, (cur) => ({
      next: {
        month,
        images: Math.max(0, (cur.images ?? 0) - 1),
        usd: round(Math.max(0, (cur.usd ?? 0) - cost)),
        stepUsd: round(Math.max(0, (cur.stepUsd ?? 0) - (kind === "step" ? cost : 0))),
      },
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
async function attempt(prompt: string, quality: Quality, deps: GenDeps, plan: GenPlan): Promise<GenResult> {
  const cost = plan.cost[quality] ?? IMAGE_COST_USD[quality];
  const kind = plan.kind ?? "photo";
  if (!(await deps.ledger.reserve(quality, deps.now(), cost, kind))) return { ok: false, error: "budget" };
  const body = JSON.stringify({ model: plan.model, prompt, size: plan.size, quality, n: 1, stream: true, partial_images: plan.partials });
  let res: Response;
  try {
    res = await deps.fetch(IMAGES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.key}` },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? (quality === "high" ? HIGH_TIMEOUT_MS : IMAGE_TIMEOUT_MS)),
    });
  } catch {
    // Never reached OpenAI, or timed out mid-stream: counted, since a cut stream may still have been billed.
    return { ok: false, error: "failed", detail: "network" };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    await deps.ledger.refund(quality, deps.now(), cost, kind).catch(() => undefined);
    return { ok: false, error: "failed", detail: `openai ${res.status}` };
  }
  const text = await res.text().catch(() => "");
  const bytes = finalImageOf(text);
  return bytes ? { ok: true, bytes, quality } : { ok: false, error: "failed", detail: "no image" };
}

/**
 * A photo for this prompt: each of the plan's qualities in turn until one gives an image (a recipe's photo: high
 * first, then medium, then low once, each when the one before fails or no longer fits under the cap).
 */
export async function generateImage(prompt: string, deps: GenDeps, plan: GenPlan = PHOTO_PLAN): Promise<GenResult> {
  if (!deps.key) return { ok: false, error: "no-key" };
  const tries: GenResult[] = [];
  for (const q of plan.qualities) {
    const got = await attempt(prompt, q, deps, plan);
    if (got.ok) return got;
    tries.push(got);
  }
  if (tries.length && tries.every((t) => !t.ok && t.error === "budget")) return { ok: false, error: "budget" };
  const detail = tries.map((t) => (t.ok ? undefined : t.detail)).find(Boolean);
  return { ok: false, error: "failed", ...(detail && { detail }) };
}
