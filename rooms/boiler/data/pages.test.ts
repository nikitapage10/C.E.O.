import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SecurityFeed } from "./feed.ts";
import { BOUNDARIES } from "./model.ts";
import { boundaryPaths } from "../web/CheckList.tsx";
import { BoilerFrame } from "../web/frame.tsx";
import { complianceNeeds, controlsNeeds, dailySeries, frameworkBars, linkTally, needsLayout, securityNeeds, severityTotals, syncMark, type LinkRow, type Need } from "./pages.ts";

const NOW = Date.UTC(2026, 10, 5, 0, 30);
const HOUR = 3_600_000;

const frame = (needs: Need[]) =>
  renderToStaticMarkup(createElement(BoilerFrame, { page: "controls", tabs: createElement("nav", null, "tabs"), title: "Every meter under 80%", needs, now: NOW, onGo: () => undefined }, createElement("p", { className: "board" }, "the board")));

const link = (id: string, state: LinkRow["state"], lastSeen: number | null = null): LinkRow => ({ id, label: id[0]!.toUpperCase() + id.slice(1), what: `What ${id} does`, room: "boiler", state, lastSeen });

describe("the Needs you column (#746)", () => {
  it("is not drawn at all when nothing needs Nikita, and the board runs full width", () => {
    const html = frame([]);
    expect(needsLayout([])).toBe("full");
    expect(html).toContain('data-needs="full"');
    expect(html).not.toContain("bx-needs");
    expect(html).not.toContain("Needs you");
    expect(html).toContain("the board");
  });

  it("sits beside the board with one card and one button per need", () => {
    const needs = controlsNeeds([link("petlibro", "down"), link("gmail", "down"), link("nest", "ok")], [], true);
    const html = frame(needs);
    expect(needsLayout(needs)).toBe("split");
    expect(html).toContain('data-needs="split"');
    expect(html).toContain("Needs you · 2");
    expect(html).toContain("Petlibro is down");
    expect(html).toContain("Reconnect Gmail");
    expect(html).toContain("the board");
  });
});

describe("Controls' reads", () => {
  it("asks for a down link and a hot meter, and tells a signed-out viewer to sign in instead of a button", () => {
    const meters = [
      { id: "voice", name: "Voice", tone: "warn" as const, share: 0.81 },
      { id: "claude", name: "Claude API", tone: "ok" as const, share: 0.3 },
    ];
    const signedIn = controlsNeeds([link("roborock", "down"), link("fantasypros", "off")], meters, true);
    expect(signedIn.map((n) => n.title)).toEqual(["Roborock is down", "Voice is at 81% of its cap"]);
    expect(signedIn[0]!.go).toEqual({ kind: "circuit", id: "ct-links", label: "Reconnect Roborock" });
    const out = controlsNeeds([link("roborock", "down")], [{ id: "voice", name: "Voice", tone: "warn", share: null }], false);
    expect(out[0]!.go).toBeNull();
    expect(out[0]!.locked).toMatch(/Sign in/);
    expect(out[1]!.title).toBe("Voice is near its cap");
    expect(JSON.stringify(out)).not.toContain("$");
  });

  it("counts links live, waiting and down for the donut", () => {
    expect(linkTally([link("a", "ok"), link("b", "slow"), link("c", "off"), link("d", "down")])).toEqual({ live: 2, waiting: 1, down: 1 });
  });

  it("draws a daily series only from what the trails recorded, and nothing when there's no history", () => {
    const trails = [
      { issue: 1, at: new Date(NOW - 2 * 24 * HOUR).toISOString(), body: "**Trail · Shaped:** Used 1,200 tokens in and 300 out, $0.0021." },
      { issue: 2, at: new Date(NOW - 40 * 24 * HOUR).toISOString(), body: "**Trail · Shaped:** Used 1,200 tokens in and 300 out, $0.0021." },
    ];
    const s = dailySeries(trails, NOW, "shaping-calls");
    expect(s).toHaveLength(30);
    expect(s!.reduce((a, x) => a + x, 0)).toBe(1);
    expect(s![27]).toBe(1);
    expect(dailySeries([], NOW, "shaping-calls")).toBeNull();
    expect(dailySeries(trails, NOW, "code-tokens")).toBeNull();
  });

  it("places a link's last answer on the last day's strip, and leaves it off when older or never", () => {
    expect(syncMark(NOW, NOW)).toBe(1);
    expect(syncMark(NOW - 6 * HOUR, NOW)).toBeCloseTo(0.75);
    expect(syncMark(NOW - 30 * HOUR, NOW)).toBeNull();
    expect(syncMark(null, NOW)).toBeNull();
  });
});

