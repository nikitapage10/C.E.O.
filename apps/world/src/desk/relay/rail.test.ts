import { describe, expect, it } from "vitest";
import type { EmailItem } from "../email/email.ts";
import type { TextItem } from "../texts/texts.ts";
import { DOCK_MAX, DOCK_SIGMA, dockOffsets, dockScale, dockScales, railAt, railIndex, railOf, railRowH, railStep } from "./rail.ts";
import { queueOf } from "./thread.ts";

/* Relay's rail (#765). Every person and message here is made up. */

const NOW = Date.UTC(2026, 10, 5, 2, 0, 0);
const mail = (over: Partial<EmailItem> = {}): EmailItem => ({ id: "aa11bb22cc33", at: NOW - 3_600_000, from: "Robin Madeup", subject: "Picnic Saturday?", kind: "needs-you", summary: "Robin asks about the picnic.", action: "Reply", done: false, ...over });
const text = (over: Partial<TextItem> = {}): TextItem => ({ id: "0123456789abcdef", name: "Sam Test", channel: "iMessage", group: false, state: "owed", sort: "normal", since: NOW - 4 * 60_000, laterUntil: null, gist: "Asks whether to start   without you", draft: null, summary: null, ...over });

describe("the Dock's bell curve", () => {
  it("is largest under the pointer and falls off as a gaussian of the distance", () => {
    expect(dockScale(0)).toBeCloseTo(DOCK_MAX);
    expect(dockScale(DOCK_SIGMA)).toBeCloseTo(1 + (DOCK_MAX - 1) * Math.exp(-0.5));
    expect(dockScale(2, 2, 1)).toBeCloseTo(1 + Math.exp(-2));
    expect(dockScale(40)).toBeCloseTo(1, 6);
  });

  it("is symmetric and only ever shrinks with distance", () => {
    for (let d = 0; d < 10; d += 0.5) {
      expect(dockScale(d)).toBeCloseTo(dockScale(-d));
      expect(dockScale(d + 0.5)).toBeLessThan(dockScale(d));
      expect(dockScale(d)).toBeGreaterThanOrEqual(1);
    }
  });

  it("is flat for a broken input", () => {
    expect(dockScale(Number.NaN)).toBe(1);
    expect(dockScale(1, 1.8, 0)).toBe(1);
  });

  it("scales every item from a fractional pointer, eased by amp, and nothing without one", () => {
    expect(dockScales(5, null)).toEqual([1, 1, 1, 1, 1]);
    const s = dockScales(7, 3);
    expect(s[3]).toBeCloseTo(DOCK_MAX);
    expect(s[2]).toBeCloseTo(s[4]!);
    expect(Math.max(...s)).toBe(s[3]);
    const half = dockScales(7, 3, 0.5);
    expect(half[3]).toBeCloseTo(1 + (DOCK_MAX - 1) / 2);
    expect(dockScales(3, 1, 0)).toEqual([1, 1, 1]);
    const between = dockScales(4, 1.5);
    expect(between[1]).toBeCloseTo(between[2]!);
  });

  it("spreads the neighbours apart and keeps the item under the pointer still", () => {
    const s = dockScales(9, 4);
    const o = dockOffsets(s, 20, 4);
    expect(o[4]).toBeCloseTo(0);
    expect(o[3]).toBeLessThan(0);
    expect(o[5]).toBeGreaterThan(0);
    expect(o[0]).toBeCloseTo(-o[8]!);
    // Grown rows never overlap: each centre gap is at least the two half-heights.
    for (let i = 1; i < 9; i++) expect(i * 20 + o[i]! - ((i - 1) * 20 + o[i - 1]!)).toBeGreaterThanOrEqual(((s[i]! + s[i - 1]!) / 2) * 20 - 1e-9);
    expect(dockOffsets([1, 1], 20, null)).toEqual([0, 0]);
  });
});

describe("the rail's rows and sync", () => {
  it("lists exactly the queue, in the Thread's order, with the current one marked", () => {
    const q = queueOf([mail(), mail({ id: "aa11bb22cc34", at: NOW - 86_400_000 * 2, from: "Quinn Madeup", subject: "" })], [text(), text({ id: "1123456789abcdef", name: "Ari Test", sort: "sooner", since: NOW - 60_000, photo: "ab12" })]);
    const rows = railOf(q, "e:aa11bb22cc33", NOW);
    expect(rows.map((r) => r.key)).toEqual(q.map((x) => x.key));
    expect(rows.map((r) => r.cur)).toEqual(q.map((x) => x.key === "e:aa11bb22cc33"));
    expect(rows[0]).toMatchObject({ who: "Ari Test", initial: "A", line: "text", photo: "ab12", age: "1 min" });
    expect(rows.find((r) => r.key === "e:aa11bb22cc34")).toMatchObject({ preview: "Robin asks about the picnic.", age: "2 d" });
    expect(rows.find((r) => r.key === "t:0123456789abcdef")?.preview).toBe("Asks whether to start without you");
    expect(rows.find((r) => r.key === "e:aa11bb22cc33")?.preview).toBe("Picnic Saturday?");
    expect(railOf(null, null, NOW)).toEqual([]);
  });

  it("finds the current item and steps along the rail, clamped to its ends", () => {
    const rows = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(railIndex(rows, "b")).toBe(1);
    expect(railIndex(rows, "z")).toBe(-1);
    expect(railIndex(rows, null)).toBe(-1);
    expect(railStep(1, 1, 3)).toBe(2);
    expect(railStep(2, 1, 3)).toBe(2);
    expect(railStep(0, -1, 3)).toBe(0);
    expect(railStep(-1, 1, 3)).toBe(0);
    expect(railStep(-1, -1, 3)).toBe(2);
    expect(railStep(0, 1, 0)).toBeNull();
  });

  it("reads which item a pointer is over, and fits the rows to the space", () => {
    expect(railAt(10, 20, 5)).toBe(0);
    expect(railAt(50, 20, 5)).toBe(2);
    expect(railAt(-30, 20, 5)).toBe(0);
    expect(railAt(999, 20, 5)).toBe(4);
    expect(railAt(10, 20, 0)).toBeNull();
    expect(railRowH(600, 30)).toBe(20);
    expect(railRowH(600, 3)).toBe(26);
    expect(railRowH(200, 100)).toBe(10);
  });
});
