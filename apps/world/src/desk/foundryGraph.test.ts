import { describe, expect, it } from "vitest";
import { EMPTY_FOUNDRY, parseLastCommit, type Crate, type FoundryData, type GhCommit } from "../foundry.ts";
import { ago, capUse, CHECK_EVERY_MS, foundryGraph, laneLoad, type GraphInput } from "./foundryGraph.ts";

const NOW = Date.parse("2026-10-13T21:10:00Z");
const NEXT = Date.parse("2026-10-13T21:21:00Z");

const crate = (number: number, over: Partial<Crate> = {}): Crate => ({ number, title: `#${number}`, kind: "build", state: "working", rung: null, url: "", updatedAt: NOW, pitch: "", size: null, revising: false, ...over });

function graph(over: Partial<GraphInput> = {}, data: Partial<FoundryData> = {}) {
  const g = foundryGraph({ now: NOW, connected: true, setup: { direct: true, shape: true, images: true }, nextCheck: NEXT, ...over, data: { ...EMPTY_FOUNDRY, ...data } });
  return { node: (id: string) => g.nodes.find((n) => n.id === id)!, edge: (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)!, ...g };
}

describe("the Foundry's systems graph", () => {
  it("draws every part and wires the route from an idea to the live site", () => {
    const g = graph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["blob", "builder", "checks", "deploy", "desk", "issues", "main", "nikita", "queue", "rivet", "rocky", "rusty", "shaping"]);
    const route = ["nikita", "desk", "shaping", "issues", "queue", "builder", "rusty", "checks", "main", "deploy"];
    for (let i = 1; i < route.length; i++) expect(g.edge(route[i - 1]!, route[i]!)).toBeDefined();
    expect(g.edge("desk", "blob")).toBeDefined();
    for (const n of g.nodes) expect(n.what.length && n.source.length).toBeTruthy();
  });

  it("reads the checks from the last run on main", () => {
    const at = NOW - 5 * 60_000;
    expect(graph({}, { checks: { state: "pass", url: "u", at } }).node("checks")).toMatchObject({ state: "ok", status: "Passing", url: "u" });
    expect(graph({}, { checks: { state: "fail", url: "u", at } }).node("checks")).toMatchObject({ state: "down", status: "Failing" });
    expect(graph({}, { checks: { state: "running", url: "u", at } }).node("checks")).toMatchObject({ state: "slow", status: "Running" });
    expect(graph({}, { checks: { state: "fail", url: "u", at } }).edge("checks", "main").state).toBe("down");
    expect(graph().node("checks")).toMatchObject({ state: "off", status: "No run read" });
  });

  it("says plainly when shaping and pictures aren't set up, or api/foundry can't be reached", () => {
    expect(graph({ setup: { direct: true, shape: false, images: false } }).node("shaping")).toMatchObject({ state: "off", status: "Not set up" });
    expect(graph({ setup: { direct: true, shape: false, images: false } }).node("blob")).toMatchObject({ state: "off", status: "Not connected" });
    expect(graph({ setup: { direct: true, shape: true, images: true } }).node("blob")).toMatchObject({ state: "ok", status: "Connected" });
    expect(graph({ setup: null }).node("shaping").status).toBe("Checking…");
    const lost = graph({ setup: "unreached" });
    expect(lost.node("shaping").status).toBe("Not reached");
    expect(lost.edge("desk", "shaping").state).toBe("off");
    expect(graph({ setup: { direct: false, shape: true, images: true } }).edge("shaping", "issues").state).toBe("off");
  });

  it("times the queue check from its schedule and says it can't see the routine", () => {
    const q = graph().node("queue");
    expect(q.state).toBe("ok");
    expect(q.what).toContain("in 11 min");
    expect(q.source).toMatch(/can't/);
    // Four minutes into the fifteen.
    expect(q.load).toBeCloseTo((NOW - (NEXT - CHECK_EVERY_MS)) / CHECK_EVERY_MS);
  });

  it("puts everything off when GitHub hasn't answered", () => {
    const g = graph({ connected: false });
    for (const id of ["issues", "queue", "builder", "rivet", "rusty", "rocky", "checks", "main", "deploy"]) expect(g.node(id).state).toBe("off");
    expect(g.node("desk").state).toBe("ok");
  });

  it("dates the deploy by the latest commit on main, and says it isn't measured directly", () => {
    const commit = { sha: "abc1234", url: "c", title: "Ship it", at: NOW - 12 * 60_000 };
    const g = graph({}, { lastCommit: commit });
    expect(g.node("main")).toMatchObject({ state: "ok", status: "abc1234 · 12 min ago", url: "c" });
    expect(g.node("deploy")).toMatchObject({ state: "ok", status: "Pushed 12 min ago" });
    expect(g.node("deploy").source).toMatch(/Not measured directly/);
    expect(graph().node("deploy")).toMatchObject({ state: "off", status: "Not measurable" });
  });
});

