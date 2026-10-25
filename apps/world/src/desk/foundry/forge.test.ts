import { describe, expect, it } from "vitest";
import { parseOpenPrs, type Change, type Crate, type OpenPr } from "../../foundry.ts";
import { forgeEvents, forgeLanes, LANES, prFor, queueOf, shipWords, snapshot, stageOf, STAGE_U, GATE_U } from "./forge.ts";

/** The Foundry's pipeline (#432): which jobs get a lane, where each stands, and what changed between two reads. */

const job = (number: number, o: Partial<Crate> = {}): Crate => ({
  number,
  title: `Job ${number}`,
  kind: "build",
  state: "working",
  rung: null,
  url: `https://github.com/nikitapage10/C.E.O./issues/${number}`,
  updatedAt: 1_000 + number,
  pitch: "",
  size: "small",
  revising: false,
  builder: "tessellate",
  ...o,
});
const pr = (number: number, issue: number | null, checks: OpenPr["checks"] = "unknown", at = 5_000): OpenPr => ({ number, url: `https://github.com/x/pull/${number}`, at, draft: false, issue, checks });
const change = (key: string, issue: number | null): Change => ({ key, at: 9_000, title: `Change ${key}`, kind: "build", issue: issue ? { number: issue, url: "" } : null, landed: { label: `#${key}`, url: "" }, by: "tessellate", short: "", approval: "none", origin: "chat" });

describe("which jobs get a lane", () => {
  it("gives every working build its own lane, newest first, with Rusty's dock crew on his extra hands", () => {
    const { lanes, more } = forgeLanes([job(1), job(2), job(3), job(9, { state: "queued" }), job(8, { kind: "idea", state: "queued" })]);
    expect(lanes.map((l) => l.crate.number)).toEqual([3, 2, 1]);
    expect(more).toEqual([]);
    // Rusty on the oldest, then Dusty, then Gusty.
    expect(Object.fromEntries(lanes.map((l) => [l.crate.number, l.hand]))).toEqual({ 1: "Rusty", 2: "Dusty", 3: "Gusty" });
  });

  it("stops at the cap's four lanes and counts the rest on +N more, waiting their turn", () => {
    const { lanes, more } = forgeLanes([1, 2, 3, 4, 5, 6].map((n) => job(n)));
    expect(lanes).toHaveLength(LANES);
    expect(lanes.every((l) => l.flight === "running")).toBe(true);
    expect(more.map((l) => l.stage)).toEqual(["waiting", "waiting"]);
  });

  it("puts running jobs ahead of ones needing Nikita, then paused ones", () => {
    const { lanes } = forgeLanes([job(1, { paused: true, updatedAt: 9_999 }), job(2, { state: "ready" }), job(3)]);
    expect(lanes.map((l) => [l.crate.number, l.stage])).toEqual([
      [3, "building"],
      [2, "ready"],
      [1, "paused"],
    ]);
  });

  it("names Rocky and Rivet on their own work", () => {
    const { lanes } = forgeLanes([job(1, { builder: "caret" }), job(2, { kind: "upkeep", builder: "semicolon" })]);
    expect(lanes.map((l) => l.hand).sort()).toEqual(["Rivet", "Rocky"]);
  });

  it("has nothing in flight when nothing is in hand, and keeps ideas out", () => {
    expect(forgeLanes([job(1, { state: "shipped" }), job(2, { kind: "idea", state: "queued" })])).toEqual({ lanes: [], more: [] });
  });

  it("queues approved work oldest first, never ideas", () => {
    expect(queueOf([job(5, { state: "queued" }), job(2, { state: "queued" }), job(3, { kind: "idea", state: "queued" })]).map((c) => c.number)).toEqual([2, 5]);
  });
});