describe("Security's reads", () => {
  const feed = (over: Partial<SecurityFeed> = {}): SecurityFeed => ({
    at: new Date(NOW).toISOString(),
    workflows: [
      { id: "checks", name: "Checks", scope: "main", state: "pass", conclusion: null, at: null, url: null, recent: [{ state: "pass", at: "2026-11-04T10:00:00Z" }] },
      { id: "codeql", name: "CodeQL", scope: "main", state: "fail", conclusion: null, at: "2026-11-04T22:00:00Z", url: "https://github.com/nikitapage10/C.E.O./actions/runs/9" },
    ],
    features: [],
    alerts: { codeScanning: { open: 1, fixed: 0, more: false, severity: { critical: 0, high: 0, medium: 1, low: 0 } }, dependabot: { open: 2, fixed: 1, more: false, severity: { critical: 1, high: 0, medium: 0, low: 1 } } },
    scorecard: null,
    ...over,
  });

  it("asks for a failing scan and a critical alert, not a medium one, and nothing when all is well", () => {
    const needs = securityNeeds(feed());
    expect(needs.map((n) => n.id)).toEqual(["scan-codeql", "alerts-dependabot"]);
    expect(needs[0]!.at).toBe(Date.parse("2026-11-04T22:00:00Z"));
    expect(securityNeeds(feed({ workflows: [], alerts: { codeScanning: { open: 0, fixed: 3, more: false }, dependabot: null } }))).toEqual([]);
    expect(securityNeeds(null)).toEqual([]);
  });

  it("adds alerts up by severity, and says so when the feed sent no split", () => {
    expect(severityTotals(feed().alerts)).toEqual({ critical: 1, high: 0, medium: 1, low: 1 });
    expect(severityTotals({ codeScanning: { open: 1, fixed: 0, more: false }, dependabot: null })).toBeNull();
  });

  it("draws every trust boundary, fanning out the ones between the same two zones", () => {
    const paths = boundaryPaths();
    expect(paths).toHaveLength(BOUNDARIES.length);
    const mids = paths.map((p) => p.mid.map((v) => v.toFixed(0)).join(","));
    expect(new Set(mids).size).toBe(mids.length);
  });
});

describe("Compliance's reads", () => {
  it("gives a bar per framework that adds up, and regulation as nothing mapped", () => {
    const bars = frameworkBars();
    expect(bars.map((b) => b.id)).toEqual(["owasp", "nist", "saif", "regulation"]);
    for (const b of bars) expect(Object.values(b.counts).reduce((a, x) => a + x, 0)).toBe(b.total);
    expect(bars[3]!.total).toBe(0);
  });

  it("asks only for an open risk", () => {
    const base = { where: "x", residual: "Nothing guards it yet.", controls: "Some control" };
    const needs = complianceNeeds([
      { id: "LLM98", name: "Open one", ...base, tracking: "Open: nothing yet" },
      { id: "LLM99", name: "Tracked one", ...base, tracking: "Agents' own identity (R2)" },
    ]);
    expect(needs.map((n) => n.title)).toEqual(["LLM98 Open one is open"]);
    expect(needs[0]!.body).toBe("Nothing guards it yet.");
    expect(complianceNeeds([])).toEqual([]);
  });
});
