import { describe, expect, it, vi } from "vitest";
import { BlobRoomLog, LOG_KEEP, LOG_SHOW, MemoryRoomLog, cleanTurn, keepTurns, readRoom, type LoggedTurn } from "./log.ts";
import { pickBlob } from "../_blob.ts";

vi.mock("@vercel/blob", async () => (await import("../_desk/fakeBlob.ts")).fakeBlob);

const NOW = Date.parse("2026-10-22T16:00:00Z");
const DAY = 86_400_000;
const turn = (i: number, at = NOW - i * 60_000, room: LoggedTurn["room"] = "green"): LoggedTurn => ({ at: new Date(at).toISOString(), question: `q${i}`, answer: `a${i}`, room, model: "claude-sonnet-5-5" });

describe("Skippy's room log (#273)", () => {
  it("reads a room from the set, and anything else as none", () => {
    for (const r of ["green", "exchange", "boiler", "foundry", "relay", "none"]) expect(readRoom(r)).toBe(r);
    for (const bad of ["Green", "spire", "lattice", "", " green", 7, null, undefined, {}, ["green"]]) expect(readRoom(bad)).toBe("none");
  });

  it("keeps the last 200 turns, oldest first, and none older than 30 days", () => {
    const many = Array.from({ length: 260 }, (_, i) => turn(i));
    const kept = keepTurns([...many, turn(999, NOW - 31 * DAY), turn(998, NOW - 29 * DAY)], NOW);
    expect(kept).toHaveLength(LOG_KEEP);
    expect(kept.at(-1)!.question).toBe("q0");
    expect(kept.some((t) => t.question === "q999")).toBe(false);
    expect(Date.parse(kept[0]!.at)).toBeLessThan(Date.parse(kept[1]!.at));
  });

  it("drops what isn't a turn and caps what is", () => {
    expect(cleanTurn({ at: "nope", question: "q", answer: "a" })).toBeNull();
    expect(cleanTurn({ at: new Date(NOW).toISOString(), question: "", answer: "a" })).toBeNull();
    const t = cleanTurn({ at: new Date(NOW).toISOString(), question: "x".repeat(900), answer: "y\n\ny".repeat(400), room: "mars", model: 5 })!;
    expect(t.question.length).toBe(600);
    expect(t.answer.length).toBeLessThanOrEqual(700);
    expect(t.answer).not.toContain("\n");
    expect(t.room).toBe("none");
    expect(t.model).toBe("unknown");
    expect(keepTurns("garbage", NOW)).toEqual([]);
  });

  it("lists a room newest first, at most fifty, and keeps rooms apart", async () => {
    const log = new MemoryRoomLog();
    for (let i = 59; i >= 0; i--) await log.add(turn(i), NOW);
    await log.add(turn(1, NOW, "exchange"), NOW);
    const green = await log.list("green", NOW);
    expect(green).toHaveLength(LOG_SHOW);
    expect(green[0]!.question).toBe("q0");
    expect((await log.list("exchange", NOW)).map((t) => t.question)).toEqual(["q1"]);
    expect(await log.list("relay", NOW)).toEqual([]);
    // Thirty-one days on, the old turns are gone on read.
    expect(await log.list("green", NOW + 31 * DAY)).toEqual([]);
  });

  it("keeps each room in its own private file in the blob store", async () => {
    const blob = pickBlob({ BLOB_STORE_ID: "store_test" })!;
    const log = new BlobRoomLog(blob);
    await log.add(turn(0, NOW, "relay"), NOW);
    await log.add(turn(1, NOW - 1000, "relay"), NOW);
    expect((await log.list("relay", NOW)).map((t) => t.question)).toEqual(["q0", "q1"]);
    expect(await blob.get("desk/skippy/rooms/relay.json")).not.toBeNull();
    expect(await log.list("green", NOW)).toEqual([]);
  });
});
