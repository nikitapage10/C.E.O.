import { deflateSync } from "node:zlib";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { BlobPreconditionError, prefixed, type BlobBackend } from "../_blob.ts";
import { MemoryAuthStore } from "../_desk/store.ts";
import { signedInCookie } from "../_desk/testing.ts";
import { FEED_TOKEN, isFeedWrite, LOG_TOKEN } from "../_site/roomkeys.ts";
import { finalImageOf, generateImage, IMAGE_COST_USD, IMAGES_CAP_USD, IMAGES_URL, ImageLedger, ledgerPath, type GenDeps } from "./photoGen.ts";
import { decodeImage, decodePng, kindOf, shrink, smallJpeg } from "./photoImage.ts";
import {
  CATALOG_PATH,
  keyOf,
  PHOTO_ID,
  photoIdOf,
  PhotoLibrary,
  photosGet,
  photosPost,
  photosPut,
  promptFor,
  readCatalog,
  readMealToShoot,
  readMealsToShoot,
  runQueue,
  smallPath,
  STYLE_PLATE,
  STYLE_PREP,
  type MealToShoot,
  type PhotoDeps,
} from "./photos.ts";

/** The Kitchen's meal photo library (#687). Every meal, image and key here is made up; OpenAI and storage are mocked. */

const DESK = "a test desk key, not a real one";
const ORIGIN = "https://ceo.test";
const LOG = "test-log-key-not-a-real-one-0123456789abcdef";
const FEED = "test-feed-key-not-a-real-one-0123456789abcdef";
const OPENAI = "sk-test-not-a-real-openai-key";
const NOW = Date.parse("2026-11-04T18:00:00Z");

/** A store with real ETags, so the catalog's read-change-write is exercised. */
function memoryBlob(): BlobBackend & { files: Map<string, { bytes: Uint8Array; etag: string; type: string }> } {
  const files = new Map<string, { bytes: Uint8Array; etag: string; type: string }>();
  let n = 0;
  return {
    kind: "azureblob",
    files,
    get: async (path) => {
      const f = files.get(path);
      return f ? { stream: new Response(f.bytes.slice()).body!, etag: f.etag, contentType: f.type } : null;
    },
    etag: async (path) => files.get(path)?.etag ?? null,
    put: async (path, body, opts) => {
      const cur = files.get(path);
      if (opts.ifMatch && cur?.etag !== opts.ifMatch) throw new BlobPreconditionError("changed");
      if (!opts.ifMatch && !opts.allowOverwrite && cur) throw new BlobPreconditionError("exists");
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body);
      files.set(path, { bytes, etag: `e${++n}`, type: opts.contentType });
      return { pathname: path };
    },
    del: async (path) => void files.delete(path),
  };
}

/** A synthetic PNG: an RGB or RGBA gradient, rows with filters 0–4 so every unfilter runs. */
function png(width: number, height: number, alpha = false): Uint8Array {
  const ch = alpha ? 4 : 3;
  const rows: number[] = [];
  const px = (x: number, y: number, c: number) => (c === 3 ? 200 : (x * 7 + y * 3 + c * 50) & 0xff);
  let prev = new Array<number>(width * ch).fill(0);
  for (let y = 0; y < height; y++) {
    const line = Array.from({ length: width * ch }, (_, i) => px(Math.floor(i / ch), y, i % ch));
    const filter = y % 5;
    rows.push(filter);
    for (let i = 0; i < line.length; i++) {
      const a = i >= ch ? line[i - ch]! : 0;
      const b = y > 0 ? prev[i]! : 0;
      const c = i >= ch && y > 0 ? prev[i - ch]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows.push((line[i]! - pred) & 0xff);
    }
    prev = line;
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    new DataView(out.buffer).setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(Uint8Array.from(rows)))), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return all;
}

