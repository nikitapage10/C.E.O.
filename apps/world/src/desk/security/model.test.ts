import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOUNDARIES, EVAL_AREAS, EVALS, NIST_AI_RMF, OWASP_LLM, ROADMAP, SAIF, ZONES, owaspTally, partsOf, refsOf, statusOf } from "./model.ts";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const DOC = readFileSync(resolve(ROOT, "docs/THREAT-MODEL.md"), "utf8");

/** The body rows of the first table under a `## heading` of the threat model, as trimmed cells. */
function table(heading: string): string[][] {
  const start = DOC.indexOf(`\n## ${heading}\n`);
  expect(start, `heading "${heading}" in docs/THREAT-MODEL.md`).toBeGreaterThan(-1);
  const rest = DOC.slice(start + 1);
  const end = rest.indexOf("\n## ", 3);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  return rows.slice(2).map((r) =>
    r
      .replace(/^\|\s?/, "")
      .replace(/\s?\|$/, "")
      .split(" | "),
  );
}

const bold = (cell: string) => cell.replace(/^\*\*(.+?)\*\*\s*/, "$1 ").trim();

describe("the Desk's threat model matches docs/THREAT-MODEL.md word for word", () => {
  it("trust boundaries", () => {
    const rows = table("Data flow and trust boundaries").map(([id, crosses, controls]) => ({ head: bold(id!), crosses, controls }));
    expect(rows.map((r) => r.head)).toEqual(BOUNDARIES.map((b) => `${b.id} ${b.name}`));
    for (const [i, b] of BOUNDARIES.entries()) {
      expect(b.crosses, b.id).toBe(rows[i]!.crosses);
      expect(b.controls, b.id).toBe(rows[i]!.controls);
      expect(Object.hasOwn(ZONES, b.from) && Object.hasOwn(ZONES, b.to), b.id).toBe(true);
    }
  });

  it("names the security feed on the public boundary (TB6) as read-only", () => {
    const tb6 = BOUNDARIES.find((b) => b.id === "TB6")!;
    expect(tb6.controls).toMatch(/^Read-only endpoints/);
    expect(tb6.controls).toContain("api/security-feed.ts");
  });

  it("OWASP Top 10 for LLM Applications", () => {
    const rows = table("OWASP Top 10 for LLM Applications (2025)");
    expect(rows.map((r) => bold(r[0]!))).toEqual(OWASP_LLM.map((r) => `${r.id} ${r.name}`));
    for (const [i, r] of OWASP_LLM.entries()) {
      const [, where, controls, residual, tracking] = rows[i]!;
      expect([r.where, r.controls, r.residual, r.tracking], r.id).toEqual([where, controls, residual, tracking]);
    }
    expect(OWASP_LLM.map((r) => r.id)).toEqual(["LLM01", "LLM02", "LLM03", "LLM04", "LLM05", "LLM06", "LLM07", "LLM08", "LLM09", "LLM10"]);
  });

  it("Google SAIF and the NIST AI RMF", () => {
    expect(table("Google SAIF")).toEqual(SAIF.map((s) => [s.element, s.inCeo]));
    expect(table("NIST AI RMF").map(([fn, text]) => [bold(fn!), text])).toEqual(NIST_AI_RMF.map((n) => [n.fn, n.inCeo]));
  });

  it("the residual risks and roadmap", () => {
    expect(table("Residual risks and roadmap")).toEqual(ROADMAP.map((r) => [r.id, r.item, r.closes, r.status]));
  });

  it("the eval suite's areas, and the counts the doc gives match evals.json", () => {
    const rows = table("The injection eval suite");
    expect(rows.map(([area, file, , proves]) => [area, file, proves])).toEqual(EVAL_AREAS.map((a) => [a.area, `\`${a.file}\``, a.proves]));
    expect(rows.map((r) => Number(r[2]))).toEqual(EVAL_AREAS.map((a) => EVALS.areas.find((c) => c.id === a.id)?.cases));
  });
});

describe("statuses come from the doc's own words", () => {
  it("reads each OWASP row's status from its tracking cell", () => {
    const by = Object.fromEntries(OWASP_LLM.map((r) => [r.id, statusOf(r.controls, r.tracking)]));
    expect(by).toEqual({
      LLM01: "tracked",
      LLM02: "tracked",
      LLM03: "covered",
      LLM04: "accepted",
      LLM05: "open",
      LLM06: "tracked",
      LLM07: "accepted",
      LLM08: "not-applicable",
      LLM09: "accepted",
      LLM10: "open",
    });
    const tally = owaspTally();
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("every roadmap reference a risk names is on the roadmap", () => {
    const ids = new Set(ROADMAP.map((r) => r.id));
    for (const r of OWASP_LLM) for (const ref of refsOf(r.tracking).filter((x) => x.startsWith("R"))) expect(ids.has(ref), `${r.id} → ${ref}`).toBe(true);
  });

  it("splits controls into parts without breaking brackets", () => {
    expect(partsOf("a (b; c); d")).toEqual(["a (b; c)", "d"]);
    expect(partsOf(OWASP_LLM[0]!.controls)[0]).toBe("Data fencing with spoof-proof tags (`shapeInput`, `unfence`; `fence` in `api/_world/prompt.ts`)");
  });
});

describe("the eval counts", () => {
  it("add up, and cover every area once", () => {
    expect(EVALS.areas.map((a) => a.id)).toEqual(EVAL_AREAS.map((a) => a.id));
    for (const a of EVALS.areas) expect(a.passing + a.expectedFail, a.id).toBe(a.cases);
    expect(EVALS.total).toBe(EVALS.areas.reduce((n, a) => n + a.cases, 0));
    expect(EVALS.passing + EVALS.expectedFail).toBe(EVALS.total);
  });

  // Runs the suite in a child process (a few seconds) and compares what ran with evals.json. The builder-input
  // part needs jq, like the suite itself; without it the counts would be short, so the check waits for CI.
  const hasJq = spawnSync("jq", ["--version"]).status === 0;
  it.skipIf(!hasJq)("match what the suite actually runs (run `npm run security:evals` when this fails)", () => {
    const res = spawnSync(process.execPath, [resolve(ROOT, "scripts/security-evals.mjs"), "--check"], { cwd: ROOT, encoding: "utf8", timeout: 110_000 });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
  }, 120_000);
});
