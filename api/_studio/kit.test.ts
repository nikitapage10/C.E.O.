import { describe, expect, it } from "vitest";
import type { BlobBackend, StoredBlob } from "../_blob.ts";
import { decide } from "../_site/gate.ts";
import { FEED_TOKEN } from "../_site/roomkeys.ts";
import { isMediaName, kitGet, MEDIA_SLICE, kitPost, kitPut, kitSig, kitSigned, parseRange, type KitDeps } from "./kit.ts";

const NOW = Date.parse("2026-11-25T20:00:00Z");
const FEED = "f".repeat(40);
const env = { FOUNDRY_DESK_KEY: "desk-key-".padEnd(40, "x"), [FEED_TOKEN]: FEED };
const URL_ = "https://ceo.test/api/studio-kit";

function mem(): BlobBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    kind: "vercel",
    files,
    async get(p) {
      const f = files.get(p);
      if (!f) return null;
      return { stream: new Response(new Blob([f as BlobPart])).body!, etag: "1", contentType: "application/octet-stream" } as StoredBlob;
    },
    async etag(p) {
      return files.has(p) ? "1" : null;
    },
    async put(p, body) {
      files.set(p, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body as ArrayBuffer));
      return { pathname: p };
    },
    async del(p) {
      files.delete(p);
    },
  };
}
const deps = (blob = mem()): KitDeps & { blob: ReturnType<typeof mem> } => ({ env, blob, now: NOW, origin: "https://ceo.test" });

