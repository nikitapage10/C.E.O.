import { describe, expect, it } from "vitest";
import { ambientKey, archive, EMPTY, isArchived, isSaid, KEEP_MAX, KEEP_MS, load, markSaid, nextFresh, parse, prune, restore, save, splitArchived, versionOf, type SenateMemory } from "./heard.ts";
import { rites, type RiteInput } from "./rite.ts";

const BENCH = ["foundry", "relay", "boiler", "workshop"];
const SHIPPED: RiteInput = { key: "shipped", kind: "duty", by: "foundry", room: "Foundry", what: "two changes shipped while you were away", say: "Shipped: A, B." };
const SETUP: RiteInput = { key: "setup", kind: "duty", by: "boiler", room: "Boiler Room", what: "one setup step only you can do", say: "Four of five done." };
const IDEAS: RiteInput = { key: "ideas", kind: "decision", by: "foundry", room: "Foundry", what: "which idea the Foundry builds next", options: [{ label: "Shadows" }, { label: "Weather" }] };
const T = 1_700_000_000_000;

/** A storage that keeps what it is given, or throws on every call. */
const mem = (throws = false) => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error("blocked");
      m.set(k, v);
    },
  };
};

describe("the Senate says each thing once (#900)", () => {
  it("versions an item by what it says, not by where it sits on the docket", () => {
    const [a] = rites([SHIPPED, SETUP], BENCH);
    const [, b] = rites([SETUP, SHIPPED], BENCH);
    expect(a!.key).toBe("shipped");
    expect(b!.key).toBe("shipped");
    expect(a!.ver).toBe(b!.ver);
    expect(a!.n).not.toBe(b!.n);
  });

  it("gives changed content a new version", () => {
    const more = { ...SHIPPED, what: "three changes shipped while you were away" };
    expect(versionOf(more)).not.toBe(versionOf(SHIPPED));
    expect(versionOf({ ...IDEAS, options: [{ label: "Shadows" }, { label: "Tides" }] })).not.toBe(versionOf(IDEAS));
  });

  it("lets a row with a clock in its words name its own version", () => {
    const at3 = { ...SHIPPED, say: "It has waited 3h.", ver: "waiting" };
    const at4 = { ...SHIPPED, say: "It has waited 4h.", ver: "waiting" };
    expect(versionOf(at3)).toBe(versionOf(at4));
    expect(versionOf({ ...at4, ver: "draft" })).not.toBe(versionOf(at4));
  });

  it("picks the first item not yet said, and nothing once all are said", () => {
    const docket = rites([SHIPPED, SETUP, IDEAS], BENCH);
    let m: SenateMemory = EMPTY;
    const order: string[] = [];
    for (let k = 0; k < 10; k++) {
      const next = nextFresh(docket, m);
      if (!next) break;
      order.push(next.key);
      m = markSaid(m, next.key, next.ver, T);
    }
    expect(order).toEqual(["shipped", "setup", "ideas"]);
    expect(nextFresh(docket, m)).toBeNull();
  });

  it("says a changed item once more, and only that one", () => {
    let m: SenateMemory = EMPTY;
    for (const it of rites([SHIPPED, SETUP], BENCH)) m = markSaid(m, it.key, it.ver, T);
    const later = rites([{ ...SHIPPED, what: "three changes shipped while you were away" }, SETUP], BENCH);
    const next = nextFresh(later, m);
    expect(next?.key).toBe("shipped");
    m = markSaid(m, next!.key, next!.ver, T + 1);
    expect(nextFresh(later, m)).toBeNull();
  });

  it("skips what this visit has said even when the memory can't be kept", () => {
    const docket = rites([SHIPPED, SETUP], BENCH);
    const here = new Set([`shipped@${docket[0]!.ver}`]);
    expect(nextFresh(docket, EMPTY, here)?.key).toBe("setup");
  });

  it("hears a status line once, its numbers aside", () => {
    expect(ambientKey("spire", "The Lattice is at 41 visitors")).toBe(ambientKey("spire", "The Lattice is at 42 visitors"));
    expect(ambientKey("spire", "The Lattice is at 41 visitors")).not.toBe(ambientKey("foundry", "The Lattice is at 41 visitors"));
    expect(ambientKey("foundry", "Working on the Lattice")).not.toBe(ambientKey("foundry", "Working on the Desk"));
  });

  it("keeps a mark idempotent", () => {
    const m = markSaid(EMPTY, "a", "v1", T);
    expect(markSaid(m, "a", "v1", T + 5)).toBe(m);
  });
});

