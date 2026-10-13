import { describe, expect, it, vi } from "vitest";
import { audioResponse, handleGet, handlePost, MAX_BODY, type DayStoryEnv } from "./day-story.ts";
import { MemoryStore } from "./_world/store.ts";
import { MemoryStoryStore, SAMPLE_RATE, wavOf } from "./_world/story.ts";

const GEMINI = "AIzaTESTKEY-never-in-a-response-42";
const DESK = "correct horse battery staple";
/** 3 pm Mountain on 13 October 2026. */
const NOW = Date.parse("2026-10-13T21:00:00Z");
const TODAY = "2026-10-13";
const YESTERDAY = "2026-10-12";

const PCM = new Uint8Array(SAMPLE_RATE * 2).fill(3);
const geminiFetch = () =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", data: Buffer.from(PCM).toString("base64") }] }], usage: { total_input_tokens: 300, total_output_tokens: 25 } }), {
        status: 200,
      }),
  );

function setup(env: Record<string, string | undefined> = {}) {
  const world = new MemoryStore();
  const hour = (day: string, step: number) => ({ step, at: `${day}T18:05:00.000Z`, day, source: "scripted" as const, summary: `Hour ${step} in Ilyr.`, scenes: [], changes: [], remarks: [], events: [], cost: null });
  world.days.set(TODAY, { day: TODAY, entries: [hour(TODAY, 2)], recap: null });
  world.days.set(YESTERDAY, { day: YESTERDAY, entries: [hour(YESTERDAY, 1)], recap: "Yesterday, footnoted." });
  const stories = new MemoryStoryStore();
  const fetcher = geminiFetch();
  const deps: DayStoryEnv = { world, stories, env: { GEMINI_API_KEY: GEMINI, FOUNDRY_DESK_KEY: DESK, ...env }, now: NOW, fetcher };
  return { deps, stories, fetcher };
}

