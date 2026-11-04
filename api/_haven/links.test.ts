import { describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend, type PutOptions } from "../_blob.ts";
import { readJson, updateJson } from "./json.ts";
import { KEY_PREFIX, KEY_SHAPE, PHONE_KEY_HEADER, phoneKeyOf } from "./links.ts";

const KEY = `${KEY_PREFIX}${"A".repeat(43)}`;
const req = (headers: Record<string, string>) => new Request("https://ceo.test/api/capture", { headers });

describe("phoneKeyOf", () => {
  it("reads the phone-key header, trimmed", () => {
    expect(phoneKeyOf(req({ [PHONE_KEY_HEADER]: `  ${KEY} ` }))).toBe(KEY);
  });

  it("prefers the phone-key header over a Bearer token", () => {
    expect(phoneKeyOf(req({ [PHONE_KEY_HEADER]: KEY, authorization: "Bearer something-else" }))).toBe(KEY);
  });

  it("falls back to the Bearer token, and to null for anything else", () => {
    expect(phoneKeyOf(req({ authorization: `Bearer ${KEY}` }))).toBe(KEY);
    expect(phoneKeyOf(req({ authorization: `Basic ${KEY}` }))).toBeNull();
    expect(phoneKeyOf(req({ [PHONE_KEY_HEADER]: "   " }))).toBeNull();
    expect(phoneKeyOf(req({}))).toBeNull();
  });
});

describe("KEY_SHAPE", () => {
  it("accepts a prefix plus 43 base64url characters and nothing else", () => {
    expect(KEY_SHAPE.test(KEY)).toBe(true);
    expect(KEY_SHAPE.test(`${KEY_PREFIX}${"a-_9".repeat(10)}abc`)).toBe(true);
    expect(KEY_SHAPE.test(KEY.slice(0, -1))).toBe(false);
    expect(KEY_SHAPE.test(`${KEY}A`)).toBe(false);
    expect(KEY_SHAPE.test(KEY.replace("skp_", "key_"))).toBe(false);
    expect(KEY_SHAPE.test(`${KEY_PREFIX}${"A".repeat(42)}+`)).toBe(false);
  });
});

/** A one-file-per-path store with real ETags, so conditional writes behave like the real thing. */
function memoryBlob() {
  const files = new Map<string, { body: string; etag: number }>();
  let version = 0;
  const blob: BlobBackend = {
    kind: "vercel",
    async get(path) {
      const f = files.get(path);
      return f ? { stream: new Blob([f.body]).stream(), etag: `"${f.etag}"`, contentType: "application/json" } : null;
    },
    async etag(path) {
      const f = files.get(path);
      return f ? `"${f.etag}"` : null;
    },
    async put(path, body, opts: PutOptions) {
      const f = files.get(path);
      if (opts.ifMatch !== undefined && f && opts.ifMatch !== `"${f.etag}"`) throw new BlobPreconditionError();
      if (opts.ifMatch === undefined && f && !opts.allowOverwrite) throw new BlobPreconditionError();
      files.set(path, { body: String(body), etag: ++version });
      return { pathname: path };
    },
    async del(path) {
      files.delete(path);
    },
  };
  return { blob, files };
}

describe("readJson", () => {
  it("returns the fallback for a missing file and for one that is not JSON", async () => {
    const { blob, files } = memoryBlob();
    expect(await readJson(blob, "a.json", [1])).toEqual([1]);
    files.set("a.json", { body: "{not json", etag: 1 });
    expect(await readJson(blob, "a.json", [1])).toEqual([1]);
    files.set("a.json", { body: "null", etag: 2 });
    expect(await readJson(blob, "a.json", [1])).toEqual([1]);
  });

  it("returns what is stored", async () => {
    const { blob, files } = memoryBlob();
    files.set("a.json", { body: '{"n":2}', etag: 1 });
    expect(await readJson(blob, "a.json", { n: 0 })).toEqual({ n: 2 });
  });
});

describe("updateJson", () => {
  it("starts from the fallback, writes the next value and hands back the result", async () => {
    const { blob } = memoryBlob();
    const r = await updateJson(blob, "n.json", 0, (cur) => ({ next: cur + 1, result: "made" }));
    expect(r).toBe("made");
    expect(await readJson(blob, "n.json", -1)).toBe(1);
    await updateJson(blob, "n.json", 0, (cur) => ({ next: cur + 1, result: null }));
    expect(await readJson(blob, "n.json", -1)).toBe(2);
  });

  it("writes nothing when next is null", async () => {
    const { blob, files } = memoryBlob();
    expect(await updateJson(blob, "n.json", 5, (cur) => ({ next: null, result: cur }))).toBe(5);
    expect(files.size).toBe(0);
  });

  it("tries again when another write lands first, and re-reads the new value", async () => {
    const { blob, files } = memoryBlob();
    await updateJson(blob, "n.json", 0, () => ({ next: 10, result: null }));
    const seen: number[] = [];
    let raced = false;
    const racing: BlobBackend = {
      ...blob,
      async put(path, body, opts) {
        if (!raced) {
          raced = true;
          files.set(path, { body: "20", etag: 99 });
        }
        return blob.put(path, body, opts);
      },
    };
    await updateJson(racing, "n.json", 0, (cur) => {
      seen.push(cur);
      return { next: cur + 1, result: null };
    });
    expect(seen).toEqual([10, 20]);
    expect(await readJson(blob, "n.json", -1)).toBe(21);
  });

  it("gives up with the error after three lost races", async () => {
    const { blob } = memoryBlob();
    let tries = 0;
    const losing: BlobBackend = {
      ...blob,
      async put() {
        tries++;
        throw new BlobPreconditionError();
      },
    };
    await expect(updateJson(losing, "n.json", 0, () => ({ next: 1, result: null }))).rejects.toBeInstanceOf(BlobPreconditionError);
    expect(tries).toBe(3);
  });

  it("does not hide other errors", async () => {
    const { blob } = memoryBlob();
    await updateJson(blob, "n.json", 0, () => ({ next: 1, result: null }));
    let tries = 0;
    const broken: BlobBackend = {
      ...blob,
      async put() {
        tries++;
        throw new Error("storage down");
      },
    };
    await expect(updateJson(broken, "n.json", 0, () => ({ next: 2, result: null }))).rejects.toThrow("storage down");
    expect(tries).toBe(1);
  });
});
