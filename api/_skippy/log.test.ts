import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BlobRoomLog, LOG_KEEP, LOG_SHOW, MemoryRoomLog, ROOM_SUBMINDS, cardText, cleanCard, cleanFollowUp, cleanTurn, handoffTo, keepTurns, readRoom, turnId, type LoggedTurn } from "./log.ts";
import { SUBMINDS } from "../../packages/simulator/src/subminds.ts";
import { pickBlob } from "../_blob.ts";

vi.mock("@vercel/blob", async () => (await import("../_desk/fakeBlob.ts")).fakeBlob);

const NOW = Date.parse("2026-10-22T16:00:00Z");
const DAY = 86_400_000;
const turn = (i: number, at = NOW - i * 60_000, room: LoggedTurn["room"] = "green"): Omit<LoggedTurn, "id"> => ({ at: new Date(at).toISOString(), question: `q${i}`, answer: `a${i}`, room, model: "claude-sonnet-5-5" });

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

describe("hand-offs in the room log (#312)", () => {
  const at = new Date(NOW).toISOString();
  const handed = (question: string, needs: LoggedTurn["needs"], room: LoggedTurn["room"] = "foundry") => ({ at, question, answer: "Handed to the Builder.", room, model: "claude-sonnet-5-5", needs });

  it("keeps its copy of the subminds in step with the one list", () => {
    for (const [room, m] of Object.entries(ROOM_SUBMINDS)) {
      const real = SUBMINDS.find((s) => s.room === room)!;
      expect(m, room).toEqual({ id: real.id, name: real.name, active: real.active });
    }
  });

  it("hands a submind's ask to the room's active submind, and anything else to Skippy", () => {
    expect(handoffTo("submind", "foundry")).toBe("ember");
    expect(handoffTo("submind", "green")).toBe("turf");
    expect(handoffTo("submind", "relay")).toBe("skippy");
    expect(handoffTo("submind", "none")).toBe("skippy");
    expect(handoffTo("skippy", "green")).toBe("skippy");
    for (const no of ["none", "", "ember", null, 1]) expect(handoffTo(no, "foundry")).toBeNull();
  });

  it("gives every turn a stable id and drops a hand-off to anyone outside the set", () => {
    const t = cleanTurn({ at, question: "q", answer: "a", needs: "rocky" })!;
    expect(t.id).toBe(turnId(at, "q"));
    expect(t.needs).toBeUndefined();
    expect(cleanTurn({ at, question: "q", answer: "a", needs: "ember", id: "../../etc" })!.id).toBe(turnId(at, "q"));
  });

  it("lists only the open hand-offs when asked, and closes one when its answer comes back", async () => {
    const log = new MemoryRoomLog();
    await log.add(handed("Build the Spire a lift", "ember"), NOW);
    await log.add(handed("Which room owns this?", "skippy"), NOW + 1);
    await log.add({ at: new Date(NOW + 2).toISOString(), question: "What's building?", answer: "Two jobs.", room: "foundry", model: "m" }, NOW);
    expect(await log.list("foundry", NOW, "any")).toHaveLength(2);
    const [ember] = await log.list("foundry", NOW, "ember");
    expect(ember!.question).toBe("Build the Spire a lift");
    expect(await log.list("foundry", NOW)).toHaveLength(3);

    // A submind answers only what was handed to it; Skippy can answer any.
    expect(await log.answer(ember!.id, { from: "turf", text: "Mine now.", at }, NOW)).toEqual({ ok: false, why: "wrong-thread" });
    const done = await log.answer(ember!.id, { from: "ember", text: "On the line, monkey.", at }, NOW);
    expect(done.ok && done.turn.followUp).toEqual({ from: "ember", text: "On the line, monkey.", at });
    expect(await log.answer(ember!.id, { from: "skippy", text: "Again.", at }, NOW)).toEqual({ ok: false, why: "answered" });
    expect(await log.list("foundry", NOW, "ember")).toEqual([]);
    expect(await log.list("foundry", NOW, "any")).toHaveLength(1);

    const plain = (await log.list("foundry", NOW)).find((t) => !t.needs)!;
    expect(await log.answer(plain.id, { from: "skippy", text: "x", at }, NOW)).toEqual({ ok: false, why: "not-handed-off" });
    expect(await log.answer("0123456789abcdef", { from: "skippy", text: "x", at }, NOW)).toEqual({ ok: false, why: "missing" });
  });

  it("answers in whichever room's file the turn is in, in the blob store too", async () => {
    const blob = pickBlob({ BLOB_STORE_ID: "store_handoff" })!;
    const log = new BlobRoomLog(blob);
    await log.add(handed("Is my book hedged?", "ticker", "exchange"), NOW);
    const [t] = await log.list("exchange", NOW, "ticker");
    const res = await log.answer(t!.id, { from: "skippy", text: "Hedged enough.", at }, NOW);
    expect(res.ok && res.turn.room).toBe("exchange");
    expect((await log.list("exchange", NOW))[0]!.followUp?.text).toBe("Hedged enough.");
    expect(await log.list("exchange", NOW, "any")).toEqual([]);
  });
});