describe("the Studio's render kit (#1235)", () => {
  it("takes a file with the feed key and hands it back only on a signed link", async () => {
    const d = deps();
    const put = await kitPut(new Request(URL_, { method: "PUT", headers: { Authorization: `Bearer ${FEED}`, "x-kit-path": "ep3/engine/episode.js" }, body: "let a = 1;" }), d);
    expect(put.status).toBe(200);
    expect((await kitPut(new Request(URL_, { method: "PUT", headers: { "x-kit-path": "a.js" }, body: "x" }), d)).status).toBe(401);
    expect((await kitPut(new Request(URL_, { method: "PUT", headers: { Authorization: `Bearer ${FEED}`, "x-kit-path": "../etc/passwd" }, body: "x" }), d)).status).toBe(400);
    const signed = await (await kitPost(new Request(URL_, { method: "POST", headers: { Authorization: `Bearer ${FEED}` }, body: JSON.stringify({ method: "GET", paths: ["ep3/engine/episode.js"] }) }), d)).json();
    const link = signed.urls["ep3/engine/episode.js"] as string;
    expect(link.startsWith("https://ceo.test/api/studio-kit?p=")).toBe(true);
    const got = await kitGet(new Request(link), d);
    expect(await got.text()).toBe("let a = 1;");
    // Tampered, expired, or the wrong method: no.
    expect((await kitGet(new Request(link.replace("episode.js", "other.js")), d)).status).toBe(401);
    expect((await kitGet(new Request(link), { ...d, now: NOW + 3 * 24 * 3600_000 })).status).toBe(401);
    expect((await kitPut(new Request(link, { method: "PUT", body: "x" }), d)).status).toBe(401);
  });

  it("signs uploads only under out/, and the gate lets a signed link through", async () => {
    const d = deps();
    const bad = await kitPost(new Request(URL_, { method: "POST", headers: { Authorization: `Bearer ${FEED}` }, body: JSON.stringify({ method: "PUT", paths: ["ep3/engine/episode.js"] }) }), d);
    expect(bad.status).toBe(400);
    const { urls } = await (await kitPost(new Request(URL_, { method: "POST", headers: { Authorization: `Bearer ${FEED}` }, body: JSON.stringify({ method: "PUT", paths: ["out/ep3-v6.mp4"] }) }), d)).json();
    const up = new Request(urls["out/ep3-v6.mp4"], { method: "PUT", body: new Uint8Array([1, 2, 3]) });
    expect(kitSigned(up, env, NOW)).toBe(true);
    expect((await kitPut(up, d)).status).toBe(200);
    expect(d.blob.files.get("studio/kit/out/ep3-v6.mp4")).toEqual(new Uint8Array([1, 2, 3]));
    const state = { on: true } as Parameters<typeof decide>[1]["state"];
    const exp = Math.floor(NOW / 1000) + 3600;
    const ok = new Request(`${URL_}?p=a.js&e=${exp}&s=${kitSig("GET", "a.js", exp, env.FOUNDRY_DESK_KEY)}`);
    expect(decide(ok, { state, keys: null, env, now: NOW })).toMatchObject({ allow: true, why: "kit-link" });
    const forged = new Request(`${URL_}?p=a.js&e=${exp}&s=${"A".repeat(43)}`);
    expect(decide(forged, { state, keys: null, env, now: NOW }).allow).toBe(false);
  });

  it("joins a cut's upload parts into one review file, feed key only (#1243)", async () => {
    const d = deps();
    d.blob.join = async (path, sources, _ct) => {
      const parts = sources.map((p) => d.blob.files.get(p)!);
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      d.blob.files.set(path, out);
      return { bytes: out.length };
    };
    d.blob.files.set("studio/kit/out/ep2-v8.part00", new Uint8Array([1, 2]));
    d.blob.files.set("studio/kit/out/ep2-v8.part01", new Uint8Array([3]));
    const ask = (body: unknown, auth = true) => kitPost(new Request(URL_, { method: "POST", headers: auth ? { Authorization: `Bearer ${FEED}` } : {}, body: JSON.stringify(body) }), d);
    expect((await ask({ join: "out/ep2-v8.part", count: 2, to: "ep2-v8.mp4" }, false)).status).toBe(401);
    expect((await ask({ join: "ep2/engine/x", count: 2, to: "ep2-v8.mp4" })).status).toBe(400);
    expect((await ask({ join: "out/ep2-v8.part", count: 2, to: "../x.mp4" })).status).toBe(400);
    expect((await ask({ join: "out/ep2-v8.part", count: 3, to: "ep2-v8.mp4" })).status).toBe(404);
    const done = await (await ask({ join: "out/ep2-v8.part", count: 2, to: "ep2-v8.mp4" })).json();
    expect(done).toMatchObject({ ok: true, bytes: 3, url: "https://ceo.test/api/studio-kit?m=ep2-v8.mp4" });
    expect(d.blob.files.get("studio/kit/media/ep2-v8.mp4")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("plays review files only to a signed-in Desk, in byte ranges (#1243)", async () => {
    const d = deps();
    expect((await kitGet(new Request(`${URL_}?m=ep2-v8.mp4`), d)).status).toBe(503);
    const signedOut = await kitGet(new Request(`${URL_}?m=ep2-v8.mp4`), { ...d, desk: { deskKey: env.FOUNDRY_DESK_KEY, store: { passkeys: async () => [] } as never, now: NOW } });
    expect(signedOut.status).toBe(401);
    expect((await kitGet(new Request(`${URL_}?m=../secrets.json`), d)).status).toBe(400);
    expect(isMediaName("ep3-v7.mp4")).toBe(true);
    expect(isMediaName("a/b.mp4")).toBe(false);
    expect(parseRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange("bytes=12-", 10)).toBeNull();
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
  });

  it("hands a long review file out in slices (#1243)", async () => {
    const d = deps();
    const big = new Uint8Array(MEDIA_SLICE + 10).map((_, i) => i % 251);
    d.blob.files.set("studio/kit/media/ep2-v8.mp4", big);
    d.blob.range = async (p, start, end) => {
      const f = d.blob.files.get(p);
      if (!f) return null;
      const last = Math.min(end ?? f.length - 1, f.length - 1);
      return { stream: new Response(f.slice(start, last + 1)).body!, size: f.length, start, end: last, contentType: "video/mp4" };
    };
    const desk = { deskKey: env.FOUNDRY_DESK_KEY, store: { passkeys: async () => [] } as never, now: NOW };
    // Signed out stays out, even with a Range.
    expect((await kitGet(new Request(`${URL_}?m=ep2-v8.mp4`, { headers: { Range: "bytes=0-" } }), { ...d, desk })).status).toBe(401);
  });
});
