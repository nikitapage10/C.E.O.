import { describe, expect, it } from "vitest";
import { areaLine, areaOf, cardHtml, checksVerdict, groupAreas, parseChecks, parseNumstat, scrub, summaryLines, totals } from "./change-card-lib.mjs";

describe("change card helpers (#158)", () => {
  it("files each path under the area Nikita would name", () => {
    expect(areaOf("apps/world/src/desk/Desk.tsx")).toBe("Desk");
    expect(areaOf("apps/world/src/rooms/primitives.tsx")).toBe("Lattice");
    expect(areaOf("api/foundry.ts")).toBe("API");
    expect(areaOf("api/_security/rules.ts")).toBe("Security");
    expect(areaOf("docs/FOUNDRY.md")).toBe("Docs");
    expect(areaOf("CLAUDE.md")).toBe("Docs");
    expect(areaOf(".github/workflows/checks.yml")).toBe("CI");
    expect(areaOf("packages/simulator/src/cast.ts")).toBe("Simulator");
    expect(areaOf("scripts/change-card.mjs")).toBe("Scripts");
    expect(areaOf("package.json")).toBe("Config");
    expect(areaOf("vitest.config.ts")).toBe("Config");
    expect(areaOf("somewhere/else.bin")).toBe("Other");
  });

  it("reads numstat, binaries included, and groups biggest first", () => {
    const files = parseNumstat("10\t2\tapps/world/src/desk/Desk.tsx\n3\t0\tapi/foundry.ts\n40\t5\tdocs/FOUNDRY.md\n-\t-\tapps/world/public/desk/a.webp\n1\t1\tdocs/DELIVERY.md\n\njunk line");
    expect(files).toHaveLength(5);
    expect(files[3]).toEqual({ path: "apps/world/public/desk/a.webp", added: 0, removed: 0 });
    const groups = groupAreas(files);
    expect(areaLine(groups)).toBe("Docs · Desk · API · Assets");
    expect(groups[0]).toEqual({ area: "Docs", files: 2, added: 41, removed: 6 });
    expect(totals(groups)).toEqual({ files: 5, added: 54, removed: 8 });
  });

  it("reads checks from flags or an object, and never shows an unknown state as green", () => {
    expect(parseChecks("typecheck=pass, lint:green,test=FAIL,build=maybe")).toEqual([
      { name: "typecheck", state: "pass" },
      { name: "lint", state: "pass" },
      { name: "test", state: "fail" },
      { name: "build", state: "skip" },
    ]);
    expect(parseChecks({ build: "passed" })).toEqual([{ name: "build", state: "pass" }]);
    expect(checksVerdict(parseChecks("a=pass,b=pass"))).toBe("green");
    expect(checksVerdict(parseChecks("a=pass,b=skip"))).toBe("partial");
    expect(checksVerdict(parseChecks("a=pass,b=fail"))).toBe("red");
    expect(checksVerdict([])).toBe("none");
  });

  it("keeps keys, emails and links off the card, but leaves branch names alone", () => {
    expect(scrub("mail someone@example.com about it")).toBe("mail [redacted] about it");
    expect(scrub("see https://x.test/?token=abc")).toBe("see [redacted]");
    expect(scrub("key sk-ant-abcdef1234567890 here")).toBe("key [redacted] here");
    expect(scrub("ghp_0123456789abcdefABCDEF")).toBe("[redacted]");
    expect(scrub("Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg==")).toBe("[redacted]");
    expect(scrub("foundry/build/158-change-pictures-for-every-issue")).toBe("foundry/build/158-change-pictures-for-every-issue");
    expect(scrub("a\nb\tc")).toBe("a b c");
    expect(scrub("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("keeps the summary to three lines", () => {
    expect(summaryLines("one\ntwo\n\nthree\nfour")).toEqual(["one", "two", "three"]);
    expect(summaryLines(["just one", ""])).toEqual(["just one"]);
  });

  it("escapes everything it writes into the card", () => {
    const html = cardHtml({ issue: 7, title: "<script>alert(1)</script>", summary: "a & b", groups: [], checks: [] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).toContain("#7");
  });
});
