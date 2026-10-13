import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS } from "./agents.ts";
import { SHIPPED_REMARKS } from "./quips.ts";
import { renderWorldCast, worldCast } from "./worldCast.ts";

describe("the cast as the hourly world step sees it", () => {
  it("api/_world/cast.ts is up to date with the cast (run `npm run world:cast` after changing it)", () => {
    const file = readFileSync(new URL("../../../api/_world/cast.ts", import.meta.url), "utf8");
    expect(file).toBe(renderWorldCast());
  });

  it("has every agent, in their home room, with a voice", () => {
    const cast = worldCast();
    expect(cast.members.map((m) => m.id)).toEqual(SAMPLE_AGENTS.map((a) => a.id));
    for (const m of cast.members) {
      expect(m.bio.length, m.id).toBeGreaterThan(20);
      expect(m.catchphrase.length, m.id).toBeGreaterThan(0);
    }
    expect(cast.members.filter((m) => m.lead)).toHaveLength(9);
  });

  it("every builder has a stock line for when a job of theirs ships", () => {
    for (const id of ["tessellate", "caret", "semicolon", "ember"]) {
      expect(SHIPPED_REMARKS[id]?.length, id).toBeGreaterThan(0);
      for (const line of SHIPPED_REMARKS[id]!) expect(line).toContain("{title}");
    }
  });
});
