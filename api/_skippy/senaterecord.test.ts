import { beforeEach, describe, expect, it } from "vitest";
import { BlobPreconditionError, type BlobBackend } from "../_blob.ts";
import { MemoryChatLedger } from "./budget.ts";
import { BlobRecordStore, MemoryRecordStore, RECORD_KEEP, RECORD_PATH, readRuling, senateRecord } from "./senaterecord.ts";
import { MemoryTopicStore, joinDebate, newDebate, resetGaps, type SenateAsk } from "./senatetalk.ts";

/** The Senate Record (#1181): each new argument's motion and ruling kept, read back newest first. Every line is made up. */

const NOW = Date.parse("2026-11-14T12:00:00Z");
const SEATED = ["foundry", "relay", "exchange", "green", "spire", "archive", "boiler"];

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

const ruling = (i: number) => ({ at: new Date(NOW + i * 60_000).toISOString(), motion: `that sample motion number ${i} is clearly a lamp`, close: `Carried, ruling ${i}.` });

describe("the Senate Record's store (#1181)", () => {
  it("keeps rulings in the blob store, newest last, capped at RECORD_KEEP", async () => {
    const blob = memoryBlob();
    const store = new BlobRecordStore(blob, RECORD_PATH, 3);
    for (let i = 0; i < 5; i++) await store.add(ruling(i));
    expect((await store.load()).map((r) => r.close)).toEqual(["Carried, ruling 2.", "Carried, ruling 3.", "Carried, ruling 4."]);
    expect(blob.files.has(RECORD_PATH)).toBe(true);
    expect(RECORD_KEEP).toBe(200);
  });

  it("drops anything that isn't a ruling, on the way in and on the way out", async () => {
    const blob = memoryBlob();
    await blob.put(RECORD_PATH, JSON.stringify([ruling(1), { motion: "no ruling" }, "a bare string", { at: "yesterday", motion: "m", close: "c" }]), { contentType: "application/json" });
    const store = new BlobRecordStore(blob);
    expect(await store.load()).toEqual([ruling(1)]);
    await store.add({ at: "not a time", motion: "m", close: "c" });
    expect(await store.load()).toHaveLength(1);
    expect(readRuling({ ...ruling(1), close: "x".repeat(300) })).toBeNull();
    const mem = new MemoryRecordStore(2);
    for (let i = 0; i < 3; i++) await mem.add(ruling(i));
    expect(mem.list.map((r) => r.motion)).toEqual([ruling(1).motion, ruling(2).motion]);
  });

  it("retries a write that lost a race", async () => {
    const blob = memoryBlob();
    const store = new BlobRecordStore(blob);
    await store.add(ruling(0));
    let raced = false;
    const put = blob.put;
    blob.put = async (path, body, opts) => {
      if (!raced) {
        raced = true;
        await put(path, JSON.stringify([ruling(0), ruling(1)]), { contentType: "application/json", allowOverwrite: true });
      }
      return put(path, body, opts);
    };
    await store.add(ruling(2));
    expect((await store.load()).map((r) => r.close)).toEqual(["Carried, ruling 0.", "Carried, ruling 1.", "Carried, ruling 2."]);
  });
});

describe("the Senate Record's view (#1181)", () => {
  it("lists the kept rulings newest first, then older motions alone, each once", () => {
    const v = senateRecord([ruling(1), ruling(2)], ["that an old motion was argued", ruling(1).motion, "that an older one was too", ruling(2).motion]);
    expect(v.entries).toEqual([
      { at: ruling(2).at, motion: ruling(2).motion, close: ruling(2).close },
      { at: ruling(1).at, motion: ruling(1).motion, close: ruling(1).close },
      { motion: "that an older one was too" },
      { motion: "that an old motion was argued" },
    ]);
    expect(senateRecord([], [], 5).entries).toEqual([]);
    expect(senateRecord([], ["a", "b", "c"], 2).entries).toEqual([{ motion: "c" }, { motion: "b" }]);
  });
});

describe("the chamber keeps its rulings (#1181)", () => {
  beforeEach(() => resetGaps());
  const ask: SenateAsk = async (system, user) => {
    const ids = /by id: ([a-z, ]+)\./.exec(user)![1]!.split(", ");
    const answer = system.includes("Nikita")
      ? { answers: [{ by: ids[0]!, text: "A fair point from the floor." }], rest: [], close: "Carried again, with the floor's help." }
      : {
          motion: "that the bright disc is a lamp someone forgot",
          lines: [
            { by: ids[0]!, stance: "open", text: "It is plainly a lamp." },
            { by: ids[1]!, stance: "aye", text: "Left on for ages." },
            { by: ids[2]!, stance: "nay", text: "Lamps do not set." },
          ],
          close: "Carried. The chair is the brighter lamp.",
          murmurs: ["Hear, hear"],
        };
    return { answer, usage: { input_tokens: 1_000, output_tokens: 200 } };
  };

  it("keeps a new argument's motion and ruling, never Nikita's join", async () => {
    const record = new MemoryRecordStore();
    const deps = { chat: new MemoryChatLedger(), kernel: new MemoryChatLedger(), topics: new MemoryTopicStore(), record, ask, budget: 60, now: NOW, rnd: () => 0.3 };
    const got = await newDebate({ seated: SEATED }, deps);
    expect("debate" in got).toBe(true);
    expect(record.list).toEqual([{ at: "2026-11-14T12:00:00.000Z", motion: "that the bright disc is a lamp someone forgot", close: "Carried. The chair is the brighter lamp." }]);
    await joinDebate(
      { said: "maybe it is a sun", motion: "that the bright disc is a lamp someone forgot", seated: SEATED, lines: [{ by: "relay", text: "Left on for ages." }] },
      { ...deps, now: NOW + 60_000 },
    );
    expect(record.list).toHaveLength(1);
  });
});
