import { CastSchema, HOUSES, LoreSchema, LINEAGE_IDS, ProfileSchema, LOOK_PRESETS, LookSchema, lookFromPreset, parseCast, relationshipsOf } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS } from "./agents.ts";
import { defaultCast } from "./cast.ts";
import { SKIPPY_LORE } from "./lore.ts";

describe("cast", () => {
  it("the default cast validates and covers every sample agent", () => {
    const cast = defaultCast();
    expect(CastSchema.safeParse(cast).success).toBe(true);
    expect(Object.keys(cast.profiles).sort()).toEqual(SAMPLE_AGENTS.map((a) => a.id).sort());
    for (const p of Object.values(cast.profiles)) expect(p.personality.catchphrase.length).toBeGreaterThan(0);
  });

  it("every sample agent has a dossier, every lineage a House, and old casts still parse", () => {
    const cast = defaultCast();
    for (const p of Object.values(cast.profiles)) {
      expect(p.lore.title.length).toBeGreaterThan(0);
      expect(p.lore.origin.length).toBeGreaterThan(0);
      expect(p.lore.chronicle.length).toBeGreaterThan(0);
    }
    for (const l of LINEAGE_IDS) expect(HOUSES[l].lineage).toBe(l);
    const { lore: _lore, ...old } = cast.profiles.kevin!;
    expect(ProfileSchema.parse(old).lore).toMatchObject({ title: "", quirks: [] });
  });

  it("Skippy, who sits in the Kernel now, has a dossier that would pass as anyone's", () => {
    expect(LoreSchema.safeParse(SKIPPY_LORE).success).toBe(true);
    expect(defaultCast().profiles.semicolon?.name).toBe("Rivet");
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
