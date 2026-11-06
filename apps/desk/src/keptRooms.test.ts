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
    k = keptAfter(k, "haven", true, 0);
    expect(k).toEqual(["haven"]);
    k = keptAfter(k, "spire", true, 0);
    expect(k).toEqual(["spire", "haven"]);
    k = keptAfter(k, "relay", true, 0);
    expect(k).toEqual(["relay", "haven"]);
  });

  it("mounts the three one at a time as the Desk's idle time comes", () => {
    expect(keptAfter(["green"], "green", true, 1)).toEqual(["green", "today"]);
    expect(keptAfter(["green", "today"], "green", true, 2)).toEqual(["green", "today", "haven"]);
    expect(keptAfter(["green", "today", "haven"], "green", true, 3)).toEqual(["green", "today", "haven", "relay"]);
    expect(keptAfter(["relay"], "today", true, 1)).toEqual(["today", "relay"]);
  });

  it("never keeps any other room once it is left", () => {
    expect(keptAfter(["green", "today", "haven", "relay"], "spire")).toEqual(["spire", "today", "haven", "relay"]);
    expect(keptAfter(["foundry"], "boiler", true, 0)).toEqual(["boiler"]);
  });

  it("caps how many stay mounted", () => {
    expect(keptAfter(["haven", "today", "relay"], "archive").length).toBeLessThanOrEqual(KEEP);
    expect(KEEP).toBe(4);
  });

  it("keeps nothing on a machine short of memory", () => {
    expect(keptAfter(["today", "haven", "relay"], "green", false)).toEqual(["green"]);
    expect(keptAfter(["today", "haven"], "relay", false, 3)).toEqual(["relay"]);
  });
});