describe("the subminds' doorbell (#341, scripts/submind-watch.sh)", () => {
  const script = readFileSync(new URL("../../scripts/submind-watch.sh", import.meta.url), "utf8");

  it("watches each active room for its own submind, and only those", () => {
    const mapped = Object.fromEntries([...script.matchAll(/^\s+([a-z]+)\) mind=([a-z]+) ;;$/gm)].map((m) => [m[1], m[2]]));
    const active = Object.fromEntries(Object.entries(ROOM_SUBMINDS).filter(([, m]) => m.active).map(([room, m]) => [room, m.id]));
    expect(mapped).toEqual(active);
  });

  it("reads only the needs filter with the read key in its own header, from stdin, and never prints it", () => {
    expect(script).toContain('url="$site/api/skippy-log?room=$room&needs=$mind"');
    expect(script).toContain(`printf 'x-ceo-room-key: %s\\n' "$SUBMIND_LOG_TOKEN" | curl -sS --max-time 20 -H @-`);
    const uses = script.split("\n").filter((l) => l.includes("$SUBMIND_LOG_TOKEN") || l.includes("${SUBMIND_LOG_TOKEN"));
    expect(uses).toHaveLength(2); // the emptiness check and the header
    const code = script.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    expect(code).not.toMatch(/echo[^\n]*\$\{?SUBMIND_LOG_TOKEN/);
    expect(code).not.toMatch(/\bset -x\b|\benv\b|printenv|-X POST|SUBMIND_FEED_TOKEN/);
  });
});

describe("the answer card (#341)", () => {
  it("keeps a verdict, up to three columns and six rows, short lines, and no links", () => {
    const c = cleanCard({ verdict: " Start Tucker ", cols: ["Sleeper", "FantasyPros", "Form", "Extra"], rows: [{ label: "Tucker", values: [7.611, "9", 9] }, { label: "", values: [1] }], metrics: ["a", "see https://x.example", 5], sources: ["Sleeper"] })!;
    expect(c).toEqual({ verdict: "Start Tucker", cols: ["Sleeper", "FantasyPros", "Form"], rows: [{ label: "Tucker", values: [7.61, null, 9] }], metrics: ["a"], sources: ["Sleeper"] });
    expect(cleanCard({ verdict: "", cols: [] })).toBeNull();
    expect(cleanCard(["x"])).toBeNull();
    expect(cleanCard({ verdict: "Fine", rows: [{ label: "x", values: [1] }] })).toEqual({ verdict: "Fine", cols: [], rows: [], metrics: [], sources: [] });
    expect(cardText(c)).toContain("Tucker");
  });

  it("rides on a follow-up and survives the store", () => {
    const at = new Date(NOW).toISOString();
    const f = cleanFollowUp({ from: "turf", text: "Tucker.", at, card: { verdict: "Start Tucker", cols: ["Sleeper"], rows: [{ label: "Tucker", values: [7.6] }] } })!;
    expect(f.card!.rows).toEqual([{ label: "Tucker", values: [7.6] }]);
    expect(cleanFollowUp({ from: "turf", text: "Tucker.", at, card: { nope: 1 } })).toEqual({ from: "turf", text: "Tucker.", at });
    const t = cleanTurn({ ...turn(1), needs: "turf", followUp: f })!;
    expect(t.followUp!.card!.verdict).toBe("Start Tucker");
  });
});