const IMAGE = png(48, 72);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** OpenAI's streamed answer: a partial image, then the final one. */
const sse = (final: Uint8Array) =>
  [
    `event: image_generation.partial_image`,
    `data: ${JSON.stringify({ type: "image_generation.partial_image", b64_json: b64(png(4, 4)), partial_image_index: 0 })}`,
    ``,
    `event: image_generation.completed`,
    `data: ${JSON.stringify({ type: "image_generation.completed", b64_json: b64(final), usage: { total_tokens: 1 } })}`,
    ``,
  ].join("\n");

type Call = { url: string; body: Record<string, unknown>; auth: string | null };

/** A mocked OpenAI: each call answers with the next of `answers` (a status, or "ok" for an image). */
function openai(...answers: Array<"ok" | number | "empty">) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, auth: new Headers(init.headers).get("authorization") });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)] ?? "ok";
    if (a === "ok") return new Response(sse(IMAGE), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    if (a === "empty") return new Response("data: {}\n\n", { status: 200 });
    return new Response(JSON.stringify({ error: { message: "no" } }), { status: a });
  };
  return { fetch, calls };
}

const MEAL: MealToShoot = { meal: "gochujang-chicken-bowl", name: "Gochujang chicken bowl", description: "Sticky chicken thighs over rice with a crunchy slaw.", components: ["Chicken thighs", "Jasmine rice", "Cabbage slaw"], style: "plate" };
const PREP: MealToShoot = { meal: "turkey-chili", name: "Turkey chili", description: "A big pot for the week.", components: ["Ground turkey", "Kidney beans"], style: "prep" };

function setup(answers: Array<"ok" | number | "empty"> = ["ok"]) {
  const lib = memoryBlob();
  const state = memoryBlob();
  const store = new MemoryAuthStore();
  const ai = openai(...answers);
  const lines: string[] = [];
  const runs: Array<() => Promise<unknown>> = [];
  const deps: PhotoDeps = {
    desk: { deskKey: DESK, store, now: NOW },
    library: new PhotoLibrary(lib),
    ledger: new ImageLedger(state),
    openaiKey: OPENAI,
    fetch: ai.fetch,
    env: { [LOG_TOKEN]: LOG, [FEED_TOKEN]: FEED },
    log: (l) => lines.push(l),
    kick: (run) => void runs.push(run),
  };
  const gen = (now = NOW): GenDeps => ({ key: OPENAI, fetch: ai.fetch, ledger: new ImageLedger(state), now: () => now });
  return { deps, lib, state, store, ai, lines, runs, gen, library: deps.library!, cookie: () => signedInCookie(DESK, NOW, store) };
}

