import { describe, expect, it } from "vitest";
import { MemoryRecordStore } from "./_skippy/senaterecord.ts";
import { MemoryTopicStore } from "./_skippy/senatetalk.ts";
import { recordGet } from "./senate-record.ts";

/** GET /api/senate-record (#1181): the Senate's motions and rulings, read-only. Every line is made up. */

describe("GET /api/senate-record (#1181)", () => {
  it("answers the record, newest first, rulings then older motions alone", async () => {
    const record = new MemoryRecordStore();
    const topics = new MemoryTopicStore();
    topics.list = ["that an old sample motion stands", "that a new sample motion stands"];
    await record.add({ at: "2026-11-14T12:00:00.000Z", motion: "that a new sample motion stands", close: "Carried, magnificently." });
    const res = await recordGet({ record, topics });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
    expect(await res.json()).toEqual({
      entries: [{ at: "2026-11-14T12:00:00.000Z", motion: "that a new sample motion stands", close: "Carried, magnificently." }, { motion: "that an old sample motion stands" }],
    });
  });

  it("answers an empty record with no store, and 503 when the store fails", async () => {
    expect(await (await recordGet({ record: null, topics: null })).json()).toEqual({ entries: [] });
    const broken = { load: async () => Promise.reject(new Error("down")), add: async () => undefined };
    const res = await recordGet({ record: broken, topics: null });
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
