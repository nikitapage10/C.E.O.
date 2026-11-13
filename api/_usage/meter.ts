/**
 * The usage ledger (#1142, the Boiler Room's Tokenomics tab): one private line for every AI call the Function App
 * makes, written to the blob store (api/_blob.ts) under `desk/usage/YYYY-MM-DD.jsonl`, one file a day (UTC).
 *
 * A line holds only what the bill is made of: when, which provider and model, which feature (a stable id such as
 * `skippy.talk`), the tokens in, out, written to and read from the cache, the web searches, the dollars at list price
 * (./prices.ts), how long it took, whether it worked (and the HTTP status when not) and why the model stopped. Never a
 * prompt, an answer, a header, a key or anything about a person.
 *
 * How it is written: `meteredFetch(feature)` is a fetch for the providers' clients (the Anthropic SDK's `fetch`
 * option, or the raw fetch a caller already takes). It answers exactly as fetch would and reads a copy of the answer
 * on the side, so it never slows or fails the call. Lines are queued and appended in one write a moment later, with
 * an ETag check (as the other ledgers, api/_skippy/budget.ts), handed to `waitUntil` so a request's answer doesn't
 * wait for them; a timer awaits `flushUsage()` before it ends. A failed write drops its lines and logs a count only.
 *
 * The callers' own caps and month ledgers are unchanged: this only watches.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { BlobPreconditionError, pickBlob, type BlobBackend } from "../_blob.js";
import { waitUntil } from "../_waitUntil.js";
import { priceCall, type Provider, type Tokens } from "./prices.js";

export const USAGE_PREFIX = "desk/usage/";
export const usagePath = (day: string) => `${USAGE_PREFIX}${day}.jsonl`;
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** One AI call, as the ledger keeps it. */
export interface UsageLine extends Tokens {
  at: number;
  provider: Provider;
  model: string;
  feature: string;
  usd: number;
  ms: number;
  ok: boolean;
  /** The HTTP status of a failed call (0 when it never answered). */
  status?: number;
  /** Why the model stopped, when it says (`end_turn`, `max_tokens`, `refusal`, `STOP`, `empty`…). */
  stop?: string;
  /** A Message Batches result (half price). */
  batch?: boolean;
}

/** A feature's stable id, or one picked from the call's model and whether it searches the web. */
export type FeatureOf = string | ((call: { model: string; searches: boolean }) => string);

/** A feature for everything run inside `fn`, over the client's own (a Talk call's asks run Skippy's one brain). */
const scope = new AsyncLocalStorage<string>();
export const usageAs = <T>(feature: string, fn: () => T): T => scope.run(feature, fn);

/* ── reading an answer ── */

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");

export const ZERO: Tokens = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, searches: 0 };

/** The tokens in one Claude `usage` object. */
export function claudeTokens(u: Json): Tokens {
  const cc = obj(u.cache_creation);
  const w1h = num(cc.ephemeral_1h_input_tokens);
  const write = num(u.cache_creation_input_tokens);
  return {
    tokensIn: num(u.input_tokens),
    tokensOut: num(u.output_tokens),
    cacheWrite: Math.max(0, write - w1h),
    cacheWrite1h: w1h,
    cacheRead: num(u.cache_read_input_tokens),
    searches: num(obj(u.server_tool_use).web_search_requests),
  };
}

/** The tokens in an OpenAI `usage` object (chat completions or images). */
export function openaiTokens(u: Json): Tokens {
  const details = obj(u.prompt_tokens_details ?? u.input_tokens_details);
  const cached = num(details.cached_tokens);
  const input = num(u.prompt_tokens ?? u.input_tokens);
  return { ...ZERO, tokensIn: Math.max(0, input - cached), tokensOut: num(u.completion_tokens ?? u.output_tokens), cacheRead: cached };
}

