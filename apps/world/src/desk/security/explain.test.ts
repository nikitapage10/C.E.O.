import { describe, expect, it } from "vitest";
import { featureStates } from "../../../../../api/security-feed.ts";
import {
  ALERT_EXPLAIN,
  EVAL_EXPLAIN,
  FEATURE_EXPLAIN,
  FRAME_EXPLAIN,
  NIST_EXPLAIN,
  OWASP_EXPLAIN,
  ROADMAP_EXPLAIN,
  SAIF_EXPLAIN,
  SCAN_EXPLAIN,
  SCORECARD_EXPLAIN,
  STAT_EXPLAIN,
  scorecardExplain,
  type Explain,
} from "./explain.ts";
import { EVAL_AREAS, NIST_AI_RMF, OWASP_LLM, ROADMAP, SAIF } from "./model.ts";

/** OpenSSF Scorecard's checks (github.com/ossf/scorecard, docs/checks.md). */
const SCORECARD_CHECKS = [
  "Binary-Artifacts",
  "Branch-Protection",
  "CI-Tests",
  "CII-Best-Practices",
  "Code-Review",
  "Contributors",
  "Dangerous-Workflow",
  "Dependency-Update-Tool",
  "Fuzzing",
  "License",
  "Maintained",
  "Packaging",
  "Pinned-Dependencies",
  "SAST",
  "SBOM",
  "Security-Policy",
  "Signed-Releases",
  "Token-Permissions",
  "Vulnerabilities",
  "Webhooks",
];

/** Plain words, a few short sentences, and nothing that belongs off a public page. */
function expectPlain(where: string, e: Explain | undefined) {
  expect(e, `${where} has an explanation`).toBeDefined();
  for (const key of ["what", "connects", "why"] as const) {
    const text = e![key];
    expect(text.trim().length, `${where}.${key} is written`).toBeGreaterThan(10);
    expect(text.length, `${where}.${key} stays short`).toBeLessThanOrEqual(240);
    expect(text.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, `${where}.${key} is 1 to 3 sentences`).toBeLessThanOrEqual(3);
    // No file paths, code or links: the Desk is public, and the pop-over is for a non-specialist.
    expect(text, `${where}.${key} has no code, paths or links`).not.toMatch(/`|https?:|\bapi\/|\bscripts\/|\.(ts|sh|yml)\b|<\/?[a-z]/);
  }
}

describe("every item on Security and Compliance explains itself (#90)", () => {
  it("the scans, the headline numbers and the alert counts", () => {
    for (const id of ["checks", "codeql", "scorecard", "dependency-review", "e2e"] as const) expectPlain(`scan ${id}`, SCAN_EXPLAIN[id]);
    for (const id of ["passing", "scorecard", "evals", "risks"] as const) expectPlain(`stat ${id}`, STAT_EXPLAIN[id]);
    for (const id of ["codeScanning", "dependabot"] as const) expectPlain(`alerts ${id}`, ALERT_EXPLAIN[id]);
  });

  it("every security switch the feed reports", () => {
    const shown = featureStates({}, {}, false).map((f) => f.id);
    expect(shown.length).toBeGreaterThan(0);
    for (const id of shown) expectPlain(`switch ${id}`, FEATURE_EXPLAIN[id]);
    expect(Object.keys(FEATURE_EXPLAIN).sort()).toEqual([...shown].sort());
  });

  it("every Scorecard check, and a fallback for one Scorecard adds later", () => {
    for (const name of SCORECARD_CHECKS) expectPlain(`Scorecard ${name}`, SCORECARD_EXPLAIN[name]);
    expect(Object.keys(SCORECARD_EXPLAIN).sort()).toEqual([...SCORECARD_CHECKS].sort());
    const later = scorecardExplain("Brand-New-Check", "Determines whether something new is done.");
    expect(later.what).toBe("Determines whether something new is done.");
    expectPlain("Scorecard fallback", scorecardExplain("Brand-New-Check", ""));
  });

  it("every OWASP risk, roadmap row and eval area the threat model lists", () => {
    for (const r of OWASP_LLM) expectPlain(r.id, OWASP_EXPLAIN[r.id]);
    expect(Object.keys(OWASP_EXPLAIN).sort()).toEqual(OWASP_LLM.map((r) => r.id).sort());
    for (const r of ROADMAP) expectPlain(`roadmap ${r.id}`, ROADMAP_EXPLAIN[r.id]);
    expect(Object.keys(ROADMAP_EXPLAIN).sort()).toEqual(ROADMAP.map((r) => r.id).sort());
    for (const a of EVAL_AREAS) expectPlain(`eval ${a.id}`, EVAL_EXPLAIN[a.id]);
  });

  it("every framework, NIST function and SAIF element", () => {
    for (const id of ["owasp", "nist", "saif", "regulation"] as const) expectPlain(`framework ${id}`, FRAME_EXPLAIN[id]);
    for (const n of NIST_AI_RMF) expectPlain(`NIST ${n.fn}`, NIST_EXPLAIN[n.fn]);
    for (const s of SAIF) expectPlain(`SAIF ${s.element}`, SAIF_EXPLAIN[s.element]);
    expect(Object.keys(SAIF_EXPLAIN).sort()).toEqual(SAIF.map((s) => s.element).sort());
  });
});
