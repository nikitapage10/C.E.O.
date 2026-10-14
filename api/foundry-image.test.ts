import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signPicture } from "./_pictures.ts";
import { GET } from "./foundry-image.ts";

/** The private Blob store, stubbed: records what was read, never touches the network. */
const blob = vi.hoisted(() => ({ reads: [] as string[] }));
vi.mock("@vercel/blob", () => ({
  get: async (path: string) => {
    blob.reads.push(path);
    return { stream: new Blob(["picture"]).stream(), blob: { contentType: "image/png" } };
  },
  put: async () => ({ pathname: "foundry/ideas/x.png" }),
}));

const PATH = "foundry/ideas/a1.png";
const at = (query: string) => GET(new Request(`https://ceo.example/api/foundry-image?${query}`));

beforeEach(() => {
  blob.reads.length = 0;
  vi.stubEnv("FOUNDRY_DESK_KEY", "test-desk-key");
  vi.stubEnv("BLOB_STORE_ID", "store_test");
});
afterEach(() => vi.unstubAllEnvs());

describe("the picture function serves only signed, unexpired links (#127)", () => {
  it("serves a picture on a good link, for the viewer's browser only and not for long", async () => {
    const until = Math.floor(Date.now() / 1000) + 600;
    const res = await at(`p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture("test-desk-key", PATH, until)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^private, max-age=(\d{1,3})$/);
    expect(Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control")!)![1])).toBeLessThanOrEqual(600);
    expect(blob.reads).toEqual([PATH]);
  });

  it("refuses the bare link a public issue used to carry, and any forged or stale one, without reading the store", async () => {
    const until = Math.floor(Date.now() / 1000) + 600;
    const good = await signPicture("test-desk-key", PATH, until);
    const stale = Math.floor(Date.now() / 1000) - 5;
    for (const query of [
      `p=${encodeURIComponent(PATH)}`,
      `p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture("wrong-key", PATH, until)}`,
      `p=${encodeURIComponent("foundry/ideas/other.png")}&u=${until}&s=${good}`,
      `p=${encodeURIComponent(PATH)}&u=${until + 60}&s=${good}`,
      `p=${encodeURIComponent(PATH)}&u=${stale}&s=${await signPicture("test-desk-key", PATH, stale)}`,
    ]) {
      expect((await at(query)).status, query).toBe(403);
    }
    expect((await at(`p=${encodeURIComponent("world/state.json")}&u=${until}&s=${good}`)).status).toBe(404);
    expect(blob.reads).toEqual([]);
  });

  it("serves nothing when the Desk key isn't set", async () => {
    vi.stubEnv("FOUNDRY_DESK_KEY", "");
    const until = Math.floor(Date.now() / 1000) + 600;
    expect((await at(`p=${encodeURIComponent(PATH)}&u=${until}&s=${await signPicture("x", PATH, until)}`)).status).toBe(403);
    expect(blob.reads).toEqual([]);
  });
});
