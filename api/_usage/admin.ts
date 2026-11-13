/**
 * The providers' own numbers (#1142, the Tokenomics tab): once a night the Function App asks Anthropic and OpenAI
 * what the organization spent each day, by model, so the tab can set the ledger's estimate (./meter.ts) beside the
 * bill and show the gap: calls the ledger never sees, such as Relay on the Mac, Claude Code, CI and Visual QA.
 *
 *   Anthropic  The Usage and Cost Admin API (platform.claude.com/docs/en/manage-claude/usage-cost-api):
 *              GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=…&group_by[]=description
 *                  → data[].{ starting_at, results[].{ amount (cents, a decimal string), model, cost_type } }
 *              GET https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=…&bucket_width=1d&group_by[]=model
 *                  → data[].{ starting_at, results[].{ model, uncached_input_tokens, output_tokens,
 *                    cache_read_input_tokens, cache_creation.{ ephemeral_5m_input_tokens, ephemeral_1h_input_tokens } } }
 *              Header `x-api-key: ANTHROPIC_ADMIN_KEY` (an Admin API key, `sk-ant-admin01-…`), `anthropic-version`.
 *   OpenAI     The organization Usage and Costs API (developers.openai.com, Administration, Usage):
 *              GET https://api.openai.com/v1/organization/costs?start_time=…&bucket_width=1d&group_by=line_item
 *                  → data[].{ start_time, results[].{ amount.{ value, currency }, line_item ("<model>, input") } }
 *              GET https://api.openai.com/v1/organization/usage/completions?start_time=…&bucket_width=1d&group_by=model
 *                  → data[].{ start_time, results[].{ model, input_tokens, output_tokens, input_cached_tokens } }
 *              Header `Authorization: Bearer OPENAI_ADMIN_KEY` (an Admin key).
 *
 * Both keys are optional and only ever sent to their own provider's host, in a header, on these GET reads; without
 * one, that provider's side of the tab says it is waiting. The keys could do more than read (an Anthropic admin key
 * can manage the organization), so they are typed into the Key Vault in Cloud Shell and never settable from the Desk
 * (api/_keys/allowlist.ts). What is kept is daily dollars and tokens by model, in `desk/usage/providers.json`.
 *
 * Gemini has no simple usage API: its side is the ledger alone.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { BlobPreconditionError, type BlobBackend } from "../_blob.js";

export const PROVIDERS_PATH = "desk/usage/providers.json";
export const ANTHROPIC_ADMIN = "https://api.anthropic.com/v1/organizations";
export const OPENAI_ADMIN = "https://api.openai.com/v1/organization";
/** The Admin API version the docs show for these reports. */
export const ANTHROPIC_VERSION = "2026-10-21";
/** How many days each pull covers (both APIs take up to 31 daily buckets a page). */
export const PULL_DAYS = 31;
/** How many days are kept. */
export const KEEP_DAYS = 120;
/** Once a night at 06:30 UTC, after both providers have closed the day. */
export const PULL_SCHEDULE = "0 30 6 * * *";

export type TruthProvider = "anthropic" | "openai";

/** One model's day, as the provider reports it. */
export interface ModelDay {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderTruth {
  /** When the last pull finished (ms), and whether it worked. */
  pulledAt: number;
  ok: boolean;
  /** The HTTP status of a failed pull. */
  status?: number;
  /** Day ("2026-11-13") → model → its numbers. */
  days: Record<string, Record<string, ModelDay>>;
}

export type Truth = Partial<Record<TruthProvider, ProviderTruth>>;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};
const model = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : fallback);
const EMPTY: ModelDay = { usd: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };

function add(days: ProviderTruth["days"], day: string, m: string, part: Partial<ModelDay>): void {
  const d = (days[day] ??= {});
  const cur = d[m] ?? { ...EMPTY };
  d[m] = { usd: cur.usd + (part.usd ?? 0), tokensIn: cur.tokensIn + (part.tokensIn ?? 0), tokensOut: cur.tokensOut + (part.tokensOut ?? 0), cacheRead: cur.cacheRead + (part.cacheRead ?? 0), cacheWrite: cur.cacheWrite + (part.cacheWrite ?? 0) };
}

