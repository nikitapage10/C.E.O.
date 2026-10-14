import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobFiles } from "./_desk/fakeBlob.ts";
import { pictureSecret } from "./_desk/keys.ts";
import { signedInCookie } from "./_desk/testing.ts";
import { signPicture, verifyPicture } from "./_pictures.ts";
import { GET, POST } from "./foundry-image.ts";

/** The private Blob store, in memory: the pictures and the Desk's passkeys. Never touches the network. */
vi.mock("@vercel/blob", async () => (await import("./_desk/fakeBlob.ts")).fakeBlob);

const KEY = "test-desk-key";
const PATH = "foundry/ideas/a1.png";
const at = (query: string, headers: Record<string, string> = {}) => GET(new Request(`https://ceo.example/api/foundry-image?${query}`, { headers }));
const pictures = () => [...blobFiles.keys()].filter((k) => k.startsWith("foundry/"));

beforeEach(() => {
  blobFiles.clear();
  blobFiles.set(PATH, { body: new Uint8Array([1, 2, 3]), type: "image/png" });
  vi.stubEnv("FOUNDRY_DESK_KEY", KEY);
  vi.stubEnv("BLOB_STORE_ID", "store_test");
});
afterEach(() => vi.unstubAllEnvs());

describe("the picture function serves only signed, unexpired links (#127)", () => {
  it("serves a picture on a good link, for the viewer's browser only and not for long", async () => {
    const until = Math.floor(Date.now() / 1000) + 600;
    const res = await at(`p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture(await pictureSecret(KEY), PATH, until)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^private, max-age=(\d{1,3})$/);
    expect(Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control")!)![1])).toBeLessThanOrEqual(600);
  });

  it("refuses the bare link a public issue used to carry, and any forged or stale one", async () => {
    const until = Math.floor(Date.now() / 1000) + 600;
    const secret = await pictureSecret(KEY);
    const good = await signPicture(secret, PATH, until);
    const stale = Math.floor(Date.now() / 1000) - 5;
    for (const query of [
      `p=${encodeURIComponent(PATH)}`,
      `p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture("wrong-key", PATH, until)}`,
      // Signed with the Desk key itself: since #132 only the key derived from it signs.
      `p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture(KEY, PATH, until)}`,
      `p=${encodeURIComponent("foundry/ideas/other.png")}&u=${until}&s=${good}`,
      `p=${encodeURIComponent(PATH)}&u=${until + 60}&s=${good}`,
      `p=${encodeURIComponent(PATH)}&u=${stale}&s=${await signPicture(secret, PATH, stale)}`,
    ]) {
      expect((await at(query)).status, query).toBe(403);
    }
    expect((await at(`p=${encodeURIComponent("world/state.json")}&u=${until}&s=${good}`)).status).toBe(404);
  });

  it("serves nothing when the Desk key isn't set", async () => {
    vi.stubEnv("FOUNDRY_DESK_KEY", "");
    const until = Math.floor(Date.now() / 1000) + 600;
    expect((await at(`p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture("x", PATH, until)}`)).status).toBe(403);
  });
});

describe("uploading and signing need the Desk's sign-in (#132)", () => {
  const upload = (headers: Record<string, string>) => POST(new Request("https://ceo.example/api/foundry-image", { method: "POST", headers: { "Content-Type": "image/png", ...headers }, body: new Uint8Array([9, 9, 9]) }));

  it("refuses an upload with no session, or with the old Desk key header, and stores nothing", async () => {
    for (const headers of [{}, { "x-desk-key": KEY }, { Cookie: "__Host-ceo-desk=forged.token" }] as Record<string, string>[]) {
      expect((await upload(headers)).status).toBe(401);
    }
    expect(pictures()).toEqual([PATH]);
  });

  it("stores an upload from a signed-in Desk, and renews its session", async () => {
    const res = await upload({ Cookie: await signedInCookie(KEY) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toMatch(/^https:\/\/ceo\.example\/api\/foundry-image\?p=foundry%2Fideas%2F\d+-r4nd0m\.png$/);
    expect(res.headers.getSetCookie().join()).toContain("HttpOnly");
    expect(pictures()).toHaveLength(2);
  });

  it("refuses an upload from another site, even with the cookie", async () => {
    expect((await upload({ Cookie: await signedInCookie(KEY), Origin: "https://attacker.example" })).status).toBe(403);
    expect(pictures()).toEqual([PATH]);
  });

  it("signs the Desk's own links only when signed in, and only for its own pictures", async () => {
    const names = ["foundry/ideas/a1.png", "world/state.json", "https://attacker.example/x.png"].map(encodeURIComponent).join(",");
    expect((await at(`sign=${names}`)).status).toBe(401);
    const res = await at(`sign=${names}`, { Cookie: await signedInCookie(KEY) });
    expect(res.status).toBe(200);
    const { links } = (await res.json()) as { links: string[] };
    expect(links).toHaveLength(1);
    const q = new URL(links[0]!, "https://ceo.example").searchParams;
    expect(q.get("p")).toBe(PATH);
    const until = Number(q.get("u"));
    expect(until - Date.now() / 1000).toBeGreaterThanOrEqual(590);
    expect(until - Date.now() / 1000).toBeLessThanOrEqual(1200);
    expect(await verifyPicture(await pictureSecret(KEY), PATH, until, q.get("s")!, Date.now())).toBe(true);
  });
});
