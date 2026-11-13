import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { mergeTruth, PROVIDERS_PATH, pullAnthropic, pullOpenAI, readTruth, runUsagePull, type Truth } from "./admin.ts";

/** The providers' own numbers (#1142), with a scripted fetch. Every key and figure is made up. */

const NOW = Date.parse("2026-11-13T06:30:00Z");
const ANT = "test-anthropic-admin-key-not-real";
const OAI = "test-openai-admin-key-not-real";

function memoryBlob(): BlobBackend & { files: Map<string, string> } {
  const files = new Map<string, string>();
  let n = 1;
  const tags = new Map<string, number>();
  return {
    kind: "azureblob",
    files,
    get: async (p) => (files.has(p) ? { stream: new Response(files.get(p)!).body!, etag: String(tags.get(p)), contentType: "application/json" } : null),
    etag: async (p) => (files.has(p) ? String(tags.get(p)) : null),
    put: async (p, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(p))) throw new BlobPreconditionError("changed");
      files.set(p, String(body));
      tags.set(p, n++);
      return { pathname: p };
    },
    del: async (p) => void files.delete(p),
  };
}

type Call = { url: string; headers: Record<string, string> };

function script(routes: Record<string, unknown[]>, calls: Call[] = []) {
  const left = Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  return async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const key = Object.keys(left).find((k) => url.includes(k));
    const next = key ? left[key]!.shift() : undefined;
    if (next === undefined) return new Response("{}", { status: 404 });
    if (typeof next === "number") return new Response("{}", { status: next });
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const anthropicRoutes = {
  "/cost_report": [
    {
      data: [{ starting_at: "2026-11-12T00:00:00Z", ending_at: "2026-11-13T00:00:00Z", results: [{ amount: "123.5", currency: "USD", model: "claude-sonnet-5-5", cost_type: "tokens" }, { amount: "20", currency: "USD", model: null, cost_type: "web_search" }] }],
      has_more: true,
      next_page: "page_2",
    },
    { data: [{ starting_at: "2026-11-12T00:00:00Z", results: [{ amount: "6.5", currency: "USD", model: "claude-sonnet-5-5", cost_type: "tokens" }] }], has_more: false, next_page: null },
  ],
  "/usage_report/messages": [
    { data: [{ starting_at: "2026-11-12T00:00:00Z", results: [{ model: "claude-sonnet-5-5", uncached_input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 100 } }] }], has_more: false },
  ],
};

const openaiRoutes = {
  "/organization/costs": [{ object: "page", data: [{ object: "bucket", start_time: Date.parse("2026-11-12T00:00:00Z") / 1000, results: [{ amount: { value: 0.42, currency: "usd" }, line_item: "gpt-image-2.6-flare, output" }, { amount: { value: 0.08, currency: "usd" }, line_item: "gpt-image-2.6-flare, input" }] }], has_more: false }],
  "/organization/usage/completions": [{ data: [{ start_time: Date.parse("2026-11-12T00:00:00Z") / 1000, results: [{ model: "gpt-4.1-mini", input_tokens: 500, input_cached_tokens: 100, output_tokens: 40 }] }], has_more: false }],
};

describe("Anthropic's Usage and Cost Admin API (#1142)", () => {
  it("reads daily cost (cents) and tokens by model, page by page, with the key in a header only", async () => {
    const calls: Call[] = [];
    const days = await pullAnthropic(ANT, script(anthropicRoutes, calls), NOW);
    expect(days["2026-11-12"]!["claude-sonnet-5-5"]).toEqual({ usd: 1.3, tokensIn: 1000, tokensOut: 200, cacheRead: 5000, cacheWrite: 400 });
    expect(days["2026-11-12"]!["web search"]!.usd).toBeCloseTo(0.2);
    expect(calls[0]!.url).toContain("https://api.anthropic.com/v1/organizations/cost_report?starting_at=2026-10-14T00:00:00Z&group_by[]=description&limit=31");
    expect(calls[1]!.url).toContain("&page=page_2");
    expect(calls[2]!.url).toContain("/usage_report/messages?starting_at=2026-10-14T00:00:00Z&bucket_width=1d&group_by[]=model");
    for (const c of calls) {
      expect(c.headers["x-api-key"]).toBe(ANT);
      expect(c.url).not.toContain(ANT);
    }
  });
});

describe("OpenAI's organization Usage and Costs API (#1142)", () => {
  it("reads daily cost by line item's model and completions tokens", async () => {
    const calls: Call[] = [];
    const days = await pullOpenAI(OAI, script(openaiRoutes, calls), NOW);
    expect(days["2026-11-12"]!["gpt-image-2.6-flare"]!.usd).toBeCloseTo(0.5);
    expect(days["2026-11-12"]!["gpt-4.1-mini"]).toMatchObject({ tokensIn: 400, cacheRead: 100, tokensOut: 40 });
    expect(calls[0]!.url).toBe(`https://api.openai.com/v1/organization/costs?start_time=${Date.parse("2026-10-14T00:00:00Z") / 1000}&bucket_width=1d&group_by=line_item&limit=31`);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${OAI}`);
  });
});

describe("the night's pull (#1142)", () => {
  it("waits without keys and writes nothing", async () => {
    const blob = memoryBlob();
    expect(await runUsagePull({ env: {}, fetcher: script({}), blob, now: NOW })).toEqual({ anthropic: "waiting", openai: "waiting" });
    expect(blob.files.size).toBe(0);
    expect(await runUsagePull({ env: {}, fetcher: script({}), blob: null, now: NOW })).toBe("not-set-up");
  });

  it("keeps each provider's days, and a failed pull keeps the old ones", async () => {
    const blob = memoryBlob();
    const env = { ANTHROPIC_ADMIN_KEY: ANT, OPENAI_ADMIN_KEY: OAI };
    expect(await runUsagePull({ env, fetcher: script({ ...anthropicRoutes, ...openaiRoutes }), blob, now: NOW })).toEqual({ anthropic: "pulled", openai: "pulled" });
    const kept = await readTruth(blob);
    expect(kept.anthropic?.ok).toBe(true);
    expect(kept.openai?.days["2026-11-12"]).toBeDefined();
    expect(await runUsagePull({ env, fetcher: script({ "/cost_report": [401], "/organization/costs": [500] }), blob, now: NOW + 86_400_000 })).toEqual({ anthropic: "failed", openai: "failed" });
    const after = JSON.parse(blob.files.get(PROVIDERS_PATH)!) as Truth;
    expect(after.anthropic).toMatchObject({ ok: false, status: 401 });
    expect(after.anthropic?.days["2026-11-12"]).toBeDefined();
    expect(blob.files.get(PROVIDERS_PATH)).not.toContain(ANT);
  });

  it("drops days older than it keeps", () => {
    const old = { pulledAt: 0, ok: true, days: { "2026-01-01": {}, "2026-11-01": {} } };
    const next = mergeTruth({ openai: old }, "openai", { pulledAt: NOW, ok: true, days: { "2026-11-12": {} } }, NOW);
    expect(Object.keys(next.openai!.days).sort()).toEqual(["2026-11-01", "2026-11-12"]);
  });
});