class PullError extends Error {
  constructor(readonly status: number) {
    super(`pull failed: ${status}`);
  }
}

/** Every page of a report: `next(page)` builds the URL; at most 10 pages. */
async function pages(fetcher: Fetch, headers: Record<string, string>, next: (page: string | null) => string): Promise<Json[]> {
  const out: Json[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const res = await fetcher(next(page), { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new PullError(res.status);
    const body = obj(await res.json());
    out.push(...arr(body.data).map(obj));
    page = body.has_more === true && typeof body.next_page === "string" ? body.next_page : null;
    if (!page) break;
  }
  return out;
}

const dayOfIso = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");
const dayOfUnix = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString().slice(0, 10) : "");

/** The window a pull asks for: midnight UTC `PULL_DAYS` days back. */
export const pullStart = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (PULL_DAYS - 1));
};

/** Anthropic's daily cost and tokens by model. */
export async function pullAnthropic(key: string, fetcher: Fetch, now: number): Promise<ProviderTruth["days"]> {
  const from = new Date(pullStart(now)).toISOString().replace(/\.\d{3}Z$/, "Z");
  const headers = { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION };
  const days: ProviderTruth["days"] = {};
  const cost = await pages(fetcher, headers, (p) => `${ANTHROPIC_ADMIN}/cost_report?starting_at=${from}&group_by[]=description&limit=${PULL_DAYS}${p ? `&page=${encodeURIComponent(p)}` : ""}`);
  for (const b of cost) {
    const day = dayOfIso(b.starting_at);
    for (const r of arr(b.results).map(obj)) {
      // Amounts are cents, as decimal strings; a cost with no model (web search, code execution) goes under its type.
      const m = model(r.model, typeof r.cost_type === "string" && r.cost_type !== "tokens" ? r.cost_type.replace(/_/g, " ") : "other");
      if (day) add(days, day, m, { usd: num(r.amount) / 100 });
    }
  }
  const usage = await pages(fetcher, headers, (p) => `${ANTHROPIC_ADMIN}/usage_report/messages?starting_at=${from}&bucket_width=1d&group_by[]=model&limit=${PULL_DAYS}${p ? `&page=${encodeURIComponent(p)}` : ""}`);
  for (const b of usage) {
    const day = dayOfIso(b.starting_at);
    for (const r of arr(b.results).map(obj)) {
      const cc = obj(r.cache_creation);
      if (day) add(days, day, model(r.model, "other"), { tokensIn: num(r.uncached_input_tokens), tokensOut: num(r.output_tokens), cacheRead: num(r.cache_read_input_tokens), cacheWrite: num(cc.ephemeral_5m_input_tokens) + num(cc.ephemeral_1h_input_tokens) });
    }
  }
  return days;
}

/** OpenAI's daily cost by line item's model, and completions tokens by model. */
export async function pullOpenAI(key: string, fetcher: Fetch, now: number): Promise<ProviderTruth["days"]> {
  const from = Math.floor(pullStart(now) / 1000);
  const headers = { Authorization: `Bearer ${key}` };
  const days: ProviderTruth["days"] = {};
  const cost = await pages(fetcher, headers, (p) => `${OPENAI_ADMIN}/costs?start_time=${from}&bucket_width=1d&group_by=line_item&limit=${PULL_DAYS}${p ? `&page=${encodeURIComponent(p)}` : ""}`);
  for (const b of cost) {
    const day = dayOfUnix(b.start_time);
    for (const r of arr(b.results).map(obj)) {
      // A line item reads "<model>, <what>" ("gpt-image-2.6-sunburst, output"); the model is before the comma.
      const item = typeof r.line_item === "string" ? r.line_item.split(",")[0] : "";
      if (day) add(days, day, model(item, "other"), { usd: num(obj(r.amount).value) });
    }
  }
  const usage = await pages(fetcher, headers, (p) => `${OPENAI_ADMIN}/usage/completions?start_time=${from}&bucket_width=1d&group_by=model&limit=${PULL_DAYS}${p ? `&page=${encodeURIComponent(p)}` : ""}`);
  for (const b of usage) {
    const day = dayOfUnix(b.start_time);
    for (const r of arr(b.results).map(obj)) {
      const cached = num(r.input_cached_tokens);
      if (day) add(days, day, model(r.model, "other"), { tokensIn: Math.max(0, num(r.input_tokens) - cached), tokensOut: num(r.output_tokens), cacheRead: cached });
    }
  }
  return days;
}

