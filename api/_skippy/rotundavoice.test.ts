import { describe, expect, it } from "vitest";
import type { BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { PhoneTodos } from "../_haven/todos.ts";
import { MemoryStoryStore, elevenCost, storyMonth } from "../_world/story.ts";
import { roomVoicePost, type RoomRouteDeps } from "./roomroute.ts";
import { ROOM_TTS_MODEL, ROOM_VOICES } from "./roomvoice.ts";
import { ROTUNDA_CACHE, ROTUNDA_RESERVE_CHARS, ROTUNDA_VOICES, forgetCredits, lineKey, speakCast } from "./rotundavoice.ts";
import { SUBMIND_TITLE } from "@ceo/desk/rotunda/rite.ts";
import { rateOf } from "@ceo/desk/rotunda/senators.ts";

/** Today's Rotunda read aloud (#755): one voice per member, each line made once ever, under the cap and its share. Every key and line is made up. */

const DESK = "a test desk key, not a real one";
const NOW = Date.parse("2026-11-05T02:00:00Z");
const eleven = { key: "test-eleven", voice: "testSkippyVoice01", budget: Number.POSITIVE_INFINITY };

function memoryBlob() {
  const files = new Map<string, Uint8Array>();
  const blob: BlobBackend = {
    kind: "azureblob",
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: "1", contentType: "audio/mpeg" } : null),
    etag: async (path) => (files.has(path) ? "1" : null),
    put: async (path, body) => {
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
  return { blob, files };
}

function fakeEleven(status = 200, left: number | null = null) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // The plan's credits (a read, not a line): unreadable unless the test gives a number.
    if (String(input).endsWith("/v1/user/subscription"))
      return left === null ? new Response("no", { status: 401 }) : Response.json({ character_count: 100_000 - left, character_limit: 100_000 });
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return status === 200 ? new Response(new Uint8Array(3_000).fill(9), { headers: { "Content-Type": "audio/mpeg" } }) : new Response("no", { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("the Rotunda's voices (#755)", () => {
  it("gives every member of the chamber Skippy's voice, each bent its own way", () => {
    expect(Object.keys(ROTUNDA_VOICES).sort()).toEqual(Object.keys(SUBMIND_TITLE).sort());
    const subs = Object.entries(ROTUNDA_VOICES).filter(([id]) => id !== "kernel");
    expect(subs.length).toBe(12);
    for (const [id, v] of subs) expect(v.name, id).toBe(SUBMIND_TITLE[id]);
    // No two members sound alike: each has its own pace and steadiness.
    const bends = Object.values(ROTUNDA_VOICES).map((v) => JSON.stringify([v.sound.speed, v.sound.stability, v.sound.similarity_boost]));
    expect(new Set(bends).size).toBe(13);
  });

  it("makes each line at a pace that comes back to the member's own once the browser shifts it into its register (#856)", () => {
    for (const [id, v] of Object.entries(ROTUNDA_VOICES)) {
      expect(v.sound.speed, id).toBeGreaterThanOrEqual(0.7);
      expect(v.sound.speed, id).toBeLessThanOrEqual(1.2);
      const own = ROOM_VOICES[id]?.sound.speed;
      if (own !== undefined) expect(v.sound.speed * rateOf(id), id).toBeCloseTo(own, 1);
    }
  });

  it("speaks every member, chair and subminds alike, in Skippy's own voice (ELEVENLABS_VOICE_ID), never a premade one", async () => {
    const { blob } = memoryBlob();
    const { calls, fetcher } = fakeEleven();
    const deps = { blob, eleven, ledger: new MemoryStoryStore(), now: NOW, fetcher };
    for (const id of Object.keys(ROTUNDA_VOICES)) await speakCast(id, `Order, from ${id}.`, deps);
    expect(calls).toHaveLength(13);
    for (const c of calls) expect(c.url).toContain("/text-to-speech/testSkippyVoice01?");
    expect(new Set(calls.map((c) => JSON.stringify(c.body.voice_settings))).size).toBe(13);
  });

  it("names a line by everything that changes how it sounds", async () => {
    const s = ROTUNDA_VOICES.boiler!.sound;
    const a = await lineKey("Again?", "v1", s);
    expect(a.startsWith(ROTUNDA_CACHE) && a.endsWith(".mp3")).toBe(true);
    expect(await lineKey("Again?", "v1", s)).toBe(a);
    expect(await lineKey("Again!", "v1", s)).not.toBe(a);
    expect(await lineKey("Again?", "v2", s)).not.toBe(a);
    expect(await lineKey("Again?", "v1", { ...s, speed: s.speed + 0.1 })).not.toBe(a);
  });

  it("makes a line once, in the member's voice, and plays it from the store ever after for free", async () => {
    const { blob, files } = memoryBlob();
    const ledger = new MemoryStoryStore();
    const { calls, fetcher } = fakeEleven();
    const deps = { blob, eleven, ledger, now: NOW, fetcher };
    const first = await speakCast("boiler", "Again?", deps);
    expect(first).toMatchObject({ cached: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/text-to-speech/testSkippyVoice01");
    expect(calls[0]!.body).toMatchObject({ text: "Again?", model_id: ROOM_TTS_MODEL });
    expect(files.size).toBe(1);
    const month = storyMonth(ledger.spend, NOW);
    expect(month.rotundaChars).toBe(6);
    expect(month.elevenUsd).toBeCloseTo(elevenCost(6));
    const again = await speakCast("boiler", "Again?", deps);
    expect(again).toMatchObject({ cached: true });
    expect(again!.audio.length).toBe(3_000);
    expect(calls).toHaveLength(1);
    expect(storyMonth(ledger.spend, NOW).rotundaChars).toBe(6);
  });

  it("speaks the chair in Skippy's own voice (ELEVENLABS_VOICE_ID)", async () => {
    const { blob } = memoryBlob();
    const { calls, fetcher } = fakeEleven();
    await speakCast("kernel", "The chair recognizes the Builder.", { blob, eleven, ledger: new MemoryStoryStore(), now: NOW, fetcher });
    expect(calls[0]!.url).toContain("/text-to-speech/testSkippyVoice01");
  });

  it("has no dollar share of its own: it speaks until the plan nears the calls' reserve, and still plays what it kept", async () => {
    const { blob } = memoryBlob();
    const ledger = new MemoryStoryStore();
    // Far past the old $3 share: no longer a reason to stop.
    await ledger.addSpend(NOW, { rotundaUsd: 50, elevenUsd: 50 });
    forgetCredits();
    const plenty = fakeEleven(200, 50_000);
    expect(await speakCast("green", "Hear, hear", { blob, eleven, ledger, now: NOW, fetcher: plenty.fetcher })).toMatchObject({ cached: false });
    forgetCredits();
    const low = fakeEleven(200, ROTUNDA_RESERVE_CHARS + 3);
    const deps = { blob, eleven, ledger, now: NOW + 1, fetcher: low.fetcher };
    expect(await speakCast("green", "Seconded", deps)).toBeNull();
    expect(await speakCast("green", "Hear, hear", deps)).toMatchObject({ cached: true });
    expect(low.calls).toHaveLength(0);
    // A dollar cap still holds when one is set.
    forgetCredits();
    expect(await speakCast("green", "Seconded", { ...deps, eleven: { ...eleven, budget: 10 }, fetcher: plenty.fetcher })).toBeNull();
  });

  it("falls back to nothing when ElevenLabs refuses, a member is unknown, or there is no key or store", async () => {
    const { blob, files } = memoryBlob();
    const ledger = new MemoryStoryStore();
    expect(await speakCast("boiler", "Again?", { blob, eleven, ledger, now: NOW, fetcher: fakeEleven(500).fetcher })).toBeNull();
    expect(files.size).toBe(0);
    expect(storyMonth(ledger.spend, NOW).rotundaUsd).toBe(0);
    const ok = fakeEleven().fetcher;
    expect(await speakCast("nobody", "Again?", { blob, eleven, ledger, now: NOW, fetcher: ok })).toBeNull();
    expect(await speakCast("boiler", "Again?", { blob, eleven: null, ledger, now: NOW, fetcher: ok })).toBeNull();
    expect(await speakCast("boiler", "Again?", { blob: null, eleven, ledger, now: NOW, fetcher: ok })).toBeNull();
  });

  describe("through POST /api/skippy-room", () => {
    async function setup() {
      const store = new MemoryAuthStore();
      const { blob } = memoryBlob();
      const { calls, fetcher } = fakeEleven();
      const lines: string[] = [];
      const d: RoomRouteDeps = {
        desk: { deskKey: DESK, store, now: NOW },
        blob,
        eleven,
        ledger: new MemoryStoryStore(),
        skippy: async () => ({ reply: "unused", handedOff: false }),
        todos: (b) => new PhoneTodos(b),
        fetcher,
        log: (l) => lines.push(l),
      };
      const cookie = await signedInCookie(DESK, NOW, store);
      const post = (body: unknown, c = cookie) =>
        new Request("https://ceo.test/api/skippy-room", { method: "POST", headers: { "Content-Type": "application/json", ...(c && { Cookie: c }) }, body: JSON.stringify(body) });
      return { d, calls, post };
    }

    it("reads a caption in its member's voice, for a signed-in Desk only, and never a private-looking line", async () => {
      const { d, calls, post } = await setup();
      expect((await roomVoicePost(post({ room: "today", speak: "Seconded", as: "foundry" }, ""), d)).status).toBe(401);
      const body = (await (await roomVoicePost(post({ room: "today", speak: "Seconded", as: "foundry" }), d)).json()) as { audio?: string; cached?: boolean; kind: string };
      expect(body).toMatchObject({ kind: "spoken", cached: false });
      expect(Buffer.from(body.audio!, "base64").length).toBe(3_000);
      expect(calls[0]!.url).toContain("/text-to-speech/testSkippyVoice01");
      const twice = (await (await roomVoicePost(post({ room: "today", speak: "Seconded", as: "foundry" }), d)).json()) as { cached?: boolean };
      expect(twice.cached).toBe(true);
      expect(calls).toHaveLength(1);
      const held = (await (await roomVoicePost(post({ room: "today", speak: "Call me on 555 867 5309 tonight", as: "relay" }), d)).json()) as { audio?: string };
      expect(held.audio).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect((await roomVoicePost(post({ room: "today", speak: "Seconded", as: "nobody" }), d)).status).toBe(400);
    });
  });
});
