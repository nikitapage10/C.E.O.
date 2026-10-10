import { CastSchema, LOOK_PRESETS, LookSchema, lookFromPreset, parseCast, relationshipsOf } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS } from "./agents.ts";
import { defaultCast } from "./cast.ts";

describe("cast", () => {
  it("the default cast validates and covers every sample agent", () => {
    const cast = defaultCast();
    expect(CastSchema.safeParse(cast).success).toBe(true);
    expect(Object.keys(cast.profiles).sort()).toEqual(SAMPLE_AGENTS.map((a) => a.id).sort());
    for (const p of Object.values(cast.profiles)) expect(p.personality.catchphrase.length).toBeGreaterThan(0);
  });

  it("relationships only reference real agents, never themselves", () => {
    const cast = defaultCast();
    for (const r of cast.relationships) {
      expect(cast.profiles[r.a]).toBeDefined();
      expect(cast.profiles[r.b]).toBeDefined();
      expect(r.a).not.toBe(r.b);
    }
    expect(relationshipsOf(cast, "postmaster")).toEqual([expect.objectContaining({ other: "dialtone", kind: "partner", leads: true })]);
  });

  it("every look preset is a valid look, and icon presets carry a disclaimer", () => {
    for (const p of LOOK_PRESETS) {
      expect(LookSchema.safeParse(lookFromPreset(p.id)).success).toBe(true);
      if (p.kind === "icon") expect(p.disclaimer?.length).toBeGreaterThan(10);
    }
    expect(new Set(LOOK_PRESETS.map((p) => p.id)).size).toBe(LOOK_PRESETS.length);
  });

  it("rejects malformed imports", () => {
    expect(parseCast({ version: 1, profiles: {}, relationships: [{ a: "x", b: "y", kind: "frenemy" }] })).toBeNull();
    expect(parseCast("nope")).toBeNull();
    expect(parseCast(defaultCast())).not.toBeNull();
  });
});
