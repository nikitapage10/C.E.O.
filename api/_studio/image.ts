/**
 * The Studio's Gemini pictures (#311, the render line's backup to OpenAI images): Gemini's image model makes a frame
 * or a pop-up sheet from a prompt and up to four reference pictures, for the Director's thread. Azure only: the key is
 * the Function App's GEMINI_API_KEY (Key Vault `gemini-api-key`), sent only in the `x-goog-api-key` header.
 *
 *   POST /api/studio-image { prompt, refs?: [base64 PNG/JPEG, ≤4], aspect?: "3:2"|"2:3"|"1:1", n?: 1–4, model? }
 *        → { id, status: "working" } (202)
 *   POST /api/studio-image { fetch: "<id>" } → { status: "working" } (202), { status: "done", model, images: [base64],
 *        mimes: [...] } (200), { status: "failed", error } (502), or { error: "gone" } (404)
 *
 * The same shape as the audio line (api/_studio/audio.ts): a job carries on past the Static Web App's ~45-second cut
 * and is fetched by id. Who: the feed key only, no query (api/_site/roomkeys.ts). No cap of its own (Nikita: no
 * internal limits); every call is counted in the AI usage ledger (feature `studio.image`, api/_usage/meter.ts).
 * Results sit in the private blob store (`studio/image/<id>.json`) for a day, never public.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { randomBytes } from "node:crypto";
import type { BlobBackend } from "../_blob.js";
import { pickBlob } from "../_blob.js";
import { roomKeyOf } from "../_site/roomkeys.js";
import { meteredFetch } from "../_usage/meter.js";
import { waitUntil } from "../_waitUntil.js";
import { readJson, updateJson } from "../_haven/json.js";

export { STUDIO_IMAGE_PATH } from "../_site/roomkeys.js";
/** The best Gemini image model first; the second is tried when the first isn't offered on this key. */
export const IMAGE_MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"] as const;
export const ASPECTS = ["3:2", "2:3", "1:1"] as const;
export const KEEP_MS = 24 * 60 * 60_000;
export const PROMPT_MAX = 8_000;
export const REFS_MAX = 4;
/** One reference picture's base64, about 6 MB of image. */
export const REF_MAX = 8_000_000;
const BODY_MAX = 34_000_000;
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const ID = /^[A-Za-z0-9_-]{16}$/;
const MODEL = /^gemini-[a-z0-9.-]{1,60}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ImageJob {
  prompt: string;
  refs: string[];
  aspect: (typeof ASPECTS)[number];
  n: number;
  model?: string;
}

type Stored =
  | { status: "working"; at: number }
  | { status: "done"; at: number; model: string; images: string[]; mimes: string[] }
  | { status: "failed"; at: number; error: string };

export interface StudioImageDeps {
  blob: BlobBackend | null;
  key: string;
  env: Record<string, string | undefined>;
  now: number;
  fetcher?: typeof fetch;
  later?: (work: Promise<unknown>) => void;
}

const jobPath = (id: string) => `studio/image/${id}.json`;
const INDEX_FILE = "studio/image/index.json";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

/** The picture type a reference's base64 starts with, or null when it is neither PNG nor JPEG. */
function refType(b64: string): string | null {
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  return null;
}

/** The job a body asks for, or null when it doesn't fit exactly. */
export function parseImageJob(body: unknown): ImageJob | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Object.keys(b).every((k) => ["prompt", "refs", "aspect", "n", "model"].includes(k))) return null;
  if (typeof b.prompt !== "string" || !b.prompt.trim() || b.prompt.length > PROMPT_MAX) return null;
  const refs = b.refs ?? [];
  if (!Array.isArray(refs) || refs.length > REFS_MAX) return null;
  for (const r of refs) if (typeof r !== "string" || r.length > REF_MAX || !B64.test(r) || !refType(r)) return null;
  const aspect = b.aspect ?? "1:1";
  if (!(ASPECTS as readonly unknown[]).includes(aspect)) return null;
  const n = b.n ?? 1;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 4) return null;
  if (b.model !== undefined && (typeof b.model !== "string" || !MODEL.test(b.model))) return null;
  return { prompt: b.prompt, refs: refs as string[], aspect: aspect as ImageJob["aspect"], n, ...(b.model ? { model: b.model as string } : {}) };
}

