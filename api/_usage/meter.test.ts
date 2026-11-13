import { afterEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { HAIKU_PRICE as BUDGET_HAIKU, OPUS_PRICE as BUDGET_OPUS, SEARCH_USD as BUDGET_SEARCH, SONNET_PRICE as BUDGET_SONNET } from "../_skippy/budget.ts";
import { GEMINI_DEEP, GEMINI_PRICE, GEMINI_QUICK } from "../_skippy/gemini.ts";
import { BlobUsageSink, callKind, flushUsage, linesOf, meteredFetch, setUsageSink, skippyTier, usageAs, usagePath, type UsageLine, type UsageSink } from "./meter.ts";
import { GEMINI_RATES, GEMINI_SEARCH_USD, HAIKU_PRICE, OPUS_PRICE, priceCall, SEARCH_USD, SONNET_PRICE } from "./prices.ts";

/** The usage ledger (#1142). Every model answer here is made up; no prompt text is ever read back. */

const AT = Date.parse("2026-11-13T12:00:00Z");
const MSG = "https://api.anthropic.com/v1/messages";

function memoryBlob(): BlobBackend & { files: Map<string, string>; races: number } {
  const files = new Map<string, string>();
  const tags = new Map<string, number>();
  let n = 1;
  const blob = {
    kind: "azureblob" as const,
    files,
    races: 0,
    get: async (path: string) => (files.has(path) ? { stream: new Response(files.get(path)!).body!, etag: String(tags.get(path)), contentType: "application/x-ndjson" } : null),
    etag: async (path: string) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path: string, body: string | ArrayBuffer | Uint8Array, opts: { ifMatch?: string; allowOverwrite?: boolean }) => {
      if (blob.races > 0) {
        blob.races -= 1;
        // Someone else wrote first.
        files.set(path, (files.get(path) ?? "") + JSON.stringify({ other: true }) + "\n");
        tags.set(path, n++);
      }
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path: string) => void files.delete(path),
  };
  return blob;
}

const claudeAnswer = (usage: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ id: "msg_1", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "a made-up answer" }], usage, ...extra });

