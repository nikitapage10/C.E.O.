import { afterEach, describe, expect, it, vi } from "vitest";
import { GEMINI_DEEP, GEMINI_QUICK, geminiKey, geminiSearch, geminiWorld, worldCost } from "./gemini.ts";

const NOW = Date.parse("2026-11-13T06:00:00Z");

function fake(reply: unknown, status = 200) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { seen, fetchFn };
}

const ok = (text: string, queries = ["mississippi senate result"]) => ({
  candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text }] }, groundingMetadata: { webSearchQueries: queries } }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 },
});

afterEach(() => vi.restoreAllMocks());

describe("Gemini for world questions (#1124)", () => {
  it("reads the key, never an unresolved vault reference", () => {
    expect(geminiKey({ GEMINI_API_KEY: " k " })).toBe("k");
    expect(geminiKey({ GEMINI_API_KEY: "@Microsoft.KeyVault(VaultName=v;SecretName=s)" })).toBe("");
    expect(geminiKey({})).toBe("");
    expect(geminiWorld("")).toBeNull();
  });

  it("asks Flash with Google Search, the key in a header, Nikita's card as background, never his name in a search", async () => {
    const f = fake(ok("Hyde-Smith won, monkey."));
    const got = await geminiWorld("KEY", f.fetchFn)!("Who won the Mississippi Senate race?", "quick", NOW, "Likes the Broncos.");
    expect(got).toMatchObject({ text: "Hyde-Smith won, monkey.", model: GEMINI_QUICK, searches: 1 });
    expect(got!.usd).toBeCloseTo(worldCost(GEMINI_QUICK, 1000, 150, 1));
    expect(f.seen[0]!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QUICK}:generateContent`);
    expect(f.seen[0]!.url).not.toContain("KEY");
    expect((f.seen[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(String(f.seen[0]!.init.body));
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.contents[0].parts[0].text).toBe("Who won the Mississippi Senate race?");
    expect(body.systemInstruction.parts[0].text).toContain("Likes the Broncos.");
    expect(body.systemInstruction.parts[0].text).toMatch(/Never anything about his health or money/);
  });

  it("takes Argon for depth, and answers null when Google refuses or can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fake(ok("A long answer."));
    expect((await geminiWorld("KEY", f.fetchFn)!("Compare the two bills", "deep", NOW))!.model).toBe(GEMINI_DEEP);
    expect(f.seen[0]!.url).toContain(GEMINI_DEEP);
    expect(await geminiWorld("KEY", fake({}, 429).fetchFn)!("q", "quick", NOW)).toBeNull();
    const down = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await geminiWorld("KEY", down)!("q", "quick", NOW)).toBeNull();
  });

  it("gives the call's web_search the voice's shape, and throws when Gemini fails so the call hands it on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const got = await geminiSearch("KEY", fake(ok("Short.")).fetchFn)!("score");
    expect(got.text).toBe("Short.");
    expect(got.usd).toBeGreaterThan(0);
    await expect(geminiSearch("KEY", fake({}, 500).fetchFn)!("score")).rejects.toThrow();
    expect(geminiSearch("")).toBeNull();
  });
});
