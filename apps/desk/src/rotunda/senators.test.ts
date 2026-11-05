import { describe, expect, it } from "vitest";
import { FACES } from "../hologram/persona.ts";
import { POSES } from "../hologram/rig.ts";
import { SUBMIND_TITLE } from "./rite.ts";
import { gestureAt, reactionTo, senatePoses, senatorOf, SENATORS } from "./senators.ts";

const IDS = Object.keys(SUBMIND_TITLE);

describe("every Skippy in the Senate is its own self (#775)", () => {
  it("the Chair and every submind has a row, with faces and poses the rig knows", () => {
    expect(IDS.length).toBe(13);
    for (const id of IDS) {
      const s = SENATORS[id];
      expect(s, id).toBeTruthy();
      expect(s!.id).toBe(id);
      expect(FACES).toContain(s!.face.rest);
      expect(FACES).toContain(s!.face.speak);
      for (const r of [s!.react.usual, ...Object.values(s!.react.to ?? {})]) expect(FACES).toContain(r!.face);
    }
    for (const p of senatePoses()) expect(POSES[p], p).toBeTruthy();
  });

  it("no two move alike: idle loops, gesture sets, faces and habits all differ", () => {
    const sig = (id: string) => {
      const s = senatorOf(id);
      return JSON.stringify([s.idle, s.speak, s.face.rest]);
    };
    expect(new Set(IDS.map(sig)).size).toBe(IDS.length);
    expect(new Set(IDS.map((id) => senatorOf(id).idle.fidget)).size).toBe(IDS.length);
    expect(new Set(IDS.map((id) => senatorOf(id).face.rest)).size).toBe(IDS.length);
    // More than one gesture each.
    for (const id of IDS) expect(new Set(senatorOf(id).speak.poses).size).toBeGreaterThan(1);
  });

  it("the Pessimist slumps and sighs slowly; the Party bounces; the Executive is still; the Historian takes its time", () => {
    const boiler = senatorOf("boiler");
    expect(boiler.idle.fidget).toBe("sigh");
    expect(boiler.idle.tempo).toBeLessThan(0.6);
    expect(boiler.idle.slump).toBeGreaterThan(0);
    const party = senatorOf("breakroom");
    expect(party.idle.hop).toBeGreaterThan(0);
    expect(party.idle.tempo).toBeGreaterThan(1.5);
    const exec = senatorOf("spire");
    expect(exec.idle.sway).toBe(0);
    expect(exec.idle.bob).toBeLessThan(0.01);
    const hist = senatorOf("archive");
    expect(hist.speak.snap).toBeLessThan(senatorOf("annex").speak.snap);
    expect(hist.face.blink).toBeGreaterThan(senatorOf("exchange").face.blink);
    expect(senatorOf("studio").idle.pose).toBe("frame");
    expect(senatorOf("foundry").idle.fidget).toBe("tinker");
  });

  it("they react to each other: the Pessimist groans at the Party, which winks back", () => {
    expect(reactionTo("boiler", "breakroom")).toEqual({ face: "annoyed", move: "groan" });
    expect(reactionTo("breakroom", "boiler")?.face).toBe("wink");
    expect(reactionTo("boiler", "boiler")).toBeNull();
    expect(reactionTo("boiler", null)).toBeNull();
    // Anyone it has no opinion of gets its usual.
    expect(reactionTo("haven", "relay")).toEqual(senatorOf("haven").react.usual);
  });

  it("a speaker works through its gestures in turn", () => {
    const s = senatorOf("green");
    const seen = new Set([0, 1, 2, 3, 4].map((k) => gestureAt(s, k * s.speak.every + 0.01)));
    expect(seen.size).toBeGreaterThan(1);
    expect(gestureAt(s, -1)).toBe(s.speak.poses[0]);
    expect(senatorOf("nobody").id).toBe("kernel");
  });
});
