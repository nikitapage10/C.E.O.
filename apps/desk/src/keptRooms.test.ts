import { describe, expect, it } from "vitest";
import { KEEP, keptAfter } from "./keptRooms.ts";

describe("kept rooms (#759)", () => {
  it("keeps the scene rooms visited, the newest first", () => {
    let k: string[] = ["today"];
    k = keptAfter(k, "haven");
    expect(k).toEqual(["haven", "today"]);
    k = keptAfter(k, "relay");
    expect(k).toEqual(["relay", "haven", "today"]);
    k = keptAfter(k, "today");
    expect(k).toEqual(["today", "haven"]);
  });

  it("never keeps a page without a scene once it is left", () => {
    expect(keptAfter(["relay"], "green")).toEqual(["green"]);
    expect(keptAfter(["green", "today"], "spire")).toEqual(["spire", "today"]);
  });

  it("caps how many stay mounted", () => {
    expect(keptAfter(["haven", "today"], "relay").length).toBeLessThanOrEqual(KEEP);
  });

  it("keeps nothing on a machine short of memory", () => {
    expect(keptAfter(["today", "haven"], "relay", false)).toEqual(["relay"]);
  });
});
