import { describe, expect, it } from "vitest";
import { MOOD, MURMURS, MURMUR_MAX, murmurFor, PESSIMIST, rite, rites, roman, type RiteInput } from "./rite.ts";

const BENCH = ["foundry", "relay", "exchange", "boiler", "workshop", "studio", "haven"];

describe("the Rotunda's order of business (#740)", () => {
  it("numbers the docket in roman numerals", () => {
    expect([1, 2, 3, 4, 9, 12].map(roman)).toEqual(["I", "II", "III", "IV", "IX", "XII"]);
  });

  it("moves and seconds a duty, with no debate", () => {
    const d = rite({ key: "setup", kind: "duty", by: "boiler", room: "Boiler Room", what: "2 setup steps only you can do", say: "3 of 5 done." }, 1, BENCH);
    expect(d.n).toBe("I");
    expect(d.clerk).toBe("The clerk reads item i, a duty: 2 setup steps only you can do.");
    expect(d.say?.text).toBe("3 of 5 done.");
    expect(d.done).toBe("Moved and seconded. It goes to your docket.");
    expect(d.meta).toBe("Moved by the Pessimist · no debate");
    expect(d.options).toBeUndefined();
    expect(d.stamp).toBe("Seconded");
  });

  it("gives a decision one advocate per option and the Pessimist's counterpoint, then puts it to Nikita", () => {
    const d = rite({ key: "ideas", kind: "decision", by: "foundry", room: "Foundry", what: "which idea the Foundry builds next", options: [{ label: "Shadows" }, { label: "Tidy branches" }, { label: "Weather" }, { label: "A fourth" }] }, 2, BENCH);
    expect(d.options?.map((o) => o.label)).toEqual(["Shadows", "Tidy branches", "Weather"]);
    const by = d.options!.map((o) => o.by);
    expect(by[0]).toBe("foundry");
    expect(new Set(by).size).toBe(3);
    expect(by).not.toContain(PESSIMIST);
    expect(d.counter).toMatchObject({ on: 0, by: PESSIMIST });
    expect(d.counter!.say.text).toMatch(/^Counterpoint: /);
    expect(d.done).toBe("The question is put to you.");
    expect(d.meta).toBe("3 advocates · counterpoint: the Pessimist");
  });

  it("reports a repair, cause then fix, with one risk note and one fix", () => {
    const d = rite({ key: "down-relay", kind: "repair", by: "relay", room: "Relay", what: "Relay needs a look", cause: "the hub isn't answering", fix: "open Relay and see what it says" }, 3, BENCH);
    expect(d.clerk).toBe("Item iii, a repair: Relay needs a look.");
    expect(d.report).toEqual({ lead: "Fix: open Relay and see what it says.", text: "Cause: the hub isn't answering." });
    expect(d.risk?.by).toBe(PESSIMIST);
    expect(d.risk?.say.text).toMatch(/^Risk: /);
    expect(d.done).toBe("One fix stands before you.");
    expect(d.stamp).toBe("Fix ready");
  });

  it("keeps the docket's order and keys", () => {
    const inputs: RiteInput[] = [
      { key: "a", kind: "repair", by: "boiler", room: "Boiler Room", what: "x" },
      { key: "b", kind: "duty", by: "relay", room: "Relay", what: "y" },
    ];
    expect(rites(inputs, BENCH).map((r) => [r.key, r.n])).toEqual([
      ["a", "I"],
      ["b", "II"],
    ]);
  });

  it("murmurs only canned lines, by the kind of business, never with numbers or addresses", () => {
    const all = Object.values(MURMURS).flat();
    for (const line of all) expect(line).not.toMatch(/[\d@$£€]/);
    for (const kind of ["duty", "decision", "repair", "idle"] as const) {
      for (let a = 0; a < 1; a += 0.13) for (let b = 0; b < 1; b += 0.17) expect(MOOD[kind].some((m) => (MURMURS[m] as readonly string[]).includes(murmurFor(kind, a, b)))).toBe(true);
    }
    expect(MURMUR_MAX.wide).toBe(3);
    expect(MURMUR_MAX.phone).toBeLessThan(MURMUR_MAX.wide);
  });
});
