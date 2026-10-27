import { describe, expect, it } from "vitest";
import { status, talk, type VoiceDeps } from "./skippy-voice.ts";
import {
  MemoryVoiceStore,
  VOICE_RULES,
  VOICE_SESSION_SECS,
  VOICE_USD_PER_MIN,
  agentBody,
  agentSig,
  classifyRefusal,
  countVoice,
  deskVariable,
  elevenReason,
  ensureAgent,
  mintToken,
  reserveAdd,
  settleAdd,
  voiceBudget,
  voiceCost,
  voiceTag,
  voiceUsage,
  voiceWait,
} from "./_skippy/voice.ts";
import { MemoryAuthStore } from "./_desk/store.ts";
import { signedInCookie } from "./_desk/testing.ts";
import { MemoryStoryStore, addStorySpend, storyMonth } from "./_world/story.ts";

const NOW = Date.parse("2026-10-25T16:00:00Z");
const KEY = "sk_test_eleven_key_that_must_never_leak_0123456789";

describe("the talk's cap", () => {
  it("takes its share from ELEVENLABS_VOICE_BUDGET_USD, never above ElevenLabs' cap", () => {
    expect(voiceBudget(undefined, 10)).toBe(5);
    expect(voiceBudget("2", 10)).toBe(2);
    expect(voiceBudget("50", 10)).toBe(10);
    expect(voiceBudget("-1", 10)).toBe(5);
    expect(voiceBudget("4", 3)).toBe(3);
  });

  it("counts a minute at the API's rate with headroom, and a session at its longest", () => {
    expect(voiceCost(60)).toBeCloseTo(VOICE_USD_PER_MIN, 10);
    expect(reserveAdd()).toMatchObject({ voiceSecs: VOICE_SESSION_SECS, voiceCalls: 1 });
    expect(reserveAdd().elevenUsd).toBeCloseTo(voiceCost(VOICE_SESSION_SECS), 10);
  });

  it("lets a session start only while its longest fits the share and the whole cap", () => {
    const fresh = voiceUsage({}, NOW, 5, 10);
    expect(fresh).toMatchObject({ usedMin: 0, sessionMin: 3, canTalk: true });
    expect(fresh.budgetMin).toBeCloseTo(41.6, 1);

    // The share nearly spent: one more three-minute session would pass it.
    const nearShare = addStorySpend({}, NOW, { voiceUsd: 5 - voiceCost(VOICE_SESSION_SECS) / 2, voiceSecs: 2400, elevenUsd: 5 });
    expect(voiceUsage(nearShare, NOW, 5, 10).canTalk).toBe(false);

    // The stories took the cap: the talk's share has room but ElevenLabs' $10 doesn't.
    const storiesFull = addStorySpend({}, NOW, { elevenUsd: 10 - voiceCost(VOICE_SESSION_SECS) / 2 });
    const u = voiceUsage(storiesFull, NOW, 5, 10);
    expect(u.canTalk).toBe(false);
    expect(u.leftMin).toBeLessThan(3);

    // A new month starts clean.
    expect(voiceUsage(nearShare, Date.parse("2026-11-01T00:00:00Z"), 5, 10).canTalk).toBe(true);
    // No cap set (no key): nothing fits.
    expect(voiceUsage({}, NOW, 0, 0).canTalk).toBe(false);
  });

  it("settles a session to its real length, giving back what it didn't use", () => {
    let spend = addStorySpend({}, NOW, reserveAdd());
    spend = addStorySpend(spend, NOW, settleAdd(VOICE_SESSION_SECS, 45));
    const m = storyMonth(spend, NOW);
    expect(m.voiceSecs).toBe(45);
    expect(m.voiceUsd).toBeCloseTo(voiceCost(45), 10);
    expect(m.elevenUsd).toBeCloseTo(voiceCost(45), 10);
    expect(m.voiceCalls).toBe(1);
    expect(voiceUsage(spend, NOW, 5, 10).usedMin).toBe(0.8);
  });
});

describe("the talk's pace", () => {
  const tag = voiceTag("passkey", Buffer.from("k"));
  it("holds a passkey to a few sessions a minute", () => {
    let limits = {};
    for (let i = 0; i < VOICE_RULES.minute.max; i++) {
      expect(voiceWait(limits, tag, NOW)).toBe(0);
      limits = countVoice(limits, tag, NOW);
    }
    expect(voiceWait(limits, tag, NOW)).toBeGreaterThan(0);
    expect(voiceWait(limits, tag, NOW + 61_000)).toBe(0);
  });
});

