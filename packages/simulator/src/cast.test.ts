import { CastSchema, HOUSES, LoreSchema, LINEAGE_IDS, ProfileSchema, LOOK_PRESETS, LookSchema, lookFromPreset, parseCast, relationshipsOf } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS, SUBMINDS } from "./agents.ts";
import { defaultCast } from "./cast.ts";
import { SKIPPY_LORE } from "./lore.ts";
import { AGENT_QUIPS, SUBMIND_CONDUCT } from "./quips.ts";

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
    expect(SAMPLE_AGENTS.some((a) => a.name.startsWith("Skippy"))).toBe(false);
  });

  it("Rivet is back on the Foundry bench as first responder, in her hard hat", () => {
    const rivet = SAMPLE_AGENTS.find((a) => a.id === "semicolon")!;
    expect(rivet).toMatchObject({ name: "Rivet", role: "First responder", home: { room: "foundry", station: "bench-b" } });
    const p = defaultCast().profiles.semicolon!;
    expect(p.name).toBe("Rivet");
    expect(p.look).toMatchObject({ body: "hardhat", shell: "#b9642a", accent: "#ffb36b", trim: "#b49413" });
    expect(p.personality.traits).toEqual(["deadpan", "grumpy", "loyal", "sarcastic"]);
  });

  it("each submind is its own character: own colour on the admiral can, traits, catchphrase, lines and friends", () => {
    const cast = defaultCast();
    const traitSets = new Set<string>();
    const catchphrases = new Set<string>();
    for (const m of SUBMINDS) {
      const p = cast.profiles[m.id]!;
      expect(p.role, m.id).toBe("Room lead");
      expect(p.name, m.id).toBe(`The ${m.job}`);
      expect(p.personality.bio, m.id).toContain("Skippy's submind");
      expect(p.look, m.id).toMatchObject({ body: "skippy", shell: m.colour, accent: m.colour });
      traitSets.add([...p.personality.traits].sort().join(","));
      catchphrases.add(p.personality.catchphrase);
      expect(p.lore.title, m.id).toContain(`The ${m.job}`);
      expect(AGENT_QUIPS[m.id]?.length ?? 0, m.id).toBeGreaterThanOrEqual(5);
      expect(SUBMIND_CONDUCT[m.id]?.length ?? 0, m.id).toBeGreaterThanOrEqual(3);
      expect(relationshipsOf(cast, m.id).length, m.id).toBeGreaterThanOrEqual(1);
    }
    expect(traitSets.size).toBe(SUBMINDS.length);
    expect(catchphrases.size).toBe(SUBMINDS.length);
    // the Builder leads the Foundry; it never takes Rivet's place on the bench.
    expect(SUBMINDS.find((m) => m.room === "foundry")?.id).toBe("ember");
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