/** The tokens in a Gemini answer (`usageMetadata`, and its grounded searches). Thinking is billed as output. */
export function geminiTokens(body: Json): Tokens {
  const u = obj(body.usageMetadata);
  const cached = num(u.cachedContentTokenCount);
  const prompt = num(u.promptTokenCount) + num(u.toolUsePromptTokenCount);
  const cands = Array.isArray(body.candidates) ? (body.candidates as unknown[]) : [];
  const queries = obj(obj(cands[0]).groundingMetadata).webSearchQueries;
  return { ...ZERO, tokensIn: Math.max(0, prompt - cached), tokensOut: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount), cacheRead: cached, searches: Array.isArray(queries) ? queries.length : 0 };
}

const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  tokensIn: Math.max(a.tokensIn, b.tokensIn),
  tokensOut: Math.max(a.tokensOut, b.tokensOut),
  cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  cacheWrite1h: Math.max(a.cacheWrite1h ?? 0, b.cacheWrite1h ?? 0),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  searches: Math.max(a.searches, b.searches),
});

/** Which provider a URL belongs to, and whether it is a call the ledger counts. */
export function callKind(url: string): { provider: Provider; kind: "messages" | "batch-results" | "openai" | "gemini" } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "api.anthropic.com") {
    if (/^\/v1\/messages\/?$/.test(u.pathname)) return { provider: "anthropic", kind: "messages" };
    if (/^\/v1\/messages\/batches\/[^/]+\/results\/?$/.test(u.pathname)) return { provider: "anthropic", kind: "batch-results" };
    return null;
  }
  if (u.hostname === "api.openai.com" && /^\/v1\/(chat\/completions|images\/generations|images\/edits|responses)\/?$/.test(u.pathname)) return { provider: "openai", kind: "openai" };
  if (u.hostname === "generativelanguage.googleapis.com" && /:(stream)?generateContent$/i.test(u.pathname)) return { provider: "google", kind: "gemini" };
  return null;
}

/** The model a request names: its body's `model`, or Gemini's path (`/models/<model>:generateContent`). */
export function requestModel(url: string, body: unknown): { model: string; searches: boolean } {
  const fromPath = /\/models\/([^/:]+):/.exec(url)?.[1];
  let parsed: Json = {};
  if (typeof body === "string" && body.length < 4_000_000) {
    try {
      parsed = obj(JSON.parse(body));
    } catch {
      parsed = {};
    }
  }
  const tools = Array.isArray(parsed.tools) ? (parsed.tools as unknown[]) : [];
  const searches = tools.some((t) => /^web_search/.test(str(obj(t).type)) || "google_search" in obj(t) || "googleSearch" in obj(t));
  return { model: str(parsed.model) || (fromPath ? decodeURIComponent(fromPath) : ""), searches };
}

/** Every `usage` (or Gemini `usageMetadata`) in a server-sent stream, merged: the providers repeat and grow them. */
function fromStream(text: string, provider: Provider): { tokens: Tokens; model: string; stop: string } {
  let tokens = ZERO;
  let model = "";
  let stop = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:") || !/usage|stop_reason|finishReason|"model"/.test(line)) continue;
    let ev: Json;
    try {
      ev = obj(JSON.parse(line.slice(5).trim()));
    } catch {
      continue;
    }
    const msg = obj(ev.message);
    model ||= str(msg.model) || str(ev.model) || str(ev.modelVersion);
    stop = str(obj(ev.delta).stop_reason) || str(msg.stop_reason) || str(obj((ev.candidates as unknown[] | undefined)?.[0]).finishReason) || stop;
    if (provider === "google" && ev.usageMetadata) tokens = addTokens(tokens, geminiTokens(ev));
    const u = obj(ev.usage ?? msg.usage);
    if (Object.keys(u).length) tokens = addTokens(tokens, provider === "anthropic" ? claudeTokens(u) : openaiTokens(u));
  }
  return { tokens, model, stop };
}

