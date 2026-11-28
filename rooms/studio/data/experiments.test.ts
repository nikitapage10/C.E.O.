import { describe, expect, it } from "vitest";
import { readEpisode } from "../../../api/_studio/desk.ts";
import { epLabel, experimentGroups, isEpisode, isExperiment, openOn, type Episode } from "./desk.ts";

const ep = (id: string, n: number, extra: Partial<Episode> = {}): Episode => ({ id, n, title: id, stages: { render: { status: "ready" } }, ...extra });

describe("experiments on the Studio desk (#1272)", () => {
  it("keeps x- cuts apart from the episodes, named by their set", () => {
    const x = ep("x-ep7-A1", 0, { group: "Ch 7 experiments" });
    expect(isExperiment(x)).toBe(true);
    expect(isEpisode(x)).toBe(false);
    expect(epLabel(x)).toBe("Ch 7 experiments");
    expect(epLabel(ep("ep7", 7))).toBe("Ep 7");
    expect(experimentGroups([x, ep("ep7", 7), ep("x-ep7-B1", 0, { group: "Ch 7 experiments" }), ep("x-1", 0)]).map((g) => [g.group, g.items.length])).toEqual([
      ["Ch 7 experiments", 2],
      ["Experiments", 1],
    ]);
  });

  it("opens on an episode, never an experiment", () => {
    expect(openOn([ep("ep6", 6), ep("x-ep7-A1", 0)])).toBe(0);
  });

  it("takes a set name from the Director's thread", () => {
    expect(readEpisode({ id: "x-ep7-a1", n: 0, title: "A1", group: "Ch 7 experiments", stages: {} })?.group).toBe("Ch 7 experiments");
    expect(readEpisode({ id: "x-ep7-a1", n: 0, title: "A1", group: "", stages: {} })).toBeNull();
  });
});