describe("cards put away (#900)", () => {
  it("archives a card as said, off the docket, and restores it still said", () => {
    const docket = rites([SHIPPED, SETUP], BENCH);
    const v = docket[1]!.ver;
    let m = archive(EMPTY, "setup", v, T);
    expect(isArchived(m, "setup", v)).toBe(true);
    expect(isSaid(m, "setup", v)).toBe(true);
    const { shown, away } = splitArchived(docket, (r) => r.key, (r) => r.ver, m);
    expect(shown.map((r) => r.key)).toEqual(["shipped"]);
    expect(away.map((r) => r.key)).toEqual(["setup"]);
    expect(nextFresh(docket, m)?.key).toBe("shipped");
    m = restore(m, "setup");
    expect(isArchived(m, "setup", v)).toBe(false);
    expect(isSaid(m, "setup", v)).toBe(true);
    expect(restore(m, "setup")).toBe(m);
  });

  it("brings an archived card back when its content changes", () => {
    const m = archive(EMPTY, "shipped", versionOf(SHIPPED), T);
    const newer = versionOf({ ...SHIPPED, what: "three changes shipped while you were away" });
    expect(isArchived(m, "shipped", newer)).toBe(false);
    expect(splitArchived([{ key: "shipped", ver: newer }], (r) => r.key, (r) => r.ver, m).shown).toHaveLength(1);
  });
});

describe("the memory on this device (#900)", () => {
  it("survives a reload", () => {
    const s = mem();
    let m = markSaid(EMPTY, "shipped", "v1", T);
    m = archive(m, "setup", "v2", T);
    m = { ...m, recess: 4 };
    save(m, s);
    const back = load(s, T + 1000);
    expect(isSaid(back, "shipped", "v1")).toBe(true);
    expect(isArchived(back, "setup", "v2")).toBe(true);
    expect(back.recess).toBe(4);
  });

  it("starts empty, and doesn't throw, when storage is blocked", () => {
    const s = mem(true);
    expect(load(s, T)).toEqual(EMPTY);
    expect(() => save(markSaid(EMPTY, "a", "v", T), s)).not.toThrow();
    expect(load(null, T)).toEqual(EMPTY);
  });

  it("takes only what is well formed", () => {
    expect(parse("not json")).toEqual(EMPTY);
    expect(parse("null")).toEqual(EMPTY);
    expect(parse(JSON.stringify({ said: { a: { v: "x", at: T }, b: { v: 3 }, c: null }, archived: "no", recess: -2 }))).toEqual({ said: { a: { v: "x", at: T } }, archived: {}, recess: 0 });
  });

  it("lets old and surplus marks go", () => {
    let m: SenateMemory = markSaid(EMPTY, "old", "v", T - KEEP_MS - 1);
    for (let k = 0; k < KEEP_MAX + 20; k++) m = markSaid(m, `k${k}`, "v", T + k);
    const p = prune(m, T + KEEP_MAX + 20);
    expect(Object.keys(p.said)).toHaveLength(KEEP_MAX);
    expect(p.said.old).toBeUndefined();
    expect(p.said[`k${KEEP_MAX + 19}`]).toBeDefined();
    expect(p.said.k0).toBeUndefined();
  });
});
