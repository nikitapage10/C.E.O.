import { describe, expect, it } from "vitest";
import type { Crate } from "../foundry.ts";
import { routineFor } from "./FoundryDirector.tsx";

const crate = (kind: Crate["kind"], state: Crate["state"]): Crate => ({ number: 1, title: "#1", kind, state, rung: null, url: "", updatedAt: 0, pitch: "", size: null, revising: false });

describe("routineFor", () => {
  it("keeps Rivet at her alarm post when she's free, leaning in while the checks run", () => {
    expect(routineFor("semicolon", null, 0)).toBe("foundryWatch");
    expect(routineFor("semicolon", null, 0, false, { checksRunning: true })).toBe("foundryWatchClose");
    expect(routineFor("semicolon", null, 0, false, { handingUp: true, checksRunning: true })).toBe("foundryHandUp");
  });

  it("keeps Rocky at his drafting table between jobs, and there until a new one is handed up", () => {
    expect(routineFor("caret", null, 3)).toBe("foundryDrafting");
    expect(routineFor("caret", crate("build", "working"), 0, false, { handingUp: true })).toBe("foundryDrafting");
    expect(routineFor("caret", crate("build", "working"), 0)).toBe("foundryBuilding");
    expect(routineFor("semicolon", crate("fix", "working"), 0)).toBe("foundryFixing");
  });

  it("leaves Rusty on his ideas, upkeep or rounds", () => {
    expect(routineFor("tessellate", null, 2)).toBe("foundryIdeas");
    expect(routineFor("tessellate", null, 0, true)).toBe("foundryUpkeep");
    expect(routineFor("tessellate", null, 0)).toBe("foundryIdle");
  });
});