/** The truth with one provider's fresh days laid over what was kept, the oldest past `KEEP_DAYS` dropped. */
export function mergeTruth(cur: Truth, provider: TruthProvider, got: ProviderTruth, now: number): Truth {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = { ...(cur[provider]?.days ?? {}), ...got.days };
  for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
  return { ...cur, [provider]: { ...got, days } };
}

export interface PullDeps {
  env: Record<string, string | undefined>;
  fetcher: Fetch;
  blob: BlobBackend | null;
  now: number;
}

/** The kept truth, or {} when there is none. */
export async function readTruth(blob: BlobBackend): Promise<Truth> {
  const found = await blob.get(PROVIDERS_PATH);
  if (!found) return {};
  const got = await new Response(found.stream).json().catch(() => ({}));
  return obj(got) as Truth;
}

/** The night's pull: each provider whose admin key is set. Returns what happened, by provider (counts only). */
export async function runUsagePull(deps: PullDeps): Promise<Partial<Record<TruthProvider, "pulled" | "waiting" | "failed">> | "not-set-up"> {
  if (!deps.blob) return "not-set-up";
  const keys: Record<TruthProvider, string> = { anthropic: deps.env.ANTHROPIC_ADMIN_KEY?.trim() ?? "", openai: deps.env.OPENAI_ADMIN_KEY?.trim() ?? "" };
  const out: Partial<Record<TruthProvider, "pulled" | "waiting" | "failed">> = {};
  const fresh: Partial<Record<TruthProvider, ProviderTruth>> = {};
  for (const p of ["anthropic", "openai"] as const) {
    if (!keys[p]) {
      out[p] = "waiting";
      continue;
    }
    try {
      const days = await (p === "anthropic" ? pullAnthropic : pullOpenAI)(keys[p], deps.fetcher, deps.now);
      fresh[p] = { pulledAt: deps.now, ok: true, days };
      out[p] = "pulled";
    } catch (e) {
      fresh[p] = { pulledAt: deps.now, ok: false, status: e instanceof PullError ? e.status : 0, days: {} };
      out[p] = "failed";
    }
  }
  if (!Object.keys(fresh).length) return out;
  for (let attempt = 0; ; attempt++) {
    const found = await deps.blob.get(PROVIDERS_PATH);
    const cur = found ? (obj(await new Response(found.stream).json().catch(() => ({}))) as Truth) : {};
    let next = cur;
    for (const [p, got] of Object.entries(fresh) as [TruthProvider, ProviderTruth][]) {
      // A failed pull keeps the days already kept and only notes the failure.
      next = got.ok ? mergeTruth(next, p, got, deps.now) : { ...next, [p]: { ...(next[p] ?? { days: {} }), pulledAt: got.pulledAt, ok: false, status: got.status } };
    }
    try {
      await deps.blob.put(PROVIDERS_PATH, JSON.stringify(next), { contentType: "application/json", addRandomSuffix: false, ...(found ? { ifMatch: found.etag } : { allowOverwrite: false }) });
      return out;
    } catch (e) {
      if (attempt >= 2 || !(e instanceof BlobPreconditionError || !found)) throw e;
    }
  }
}
