import { describe, expect, it } from "vitest";
import type { BlobBackend, StoredBlob } from "../_blob.ts";
import { decide } from "../_site/gate.ts";
import { FEED_TOKEN } from "../_site/roomkeys.ts";
import { kitGet, kitPost, kitPut, kitSig, kitSigned, type KitDeps } from "./kit.ts";

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
});
