import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { isFeedWrite } from "../_site/roomkeys.ts";
import { IMAGE_MODELS, parseImageJob, studioImage, type StudioImageDeps } from "./image.ts";

/** The Studio's Gemini pictures (#311). Every key and picture here is made up. */

const NOW = Date.parse("2026-11-24T23:50:00Z");
const ORIGIN = "https://ceo.test";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const ENV = { SUBMIND_FEED_TOKEN: FEED, SUBMIND_LOG_TOKEN: LOG };
const PNG = "iVBORw0KGgoAAAANSUhEUg==";

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

function setup(fetcher: typeof fetch) {
  const blob = memoryBlob();
  const pending: Promise<unknown>[] = [];
  const deps = (): StudioImageDeps => ({ blob, key: "test-gemini-key", env: ENV, now: NOW, fetcher, later: (p) => void pending.push(p) });
  const post = (body: unknown, key = FEED) => studioImage(new Request(`${ORIGIN}/api/studio-image`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }), deps());
  return { post, pending };
}

const picture = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }] }));

describe("The Studio's Gemini pictures (#311)", () => {
  it("reads only the closed shape", () => {
    expect(parseImageJob({ prompt: "a pop-up sheet", refs: [PNG], aspect: "3:2" })).toEqual({ prompt: "a pop-up sheet", refs: [PNG], aspect: "3:2", n: 1 });
    expect(parseImageJob({ prompt: "x", refs: ["notapicture"] })).toBeNull();
    expect(parseImageJob({ prompt: "x", refs: [PNG, PNG, PNG, PNG, PNG] })).toBeNull();
    expect(parseImageJob({ prompt: "x", aspect: "16:9" })).toBeNull();
    expect(parseImageJob({ prompt: "x", model: "../secrets" })).toBeNull();
    expect(parseImageJob({ prompt: "x", extra: 1 })).toBeNull();
  });

  it("takes the feed key only", async () => {
    const { post } = setup(async () => picture());
    expect((await post({ prompt: "x" }, LOG)).status).toBe(401);
    expect(isFeedWrite(new Request(`${ORIGIN}/api/studio-image`, { method: "POST" }))).toBe(true);
  });

  it("makes pictures with references, and falls back when the first model isn't offered", async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const { post, pending } = setup(async (input, init) => {
      urls.push(String(input));
      bodies.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-gemini-key");
      return String(input).includes(IMAGE_MODELS[0]) ? new Response("no", { status: 404 }) : picture();
    });
    const { id } = (await (await post({ prompt: "a pop-up sheet", refs: [PNG], aspect: "2:3", n: 2 })).json()) as { id: string };
    await Promise.all(pending);
    expect(urls.filter((u) => u.includes(IMAGE_MODELS[1])).length).toBe(2);
    expect(bodies[0]).toMatchObject({ generationConfig: { imageConfig: { aspectRatio: "2:3" } }, contents: [{ parts: [{ text: "a pop-up sheet" }, { inlineData: { mimeType: "image/png", data: PNG } }] }] });
    const done = (await (await post({ fetch: id })).json()) as { status: string; model: string; images: string[] };
    expect(done).toMatchObject({ status: "done", model: IMAGE_MODELS[1], images: [PNG, PNG] });
  });

  it("says when Gemini refused", async () => {
    const { post, pending } = setup(async () => new Response("quota", { status: 429 }));
    const { id } = (await (await post({ prompt: "x" })).json()) as { id: string };
    await Promise.all(pending);
    const out = await post({ fetch: id });
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ status: "failed", error: "gemini-429" });
  });
});
