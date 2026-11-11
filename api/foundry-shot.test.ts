/**
 * Skippy's screenshots (#1027): kept only in the private store, posted from a passkey session, read back by a passkey
 * session or the Builder read key, and nothing else. The pictures here are a few made-up bytes.
 */
import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "./_desk/store.ts";
import { signedInCookie } from "./_desk/testing.ts";
import { isBuilderRead } from "./_site/builderkey.ts";
import { MemoryShots, SHOT_ID, shotType } from "./_skippy/shots.ts";
import { shotGet, shotPost, type ShotDeps } from "./foundry-shot.ts";

const NOW = Date.parse("2026-11-11T09:00:00Z");
const ORIGIN = "https://ceo.example";
const BUILDER = "b".repeat(40);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

async function deps(): Promise<{ deps: ShotDeps & { shots: MemoryShots }; cookie: string; lines: string[] }> {
  const store = new MemoryAuthStore();
  const cookie = await signedInCookie("test-desk-key", NOW, store);
  const lines: string[] = [];
  return { deps: { desk: { deskKey: "test-desk-key", store, now: NOW }, shots: new MemoryShots(), env: { BUILDER_READ_KEY: BUILDER }, log: (l) => lines.push(l) }, cookie, lines };
}

const post = (body: BodyInit, headers: Record<string, string>) => new Request(`${ORIGIN}/api/foundry-shot`, { method: "POST", headers, body });

describe("/api/foundry-shot (#1027)", () => {
  it("keeps a picture from a passkey session under a fresh opaque id, its type read from its bytes", async () => {
    const { deps: d, cookie, lines } = await deps();
    const res = await shotPost(post(JPEG, { "Content-Type": "image/jpeg", Cookie: cookie }), d);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(SHOT_ID);
    expect(d.shots.items.get(id)?.type).toBe("image/jpeg");
    expect(lines.join(" ")).not.toContain(id);
  });

  it("refuses a signed-out post, a body that isn't a picture, and one that's too big", async () => {
    const { deps: d, cookie } = await deps();
    expect((await shotPost(post(JPEG, { "Content-Type": "image/jpeg" }), d)).status).toBe(401);
    expect((await shotPost(post("<svg/>", { "Content-Type": "image/jpeg", Cookie: cookie }), d)).status).toBe(415);
    expect((await shotPost(post(JPEG, { "Content-Type": "text/html", Cookie: cookie }), d)).status).toBe(415);
    expect((await shotPost(post(JPEG, { "Content-Type": "image/jpeg", "Content-Length": String(4 * 1024 * 1024), Cookie: cookie }), d)).status).toBe(413);
    expect(d.shots.items.size).toBe(0);
  });

  it("serves it back only to a passkey session or the Builder read key, privately", async () => {
    const { deps: d, cookie } = await deps();
    const id = await d.shots.save(JPEG, "image/jpeg");
    const signedOut = await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=${id}`), d);
    expect(signedOut.status).toBe(401);
    const builder = await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=${id}`, { headers: { "x-ceo-builder-key": BUILDER } }), d);
    expect(builder.status).toBe(200);
    expect(builder.headers.get("content-type")).toBe("image/jpeg");
    expect(builder.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await builder.arrayBuffer())).toEqual(JPEG);
    const session = await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=${id}`, { headers: { Cookie: cookie } }), d);
    expect(session.status).toBe(200);
    expect((await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=shot-0000`, { headers: { Cookie: cookie } }), d)).status).toBe(400);
    expect((await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=shot-${"0".repeat(20)}`, { headers: { Cookie: cookie } }), d)).status).toBe(404);
    // The wrong key, or the right one on another query, opens nothing.
    expect((await shotGet(new Request(`${ORIGIN}/api/foundry-shot?id=${id}`, { headers: { "x-ceo-builder-key": "c".repeat(40) } }), d)).status).toBe(401);
    expect(isBuilderRead(new Request(`${ORIGIN}/api/foundry-shot?id=${id}&x=1`))).toBe(false);
    expect(isBuilderRead(new Request(`${ORIGIN}/api/foundry-shot?id=${id}`, { method: "POST" }))).toBe(false);
  });

  it("reads a picture's type from its first bytes only", () => {
    expect(shotType(JPEG)).toBe("image/jpeg");
    expect(shotType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(shotType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(shotType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});
