import { describe, expect, it } from "vitest";
import { byDay, dayLabel, HISTORY_PATH, loadConversation, loadHistory, readSummary, spanLabel, viaLabel } from "./callHistory.ts";

/** Call history (#1160), browser side. Every word here is made up. */

const reply = (status: number, body: unknown, seen: string[] = []) =>
  (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;

describe("Call history in Skippy's chat (#1160)", () => {
  it("reads the list newest first and drops what doesn't hold together", async () => {
    const seen: string[] = [];
    const got = await loadHistory(
      reply(
        200,
        {
          conversations: [
            { id: "c1", kind: "chat", via: "phone", at: "2026-11-12T09:00:00Z", end: "2026-11-12T09:05:00Z", turns: 3, first: "a sample question" },
            { id: "tconv_x", kind: "talk", via: "talk", at: "2026-11-12T18:00:00Z", end: "2026-11-12T18:12:00Z", turns: 6, first: "a sample call" },
            { id: "", at: "2026-11-12T10:00:00Z" },
            { id: "c2", at: "not a date" },
          ],
        },
        seen,
      ),
    );
    expect(seen).toEqual([HISTORY_PATH]);
    expect(got.ok && got.value.map((c) => c.id)).toEqual(["tconv_x", "c1"]);
  });

  it("says why when it can't open", async () => {
    expect(await loadHistory(reply(401, { error: "signed-out" }))).toEqual({ ok: false, why: "signed-out" });
    expect(await loadHistory(reply(500, {}))).toEqual({ ok: false, why: "failed" });
    expect(await loadConversation("tgone", reply(404, { error: "gone" }))).toEqual({ ok: false, why: "gone" });
  });

  it("reads one conversation back by its id", async () => {
    const seen: string[] = [];
    const got = await loadConversation(
      "tconv x",
      reply(
        200,
        {
          conversation: {
            id: "tconv x",
            kind: "talk",
            via: "talk",
            at: "2026-11-12T18:00:00Z",
            end: "2026-11-12T18:12:00Z",
            turns: 2,
            first: "hi",
            lines: [
              { at: "2026-11-12T18:00:00Z", via: "talk", q: "a sample hello", a: "[smug] A sample answer." },
              { at: "2026-11-12T18:01:00Z", via: "talk", q: "", a: "" },
            ],
          },
        },
        seen,
      ),
    );
    expect(seen).toEqual([`${HISTORY_PATH}?id=tconv%20x`]);
    expect(got.ok && got.value.lines.map((l) => l.q)).toEqual(["a sample hello"]);
  });

  it("labels how it came in, its day and how long a call ran", () => {
    expect(viaLabel({ kind: "talk", via: "talk" })).toBe("Call");
    expect(viaLabel({ kind: "chat", via: "phone" })).toBe("Phone");
    expect(viaLabel({ kind: "chat", via: "desk" })).toBe("Typed");
    expect(viaLabel({ kind: "chat", via: "room" })).toBe("Room mic");
    const now = new Date(2026, 10, 13, 12, 0).getTime();
    expect(dayLabel(new Date(2026, 10, 13, 8, 0).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 12, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 10, 9, 0).toISOString(), now)).toMatch(/10 Nov/);
    expect(spanLabel({ at: "2026-11-12T18:00:00Z", end: "2026-11-12T18:12:20Z" })).toBe("12 min");
    expect(spanLabel({ at: "2026-11-12T18:00:00Z", end: "2026-11-12T18:00:10Z" })).toBe("");
    const a = readSummary({ id: "c1", at: new Date(2026, 10, 13, 9).toISOString() })!;
    const b = readSummary({ id: "c2", at: new Date(2026, 10, 13, 8).toISOString() })!;
    const c = readSummary({ id: "c3", at: new Date(2026, 10, 12, 8).toISOString() })!;
    expect(byDay([a, b, c], now).map((g) => [g.day, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
    ]);
  });
});
