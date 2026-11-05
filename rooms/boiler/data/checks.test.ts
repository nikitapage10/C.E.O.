import { describe, expect, it } from "vitest";
import { alertState, changesOf, checkLines, cut, KNOT_U, lookOf, RISK_CHECK, route, scanState, scoreState, switchState, type CheckState } from "./checks.ts";
import type { SecurityFeed } from "./feed.ts";

const feed = { at: "2026-10-25T00:00:00Z", workflows: [], features: [], alerts: { codeScanning: null, dependabot: null }, scorecard: null } as SecurityFeed;
const run = (state: SecurityFeed["workflows"][number]["state"]) => ({ id: "checks", name: "Checks", scope: "main", state, conclusion: null, at: null, url: null }) as SecurityFeed["workflows"][number];

describe("security checks as lines", () => {
  it("reads every source's state plainly, and waits when nothing is reported", () => {
    expect(scanState(null, run("pass"))).toBe("wait");
    expect(scanState(feed, undefined)).toBe("wait");
    expect(scanState(feed, run("pass"))).toBe("pass");
    expect(scanState(feed, run("fail"))).toBe("fail");
    expect(scanState(feed, run("none"))).toBe("wait");
    expect(alertState(null, feed)).toBe("wait");
    expect(alertState({ open: 0, fixed: 3, more: false }, feed)).toBe("pass");
    expect(alertState({ open: 2, fixed: 3, more: false }, feed)).toBe("part");
    expect(switchState("on")).toBe("pass");
    expect(switchState("off")).toBe("fail");
    expect(switchState("unreported")).toBe("wait");
    expect(scoreState(null)).toBe("wait");
    expect(scoreState({ score: 3.9, date: "", checks: [] })).toBe("fail");
    expect(scoreState({ score: 7.2, date: "", checks: [] })).toBe("pass");
    expect(RISK_CHECK.open).toBe("fail");
    expect(RISK_CHECK.covered).toBe("pass");
  });

  it("never draws flow on a line that is waiting or not applicable", () => {
    for (const s of ["wait", "off"] as CheckState[]) {
      const l = lookOf(s);
      expect(l.waiting).toBe(true);
      expect(l.rate).toBe(0);
    }
    expect(lookOf("pass", 1).density).toBeGreaterThan(lookOf("pass", 0.2).density);
  });

  it("cuts a path by arc length", () => {
    const p = route([0, 0], [100, 0], false);
    const c = cut(p.xs, p.ys, 0.5);
    expect(c.xs.at(-1)).toBeCloseTo(50, 5);
    expect(cut(p.xs, p.ys, 1).xs.at(-1)).toBe(100);
  });

  it("stops a failing check at a red knot, with a bare bed past it", () => {
    const p = route([0, 10], [200, 10], false);
    const [live, dead] = checkLines("codeql", "fail", p, { rgb: "1,1,1", bad: "2,2,2" });
    expect(live!.knots).toEqual([1]);
    expect(live!.rgb).toBe("2,2,2");
    const end = (live!.path as { xs: readonly number[] }).xs.at(-1)!;
    expect(end).toBeCloseTo(200 * KNOT_U, 3);
    expect(dead!.id).toBe("codeql~");
    expect((dead!.path as { xs: readonly number[] }).xs[0]).toBeCloseTo(end, 6);
    expect((dead!.path as { xs: readonly number[] }).xs.at(-1)).toBe(200);
    expect(dead!.bright).toBe(0);
    expect(checkLines("checks", "pass", p, { rgb: "1,1,1", bad: "2,2,2" })).toHaveLength(1);
  });

  it("eases a bundle's strands into their figure, ending exactly on it", () => {
    const p = route([0, 0], [300, 120], true);
    expect(p.xs[0]).toBe(0);
    expect(p.xs.at(-1)).toBeCloseTo(300, 6);
    expect(p.ys.at(-1)).toBeCloseTo(120, 6);
    expect(p.ys[1]).toBeCloseTo(0, 0);
  });

  it("reports only real changes", () => {
    const a = new Map<string, CheckState>([["x", "pass"], ["y", "wait"]]);
    const b = new Map<string, CheckState>([["x", "fail"], ["y", "wait"], ["z", "pass"]]);
    expect(changesOf(a, b)).toEqual([{ id: "x", from: "pass", to: "fail" }]);
    // The feed arriving is not news.
    expect(changesOf(new Map([["x", "wait"]]), new Map([["x", "pass"]]))).toEqual([]);
  });
});
