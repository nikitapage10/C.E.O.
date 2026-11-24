import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { isFeedWrite, roomKeyPass } from "../_site/roomkeys.ts";
import { KEEP_MS, parseJob, studioAudio, type StudioAudioDeps } from "./audio.ts";

/** The Studio's audio line (#311). Every key and word here is made up. */

const NOW = Date.parse("2026-11-24T02:00:00Z");
const ORIGIN = "https://ceo.test";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const ENV = { SUBMIND_FEED_TOKEN: FEED, SUBMIND_LOG_TOKEN: LOG };
const ELEVEN = { key: "test-eleven-key", voice: "SkippyVoice0001", budget: 10 };

function memoryBlob(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const tags = new Map<string, number>();
  let n = 1;
  return {
    kind: "azureblob",
    files,
    get: async (path) => (files.has(path) ? { stream: new Response(files.get(path)!.slice()).body!, etag: String(tags.get(path)), contentType: "application/json" } : null),
    etag: async (path) => (files.has(path) ? String(tags.get(path)) : null),
    put: async (path, body, opts) => {
      if (opts.ifMatch && opts.ifMatch !== String(tags.get(path))) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && opts.allowOverwrite === false && files.has(path)) throw new BlobPreconditionError("exists");
      files.set(path, typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body));
      tags.set(path, n++);
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

function setup(fetcher?: typeof fetch) {
  const blob = memoryBlob();
  const calls: { url: string; body: unknown; key: string | null }[] = [];
  const pending: Promise<unknown>[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("xi-api-key") });
    if (url.includes("with-timestamps")) {
      return new Response(JSON.stringify({ audio_base64: "QUJD", alignment: { characters: ["H", "i"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] } }));
    }
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  };
  let now = NOW;
  const deps = (): StudioAudioDeps => ({ blob, eleven: ELEVEN, env: ENV, now, fetcher: fetcher ?? fake, later: (p) => void pending.push(p) });
  const post = (body: unknown, key = FEED, path = "/api/studio-audio") =>
    studioAudio(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }), deps());
  return { blob, calls, pending, post, setNow: (t: number) => (now = t) };
}

describe("The Studio's audio line (#311)", () => {
  it("reads only the three closed shapes", () => {
    expect(parseJob({ mode: "tts", text: "Hello there." })).toEqual({ mode: "tts", text: "Hello there." });
    expect(parseJob({ mode: "tts", text: "Hi", voice: "../etc" })).toBeNull();
    expect(parseJob({ mode: "tts", text: "" })).toBeNull();
    expect(parseJob({ mode: "tts", text: "Hi", extra: 1 })).toBeNull();
    expect(parseJob({ mode: "tts", text: "Hi", speed: 1.5, stability: -1, style: 0.6 })).toEqual({ mode: "tts", text: "Hi", speed: 1.2, stability: 0, style: 0.6 });
    expect(parseJob({ mode: "tts", text: "Hi", speed: "fast" })).toBeNull();
    expect(parseJob({ mode: "music", prompt: "upbeat synth", length_ms: 180_000 })).not.toBeNull();
    expect(parseJob({ mode: "music", prompt: "upbeat synth", length_ms: 180_001 })).toBeNull();
    expect(parseJob({ mode: "sfx", text: "whoosh", duration_seconds: 2 })).not.toBeNull();
    expect(parseJob({ mode: "sfx", text: "whoosh", duration_seconds: 31 })).toBeNull();
  });

  it("takes the feed key only, as a POST with no query", async () => {
    const { post } = setup();
    expect((await post({ mode: "tts", text: "Hi" }, LOG)).status).toBe(401);
    expect((await post({ mode: "tts", text: "Hi" }, "not-a-key-at-all-not-a-key-at-all-00")).status).toBe(401);
    expect((await post({ mode: "tts", text: "Hi" }, FEED, "/api/studio-audio?x=1")).status).toBe(400);
    expect(isFeedWrite(new Request(`${ORIGIN}/api/studio-audio`, { method: "POST" }))).toBe(true);
    expect(isFeedWrite(new Request(`${ORIGIN}/api/studio-audio`, { method: "GET" }))).toBe(false);
    expect(roomKeyPass(new Request(`${ORIGIN}/api/studio-audio`, { method: "POST", headers: { Authorization: `Bearer ${LOG}` } }), ENV)).toBeNull();
  });

  it("speaks in Skippy's voice with timestamps, then hands it back on fetch", async () => {
    const { post, calls, pending } = setup();
    const started = await post({ mode: "tts", text: "Ah, the C.E.O. calls." });
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };
    await Promise.all(pending);
    expect(calls[0]!.url).toContain(`/text-to-speech/${ELEVEN.voice}/with-timestamps`);
    expect(calls[0]!.key).toBe(ELEVEN.key);
    expect((calls[0]!.body as { voice_settings: Record<string, unknown> }).voice_settings).not.toHaveProperty("speed");
    const done = await post({ fetch: id });
    expect(done.status).toBe(200);
    const body = (await done.json()) as { status: string; audio_base64: string; alignment: { characters: string[] } };
    expect(body.status).toBe("done");
    expect(body.audio_base64).toBe("QUJD");
    expect(body.alignment.characters).toEqual(["H", "i"]);
    expect(JSON.stringify(body)).not.toContain(ELEVEN.key);
  });

  it("makes music and sound effects as MP3", async () => {
    const { post, calls, pending } = setup();
    const m = (await (await post({ mode: "music", prompt: "bright synth", length_ms: 180_000 })).json()) as { id: string };
    const s = (await (await post({ mode: "sfx", text: "paper whoosh", duration_seconds: 1.5 })).json()) as { id: string };
    await Promise.all(pending);
    expect(calls[0]!.url).toContain("/v1/music");
    expect(calls[0]!.body).toEqual({ prompt: "bright synth", music_length_ms: 180_000 });
    expect(calls[1]!.url).toContain("/v1/sound-generation");
    for (const id of [m.id, s.id]) {
      const out = (await (await post({ fetch: id })).json()) as { audio_base64: string; mime: string };
      expect(out.mime).toBe("audio/mpeg");
      expect(out.audio_base64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    }
  });

  it("says when ElevenLabs refused", async () => {
    const { post, pending } = setup(async () => new Response("no", { status: 401 }));
    const { id } = (await (await post({ mode: "sfx", text: "boom" })).json()) as { id: string };
    await Promise.all(pending);
    const out = await post({ fetch: id });
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ status: "failed", error: "elevenlabs-401" });
  });

  it("lets a result go after a day", async () => {
    const { post, pending, setNow, blob } = setup();
    const { id } = (await (await post({ mode: "sfx", text: "tick" })).json()) as { id: string };
    await Promise.all(pending);
    setNow(NOW + KEEP_MS + 1);
    expect((await post({ fetch: id })).status).toBe(404);
    expect((await post({ mode: "sfx", text: "tock" })).status).toBe(202);
    expect(blob.files.has(`studio/audio/${id}.json`)).toBe(false);
  });
});

describe("The Studio's voice settings (#1219)", () => {
  it("sends a faster, livelier read to ElevenLabs", async () => {
    const { post, calls, pending } = setup();
    await post({ mode: "tts", text: "Quick now.", speed: 1.15, stability: 0.3, style: 0.7 });
    await Promise.all(pending);
    expect((calls[0]!.body as { voice_settings: Record<string, unknown> }).voice_settings).toMatchObject({ speed: 1.15, stability: 0.3, style: 0.7 });
  });
});