/** One answer's tokens, model and stop reason, by provider. */
function fromBody(body: Json, provider: Provider): { tokens: Tokens; model: string; stop: string } {
  if (provider === "anthropic") return { tokens: claudeTokens(obj(body.usage)), model: str(body.model), stop: str(body.stop_reason) };
  if (provider === "openai") {
    const choice = obj((body.choices as unknown[] | undefined)?.[0]);
    return { tokens: openaiTokens(obj(body.usage)), model: str(body.model), stop: str(choice.finish_reason) || str(body.status) };
  }
  const cand = obj((body.candidates as unknown[] | undefined)?.[0]);
  const parts = obj(cand.content).parts;
  const said = Array.isArray(parts) && parts.some((p) => typeof obj(p).text === "string" && !obj(p).thought && str(obj(p).text).trim());
  return { tokens: geminiTokens(body), model: str(body.modelVersion), stop: said ? str(cand.finishReason) || "STOP" : "empty" };
}

/** The ledger's lines for one answer (`text`, a copy of the body), or none when there is nothing to count. */
export function linesOf(input: { url: string; reqBody: unknown; status: number; contentType: string; text: string; at: number; ms: number; feature: FeatureOf }): UsageLine[] {
  const kind = callKind(input.url);
  if (!kind) return [];
  const req = requestModel(input.url, input.reqBody);
  const name = (model: string, searches: boolean) => scope.getStore() ?? (typeof input.feature === "string" ? input.feature : input.feature({ model, searches }));
  const line = (model: string, t: Tokens, extra: Partial<UsageLine> = {}): UsageLine => {
    const tokens: Tokens = { ...t, cacheWrite1h: t.cacheWrite1h ?? 0 };
    return { at: input.at, provider: kind.provider, model, feature: name(model, req.searches), ...tokens, usd: round(priceCall(kind.provider, model, tokens, extra.batch === true)), ms: input.ms, ok: true, ...extra };
  };
  if (input.status >= 400 || input.status === 0) return [line(req.model, ZERO, { ok: false, status: input.status })];
  if (kind.kind === "batch-results") {
    // One JSON line per request of the batch (the results file); only succeeded ones carry a message.
    const out: UsageLine[] = [];
    for (const raw of input.text.split("\n")) {
      if (!raw.trim()) continue;
      let r: Json;
      try {
        r = obj(obj(JSON.parse(raw)).result);
      } catch {
        continue;
      }
      const msg = obj(r.message);
      if (r.type === "succeeded") out.push(line(str(msg.model) || req.model, claudeTokens(obj(msg.usage)), { batch: true, ms: 0, stop: str(msg.stop_reason) }));
      else out.push(line(req.model, ZERO, { batch: true, ms: 0, ok: false, status: 0, stop: str(r.type) }));
    }
    return out;
  }
  if (/event-stream/.test(input.contentType)) {
    const got = fromStream(input.text, kind.provider);
    return [line(got.model || req.model, got.tokens, got.stop ? { stop: got.stop } : {})];
  }
  let body: Json;
  try {
    body = obj(JSON.parse(input.text));
  } catch {
    return [line(req.model, ZERO, { stop: "unreadable" })];
  }
  const got = fromBody(body, kind.provider);
  return [line(got.model || req.model, got.tokens, got.stop ? { stop: got.stop } : {})];
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

/* ── writing ── */

/** Where the lines go: the private store, or a fake in tests. */
export interface UsageSink {
  append(day: string, lines: UsageLine[]): Promise<void>;
}

/** Appends to the day's file with an ETag check; a lost race is tried again (four tries). */
export class BlobUsageSink implements UsageSink {
  constructor(private readonly blob: BlobBackend) {}
  async append(day: string, lines: UsageLine[]): Promise<void> {
    const path = usagePath(day);
    const add = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    for (let attempt = 0; ; attempt++) {
      const found = await this.blob.get(path);
      const cur = found ? await new Response(found.stream).text() : "";
      try {
        await this.blob.put(path, cur + add, { contentType: "application/x-ndjson", addRandomSuffix: false, ...(found ? { ifMatch: found.etag } : { allowOverwrite: false }) });
        return;
      } catch (e) {
        if (attempt >= 3 || !(e instanceof BlobPreconditionError || !found)) throw e;
      }
    }
  }
}

let sinkOf: () => UsageSink | null = () => {
  const blob = pickBlob(process.env);
  return blob ? new BlobUsageSink(blob) : null;
};
/** Tests swap the sink (null puts back the private store). */
export function setUsageSink(make: (() => UsageSink | null) | null): void {
  sinkOf = make ?? (() => {
    const blob = pickBlob(process.env);
    return blob ? new BlobUsageSink(blob) : null;
  });
}

/** How long lines wait to go out together. */
export const FLUSH_MS = 250;
let queue: UsageLine[] = [];
let pending: Promise<void> | null = null;

async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, FLUSH_MS));
  while (queue.length) {
    const batch = queue;
    queue = [];
    const byDay = new Map<string, UsageLine[]>();
    for (const l of batch) byDay.set(dayOf(l.at), [...(byDay.get(dayOf(l.at)) ?? []), l]);
    let sink: UsageSink | null;
    try {
      sink = sinkOf();
    } catch {
      sink = null;
    }
    if (!sink) continue;
    for (const [day, lines] of byDay) {
      try {
        await sink.append(day, lines);
      } catch {
        console.warn(`usage ledger: ${lines.length} lines not written`);
      }
    }
  }
}

