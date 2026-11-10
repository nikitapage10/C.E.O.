import { describe, expect, it } from "vitest";
import { ALWAYS_KEPT, KEEP, keptAfter, onSenateBuilt, senateBuilt, settleShown, waitsOnSenate } from "./keptRooms.ts";

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

  it("holds the Haven and Relay until the Senate's chamber is built (#973)", () => {
    expect(waitsOnSenate("today")).toBe(false);
    expect(waitsOnSenate("haven")).toBe(true);
    expect(waitsOnSenate("relay")).toBe(true);
    expect(waitsOnSenate(undefined)).toBe(false);
    const heard: string[] = [];
    const off = onSenateBuilt(() => heard.push("a"));
    onSenateBuilt(() => heard.push("b"));
    off();
    expect(heard).toEqual([]);
    senateBuilt();
    senateBuilt();
    expect(heard).toEqual(["b"]);
    // Asked after it is built: at once.
    onSenateBuilt(() => heard.push("c"));
    expect(heard).toEqual(["b", "c"]);
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

describe("a kept room shown again (#958)", () => {
  const anim = (name: string | null, iterations: number) => {
    const a = { finished: false, effect: { getComputedTiming: () => ({ iterations }) }, finish: () => void (a.finished = true) };
    return name === null ? a : Object.assign(a, { animationName: name });
  };
  const page = (list: ReturnType<typeof anim>[]) => ({ dataset: {} as DOMStringMap, getAnimations: () => list as unknown as Animation[] });

  it("plays its entrances the first time, and marks it seen", () => {
    const rise = anim("wv-page-in", 1);
    const el = page([rise]);
    expect(settleShown(el)).toBe(0);
    expect(rise.finished).toBe(false);
    expect(el.dataset.seen).toBe("");
  });

  it("finishes its one-shot CSS animations each time after, leaving loops and script animations alone", () => {
    const rise = anim("wv-page-in", 1), rule = anim("fl-draw", 1), sheet = anim("hv-in", 1), breathe = anim("hv-breathe", Infinity), swarm = anim(null, 1);
    const el = page([rise, rule, sheet, breathe, swarm]);
    settleShown(el);
    expect(settleShown(el)).toBe(3);
    expect([rise, rule, sheet].every((a) => a.finished)).toBe(true);
    expect(breathe.finished).toBe(false);
    expect(swarm.finished).toBe(false);
  });
});