describe("the crew lanes", () => {
  it("counts running jobs against each lane's cap", () => {
    const crates = [crate(1), crate(2), crate(3, { builder: "caret" }), crate(4, { kind: "fix", rung: 1 })];
    const g = graph({}, { crates });
    expect(g.node("rusty")).toMatchObject({ state: "ok", status: "2 of 4 running" });
    expect(g.node("rusty").load).toBeCloseTo(0.5);
    expect(g.node("rocky")).toMatchObject({ state: "ok", status: "1 of 1 running" });
    expect(g.node("rivet")).toMatchObject({ state: "ok", status: "1 running" });
    expect(capUse(crates)).toEqual({ inCap: 3, outside: 1, waiting: 0 });
  });

  it("shows work waiting its turn when a lane is full", () => {
    const crates = [crate(1, { builder: "caret" }), crate(2, { builder: "caret" })];
    expect(laneLoad(crates, "caret")).toEqual({ running: 1, waiting: 1, stuck: 0 });
    expect(graph({}, { crates }).node("rocky")).toMatchObject({ state: "slow", status: "1 of 1 · 1 waiting" });
    expect(graph({}, { crates }).edge("builder", "rocky").state).toBe("slow");
  });

  it("holds the whole crew to four at once, with fixes outside the cap", () => {
    const crates = [1, 2, 3, 4, 5].map((n) => crate(n));
    expect(capUse(crates)).toEqual({ inCap: 4, outside: 0, waiting: 1 });
  });

  it("marks a lane with a stuck job down, and an idle one idle", () => {
    const g = graph({}, { crates: [crate(7, { state: "stuck" })] });
    expect(g.node("rusty")).toMatchObject({ state: "down", status: "1 stuck" });
    expect(g.node("builder")).toMatchObject({ state: "slow", status: "1 stuck" });
    expect(g.node("rocky")).toMatchObject({ state: "ok", status: "Idle" });
  });
});

describe("parseLastCommit", () => {
  it("takes the newest commit's short sha, first line and date", () => {
    const commits: GhCommit[] = [{ sha: "0123456789abcdef", html_url: "h", commit: { message: "Merge #45: systems\n\nBody", committer: { date: "2026-10-13T20:00:00Z" } } }];
    expect(parseLastCommit(commits)).toEqual({ sha: "0123456", url: "h", title: "Merge #45: systems", at: Date.parse("2026-10-13T20:00:00Z") });
    expect(parseLastCommit([])).toBeNull();
    expect(parseLastCommit([{ sha: "x", html_url: "h", commit: { message: "m" } }])).toBeNull();
  });
});

describe("ago", () => {
  it("reads a time as a short age", () => {
    expect(ago(NOW - 20_000, NOW)).toBe("just now");
    expect(ago(NOW - 12 * 60_000, NOW)).toBe("12 min ago");
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(ago(NOW - 2 * 86_400_000, NOW)).toBe("2 d ago");
  });
});
