import { describe, expect, it } from "vitest";
import { renderSummary, severityOf, summarize } from "./security-alerts-lib.mjs";

const codeAlert = (sev, plain, tool = "CodeQL") => ({
  number: 7,
  rule: { id: "js/sql-injection", description: "secret detail", security_severity_level: sev, severity: plain },
  tool: { name: tool },
  most_recent_instance: { location: { path: "api/secret.ts" } },
});

describe("upkeep's alert counts (#918)", () => {
  it("reads severity the same way as the Desk's feed", () => {
    expect(severityOf("code-scanning", codeAlert("critical", "error"))).toBe("critical");
    expect(severityOf("code-scanning", codeAlert(undefined, "warning"))).toBe("medium");
    expect(severityOf("dependabot", { security_advisory: { severity: "moderate" } })).toBe("medium");
    expect(severityOf("dependabot", {})).toBeNull();
  });

  it("counts by severity and scanner and keeps no rule, path or description", () => {
    const r = summarize("code-scanning", [codeAlert("high", "error"), codeAlert(undefined, "note", "Scorecard"), codeAlert(undefined, undefined, "evil\nname")]);
    expect(r).toEqual({ state: "read", open: 3, more: false, severity: { critical: 0, high: 1, medium: 0, low: 1 }, unrated: 1, tools: { CodeQL: 1, Scorecard: 1, other: 1 } });
    const text = JSON.stringify(r) + renderSummary({ codeScanning: r, dependabot: summarize("dependabot", []) });
    expect(text).not.toMatch(/sql-injection|secret|api\//);
  });

  it("a refused read is 'unreported' with its status only", () => {
    expect(summarize("dependabot", 403)).toEqual({ state: "unreported", status: 403 });
    expect(renderSummary({ codeScanning: summarize("code-scanning", 403), dependabot: summarize("dependabot", 0) })).toContain("not reported (HTTP 403)");
  });
});