const post = (body: unknown) => new Request("https://ceo.test/api/day-story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (q: string, headers: Record<string, string> = {}) => new Request(`https://ceo.test/api/day-story?${q}`, { headers });

describe("the backfill (POST /api/day-story) is gated by the Desk key", () => {
  it("refuses a wrong, missing or differently sized key, and calls nothing", async () => {
    const { deps, fetcher } = setup();
    for (const key of ["wrong", "", DESK.slice(0, -1), `${DESK}!`, undefined, 42]) {
      const res = await handlePost(post({ key }), deps);
      expect(res.status, String(key)).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is not set up without a Desk key on the server", async () => {
    const { deps, fetcher } = setup({ FOUNDRY_DESK_KEY: "" });
    expect((await handlePost(post({ key: "" }), deps)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("makes yesterday's story first (its recap is filed), then today's so far, each once", async () => {
    const { deps, fetcher } = setup();
    const first = (await (await handlePost(post({ key: DESK }), deps)).json()) as { day: string; made: boolean; story: { partial: boolean; audio: string } };
    expect(first).toMatchObject({ day: YESTERDAY, made: true, story: { partial: false } });
    expect(first.story.audio).toMatch(/^\/api\/day-story\?day=2026-10-12&audio=1&v=\d+$/);
    const second = (await (await handlePost(post({ key: DESK }), deps)).json()) as { day: string; made: boolean; story: { partial: boolean } };
    expect(second).toMatchObject({ day: TODAY, made: true, story: { partial: true } });
    const third = (await (await handlePost(post({ key: DESK, day: TODAY }), deps)).json()) as { made: boolean; reason: string };
    expect(third).toMatchObject({ made: false, reason: "exists" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("remakes a story read in the old, slow style once, in the new voice (#102)", async () => {
    const { deps, stories, fetcher } = setup();
    await handlePost(post({ key: DESK, day: YESTERDAY }), deps);
    const made = (await stories.readStory(YESTERDAY))!;
    const old = { ...made, voice: "Gacrux" };
    delete old.style;
    stories.stories.set(YESTERDAY, old);
    stories.claims.clear();
    expect(await (await handleGet(get(`day=${YESTERDAY}`), deps)).json()).toMatchObject({ ready: true, stale: true });
    const remade = (await (await handlePost(post({ key: DESK, day: YESTERDAY }), { ...deps, now: NOW + 60_000 })).json()) as { made: boolean; story: { stale: boolean } };
    expect(remade).toMatchObject({ made: true, story: { stale: false } });
    const again = (await (await handlePost(post({ key: DESK, day: YESTERDAY }), { ...deps, now: NOW + 120_000 })).json()) as { made: boolean; reason: string };
    expect(again).toMatchObject({ made: false, reason: "exists" });
    expect((await handlePost(post({ key: "wrong", day: YESTERDAY }), deps)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("only for today or yesterday", async () => {
    const { deps, fetcher } = setup();
    expect((await handlePost(post({ key: DESK, day: "2026-10-01" }), deps)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never returns the Gemini key", async () => {
    const { deps } = setup();
    const res = await handlePost(post({ key: DESK }), deps);
    expect(await res.text()).not.toContain(GEMINI);
  });
});

describe("reading a story (GET)", () => {
  it("says plainly why there is no audio: no key, over budget, not yet", async () => {
    const noKey = setup({ GEMINI_API_KEY: "" });
    expect(await (await handleGet(get(`day=${TODAY}`), noKey.deps)).json()).toEqual({ day: TODAY, ready: false, reason: "no-key" });
    const spent = setup({ GEMINI_BUDGET_USD: "1" });
    spent.stories.spend = { "2026-10": { usd: 1, tokensIn: 0, tokensOut: 0, calls: 9, stories: 9, scriptUsd: 0 } };
    expect(await (await handleGet(get(`day=${TODAY}`), spent.deps)).json()).toMatchObject({ reason: "over-budget" });
    const fresh = setup();
    const res = await handleGet(get(`day=${TODAY}`), fresh.deps);
    expect(await res.text()).not.toContain(GEMINI);
    expect(await (await handleGet(get(`day=${TODAY}`), fresh.deps)).json()).toMatchObject({ reason: "not-yet" });
  });

  it("serves the transcript, then the WAV from our own origin, cached when versioned", async () => {
    const { deps } = setup();
    await handlePost(post({ key: DESK, day: YESTERDAY }), deps);
    const view = (await (await handleGet(get(`day=${YESTERDAY}`), deps)).json()) as { ready: boolean; script: string; durationSec: number; audio: string };
    expect(view).toMatchObject({ ready: true, durationSec: 1, stale: false });
    expect(view.script.length).toBeGreaterThan(20);
    const audio = await handleGet(new Request(`https://ceo.test${view.audio}`), deps);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect(audio.headers.get("cache-control")).toContain("immutable");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(bytes.length).toBe(44 + PCM.length);
  });

  it("404s audio that isn't there and refuses a bad day", async () => {
    const { deps } = setup();
    expect((await handleGet(get(`day=${TODAY}&audio=1`), deps)).status).toBe(404);
    expect((await handleGet(get("day=../../etc"), deps)).status).toBe(400);
  });
});

describe("serving a long story in ranges", () => {
  const big = wavOf(new Uint8Array(MAX_BODY + 1000));

  it("answers 206 with at most MAX_BODY bytes, never shared-cached", async () => {
    const res = audioResponse(big, "bytes=0-", false);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-${MAX_BODY - 1}/${big.length}`);
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    expect((await res.arrayBuffer()).byteLength).toBe(MAX_BODY);
    const tail = audioResponse(big, `bytes=${MAX_BODY}-`, false);
    expect(tail.headers.get("content-range")).toBe(`bytes ${MAX_BODY}-${big.length - 1}/${big.length}`);
    expect(audioResponse(big, `bytes=${big.length + 5}-`, false).status).toBe(416);
  });
});
