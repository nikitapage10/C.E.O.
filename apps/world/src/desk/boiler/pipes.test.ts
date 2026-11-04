import { describe, expect, it } from "vitest";
import type { JobRow } from "../jobs.ts";
import type { GNode } from "../systemsGraph.ts";
import { gaugeOf, jobState, MAP_LINES, pipeHeadline, readPipes, STATIONS, type PipeInput } from "./pipes.ts";

const NOW = Date.UTC(2026, 10, 4, 22, 0);
const node = (id: string, state: GNode["state"]): GNode => ({ id, l: id, s: "", k: "service", state });
const job = (file: string, patch: Partial<JobRow> = {}): JobRow => ({ file, name: file, when: "", state: "pass", at: NOW - 3_600_000, lateMin: 2, missed: false, url: `https://github.com/nikitapage10/C.E.O./actions/runs/1`, ...patch });

function input(patch: Partial<PipeInput> = {}): PipeInput {
  const ok = ["claudecode", "github", "claude", "speech", "blob", "pings"];
  return {
    now: NOW,
    nodes: Object.fromEntries(ok.map((id) => [id, node(id, "ok")])),
    links: { gmail: "ok", hub: "ok", sleeper: "ok", fantasypros: "ok", polymarket: "ok", paypal: "ok", nest: "ok", whisker: "ok", roborock: "ok", petlibro: "ok", tasks: "ok", kroger: "ok", checks: "ok" },
    jobs: ["checks.yml", "e2e.yml", "deploy-azure.yml", "desk-pings.yml", "live-watch.yml", "backup-azure.yml"].map((f) => job(f)),
    vqa: { at: new Date(NOW - 600_000).toISOString(), url: "https://github.com/nikitapage10/C.E.O./actions/runs/2", run: "pass", review: "reviewed", rooms: 12, findings: 0, blockers: 0 },
    security: { failing: [], reported: 5, alerts: 0 },
    clock: { state: "ok", at: NOW - 600_000 },
    ...patch,
  };
}

describe("the pipe map", () => {
  it("puts every station on a line that exists, once", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STATIONS) expect(MAP_LINES.some((l) => l.id === s.line), s.id).toBe(true);
  });

  it("holds when every feed is healthy", () => {
    const m = readPipes(input());
    expect(m.faults).toEqual([]);
    expect(m.counts.ok).toBe(STATIONS.length);
    expect(pipeHeadline(m.faults)).toEqual({ text: "everything is holding", ok: true });
  });

  it("cracks a link that is down, with its reason and fix, and lists leaks before shut valves before late flow", () => {
    const m = readPipes(
      input({
        links: { ...input().links, petlibro: "down", gmail: "down" },
        jobs: [job("backup-azure.yml", { state: "other" }), job("deploy-azure.yml", { lateMin: 45 })],
        problems: { petlibro: "signed-out" },
      }),
    );
    expect(m.stations.petlibro!.state).toBe("leak");
    expect(m.stations.backup!.state).toBe("shut");
    expect(m.stations.deploy!.state).toBe("late");
    expect(m.faults.map((f) => f.kind)).toEqual(["leak", "leak", "shut", "late"]);
    const pet = m.faults.find((f) => f.station === "petlibro")!;
    expect(pet.title).toBe("Petlibro can't sign in.");
    expect(pet.body).toMatch(/one session per account/);
    expect(pet.fix).toBeNull();
    expect(pet.steps.length).toBeGreaterThan(0);
    expect(m.faults.find((f) => f.station === "gmail")!.fix).toEqual({ kind: "gmail", label: "Reconnect Gmail" });
    expect(m.faults.find((f) => f.station === "backup")!.fix).toMatchObject({ kind: "url" });
    expect(pipeHeadline(m.faults).text).toBe("3 faults, 1 late in the pipes");
  });

  it("keeps a link never connected dry, not a fault", () => {
    const m = readPipes(input({ links: { ...input().links, fantasypros: "off", kroger: "off" }, vqa: null, jobs: [] }));
    expect(m.stations.fantasypros!.state).toBe("dry");
    expect(m.stations.vqa!.state).toBe("dry");
    expect(m.stations.backup!.state).toBe("dry");
    expect(m.faults).toEqual([]);
  });

  it("reads Visual QA, the scans and the clock", () => {
    const vqa = { ...input().vqa!, review: "skipped" as const };
    const m = readPipes(input({ vqa, security: { failing: [{ name: "CodeQL", url: null }], reported: 5, alerts: 2 }, clock: { state: "slow", at: NOW - 80 * 60_000 } }));
    expect(m.stations.vqa!.state).toBe("shut");
    expect(m.stations.scans!.state).toBe("leak");
    expect(m.stations.clock!.state).toBe("late");
    expect(m.faults.find((f) => f.station === "clock")!.fix).toEqual({ kind: "clock", label: "Read the clock again" });
    expect(m.faults.find((f) => f.station === "clock")!.since).toBe("1 h ago");
  });

  it("never names a reason signed out", () => {
    const m = readPipes(input({ links: { ...input().links, whisker: "down" } }));
    expect(m.faults[0]!.body).not.toMatch(/Key Vault|password/);
  });

  it("reads a job's state and sets each gauge by its state", () => {
    expect(jobState(undefined)).toBe("dry");
    expect(jobState(job("x", { state: "fail" }))).toBe("leak");
    expect(jobState(job("x", { missed: true }))).toBe("shut");
    expect(jobState(job("x", { lateMin: 31 }))).toBe("late");
    expect(gaugeOf("a", "leak")).toBeGreaterThan(0.8);
    expect(gaugeOf("a", "shut")).toBeLessThan(0.1);
    expect(gaugeOf("gmail", "ok")).toBeGreaterThanOrEqual(0.42);
    expect(gaugeOf("gmail", "ok")).toBeLessThan(0.6);
  });
});
