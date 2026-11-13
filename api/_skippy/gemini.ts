/**
 * Questions about the world, answered by Gemini with Google Search (#1124, Nikita 2026-11-13: "If it goes to the
 * real-world knowledge base, it should use the Gemini API ... Gemini 3.8 Flash. And for something that's more complex
 * or comprehensive ... Argon instead").
 *
 *   quick   gemini-3.8-flash with Google Search grounding: news, scores, who/what/when, a fact out in the world.
 *   deep    gemini-4-argon with Google Search grounding: a world question that needs comparison, depth or judgment.
 *
 * Skippy's quick pass (Haiku, ./agent/loop.ts) decides which lane an ask takes: the Desk and the rooms (its tools),
 * Nikita himself (his memory), or the world (here). Only the question goes out (already through the privacy check):
 * never the Desk's lines, the memory or a room's data. The key is the Function App's GEMINI_API_KEY (Key Vault
 * `gemini-api-key`), sent only in the `x-goog-api-key` header to Google's API host and never logged. Without a key,
 * or when Gemini fails, the ask goes on to Skippy's deeper Claude self with its own web search, as before.
 *
 * Spend counts under Skippy's month (part "gemini"), priced at the later list prices so the meter never runs low:
 * Flash $1.50 / $7.50 per million tokens in / out, Argon $4 / $20, and $14 per 1,000 grounded searches.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { Usage } from "../foundry.js";
import { lookupPrompt } from "./prompt.js";
import { meteredFetch } from "../_usage/meter.js";

export const GEMINI_API = "https://generativelanguage.googleapis.com";
export const GEMINI_QUICK = "gemini-3.8-flash";
export const GEMINI_DEEP = "gemini-4-argon";
export type WorldDepth = "quick" | "deep";

/** Dollars per million tokens (in, out) and per grounded search. */
export const GEMINI_PRICE = {
  [GEMINI_QUICK]: { in: 1.5, out: 7.5 },
  [GEMINI_DEEP]: { in: 4, out: 20 },
  search: 0.014,
} as const;

/** How long each lane may take before the ask goes on to Claude. */
export const GEMINI_TIMEOUT_MS: Record<WorldDepth, number> = { quick: 12_000, deep: 30_000 };
const MAX_OUT: Record<WorldDepth, number> = { quick: 1_200, deep: 4_000 };

export interface WorldAnswer {
  text: string;
  model: string;
  usage: Usage;
  usd: number;
  searches: number;
}

/** `about`: Nikita's core card (his memory's, through its rules: no money, legal, contacts or keys), as background. */
export type WorldAsk = (question: string, depth: WorldDepth, now: number, about?: string) => Promise<WorldAnswer | null>;

/** The key from the Function App's settings: "" when unset or an unresolved Key Vault reference. */
export function geminiKey(env: Record<string, string | undefined> = process.env): string {
  const v = env.GEMINI_API_KEY?.trim() ?? "";
  return v && !v.toLowerCase().startsWith("@microsoft.keyvault(") ? v : "";
}

/** The rules Gemini answers under: the lookup's (today's date, findings only), in Skippy's length. */
export const worldPrompt = (depth: WorldDepth, now: number, about = "") =>
  `${lookupPrompt(now)} Search the web before answering anything that may have changed. Nikita lives near Denver, Colorado, on Mountain time: "local", "near me", "here" and "tonight" mean there. You are writing for Skippy, a sarcastic, brilliant AI who answers Nikita in plain words: give the answer itself first, then only what matters. ${
    depth === "quick" ? "At most 90 words, one short paragraph." : "At most 250 words: the answer, then the reasons or the comparison in a few plain sentences."
  } Plain text: no markdown, lists, headings, links or citations.${
    about.trim()
      ? ` What Skippy knows of Nikita, as background only, to read the question the way he means it and fit the answer to him (his teams, his work, his tastes). Put a detail from it into a search only when the search truly needs it to answer well (his city, his teams, his employer, a band or show he likes); his name or anyone else's only when the question can't be answered without it. Never anything about his health or money, and never his home address. Never repeat it back unless the question is about it:\n<about>\n${about.replace(/<\/?about>/gi, "").slice(0, 2_000)}\n</about>`
      : ""
  }`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string; groundingMetadata?: { webSearchQueries?: string[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number };
}

/** What one answer cost, at GEMINI_PRICE. */
export function worldCost(model: typeof GEMINI_QUICK | typeof GEMINI_DEEP, tokensIn: number, tokensOut: number, searches: number): number {
  const p = GEMINI_PRICE[model];
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000 + searches * GEMINI_PRICE.search;
}

/** The live asker, or a scripted fetch in tests. Null answers mean "go on to Claude". */
export function geminiWorld(key: string, fetchFn: typeof fetch = fetch, feature = "skippy.world"): WorldAsk | null {
  if (!key) return null;
  const call = meteredFetch(feature, fetchFn);
  return async (question, depth, now, about) => {
    const model = depth === "deep" ? GEMINI_DEEP : GEMINI_QUICK;
    const q = question.replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (!q) return null;
    let res: Response;
    try {
      res = await call(`${GEMINI_API}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: worldPrompt(depth, now, about) }] },
          contents: [{ role: "user", parts: [{ text: q }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: MAX_OUT[depth] },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS[depth]),
      });
    } catch {
      console.error("skippy: Gemini didn't answer", { model, why: "network-or-timeout" });
      return null;
    }
    if (!res.ok) {
      console.error("skippy: Gemini refused", { model, status: res.status });
      return null;
    }
    const body = (await res.json().catch(() => null)) as GeminiResponse | null;
    const c = body?.candidates?.[0];
    const text = (c?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const u = body?.usageMetadata ?? {};
    const tokensIn = (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0);
    const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const searches = c?.groundingMetadata?.webSearchQueries?.length ?? 0;
    const usd = worldCost(model, tokensIn, tokensOut, searches);
    const usage: Usage = { input_tokens: tokensIn, output_tokens: tokensOut, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    if (!text) return { text: "", model, usage, usd, searches };
    return { text, model, usage, usd, searches };
  };
}

/**
 * The call's web_search on Gemini Flash (#1124): the voice's lookup shape ({ text, usage, usd }), held to a spoken
 * length; null without a key. A Gemini failure throws, so the call's search says it failed and hands the question on.
 */
export function geminiSearch(key: string, fetchFn: typeof fetch = fetch): ((query: string) => Promise<{ text: string; usage: Usage; usd: number }>) | null {
  const ask = geminiWorld(key, fetchFn, "call.search");
  if (!ask) return null;
  return async (query) => {
    const got = await ask(`${query}\n(Read aloud on a live call: at most 70 words, the answer itself first.)`, "quick", Date.now());
    if (!got) throw new Error("gemini");
    return { text: got.text, usage: got.usage, usd: got.usd };
  };
}
