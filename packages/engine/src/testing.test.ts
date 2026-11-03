import { describe, expect, it } from "vitest";
import { headingsOf } from "./testing.ts";

describe("headingsOf", () => {
  it("reads ATX headings at every level, trimmed, and skips everything else", () => {
    const md = "# One\ntext\n## Two  \n###Not a heading\n####### Seven hashes\n#\n   \n### Three\t\n";
    expect(headingsOf(md)).toEqual(["One", "Two", "Three"]);
  });

  it("stays fast on a long run of spaces (no backtracking)", () => {
    const start = performance.now();
    expect(headingsOf("# " + " ".repeat(200_000) + "x" + " ".repeat(200_000))).toEqual(["x"]);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