const post = (body: unknown, cookie = "") =>
  new Request(`${ORIGIN}/api/haven-photos`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
const get = (query: string, cookie = "", headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/haven-photos?${query}`, { headers: { ...(cookie && { Cookie: cookie }), ...headers } });
const put = (body: unknown, key?: string, query = "") =>
  new Request(`${ORIGIN}/api/haven-photos${query}`, { method: "PUT", headers: { "Content-Type": "application/json", ...(key && { Authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) });

describe("the photo shapes", () => {
  it("reads a meal as untrusted data", () => {
    expect(readMealToShoot({ ...MEAL, name: " <b>Gochujang</b>\n chicken ", components: ["Rice", 4, "", "<script>"], style: "poster" })).toEqual({
      meal: MEAL.meal,
      name: "b Gochujang /b chicken",
      description: MEAL.description,
      components: ["Rice", "script"],
      style: "plate",
    });
    for (const bad of [null, [], { ...MEAL, meal: "Bad Id" }, { ...MEAL, name: "" }, { ...MEAL, meal: "x".repeat(60) }]) expect(readMealToShoot(bad)).toBeNull();
    expect(readMealsToShoot([])).toBeNull();
    expect(readMealsToShoot(Array.from({ length: 15 }, () => MEAL))).toBeNull();
    expect(readMealsToShoot([MEAL, { nope: 1 }])).toBeNull();
  });

  it("keys a meal by its components as a set, and the id fits the planner's", () => {
    const a = keyOf(MEAL);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(keyOf({ ...MEAL, components: [...MEAL.components].reverse().map((c) => c.toUpperCase()) })).toBe(a);
    expect(keyOf({ ...MEAL, components: ["Tofu", "Jasmine rice", "Cabbage slaw"] })).not.toBe(a);
    expect(keyOf({ ...MEAL, style: "prep" })).not.toBe(a);
    const id = photoIdOf("a".repeat(48), a);
    expect(id).toMatch(PHOTO_ID);
    expect(photoIdOf(MEAL.meal, a)).toBe(`${MEAL.meal}-${a.slice(0, 8)}`);
  });

  it("writes the prompt in the demo's two styles", () => {
    expect(promptFor(MEAL)).toContain(STYLE_PLATE);
    expect(promptFor(MEAL)).toContain("Dish: Gochujang chicken bowl: Sticky chicken thighs over rice with a crunchy slaw.");
    expect(promptFor(MEAL)).toContain("Made with Chicken thighs, Jasmine rice, Cabbage slaw.");
    expect(promptFor(PREP)).toContain(STYLE_PREP);
    expect(promptFor(PREP)).toMatch(/No text, no labels, no logos, no people, no hands\.$/);
  });

  it("reads a broken catalog as empty, and drops bad entries", () => {
    expect(readCatalog(null).photos).toEqual([]);
    const got = readCatalog({ photos: [{ id: "Bad Id", meal: "x1", key: "0".repeat(16) }, { id: "ok-1", meal: "ok", key: "0123456789abcdef", status: "nope", full: "../etc" }], worker: { until: "x" } });
    expect(got.photos.map((p) => [p.id, p.status, p.full])).toEqual([["ok-1", "failed", undefined]]);
    expect(got.worker).toBeNull();
  });
});

describe("the image work", () => {
  it("decodes an RGB and an RGBA PNG through every filter", () => {
    const rgb = decodePng(png(10, 10));
    expect([rgb.width, rgb.height]).toEqual([10, 10]);
    expect(Array.from(rgb.data.slice((3 * 10 + 4) * 4, (3 * 10 + 4) * 4 + 4))).toEqual([(4 * 7 + 9) & 0xff, (4 * 7 + 9 + 50) & 0xff, (4 * 7 + 9 + 100) & 0xff, 255]);
    const rgba = decodePng(png(6, 6, true));
    expect(rgba.data[3]).toBe(200);
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("makes the 720 px JPEG, never upscaling", () => {
    const wide = smallJpeg(png(1440, 30));
    expect(kindOf(wide.jpeg)).toBe("jpeg");
    expect([wide.width, wide.height]).toEqual([1440, 30]);
    const back = jpeg.decode(wide.jpeg, { useTArray: true });
    expect([back.width, back.height]).toEqual([720, 15]);
    const small = decodeImage(smallJpeg(IMAGE).jpeg);
    expect([small.width, small.height]).toEqual([48, 72]);
    expect(shrink({ width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }, 1).data[0]).toBe(128);
  });
});

describe("the generator", () => {
  it("takes the last completed event's image from the stream", () => {
    expect(finalImageOf(sse(IMAGE))).toEqual(IMAGE);
    expect(finalImageOf("data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"AAAA\"}\n")).toBeNull();
    expect(finalImageOf("data: not json image_generation.completed\n")).toBeNull();
  });

  it("asks for gpt-image-2 at 1024x1536, medium, streamed with a partial image", async () => {
    const s = setup(["ok"]);
    const got = await generateImage("a prompt", s.gen());
    expect(got).toEqual({ ok: true, bytes: IMAGE, quality: "medium" });
    expect(s.ai.calls).toEqual([{ url: IMAGES_URL, auth: `Bearer ${OPENAI}`, body: { model: "gpt-image-2", prompt: "a prompt", size: "1024x1536", quality: "medium", n: 1, stream: true, partial_images: 1 } }]);
    expect((await new ImageLedger(s.state).read(NOW)).usd).toBe(IMAGE_COST_USD.medium);
  });

  it("falls back to low once, and hands back what an error status didn't bill", async () => {
    const s = setup([500, "ok"]);
    const got = await generateImage("p", s.gen());
    expect(got.ok && got.quality).toBe("low");
    expect(s.ai.calls.map((c) => c.body.quality)).toEqual(["medium", "low"]);
    const spent = await new ImageLedger(s.state).read(NOW);
    expect([spent.images, spent.usd]).toEqual([1, IMAGE_COST_USD.low]);
    const none = setup([400, 400]);
    expect(await generateImage("p", none.gen())).toEqual({ ok: false, error: "failed", detail: "openai 400" });
    expect((await new ImageLedger(none.state).read(NOW)).usd).toBe(0);
  });

  it("stops at the month's cap without calling OpenAI, and starts again next month", async () => {
    const s = setup(["ok"]);
    await s.state.put(ledgerPath("2026-11"), JSON.stringify({ month: "2026-11", images: 100, usd: IMAGES_CAP_USD - 0.01 }), { contentType: "application/json", allowOverwrite: true });
    expect(await generateImage("p", s.gen())).toEqual({ ok: false, error: "budget" });
    expect(s.ai.calls).toHaveLength(0);
    expect((await new ImageLedger(s.state).read(NOW)).reached).toBe(true);
    expect((await generateImage("p", s.gen(Date.parse("2026-12-01T00:00:00Z")))).ok).toBe(true);
  });

  it("says so without a key", async () => {
    const s = setup();
    expect(await generateImage("p", { ...s.gen(), key: "" })).toEqual({ ok: false, error: "no-key" });
    expect(s.ai.calls).toHaveLength(0);
  });
});

describe("the library and its queue", () => {
  const run = (s: ReturnType<typeof setup>) => runQueue({ library: s.library, gen: s.gen(), now: () => NOW, log: (l) => s.lines.push(l) });

  it("makes each customized meal once, however often the week is confirmed", async () => {
    const s = setup(["ok"]);
    const first = await s.library.enqueue([MEAL, PREP], NOW);
    expect(first.map((t) => t.status)).toEqual(["queued", "queued"]);
    expect(await run(s)).toEqual({ made: 2, failed: 0, budget: false });
    expect(s.ai.calls).toHaveLength(2);
    expect(s.lib.files.get(smallPath(first[0]!.id))?.type).toBe("image/jpeg");
    expect(s.lib.files.get(`full/${first[0]!.id}.png`)?.bytes).toEqual(IMAGE);
    const again = await s.library.enqueue([{ ...MEAL, components: [...MEAL.components].reverse() }, PREP], NOW + 1000);
    expect(again).toEqual(first.map((t) => ({ ...t, status: "ready" })));
    expect(await run(s)).toEqual({ made: 0, failed: 0, budget: false });
    expect(s.ai.calls).toHaveLength(2);
    const cat = await s.library.catalog();
    expect(cat.photos.map((p) => [p.source, p.quality, p.width, p.height])).toEqual([["openai", "medium", 48, 72], ["openai", "medium", 48, 72]]);
    expect(cat.worker).toBeNull();
    expect(s.lines.join("\n")).not.toContain("Gochujang");
  });

  it("marks a failure, and tries it once more when the week is confirmed again", async () => {
    const s = setup([500, 500, "ok"]);
    const [t] = await s.library.enqueue([MEAL], NOW);
    expect(await run(s)).toEqual({ made: 0, failed: 1, budget: false });
    expect((await s.library.catalog()).photos[0]).toMatchObject({ status: "failed", error: "openai 500", tries: 1 });
    expect((await s.library.enqueue([MEAL], NOW))[0]).toEqual({ ...t, status: "queued" });
    expect((await run(s)).made).toBe(1);
  });

  it("parks everything queued once the cap is reached", async () => {
    const s = setup(["ok"]);
    await s.state.put(ledgerPath("2026-11"), JSON.stringify({ month: "2026-11", images: 99, usd: IMAGES_CAP_USD - IMAGE_COST_USD.medium }), { contentType: "application/json", allowOverwrite: true });
    await s.library.enqueue([MEAL, PREP, { ...MEAL, meal: "salmon-rice" }], NOW);
    expect(await run(s)).toEqual({ made: 1, failed: 0, budget: true });
    expect((await s.library.catalog()).photos.map((p) => p.status)).toEqual(["ready", "budget", "budget"]);
    expect(s.lines.at(-1)).toContain("image cap is reached");
  });

  it("lets one run at a time hold the lease", async () => {
    const s = setup(["ok"]);
    await s.library.enqueue([MEAL], NOW);
    expect(await s.library.claim("run-a", NOW)).not.toBeNull();
    await s.library.enqueue([PREP], NOW);
    expect(await s.library.claim("run-b", NOW)).toBeNull();
    // A run that went quiet: its lease and its photo come free.
    const later = NOW + 7 * 60_000;
    const next = await s.library.claim("run-b", later);
    expect(next?.meal).toBe(MEAL.meal);
    expect(next?.tries).toBe(2);
  });

  it("an upload is ready at once, and a confirm of the same meal as built reuses it", async () => {
    const s = setup();
    const up = await s.library.upload({ meal: MEAL.meal, name: MEAL.name, components: MEAL.components, style: "plate", source: "seed", bytes: IMAGE }, NOW);
    expect(up).toMatchObject({ id: MEAL.meal, status: "ready", source: "seed", full: `full/${MEAL.meal}.png` });
    expect((await s.library.enqueue([MEAL], NOW))[0]).toEqual({ meal: MEAL.meal, key: keyOf(MEAL), id: MEAL.meal, status: "ready" });
    expect(await s.library.remove(MEAL.meal)).toBe(true);
    expect([...s.lib.files.keys()]).toEqual([CATALOG_PATH]);
  });

  it("keeps the library under a folder of the one store on Vercel", async () => {
    const base = memoryBlob();
    await new PhotoLibrary(prefixed(base, "haven-meals/")).upload({ meal: "abc", name: "A", components: [], style: "plate", source: "upload", bytes: IMAGE }, NOW);
    expect([...base.files.keys()].sort()).toEqual(["haven-meals/720/abc.jpg", "haven-meals/catalog.json", "haven-meals/full/abc.png"]);
  });
});

describe("/api/haven-photos", () => {
  it("answers nobody without a passkey session, and never either room key", async () => {
    const s = setup();
    await s.library.upload({ meal: "abc", name: "A", components: [], style: "plate", source: "upload", bytes: IMAGE }, NOW);
    expect((await photosGet(get("view=catalog"), s.deps)).status).toBe(401);
    expect((await photosGet(get("id=abc"), s.deps)).status).toBe(401);
    for (const key of [LOG, FEED]) {
      const res = await photosGet(get("id=abc", "", { Authorization: `Bearer ${key}`, "x-ceo-room-key": key }), s.deps);
      expect([401, 403]).toContain(res.status);
    }
    expect((await photosPost(post({ action: "confirm", meals: [MEAL] }), s.deps)).status).toBe(401);
    expect(s.ai.calls).toHaveLength(0);
  });

  it("confirms a week: tickets at once, the photos made after the answer", async () => {
    const s = setup();
    const cookie = await s.cookie();
    const res = await photosPost(post({ action: "confirm", meals: [MEAL, PREP] }, cookie), s.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photos: Array<{ id: string; status: string }>; budget: { capUsd: number } };
    expect(body.photos.map((p) => p.status)).toEqual(["queued", "queued"]);
    expect(body.budget.capUsd).toBe(10);
    expect(s.ai.calls).toHaveLength(0);
    expect(s.runs).toHaveLength(1);
    await s.runs[0]!();
    const cat = (await (await photosGet(get(`view=catalog&ids=${body.photos.map((p) => p.id).join(",")}`, cookie), s.deps)).json()) as { photos: Array<{ status: string }>; ready: boolean };
    expect(cat.photos.map((p) => p.status)).toEqual(["ready", "ready"]);
    expect(cat.ready).toBe(true);
    const photo = await photosGet(get(`id=${body.photos[0]!.id}`, cookie), s.deps);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(kindOf(new Uint8Array(await photo.arrayBuffer()))).toBe("jpeg");
    const full = await photosGet(get(`id=${body.photos[0]!.id}&size=full`, cookie), s.deps);
    expect(full.headers.get("content-type")).toBe("image/png");
    // Again: nothing new to make, so no run.
    const again = (await (await photosPost(post({ action: "generate", meal: MEAL }, cookie), s.deps)).json()) as { photo: { status: string } };
    expect(again.photo.status).toBe("ready");
    expect(s.runs).toHaveLength(1);
  });

  it("refuses bad meals, bad photos and unknown actions", async () => {
    const s = setup();
    const cookie = await s.cookie();
    expect((await photosPost(post({ action: "confirm", meals: [{ meal: "Nope" }] }, cookie), s.deps)).status).toBe(400);
    expect((await photosPost(post({ action: "upload", meal: "abc", image: b64(new TextEncoder().encode("<svg/>")) }, cookie), s.deps)).status).toBe(400);
    expect((await photosPost(post({ action: "upload", meal: "abc", image: "not base64!" }, cookie), s.deps)).status).toBe(400);
    expect((await photosPost(post({ action: "rm -rf" }, cookie), s.deps)).status).toBe(400);
    expect((await photosGet(get("id=../catalog", cookie), s.deps)).status).toBe(404);
    expect((await photosPost(post({ action: "remove", id: "nothing-here" }, cookie), s.deps)).status).toBe(404);
  });

  it("uploads from the Desk, and with the feed key alone (counts back only)", async () => {
    const s = setup();
    const cookie = await s.cookie();
    const res = await photosPost(post({ action: "upload", meal: "abc", name: "Abc bowl", image: `data:image/png;base64,${b64(IMAGE)}` }, cookie), s.deps);
    expect(((await res.json()) as { photo: { id: string; source: string } }).photo).toMatchObject({ id: "abc", source: "upload" });
    for (const r of [put({ meal: "seed-one", image: b64(IMAGE) }), put({ meal: "seed-one", image: b64(IMAGE) }, LOG)]) expect((await photosPut(r, s.deps)).status).toBe(401);
    expect((await photosPut(put({ meal: "seed-one", image: b64(IMAGE) }, FEED, "?x=1"), s.deps)).status).toBe(400);
    const ok = await photosPut(put({ meal: "seed-one", image: b64(IMAGE), style: "prep" }, FEED), s.deps);
    expect(await ok.json()).toEqual({ ok: true, id: "seed-one", bytes: IMAGE.length });
    expect((await s.library.catalog()).photos.find((p) => p.id === "seed-one")).toMatchObject({ source: "seed", style: "prep", status: "ready" });
  });

  it("tells a failing store from a bad photo, and logs the error's class, never the meal (#711)", async () => {
    const s = setup();
    class RestError extends Error {
      code = "ContainerNotFound";
      statusCode = 404;
      name = "RestError";
    }
    s.lib.put = async () => {
      throw new RestError("The specified container does not exist.");
    };
    const res = await photosPut(put({ meal: "seed-one", name: "Seed one", image: `data:image/jpeg;base64,${b64(smallJpeg(IMAGE).jpeg)}` }, FEED), s.deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "store" });
    expect(s.lines).toEqual(["haven photos: an upload failed (store: RestError ContainerNotFound)"]);
    // A JPEG that only looks like one is still a bad photo.
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const bad = await photosPut(put({ meal: "seed-two", image: b64(broken) }, FEED), s.deps);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad-photo" });
    expect(s.lines[1]).toBe("haven photos: an upload failed (bad-photo: BadImageError)");
    expect(s.lines.join("\n")).not.toMatch(/seed-|Seed one/);
  });

  it("is one of the feed key's writes as a PUT with no query, and nothing else", () => {
    expect(isFeedWrite(new Request(`${ORIGIN}/api/haven-photos`, { method: "PUT" }))).toBe(true);
    expect(isFeedWrite(new Request(`${ORIGIN}/api/haven-photos?id=a`, { method: "PUT" }))).toBe(false);
    expect(isFeedWrite(new Request(`${ORIGIN}/api/haven-photos`, { method: "POST" }))).toBe(false);
  });
});
