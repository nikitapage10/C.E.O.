import { existsSync, statSync } from "node:fs";
import { SAMPLE_AGENTS, SUBMINDS } from "@ceo/simulator";
import { describe, expect, it } from "vitest";
import { AGENTS, portrait } from "./deskData.ts";
import { PORTRAITS } from "./portraits.ts";

const file = (src: string) => new URL(`../../public${src}`, import.meta.url);

describe("agent portraits", () => {
  it("has a portrait for everyone in the cast (run scripts/portraits.mjs when someone joins)", () => {
    for (const a of SAMPLE_AGENTS) {
      expect(PORTRAITS[a.id], a.id).toEqual({ name: a.name, room: a.home.room });
      const src = portrait(a.id)!;
      expect(src).toBe(`/desk/agent-${a.id}.webp`);
      expect(existsSync(file(src)), src).toBe(true);
      // Sized for the Desk's circles: small files.
      expect(statSync(file(src)).size).toBeLessThan(24 * 1024);
    }
  });

  it("finds subminds and the cast by their names as well as their ids", () => {
    for (const m of SUBMINDS) expect(portrait(m.name)).toBe(`/desk/agent-${m.id}.webp`);
    expect(portrait("Kevin")).toBe("/desk/agent-kevin.webp");
    expect(portrait("D20")).toBe("/desk/agent-d20.webp");
  });

  it("keeps the Desk's own names, and knows no one it shouldn't", () => {
    for (const [name, a] of Object.entries(AGENTS)) expect(portrait(name)).toBe(`/desk/agent-${a.id}.webp`);
    expect(portrait("Mom")).toBeNull();
    expect(portrait("constructor")).toBeNull();
  });
});
