import { describe, expect, it } from "vitest";
import { ALWAYS_KEPT, KEEP, keptAfter } from "./keptRooms.ts";

describe("kept rooms (#759, #934)", () => {
  it("always keeps the Senate, the Haven and Relay beside the room on screen", () => {
    expect(ALWAYS_KEPT).toEqual(["today", "haven", "relay"]);
    expect(keptAfter(["today"], "green")).toEqual(["green", "today", "haven", "relay"]);
    expect(keptAfter(["green", "today", "haven", "relay"], "relay")).toEqual(["relay", "today", "haven"]);
    expect(keptAfter(["relay", "today", "haven"], "today")).toEqual(["today", "haven", "relay"]);
  });

  it("before the Desk is idle after first paint, keeps only the three already visited", () => {
    let k: string[] = ["green"];
    k = keptAfter(k, "haven", true, false);
    expect(k).toEqual(["haven"]);
    k = keptAfter(k, "spire", true, false);
    expect(k).toEqual(["spire", "haven"]);
    k = keptAfter(k, "relay", true, false);
    expect(k).toEqual(["relay", "haven"]);
  });

  it("never keeps any other room once it is left", () => {
    expect(keptAfter(["green", "today", "haven", "relay"], "spire")).toEqual(["spire", "today", "haven", "relay"]);
    expect(keptAfter(["foundry"], "boiler", true, false)).toEqual(["boiler"]);
  });

  it("caps how many stay mounted", () => {
    expect(keptAfter(["haven", "today", "relay"], "archive").length).toBeLessThanOrEqual(KEEP);
    expect(KEEP).toBe(4);
  });

  it("keeps nothing on a machine short of memory", () => {
    expect(keptAfter(["today", "haven", "relay"], "green", false)).toEqual(["green"]);
    expect(keptAfter(["today", "haven"], "relay", false, true)).toEqual(["relay"]);
  });
});
