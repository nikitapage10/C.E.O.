import { describe, expect, it } from "vitest";
import { DESK_LATE, DESK_WAIT_MS, stageTimer, status, talk, type VoiceDeps } from "./skippy-voice.ts";
import { MemoryVoiceStore } from "./_skippy/voice.ts";
import { MemoryAuthStore } from "./_desk/store.ts";
import { signedInCookie } from "./_desk/testing.ts";
import { MemoryCrewStore } from "./_skippy/voicetoken.ts";
import { MemoryRoomLog } from "./_skippy/log.ts";

/** Talk starts fast (#496): the start's stages timed, the slow ones off its path, and a warm-up before the tap. */

const NOW = Date.parse("2026-10-27T08:30:00Z");
const KEY = "sk_test_eleven_key_never_logged_0123456789";
const ORIGIN = "https://ceo.example";
const DESK = "test-desk-key-0123456789";

async function setup(over: Partial<VoiceDeps> = {}) {
  const store = new MemoryAuthStore();
  const cookie = await signedInCookie(DESK, NOW, store);
  const calls: string[] = [];
  let n = 0;
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = String(input).replace("https://api.elevenlabs.io", "");
    calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    if (url.includes("/agents/create")) return Response.json({ agent_id: `agent_${++n}xxxx` });
    if (url.startsWith("/v1/convai/tools")) return Response.json({ id: `tool_${++n}xxxx` });
    if (url.includes("/conversation/token")) return Response.json({ token: "lk-token-abcdefgh", conversation_id: `conv_${++n}xxxx` });
    if (url.includes("/conversations/")) return Response.json({ status: "done", metadata: { call_duration_secs: 30 } });
    if (url.includes("/agents/")) return Response.json({});
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const deps: VoiceDeps = {
    deskKey: DESK,
    store,
    voice: new MemoryVoiceStore(),
    eleven: { key: KEY, voice: "onwK4e9ZLuTAKqWW03F9", budget: 10 },
    desk: async () => "Builds in flight: 1",
    crew: new MemoryCrewStore(),
    roomLog: new MemoryRoomLog(),
    site: ORIGIN,
    fetcher,
    now: NOW,
    ...over,
  };
  const post = (body: unknown) => talk(new Request(`${ORIGIN}/api/skippy-voice`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
  const get = (q = "", c = cookie) => status(new Request(`${ORIGIN}/api/skippy-voice${q}`, { headers: { Cookie: c } }), deps);
  return { post, get, calls, deps };
}

describe("Talk's start (#496)", () => {
  it("times its stages into a Server-Timing header: names and milliseconds only", async () => {
    const { post } = await setup();
    const res = await post({ action: "start" });
    expect(res.status).toBe(200);
    const timing = res.headers.get("Server-Timing")!;
    for (const stage of ["pace", "count", "desk", "credits", "agent", "mint", "keep", "total"]) expect(timing).toMatch(new RegExp(`(^|, )${stage};dur=\\d+`));
    expect(timing).not.toContain(KEY);
  });

  it("after the warm-up, a tap makes one ElevenLabs call: the token", async () => {
    const { get, post, calls } = await setup();
    const warm = await get("?warm=1");
    expect(warm.status).toBe(200);
    expect(await warm.json()).toEqual({ ok: true });
    expect(warm.headers.get("Server-Timing")).toMatch(/agent;dur=\d+/);
    // The warm-up made Skippy, his tools and his crew (the first time ever, or after a deploy that changed them).
    expect(calls.some((c) => c.startsWith("POST /v1/convai/agents/create"))).toBe(true);
    calls.length = 0;
    expect((await post({ action: "start" })).status).toBe(200);
    expect(calls).toEqual(["GET /v1/convai/conversation/token"]);
  });

  it("doesn't wait long on the Desk's lines: cold, the call starts without them", async () => {
    const { post } = await setup({ desk: () => new Promise((r) => setTimeout(() => r("late lines"), 5_000)) });
    const t0 = Date.now();
    const res = await post({ action: "start" });
    expect(Date.now() - t0).toBeLessThan(DESK_WAIT_MS + 1_500);
    const body = (await res.json()) as { desk: string };
    expect(body.desk).toContain(DESK_LATE.replace(/[()]/g, "").split(":")[0]);
    expect(body.desk).not.toContain("late lines");
  });

  it("the warm-up is for a signed-in Desk only", async () => {
    const { get } = await setup();
    expect((await get("?warm=1", "")).status).toBe(401);
  });

  it("the stage timer sums nothing up: each stage its own span, and the whole", async () => {
    let now = 0;
    const t = stageTimer(() => now);
    now = 5; // the start's own work before its first stage
    await t.time("a", new Promise((r) => setTimeout(r, 0)).then(() => (now += 30)));
    expect(t.header()).toBe("a;dur=30, total;dur=35");
  });
});