describe("the prices (#1142)", () => {
  it("keeps its copies equal to the callers' own", () => {
    for (const [mine, theirs] of [
      [HAIKU_PRICE, BUDGET_HAIKU],
      [SONNET_PRICE, BUDGET_SONNET],
      [OPUS_PRICE, BUDGET_OPUS],
    ] as const) {
      expect(mine).toEqual({ input: theirs.input, output: theirs.output, longInput: theirs.longInput, longOutput: theirs.longOutput, longFrom: theirs.longFrom, cacheRead: theirs.cacheRead });
    }
    expect(SEARCH_USD).toBe(BUDGET_SEARCH);
    expect(GEMINI_RATES.find((r) => r.prefix === GEMINI_DEEP)).toMatchObject(GEMINI_PRICE[GEMINI_DEEP]);
    expect(GEMINI_RATES.find((r) => r.prefix === GEMINI_QUICK)).toMatchObject(GEMINI_PRICE[GEMINI_QUICK]);
    expect(GEMINI_SEARCH_USD).toBe(GEMINI_PRICE.search);
  });

  it("prices cache writes, reads, searches and batches", () => {
    const t = { tokensIn: 1_000_000, tokensOut: 0, cacheWrite: 0, cacheRead: 0, searches: 0 };
    expect(priceCall("anthropic", "claude-sonnet-5-5", t)).toBeCloseTo(2);
    expect(priceCall("anthropic", "claude-sonnet-5-5", { ...t, tokensIn: 0, cacheWrite: 1_000_000 })).toBeCloseTo(2.5);
    expect(priceCall("anthropic", "claude-sonnet-5-5", { ...t, tokensIn: 0, cacheWrite1h: 1_000_000, cacheWrite: 0 })).toBeCloseTo(4);
    expect(priceCall("anthropic", "claude-sonnet-5-5", { ...t, tokensIn: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.2);
    expect(priceCall("anthropic", "claude-opus-5-5", { ...t, tokensIn: 0, searches: 3 })).toBeCloseTo(0.03);
    expect(priceCall("anthropic", "claude-sonnet-5-5", t, true)).toBeCloseTo(1);
    expect(priceCall("google", "gemini-4-argon", { ...t, searches: 1 })).toBeCloseTo(4.014);
    expect(priceCall("openai", "gpt-image-2.6-flare", { ...t, tokensIn: 0, tokensOut: 1_000_000 })).toBeCloseTo(30);
    expect(priceCall("openai", "some-unknown-model", t)).toBe(0);
  });
});

describe("reading an answer (#1142)", () => {
  it("counts only the providers' model calls", () => {
    expect(callKind(MSG)?.kind).toBe("messages");
    expect(callKind("https://api.anthropic.com/v1/messages/batches/msgbatch_1/results")?.kind).toBe("batch-results");
    expect(callKind("https://api.anthropic.com/v1/messages/batches")).toBeNull();
    expect(callKind("https://api.anthropic.com/v1/messages/count_tokens")).toBeNull();
    expect(callKind("https://api.openai.com/v1/images/generations")?.provider).toBe("openai");
    expect(callKind("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent")?.provider).toBe("google");
    expect(callKind("https://api.github.com/repos/x")).toBeNull();
    expect(callKind("not a url")).toBeNull();
  });

  it("writes a Claude answer's tokens, cache and searches, never its words", () => {
    const [l] = linesOf({
      url: MSG,
      reqBody: JSON.stringify({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "a private question" }], tools: [{ type: "web_search_20260209", name: "web_search" }] }),
      status: 200,
      contentType: "application/json",
      text: claudeAnswer({ input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 1000 }, server_tool_use: { web_search_requests: 2 } }),
      at: AT,
      ms: 900,
      feature: skippyTier(),
    });
    expect(l).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", feature: "skippy.search", tokensIn: 1000, tokensOut: 200, cacheWrite: 2000, cacheWrite1h: 1000, cacheRead: 5000, searches: 2, ok: true, stop: "end_turn", ms: 900 });
    expect(l!.usd).toBeCloseTo((1000 * 2 + 2000 * 2.5 + 1000 * 4 + 5000 * 0.2 + 200 * 10) / 1e6 + 0.02, 6);
    expect(JSON.stringify(l)).not.toMatch(/private question|made-up answer/);
  });

  it("names Skippy's tiers by model, and a scope overrides the client's feature", () => {
    const one = (model: string, feature = skippyTier("skippy", false)) => linesOf({ url: MSG, reqBody: JSON.stringify({ model }), status: 200, contentType: "application/json", text: claudeAnswer({ input_tokens: 1, output_tokens: 1 }, { model }), at: AT, ms: 1, feature })[0]!.feature;
    expect(one("claude-haiku-5-5")).toBe("skippy.fast");
    expect(one("claude-sonnet-5-5")).toBe("skippy.talk");
    expect(one("claude-opus-5-5")).toBe("skippy.hard");
    expect(usageAs("call.deep", () => one("claude-opus-5-5"))).toBe("call.deep");
  });

  it("reads a streamed answer's growing usage", () => {
    const text = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "claude-haiku-5-5", usage: { input_tokens: 400, output_tokens: 1 } } })}`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "words" } })}`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 300 } })}`,
    ].join("\n\n");
    const [l] = linesOf({ url: MSG, reqBody: "{}", status: 200, contentType: "text/event-stream", text, at: AT, ms: 1, feature: "today.todos" });
    expect(l).toMatchObject({ model: "claude-haiku-5-5", tokensIn: 400, tokensOut: 300, stop: "max_tokens" });
  });

  it("writes a line per batch result at half price", () => {
    const ok = { custom_id: "a", result: { type: "succeeded", message: { model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 1_000_000, output_tokens: 0 } } } };
    const bad = { custom_id: "b", result: { type: "errored", error: { type: "x" } } };
    const lines = linesOf({ url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results", reqBody: undefined, status: 200, contentType: "application/binary", text: `${JSON.stringify(ok)}\n${JSON.stringify(bad)}\n`, at: AT, ms: 5, feature: "annex.fit" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ batch: true, ok: true, feature: "annex.fit" });
    expect(lines[0]!.usd).toBeCloseTo(1);
    expect(lines[1]).toMatchObject({ ok: false, stop: "errored", usd: 0 });
  });

  it("reads Gemini's usage, searches and an empty answer", () => {
    const body = { modelVersion: "gemini-3.8-flash", candidates: [{ content: { parts: [{ text: "a reply" }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["a", "b"] } }], usageMetadata: { promptTokenCount: 900, cachedContentTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 20 } };
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
    const [l] = linesOf({ url, reqBody: JSON.stringify({ tools: [{ google_search: {} }] }), status: 200, contentType: "application/json", text: JSON.stringify(body), at: AT, ms: 1, feature: "skippy.world" });
    expect(l).toMatchObject({ provider: "google", model: "gemini-3.8-flash", tokensIn: 800, cacheRead: 100, tokensOut: 70, searches: 2, stop: "STOP" });
    const [empty] = linesOf({ url, reqBody: "{}", status: 200, contentType: "application/json", text: JSON.stringify({ candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 10 } }), at: AT, ms: 1, feature: "skippy.world" });
    expect(empty).toMatchObject({ model: "gemini-3.8-flash", stop: "empty" });
  });

  it("reads OpenAI's chat and image usage, and a failure costs nothing", () => {
    const [chat] = linesOf({ url: "https://api.openai.com/v1/chat/completions", reqBody: JSON.stringify({ model: "gpt-4.1-mini" }), status: 200, contentType: "application/json", text: JSON.stringify({ model: "gpt-4.1-mini-2025", choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } }), at: AT, ms: 1, feature: "green.second" });
    expect(chat).toMatchObject({ provider: "openai", tokensIn: 100, cacheRead: 20, tokensOut: 30, stop: "stop" });
    const image = `data: ${JSON.stringify({ type: "image_generation.partial_image", b64_json: "AAAA" })}\n\ndata: ${JSON.stringify({ type: "image_generation.completed", b64_json: "AAAA", usage: { input_tokens: 60, output_tokens: 900 } })}\n\n`;
    const [img] = linesOf({ url: "https://api.openai.com/v1/images/generations", reqBody: JSON.stringify({ model: "gpt-image-2.6-flare" }), status: 200, contentType: "text/event-stream", text: image, at: AT, ms: 1, feature: "haven.steps" });
    expect(img).toMatchObject({ model: "gpt-image-2.6-flare", tokensIn: 60, tokensOut: 900 });
    expect(img!.usd).toBeCloseTo((60 * 5 + 900 * 30) / 1e6, 6);
    const [fail] = linesOf({ url: MSG, reqBody: JSON.stringify({ model: "claude-opus-5-5" }), status: 529, contentType: "application/json", text: "{}", at: AT, ms: 1, feature: "kernel.agent" });
    expect(fail).toMatchObject({ ok: false, status: 529, usd: 0, model: "claude-opus-5-5" });
  });
});

describe("writing the ledger (#1142)", () => {
  afterEach(() => setUsageSink(null));

  it("appends to the day's file and survives a lost race", async () => {
    const blob = memoryBlob();
    const sink = new BlobUsageSink(blob);
    const line = (n: number): UsageLine => ({ at: AT, provider: "anthropic", model: "m", feature: `f.${n}`, tokensIn: 1, tokensOut: 1, cacheWrite: 0, cacheRead: 0, searches: 0, usd: 0, ms: 1, ok: true });
    await sink.append("2026-11-13", [line(1)]);
    blob.races = 1;
    await sink.append("2026-11-13", [line(2), line(3)]);
    const rows = blob.files.get(usagePath("2026-11-13"))!.trim().split("\n").map((r) => JSON.parse(r) as { feature?: string; other?: boolean });
    expect(rows.map((r) => r.feature ?? "other")).toEqual(["f.1", "other", "f.2", "f.3"]);
  });

  it("answers exactly as fetch would and records the call on the side, batched", async () => {
    const got: { day: string; lines: UsageLine[] }[] = [];
    const sink: UsageSink = { append: async (day, lines) => void got.push({ day, lines }) };
    setUsageSink(() => sink);
    const body = claudeAnswer({ input_tokens: 10, output_tokens: 5 });
    const base = async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    const f = meteredFetch("senate.talk", base);
    const a = await f(MSG, { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) });
    const b = await f(MSG, { method: "POST", body: JSON.stringify({ model: "claude-haiku-5-5" }) });
    expect(await a.text()).toBe(body);
    expect(b.status).toBe(200);
    // Other hosts pass straight through, unrecorded.
    await meteredFetch("x", async () => new Response("ok"))("https://example.com/");
    await flushUsage();
    expect(got).toHaveLength(1);
    expect(got[0]!.day).toBe(new Date().toISOString().slice(0, 10));
    expect(got[0]!.lines.map((l) => l.feature)).toEqual(["senate.talk", "senate.talk"]);
  });

  it("never fails a call: a thrown fetch is recorded and rethrown, a broken sink is ignored", async () => {
    const got: UsageLine[] = [];
    setUsageSink(() => ({ append: async (_d, lines) => void got.push(...lines) }));
    const f = meteredFetch("email.sort", async () => {
      throw new Error("offline");
    });
    await expect(f(MSG, { method: "POST", body: "{}" })).rejects.toThrow("offline");
    await flushUsage();
    expect(got[0]).toMatchObject({ ok: false, status: 0 });
    setUsageSink(() => ({ append: async () => Promise.reject(new Error("store down")) }));
    const res = await meteredFetch("email.sort", async () => new Response(claudeAnswer({ input_tokens: 1, output_tokens: 1 })))(MSG, { method: "POST", body: "{}" });
    expect(res.ok).toBe(true);
    await expect(flushUsage()).resolves.toBeUndefined();
  });
});