describe("where a job stands", () => {
  it("reads its pull request and checks once it has one", () => {
    const c = job(7);
    expect(stageOf(c, "running", null)).toBe("building");
    expect(stageOf(c, "running", pr(1, 7))).toBe("pr");
    expect(stageOf(c, "running", pr(1, 7, "running"))).toBe("checks");
    expect(stageOf(c, "running", pr(1, 7, "fail"))).toBe("red");
    expect(stageOf(c, "running", pr(1, 7, "pass"))).toBe("green");
    expect(stageOf(job(7, { state: "stuck" }), "running", pr(1, 7, "pass"))).toBe("stuck");
    expect(stageOf(c, "waiting", null)).toBe("waiting");
  });

  it("takes the newest pull request that works on the issue", () => {
    expect(prFor(job(7), [pr(1, 7, "fail", 1), pr(2, 7, "pass", 2), pr(3, 8, "pass", 3)])?.number).toBe(2);
    expect(prFor(job(7), [pr(3, 8)])).toBeNull();
  });

  it("puts every stage before the gate or past it, in order", () => {
    expect(STAGE_U.waiting).toBeLessThan(STAGE_U.building);
    expect(STAGE_U.building).toBeLessThan(STAGE_U.pr);
    expect(STAGE_U.pr).toBeLessThan(GATE_U);
    expect(STAGE_U.checks).toBe(GATE_U);
    expect(STAGE_U.green).toBeGreaterThan(GATE_U);
    expect(STAGE_U.green).toBeLessThan(1);
  });
});

describe("what changed between two reads", () => {
  const read = (crates: Crate[], prs: OpenPr[], log: Change[], main: "pass" | "fail" | "running" | "unknown" = "pass") => {
    const { lanes } = forgeLanes(crates, prs);
    return { snap: snapshot(lanes, queueOf(crates), crates.filter((c) => c.kind === "idea"), log, main), log };
  };

  it("has no events on the first read", () => {
    const a = read([job(1)], [], []);
    expect(forgeEvents(null, a.snap, a.log)).toEqual([]);
  });

  it("sees a job picked up, its pull request open, its checks go green, and it ship", () => {
    const a = read([job(1, { state: "queued" })], [], []);
    const b = read([job(1)], [], []);
    expect(forgeEvents(a.snap, b.snap, b.log)).toEqual([{ kind: "picked", issue: 1 }]);
    const c = read([job(1)], [pr(10, 1, "running")], []);
    expect(forgeEvents(b.snap, c.snap, c.log)).toEqual([{ kind: "pr", issue: 1 }]);
    const d = read([job(1)], [pr(10, 1, "pass")], []);
    expect(forgeEvents(c.snap, d.snap, d.log)).toEqual([{ kind: "green", issue: 1 }]);
    const shipped = change("k1", 1);
    const e = read([job(1, { state: "shipped" })], [], [shipped], "running");
    expect(forgeEvents(d.snap, e.snap, e.log)).toEqual([{ kind: "shipped", change: shipped }]);
    const f = read([job(1, { state: "shipped" })], [], [shipped], "pass");
    expect(forgeEvents(e.snap, f.snap, f.log)).toEqual([{ kind: "main", state: "pass" }]);
  });

  it("sees new ideas and new queued work, and red checks", () => {
    const a = read([job(1)], [pr(10, 1, "running")], []);
    const b = read([job(1), job(4, { kind: "idea", state: "queued" }), job(5, { state: "queued" })], [pr(10, 1, "fail")], []);
    expect(forgeEvents(a.snap, b.snap, b.log)).toEqual([
      { kind: "idea", issue: 4 },
      { kind: "queued", issue: 5 },
      { kind: "red", issue: 1 },
    ]);
  });

  it("rises neutral words for a ship, never its title", () => {
    expect(shipWords(change("k", 412))).toBe("shipped #412");
    expect(shipWords(change("88", null))).toBe("merged #88");
  });
});

describe("the open pull requests", () => {
  it("reads the feed's trimmed list and GitHub's own, linking each to its issue", () => {
    const got = parseOpenPrs([
      { number: 50, html_url: "https://github.com/x/pull/50", created_at: "2026-10-25T01:00:00Z", draft: false, issue: 432, checks: "pass" },
      { number: 51, html_url: "https://github.com/x/pull/51", created_at: "2026-10-25T01:00:00Z", head: { ref: "chat/433-something" } },
      { number: 52, html_url: "https://github.com/x/pull/52", created_at: "2026-10-25T01:00:00Z", head: { ref: "tidy" }, body: "Closes #77" },
      { number: 53, html_url: "https://github.com/x/pull/53", created_at: "not a date" },
      "junk",
    ]);
    expect(got.map((p) => [p.number, p.issue, p.checks])).toEqual([
      [50, 432, "pass"],
      [51, 433, "unknown"],
      [52, 77, "unknown"],
    ]);
    expect(parseOpenPrs(undefined)).toEqual([]);
  });
});