describe("what Skippy is told and how the agent is set up", () => {
  it("scrubs the Desk's lines and takes out template braces", () => {
    const v = deskVariable("Builds in flight: 1\n  - #12 Mail nikita@example.com {{system__secret}}");
    expect(v).not.toContain("nikita@example.com");
    expect(v).not.toMatch(/[{}]/);
    expect(v).toContain("Builds in flight: 1");
    expect(deskVariable("")).toMatch(/nothing/);
    // No markup can survive, however it is nested.
    for (const evil of ["<scr<script>ipt>alert(1)</script>", "<<script>script>", "＜script＞"]) expect(deskVariable(evil)).not.toMatch(/[<>＜＞]/);
  });

  it("makes a private agent in Skippy's voice that hangs up at three minutes", () => {
    const body = agentBody("onwK4e9ZLuTAKqWW03F9");
    expect(body.conversation_config.tts.voice_id).toBe("onwK4e9ZLuTAKqWW03F9");
    expect(body.conversation_config.conversation.max_duration_seconds).toBe(VOICE_SESSION_SECS);
    expect(body.platform_settings.auth.enable_auth).toBe(true);
    expect(body.conversation_config.agent.prompt.prompt).toContain("{{desk}}");
    const core = agentBody("onwK4e9ZLuTAKqWW03F9", "core");
    expect(core.platform_settings.auth.enable_auth).toBe(true);
    expect(core.conversation_config.conversation.max_duration_seconds).toBe(VOICE_SESSION_SECS);
  });

  it("falls back to the core settings when ElevenLabs refuses an optional one, and keeps a matching agent as it is", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return seen.length === 1 ? new Response("{}", { status: 422 }) : Response.json({ agent_id: "agent_abc123" });
    }) as typeof fetch;
    const got = await ensureAgent(KEY, "voice1234", undefined, fetcher);
    expect(got).toEqual({ ok: true, id: "agent_abc123", sig: agentSig("voice1234", "core"), tier: "core" });
    expect(seen).toHaveLength(2);
    const again = await ensureAgent(KEY, "voice1234", { id: "agent_abc123", sig: agentSig("voice1234", "core"), tier: "core" }, fetcher);
    expect(again.ok).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

describe("why ElevenLabs refused (#470)", () => {
  const refused = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("reads ElevenLabs' reason code from the error body, the code before the legacy status, and never a sentence's other words", () => {
    expect(elevenReason({ detail: { type: "authentication_error", code: "invalid_api_key", message: "Invalid API key" } })).toBe("invalid_api_key");
    expect(elevenReason({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission convai_write" } })).toBe("missing_permissions");
    expect(elevenReason({ detail: { status: "quota_exceeded" } })).toBe("quota_exceeded");
    expect(elevenReason({ detail: "Invalid API key" })).toBe("invalid_api_key");
    expect(elevenReason({ detail: `bad key ${KEY}` })).toBe("");
    expect(elevenReason({ detail: [{ loc: ["body"], msg: "x", type: "value_error" }] })).toBe("");
    expect(elevenReason(null)).toBe("");
    expect(elevenReason({ detail: { status: "<script>" } })).toBe("");
  });

  it("tells a bad key from a missing permission from a plan's limit", () => {
    expect(classifyRefusal(401, "invalid_api_key")).toBe("key-invalid");
    expect(classifyRefusal(401, "")).toBe("key-invalid");
    expect(classifyRefusal(401, "unauthorized")).toBe("key-invalid");
    expect(classifyRefusal(401, "quota_exceeded")).toBe("plan");
    expect(classifyRefusal(401, "detected_unusual_activity")).toBe("plan");
    expect(classifyRefusal(401, "missing_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "missing_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "insufficient_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "")).toBe("agent-denied");
    expect(classifyRefusal(403, "subscription_required")).toBe("plan");
    expect(classifyRefusal(403, "feature_not_available")).toBe("plan");
    expect(classifyRefusal(402, "insufficient_credits")).toBe("plan");
    expect(classifyRefusal(402, "")).toBe("plan");
    expect(classifyRefusal(429, "rate_limit_exceeded")).toBe("plan");
    expect(classifyRefusal(429, "concurrent_limit_exceeded")).toBe("plan");
    expect(classifyRefusal(500, "internal_error")).toBe("eleven");
    expect(classifyRefusal(400, "invalid_parameters")).toBe("eleven");
  });

  it("falls back to the core settings on a 403 and gives up only when those are refused too, logging the status and code but never the key", async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    let n = 0;
    const firstRefused = (async () => (++n === 1 ? refused(403, { detail: { status: "feature_not_available", message: `nope ${KEY}` } }) : Response.json({ agent_id: "agent_abc123" }))) as unknown as typeof fetch;
    expect(await ensureAgent(KEY, "voice1234", undefined, firstRefused, log)).toEqual({ ok: true, id: "agent_abc123", sig: agentSig("voice1234", "core"), tier: "core" });
    expect(n).toBe(2);

    n = 0;
    const bothRefused = (async () => (++n, refused(403, { detail: { status: "missing_permissions", message: `key ${KEY}` } }))) as unknown as typeof fetch;
    expect(await ensureAgent(KEY, "voice1234", undefined, bothRefused, log)).toEqual({ ok: false, why: "agent-denied" });
    expect(n).toBe(2);

    n = 0;
    const badKey = (async () => (++n, refused(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }))) as unknown as typeof fetch;
    expect(await ensureAgent(KEY, "voice1234", undefined, badKey, log)).toEqual({ ok: false, why: "key-invalid" });
    expect(n).toBe(1);

    n = 0;
    const broke = (async () => (++n, refused(500, {}))) as unknown as typeof fetch;
    expect(await ensureAgent(KEY, "voice1234", undefined, broke, log)).toEqual({ ok: false, why: "eleven" });
    expect(n).toBe(1);

    expect(await mintToken(KEY, "agent_abc123", (async () => refused(402, { detail: { code: "insufficient_credits" } })) as unknown as typeof fetch, log)).toEqual({ why: "plan" });

    expect(lines).toContain("ElevenLabs refused the agent's full settings: HTTP 403, feature_not_available (plan).");
    expect(lines).toContain("ElevenLabs refused the agent's core settings: HTTP 403, missing_permissions (agent-denied).");
    expect(lines).toContain("ElevenLabs refused a call's token: HTTP 402, insufficient_credits (plan).");
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toMatch(/xi-api-key|nope|Invalid API key/);
  });
});

describe("POST /api/skippy-voice, with ElevenLabs stubbed", () => {
  const ORIGIN = "https://ceo.example";

  async function setup(over: Partial<VoiceDeps> = {}, eleven: { agent?: number; token?: number; done?: boolean } = {}) {
    const store = new MemoryAuthStore();
    const cookie = await signedInCookie("test-desk-key", NOW, store);
    const calls: { url: string; method: string; key: string | null }[] = [];
    const fetcher = (async (input: string, init?: RequestInit) => {
      const url = String(input);
      const h = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? "GET", key: h.get("xi-api-key") });
      if (url.includes("/agents/create")) return eleven.agent ? new Response("{}", { status: eleven.agent }) : Response.json({ agent_id: "agent_skippy01" });
      if (url.includes("/conversation/token")) return eleven.token ? new Response(JSON.stringify({ detail: `bad key ${KEY}` }), { status: eleven.token }) : Response.json({ token: "lk-token-abcdefgh", conversation_id: "conv_0001" });
      if (url.includes("/conversations/")) return Response.json({ status: eleven.done ? "done" : "in-progress", metadata: { call_duration_secs: 50 } });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const stories = new MemoryStoryStore();
    const voice = new MemoryVoiceStore();
    const deps: VoiceDeps = {
      deskKey: "test-desk-key",
      store,
      stories,
      voice,
      eleven: { key: KEY, voice: "onwK4e9ZLuTAKqWW03F9", budget: 10 },
      budget: 5,
      desk: async () => "Ideas waiting for Nikita's pick: 2\nBuilds in flight: 1",
      fetcher,
      now: NOW,
      ...over,
    };
    const post = (body: unknown, c = cookie) => talk(new Request(`${ORIGIN}/api/skippy-voice`, { method: "POST", headers: { Cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
    const get = (c = cookie) => status(new Request(`${ORIGIN}/api/skippy-voice`, { headers: { Cookie: c } }), deps);
    return { post, get, calls, stories, voice, deps };
  }

  it("mints a one-session token for a signed-in Desk, counted at its longest, and never shows the key", async () => {
    const { post, calls, stories, voice } = await setup();
    const res = await post({ action: "start" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as { ok: boolean; token: string; conversation: string; maxSecs: number; desk: string; usage: { usedMin: number } };
    expect(body).toMatchObject({ ok: true, token: "lk-token-abcdefgh", conversation: "conv_0001", maxSecs: VOICE_SESSION_SECS });
    expect(body.desk).toContain("Builds in flight: 1");
    expect(body.usage.usedMin).toBe(3);
    expect(storyMonth(stories.spend, NOW).voiceCalls).toBe(1);
    expect(voice.state.agent?.id).toBe("agent_skippy01");
    expect(voice.state.pending.map((p) => p.id)).toEqual(["conv_0001"]);
    // The key only ever travels in ElevenLabs' header, never in a URL.
    expect(calls.every((c) => c.key === KEY && !c.url.includes(KEY))).toBe(true);
  });

  it("refuses without a session and calls nothing", async () => {
    const { post, get, calls } = await setup();
    expect((await post({ action: "start" }, "")).status).toBe(401);
    expect((await get("")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses a cross-site request", async () => {
    const { deps, calls } = await setup();
    const cookie = await signedInCookie("test-desk-key", NOW, deps.store!);
    const res = await talk(new Request("https://ceo.example/api/skippy-voice", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }), deps);
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("says no-key without the ElevenLabs key, and not-set-up without the Desk's sign-in", async () => {
    expect((await (await setup({ eleven: null })).post({ action: "start" })).status).toBe(503);
    const off = await (await setup({ eleven: null })).get();
    expect(await off.json()).toMatchObject({ ready: false, reason: "no-key" });
    expect((await (await setup({ deskKey: "" })).post({ action: "start" })).status).toBe(503);
  });

  it("refuses a new token once the month's share is spent, without calling ElevenLabs", async () => {
    const stories = new MemoryStoryStore();
    stories.spend = addStorySpend({}, NOW, { voiceUsd: 4.9, voiceSecs: 2450, elevenUsd: 4.9 });
    const { post, get, calls } = await setup({ stories });
    const res = await post({ action: "start" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: "capped" });
    expect(calls).toEqual([]);
    expect(await (await get()).json()).toMatchObject({ ready: false, reason: "capped" });
  });

  it("refuses when the day's stories have taken ElevenLabs' whole cap", async () => {
    const stories = new MemoryStoryStore();
    stories.spend = addStorySpend({}, NOW, { elevenUsd: 9.9 });
    const { post } = await setup({ stories });
    expect(await (await post({ action: "start" })).json()).toMatchObject({ ok: false, reason: "capped" });
  });

  it("holds a passkey to the pace", async () => {
    const { post } = await setup();
    for (let i = 0; i < VOICE_RULES.minute.max; i++) expect((await post({ action: "start" })).status).toBe(200);
    const res = await post({ action: "start" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("says why ElevenLabs refused, without echoing ElevenLabs' answer", async () => {
    const { post, stories } = await setup({}, { agent: 401 });
    const res = await post({ action: "start" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "key-invalid" });
    expect(await (await (await setup({}, { agent: 403 })).post({ action: "start" })).json()).toEqual({ error: "agent-denied" });
    expect(await (await (await setup({}, { agent: 402 })).post({ action: "start" })).json()).toEqual({ error: "plan" });
    expect(await (await (await setup({}, { token: 429 })).post({ action: "start" })).json()).toEqual({ error: "plan" });
    expect(storyMonth(stories.spend, NOW).voiceCalls).toBe(0);
    const failed = await (await setup({}, { token: 500 })).post({ action: "start" });
    const text = await failed.text();
    expect(failed.status).toBe(502);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({ error: "eleven" });
  });

  it("settles an ended call to its real length", async () => {
    const { post, stories, voice, deps } = await setup();
    await post({ action: "start" });
    // Still running: stays counted at its longest.
    await post({ action: "end", conversation: "conv_0001" });
    expect(storyMonth(stories.spend, NOW).voiceSecs).toBe(VOICE_SESSION_SECS);
    // Over: 50 seconds, the rest given back.
    const done = await setup({ stories, voice, store: deps.store }, { done: true });
    const res = await done.post({ action: "end", conversation: "conv_0001" }, await signedInCookie("test-desk-key", NOW, deps.store!));
    expect(res.status).toBe(200);
    expect(storyMonth(stories.spend, NOW).voiceSecs).toBe(50);
    expect(voice.state.pending).toEqual([]);
  });

  it("refuses a malformed request", async () => {
    const { post } = await setup();
    expect((await post({ action: "nope" })).status).toBe(400);
    expect((await post({ action: "end", conversation: "../../x" })).status).toBe(400);
  });
});
