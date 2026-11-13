import { describe, expect, it } from "vitest";
import type { WasteFlag } from "../../../api/_usage/aggregate.ts";
import { wasteName, worstWaste } from "./waste.ts";

const flag = (p: Partial<WasteFlag>): WasteFlag => ({ kind: "duplicate", tone: "warn", usd: 1, text: "t", ...p });

describe("worstWaste (#1152)", () => {
  it("takes the first warn flag, never an info one", () => {
    expect(worstWaste({ flags: [flag({ kind: "uncached", tone: "info" }), flag({ kind: "errors" }), flag({ kind: "cutoff" })] })?.kind).toBe("errors");
    expect(worstWaste({ flags: [flag({ tone: "info" })] })).toBeNull();
    expect(worstWaste({ flags: [] })).toBeNull();
    expect(worstWaste(null)).toBeNull();
  });
  it("names a flag in a few words", () => {
    expect(wasteName(flag({ kind: "cache", feature: "skippy" }))).toBe("cache missing in skippy");
    expect(wasteName(flag({ kind: "oversized" }))).toBe("oversized prompts");
  });
});