/** One picture from one model: the image, or the HTTP status when it refused. */
async function oneImage(job: ImageJob, model: string, key: string, fetcher: typeof fetch): Promise<{ data: string; mime: string } | { status: number }> {
  const parts = [{ text: job.prompt }, ...job.refs.map((r) => ({ inlineData: { mimeType: refType(r)!, data: r } }))];
  const res = await fetcher(`${API}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: job.aspect } } }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) return { status: res.status };
  const out = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] } | null;
  const found = out?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  return found?.inlineData?.data ? { data: found.inlineData.data, mime: found.inlineData.mimeType || "image/png" } : { status: 200 };
}

/** The job's pictures, from the asked-for model or the first offered one. */
export async function makeImages(job: ImageJob, key: string, fetcher: typeof fetch): Promise<Stored> {
  const models = job.model ? [job.model] : [...IMAGE_MODELS];
  let last = 0;
  for (const model of models) {
    const got = await Promise.all(Array.from({ length: job.n }, () => oneImage(job, model, key, fetcher).catch(() => ({ status: 0 }))));
    const images = got.filter((g): g is { data: string; mime: string } => "data" in g);
    if (images.length) return { status: "done", at: 0, model, images: images.map((i) => i.data), mimes: images.map((i) => i.mime) };
    last = (got[0] as { status: number }).status;
    // Only a model this key isn't offered moves on to the next one.
    if (last !== 404 && last !== 400) break;
  }
  return { status: "failed", at: 0, error: last === 200 ? "no-image" : `gemini-${last}` };
}

async function track(blob: BlobBackend, id: string, now: number): Promise<void> {
  const stale = await updateJson(blob, INDEX_FILE, [] as { id: string; at: number }[], (cur) => {
    const list = Array.isArray(cur) ? cur.filter((e) => e && typeof e.id === "string" && ID.test(e.id) && typeof e.at === "number") : [];
    return { next: [...list.filter((e) => now - e.at < KEEP_MS), { id, at: now }].slice(-200), result: list.filter((e) => now - e.at >= KEEP_MS) };
  });
  await Promise.all(stale.map((e) => blob.del(jobPath(e.id)).catch(() => undefined)));
}

const save = (blob: BlobBackend, id: string, value: Stored) =>
  blob.put(jobPath(id), JSON.stringify(value), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });

/** POST /api/studio-image: the feed key only. */
export async function studioImage(request: Request, deps: StudioImageDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (new URL(request.url).search !== "") return json({ error: "bad-request" }, 400);
  if (roomKeyOf(request, deps.env) !== "feed") return json({ error: "unauthorized" }, 401);
  if (!deps.blob || !deps.key) return json({ error: "not-set-up" }, 503);
  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ error: "too-big" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const blob = deps.blob;

  if (body && typeof body === "object" && !Array.isArray(body) && "fetch" in body) {
    const id = (body as { fetch: unknown }).fetch;
    if (Object.keys(body).length !== 1 || typeof id !== "string" || !ID.test(id)) return json({ error: "bad-request" }, 400);
    const found = await readJson<Stored | null>(blob, jobPath(id), null);
    if (!found || deps.now - found.at >= KEEP_MS) return json({ error: "gone" }, 404);
    if (found.status === "working") return json({ status: "working" }, 202);
    if (found.status === "failed") return json({ status: "failed", error: found.error }, 502);
    return json({ status: "done", model: found.model, images: found.images, mimes: found.mimes });
  }

  const job = parseImageJob(body);
  if (!job) return json({ error: "bad-request" }, 400);
  const id = randomBytes(12).toString("base64url");
  const at = deps.now;
  await save(blob, id, { status: "working", at });
  await track(blob, id, at).catch(() => undefined);
  const work = makeImages(job, deps.key, deps.fetcher ?? meteredFetch("studio.image"))
    .catch(() => ({ status: "failed", at: 0, error: "gemini-down" }) as Stored)
    .then((done) => save(blob, id, { ...done, at }))
    .catch(() => undefined);
  (deps.later ?? waitUntil)(work);
  return json({ id, status: "working" }, 202);
}

export function POST(request: Request): Promise<Response> {
  return studioImage(request, { blob: pickBlob(), key: process.env.GEMINI_API_KEY?.trim() ?? "", env: process.env, now: Date.now() });
}
