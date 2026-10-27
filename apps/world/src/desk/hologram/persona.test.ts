import { describe, expect, it } from "vitest";
import { SUBMINDS } from "../../../../../packages/simulator/src/subminds.ts";
import { FACES, PERSONAS, personaOf } from "./persona.ts";
import { EXPRESSIONS } from "./signal.ts";

describe("each voice on a call has its own persona (#490)", () => {
  it("Skippy stays smug, and a submind not on air yet wears his", () => {
    expect(personaOf(null).manner).toBe("smug");
    expect(personaOf(null).faces.smug).toBe("smug");
    expect(personaOf("spire").key).toBe("skippy");
  });

  it("every active submind has its own face, pose and motion", () => {
    for (const m of SUBMINDS.filter((s) => s.active)) {
      const p = personaOf(m.room);
      expect(p.key).toBe(m.room);
      for (const e of EXPRESSIONS) {
        expect(FACES).toContain(p.faces[e]);
        expect(p.poses[e]).toBeTruthy();
      }
      expect(p.motion).not.toEqual(personaOf(null).motion);
    }
  });

  it("the Pessimist is unimpressed, slow and sighing; the Commentator grins and bounces; the Bookie glances; the Builder's hands work", () => {
    const soot = PERSONAS.boiler!;
    expect(EXPRESSIONS.filter((e) => e !== "annoyed").every((e) => soot.faces[e] === "unimpressed")).toBe(true);
    expect(soot.motion.tempo).toBeLessThan(1);
    expect(soot.motion.sighEvery).toBeGreaterThan(0);
    const turf = PERSONAS.green!;
    expect(turf.faces.listening).toBe("grin");
    expect(turf.faces.smug).toBe("grin");
    expect(turf.motion.tempo).toBeGreaterThan(1);
    expect(turf.motion.bounce).toBeGreaterThan(0);
    expect(PERSONAS.exchange!.faces.smug).toBe("sly");
    expect(PERSONAS.exchange!.motion.glance).toBeGreaterThan(0);
    expect(PERSONAS.relay!.faces.listening).toBe("attentive");
    expect(PERSONAS.foundry!.faces.smug).toBe("focused");
    expect(PERSONAS.foundry!.motion.busy).toBeGreaterThan(0);
  });
});