/** Queues lines for the ledger; never throws. */
export function recordUsage(lines: UsageLine[]): void {
  if (!lines.length) return;
  queue.push(...lines);
  if (!pending) pending = drain().finally(() => (pending = null));
  try {
    waitUntil(pending);
  } catch {
    // Outside a request: the timer's own flushUsage() waits instead.
  }
}

/** Waits for every queued line to be written (a timer calls it before it ends). */
export async function flushUsage(): Promise<void> {
  while (pending) await pending.catch(() => undefined);
}

/* ── the fetch the clients use ── */

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A fetch that answers exactly as `base` does and records the AI calls it carries for `feature`. Anything else
 * (a batch's create, a model list, another host) passes straight through.
 */
export function meteredFetch(feature: FeatureOf, base: FetchLike = (i, n) => fetch(i, n)): typeof fetch {
  const wrapped: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const kind = callKind(url);
    if (!kind) return base(input, init);
    const at = Date.now();
    const reqBody = init?.body;
    let res: Response;
    try {
      res = await base(input, init);
    } catch (e) {
      try {
        recordUsage(linesOf({ url, reqBody, status: 0, contentType: "", text: "", at, ms: Date.now() - at, feature }));
      } catch {
        // never in the call's way
      }
      throw e;
    }
    try {
      const copy = res.clone();
      const contentType = res.headers.get("content-type") ?? "";
      void copy
        .text()
        .then((text) => recordUsage(linesOf({ url, reqBody, status: res.status, contentType, text, at, ms: Date.now() - at, feature })))
        .catch(() => recordUsage(linesOf({ url, reqBody, status: res.ok ? 200 : res.status, contentType: "", text: "", at, ms: Date.now() - at, feature })));
    } catch {
      // never in the call's way
    }
    return res;
  };
  return wrapped as typeof fetch;
}

/** Skippy's tiers by model: Haiku is the fast tier, Opus the hard one, Sonnet talks; a web search is its own. */
export const skippyTier =
  (prefix = "skippy", bySearch = true) =>
  ({ model, searches }: { model: string; searches: boolean }) =>
    bySearch && searches ? `${prefix}.search` : /haiku/i.test(model) ? `${prefix}.fast` : /opus/i.test(model) ? `${prefix}.hard` : `${prefix}.talk`;
