import { describe, expect, it } from "vitest";
import { classify } from "./classify.ts";

describe("a question about a list is never put on it (#1131)", () => {
  it("sends list questions to Skippy and still takes adds", () => {
    for (const t of ["what's on my shopping list", "What's on my shopping list?", "whats on the list", "is milk on the list", "how many things are on my list", "do we have eggs on the list", "tell me what's on my Amazon list"]) expect(classify(t)).toEqual({ kind: "skippy", text: expect.any(String) });
    expect(classify("can you add milk to the list")).toEqual({ kind: "shopping", items: ["milk"] });
    expect(classify("add garlic and lemons")).toMatchObject({ kind: "shopping" });
  });
});
