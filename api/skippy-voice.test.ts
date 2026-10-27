import { describe, expect, it } from "vitest";
import { status, talk, type VoiceDeps } from "./skippy-voice.ts";
import {
  VOICE_MAX_SECS,
  VOICE_SILENCE_SECS,
  MemoryVoiceStore,
  VOICE_RULES,
  agentBody,
  agentSig,
  billLines,
  classifyRefusal,
  fetchCredits,
  readCredits,
  countVoice,
  deskVariable,
  elevenReason,
  ensureAgent,
  mintToken,
  voiceTag,
  voiceWait,
} from "./_skippy/voice.ts";
import { MemoryAuthStore } from "./_desk/store.ts";
import { signedInCookie } from "./_desk/testing.ts";
import { MemoryRoomLog } from "./_skippy/log.ts";
import { MemoryCrewStore, checkToolToken, issueToolToken, noteHandoff } from "./_skippy/voicetoken.ts";
import { TOOL_DEFS } from "./_skippy/voicecrew.ts";

const NOW = Date.parse("2026-10-25T16:00:00Z");
const KEY = "sk_test_eleven_key_that_must_never_leak_0123456789";

describe("the plan's credits Skippy is told (#477, #532)", () => {
  it("writes them as plain lines, with no site cap, only when ElevenLabs answered", () => {
    expect(billLines(null)).toBe("");
    const plan = { used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" };
    const lines = billLines(plan);
    expect(lines).toContain("creator plan credits: 21,743 left of 122,113 this cycle (100,370 used), resets 2026-11-05.");
    expect(lines).toContain("no limit of the site's own");
    expect(lines).not.toMatch(/share|cap\b|dollars/);
    // Through the voice agent's variable, every number survives.
    const v = deskVariable(`${lines}\nBuilds in flight: 1`);
    expect(v).toContain("21,743 left of 122,113");
    expect(v).not.toContain("[amount]");
    expect(v).not.toContain("[private]");
  });

  it("reads the plan's credits from ElevenLabs' subscription, failing soft", async () => {
    expect(readCredits({ tier: "creator", character_count: 100370, character_limit: 122113, next_character_count_reset_unix: 1793836800 })).toEqual({ used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" });
    expect(readCredits({ character_count: 5, character_limit: 10 })).toEqual({ used: 5, limit: 10, resetAt: null, tier: null });
    expect(readCredits({ character_count: "lots" })).toBeNull();
    expect(readCredits(null)).toBeNull();
    const seen: string[] = [];
    const ok = (async (input: string, init?: RequestInit) => {
      seen.push(`${String(input)} ${new Headers(init?.headers).get("xi-api-key") === KEY}`);
      return Response.json({ character_count: 1, character_limit: 2 });
    }) as typeof fetch;
    expect(await fetchCredits(KEY, ok)).toMatchObject({ used: 1, limit: 2 });
    expect(seen).toEqual(["https://api.elevenlabs.io/v1/user/subscription true"]);
    expect(await fetchCredits(KEY, (async () => new Response("{}", { status: 401 })) as typeof fetch)).toBeNull();
    expect(await fetchCredits(KEY, (async () => Promise.reject(new Error("down"))) as typeof fetch)).toBeNull();
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

  it("makes a private agent in Skippy's voice that hangs up after two minutes of silence and has no call-length cap of the site's own", () => {
    const body = agentBody("onwK4e9ZLuTAKqWW03F9");
    expect(body.conversation_config.tts.voice_id).toBe("onwK4e9ZLuTAKqWW03F9");
    expect(body.conversation_config.conversation.max_duration_seconds).toBe(VOICE_MAX_SECS);
    expect(VOICE_MAX_SECS).toBeGreaterThan(600);
    expect(body.conversation_config.turn?.silence_end_call_timeout).toBe(VOICE_SILENCE_SECS);
    expect(VOICE_SILENCE_SECS).toBe(120);
    expect(body.platform_settings.auth.enable_auth).toBe(true);
    expect(body.conversation_config.agent.prompt.prompt).toContain("{{desk}}");
    const core = agentBody("onwK4e9ZLuTAKqWW03F9", "core");
    expect(core.platform_settings.auth.enable_auth).toBe(true);
    expect(core.conversation_config.conversation.max_duration_seconds).toBeUndefined();
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
    expect(classifyRefusal(401, "quota_exceeded")).toBe("quota");
    expect(classifyRefusal(401, "detected_unusual_activity")).toBe("plan");
    expect(classifyRefusal(401, "missing_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "missing_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "insufficient_permissions")).toBe("agent-denied");
    expect(classifyRefusal(403, "")).toBe("agent-denied");
    expect(classifyRefusal(403, "subscription_required")).toBe("plan");
    expect(classifyRefusal(403, "feature_not_available")).toBe("plan");
    expect(classifyRefusal(402, "insufficient_credits")).toBe("quota");
    expect(classifyRefusal(402, "")).toBe("quota");
    expect(classifyRefusal(200, "quota_exceeded")).toBe("quota");
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

    expect(await mintToken(KEY, "agent_abc123", (async () => refused(402, { detail: { code: "insufficient_credits" } })) as unknown as typeof fetch, log)).toEqual({ why: "quota" });

    expect(lines).toContain("ElevenLabs refused the agent's full settings: HTTP 403, feature_not_available (plan).");
    expect(lines).toContain("ElevenLabs refused the agent's core settings: HTTP 403, missing_permissions (agent-denied).");
    expect(lines).toContain("ElevenLabs refused a call's token: HTTP 402, insufficient_credits (quota).");
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toMatch(/xi-api-key|nope|Invalid API key/);
  });
});

describe("POST /api/skippy-voice, with ElevenLabs stubbed", () => {
  const ORIGIN = "https://ceo.example";

  async function setup(over: Partial<VoiceDeps> = {}, eleven: { agent?: number; token?: number; done?: boolean } = {}) {
    const store = new MemoryAuthStore();
    const cookie = await signedInCookie("test-desk-key-0123456789", NOW, store);
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
    const voice = new MemoryVoiceStore();
    const deps: VoiceDeps = {
      deskKey: "test-desk-key-0123456789",
      store,
      voice,
      eleven: { key: KEY, voice: "onwK4e9ZLuTAKqWW03F9", budget: 10 },
      desk: async () => "Ideas waiting for Nikita's pick: 2\nBuilds in flight: 1",
      fetcher,
      now: NOW,
      ...over,
    };
    const post = (body: unknown, c = cookie) => talk(new Request(`${ORIGIN}/api/skippy-voice`, { method: "POST", headers: { Cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
    const get = (c = cookie) => status(new Request(`${ORIGIN}/api/skippy-voice`, { headers: { Cookie: c } }), deps);
    return { post, get, calls, voice, deps };
  }

  it("mints a one-session token for a signed-in Desk, followed until it is over, and never shows the key", async () => {
    const { post, calls, voice } = await setup();
    const res = await post({ action: "start" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as { ok: boolean; token: string; conversation: string; desk: string };
    expect(body).toMatchObject({ ok: true, token: "lk-token-abcdefgh", conversation: "conv_0001" });
    // No site cap rides along: no call length, no minutes, no budget (#532).
    expect(body).not.toHaveProperty("maxSecs");
    expect(body).not.toHaveProperty("usage");
    expect(body.desk).toContain("Builds in flight: 1");
    // No credits line when none were read.
    expect(body.desk).not.toContain("credits");
    expect(voice.state.agent?.id).toBe("agent_skippy01");
    expect(voice.state.pending.map((p) => p.id)).toEqual(["conv_0001"]);
    // The key only ever travels in ElevenLabs' header, never in a URL.
    expect(calls.every((c) => c.key === KEY && !c.url.includes(KEY))).toBe(true);
  });

  it("shows a signed-in Desk the plan's credits, and leaves the credits out when ElevenLabs fails (#477)", async () => {
    const plan = { used: 100370, limit: 122113, resetAt: "2026-11-05", tier: "creator" };
    const { get, post } = await setup({ credits: async () => plan });
    const body = (await (await get()).json()) as { ready: boolean; usage?: unknown; credits?: unknown };
    expect(body.ready).toBe(true);
    expect(body).not.toHaveProperty("usage");
    expect(body.credits).toEqual(plan);
    const started = (await (await post({ action: "start" })).json()) as { desk: string };
    expect(started.desk).toContain("creator plan credits: 21,743 left of 122,113 this cycle (100,370 used), resets 2026-11-05.");
    const failing = await setup({ credits: async () => Promise.reject(new Error("down")) });
    const soft = (await (await failing.get()).json()) as { ready: boolean; credits?: unknown };
    expect(soft.ready).toBe(true);
    expect(soft).not.toHaveProperty("credits");
  });

  it("refuses without a session and calls nothing", async () => {
    const { post, get, calls } = await setup();
    expect((await post({ action: "start" }, "")).status).toBe(401);
    expect((await get("")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses a cross-site request", async () => {
    const { deps, calls } = await setup();
    const cookie = await signedInCookie("test-desk-key-0123456789", NOW, deps.store!);
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

  it("keeps no budget of its own (#532): a month of heavy talk and stories never stops a call", async () => {
    const { post, get } = await setup({ eleven: { key: KEY, voice: "onwK4e9ZLuTAKqWW03F9", budget: 10 } });
    expect(await (await get()).json()).toMatchObject({ ready: true });
    for (let i = 0; i < VOICE_RULES.minute.max; i++) expect(await (await post({ action: "start" })).json()).toMatchObject({ ok: true });
  });

  it("holds a passkey to the pace", async () => {
    const { post } = await setup();
    for (let i = 0; i < VOICE_RULES.minute.max; i++) expect((await post({ action: "start" })).status).toBe(200);
    const res = await post({ action: "start" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("says why ElevenLabs refused, without echoing ElevenLabs' answer", async () => {
    const { post } = await setup({}, { agent: 401 });
    const res = await post({ action: "start" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "key-invalid" });
    expect(await (await (await setup({}, { agent: 403 })).post({ action: "start" })).json()).toEqual({ error: "agent-denied" });
    expect(await (await (await setup({}, { agent: 402 })).post({ action: "start" })).json()).toEqual({ error: "quota" });
    expect(await (await (await setup({}, { token: 402 })).post({ action: "start" })).json()).toEqual({ error: "quota" });
    expect(await (await (await setup({}, { token: 429 })).post({ action: "start" })).json()).toEqual({ error: "plan" });
    const failed = await (await setup({}, { token: 500 })).post({ action: "start" });
    const text = await failed.text();
    expect(failed.status).toBe(502);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({ error: "eleven" });
  });

  it("follows an ended call and lets it go (#532: no money moves)", async () => {
    const { post, voice, deps } = await setup();
    await post({ action: "start" });
    // Still running: stays followed.
    await post({ action: "end", conversation: "conv_0001" });
    expect(voice.state.pending.map((p) => p.id)).toEqual(["conv_0001"]);
    // Over: let go.
    const done = await setup({ voice, store: deps.store }, { done: true });
    const res = await done.post({ action: "end", conversation: "conv_0001" }, await signedInCookie("test-desk-key-0123456789", NOW, deps.store!));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(voice.state.pending).toEqual([]);
  });

  it("with Skippy's crew (#479): makes the tools and subminds once, gives the call its own tool key, revokes it at the end, and logs the subminds' exchanges", async () => {
    const crew = new MemoryCrewStore();
    const roomLog = new MemoryRoomLog();
    const made: { url: string; method: string; body: Record<string, unknown> }[] = [];
    let n = 0;
    let done = false;
    const fetcher = (async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") made.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      if (url.endsWith("/v1/convai/tools") && method === "POST") return Response.json({ id: `tool_${String(++n).padStart(4, "0")}` });
      if (url.includes("/agents/create")) return Response.json({ agent_id: `agent_${String(++n).padStart(4, "0")}` });
      if (method === "PATCH") return Response.json({});
      if (url.includes("/conversation/token")) return Response.json({ token: "lk-token-abcdefgh", conversation_id: "conv_0001" });
      if (url.includes("/conversations/")) {
        const turf = (await crew.load(NOW)).agents.turf?.id;
        return Response.json({
          status: done ? "done" : "in-progress",
          metadata: { call_duration_secs: 80, start_time_unix_secs: NOW / 1000 },
          transcript: [
            { role: "user", message: "Give me the full play-by-play on the waiver race", time_in_call_secs: 5 },
            { role: "agent", message: "Handing you to the Commentator.", time_in_call_secs: 7, agent_metadata: { agent_id: "agent_0001" } },
            { role: "agent", message: "Two managers are circling the same kicker, folks!", time_in_call_secs: 9, agent_metadata: { agent_id: turf } },
          ],
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const { post } = await setup({ crew, roomLog, site: "https://ceo.example", fetcher });
    const started = await post({ action: "start" });
    const body = (await started.json()) as { tool?: string; conversation: string; crew?: Record<string, string> };
    expect(started.status, JSON.stringify(body)).toBe(200);
    expect(body.tool).toMatch(/^vt1\./);
    expect(await checkToolToken(body.tool, "test-desk-key-0123456789", crew, NOW)).toMatchObject({ ok: true, conversation: "conv_0001" });
    // Every lookup and each live submind exists on ElevenLabs, and Skippy's agent carries them.
    const kept = await crew.load(NOW);
    expect(Object.keys(kept.tools).sort()).toEqual(TOOL_DEFS.map((t) => t.name).sort());
    expect(Object.keys(kept.agents).sort()).toEqual(["ember", "soot", "static", "ticker", "turf"]);
    // The hologram's crew (#481): each submind's agent id, to its own id.
    expect(Object.values(body.crew ?? {}).sort()).toEqual(["ember", "soot", "static", "ticker", "turf"]);
    expect(body.crew?.[kept.agents.turf!.id]).toBe("turf");
    const skippy = made.filter((m) => m.method === "PATCH" && m.url.endsWith("/agents/agent_0001")).at(-1)!;
    const prompt = ((skippy.body.conversation_config as Record<string, Record<string, Record<string, unknown>>>).agent!.prompt!) as { tool_ids: string[]; built_in_tools: { transfer_to_agent: unknown } };
    expect(prompt.tool_ids).toHaveLength(TOOL_DEFS.length);
    expect(prompt.built_in_tools.transfer_to_agent).toBeTruthy();
    // A second call changes nothing on ElevenLabs.
    const before = made.length;
    await post({ action: "start" });
    expect(made.filter((m, i) => i >= before && !m.url.includes("/conversation/token")).length).toBe(0);
    // The end revokes the call's key; once the call is over the Commentator's stretch goes to the Council.
    done = true;
    await post({ action: "end", conversation: "conv_0001" });
    expect(await checkToolToken(body.tool, "test-desk-key-0123456789", crew, NOW)).toEqual({ ok: false, why: "ended" });
    const [logged] = await roomLog.list("green", NOW);
    expect(logged).toMatchObject({ room: "green", via: "voice", by: "turf", question: "Give me the full play-by-play on the waiver race" });
    expect(logged!.answer).toMatch(/circling the same kicker/);
  });

  it("lists a call's hand-offs to a signed-in Desk only", async () => {
    const crew = new MemoryCrewStore();
    const { deps } = await setup({ crew });
    const cookie = await signedInCookie("test-desk-key-0123456789", NOW, deps.store!);
    const ask = (q: string, c = cookie) => status(new Request(`https://ceo.example/api/skippy-voice?handoffs=${q}`, { headers: { Cookie: c } }), deps);
    expect(await (await ask("conv_0001")).json()).toEqual({ handoffs: [] });
    const t = await issueToolToken(crew, "test-desk-key-0123456789", "conv_0001", NOW + 60_000, NOW);
    const check = await checkToolToken(t, "test-desk-key-0123456789", crew, NOW);
    expect(check.ok).toBe(true);
    if (check.ok) await noteHandoff(crew, check.hash, "0123456789abcdef", NOW);
    expect(await (await ask("conv_0001")).json()).toEqual({ handoffs: ["0123456789abcdef"] });
    expect((await ask("../x")).status).toBe(400);
    expect((await ask("conv_0001", "")).status).toBe(401);
  });

  it("refuses a malformed request", async () => {
    const { post } = await setup();
    expect((await post({ action: "nope" })).status).toBe(400);
    expect((await post({ action: "end", conversation: "../../x" })).status).toBe(400);
  });
});
