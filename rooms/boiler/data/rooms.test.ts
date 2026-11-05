import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "./connections.ts";
import type { JobRow } from "../../../apps/world/src/desk/jobs.ts";
import { pipeRows, systemsModel } from "./systemsGraph.ts";
import { readPipes } from "./pipes.ts";
import { layout, roomCounts, roomFaults, roomSections, roomState, ROW, RUN, runsOf, STEP } from "./rooms.ts";

const NOW = Date.UTC(2026, 10, 4, 22, 0);
const job = (file: string, patch: Partial<JobRow> = {}): JobRow => ({ file, name: file.replace(".yml", ""), when: "daily", state: "pass", at: NOW - 3_600_000, lateMin: 2, missed: false, url: "https://github.com/nikitapage10/C.E.O./actions/runs/1", ...patch });

function build(links: Record<string, "ok" | "slow" | "off" | "down">, jobs: JobRow[] = [], signedIn = false) {
  const model = systemsModel({ links, foundry: { nodes: [], edges: [] }, connected: true, building: null, clock: { state: "ok", headline: "On time" }, world: null, pings: true, vqa: "ok" });
  const rows = pipeRows(model.nodes, model.over, model.flows);
  const map = readPipes({ now: NOW, nodes: model.nodes, links, jobs, vqa: null, security: null, clock: { state: "ok", at: NOW - 60_000 } });
  return roomSections({ now: NOW, rows, map, jobs, signedIn, lastSeen: { gmail: NOW - 120_000 }, caps: { gmail: 0.42 } });
}

const LIVE = { gmail: "ok", sleeper: "ok", polymarket: "ok", paypal: "ok", petlibro: "ok", whisker: "ok", roborock: "ok", nest: "ok", tasks: "ok", kroger: "ok", fantasypros: "ok" } as const;

describe("the pipe map, room by room", () => {
  it("gives every room of the old rack its own section, with every live connection it owns", () => {
    const s = build({ ...LIVE });
    expect(s.map((x) => x.id)).toEqual(expect.arrayContaining(["foundry", "boiler", "archive", "relay", "exchange", "green", "spire"]));
    for (const c of CONNECTIONS) {
      const sec = s.find((x) => x.id === c.room);
      if (!sec) continue;
      expect(sec.pipes.some((p) => p.name === c.name), `${c.name} in ${c.room}`).toBe(true);
    }
    const ids = s.flatMap((x) => x.pipes.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts the room's jobs on its manifold, a failed one broken with its fix", () => {
    const s = build({ ...LIVE }, [job("backup-azure.yml", { state: "fail" }), job("deploy-azure.yml")]);
    const backup = s.find((x) => x.id === "boiler")!.pipes.find((p) => p.id === "boiler:job-backup-azure.yml")!;
    expect(backup.state).toBe("leak");
    expect(backup.fix).toMatchObject({ kind: "url" });
    expect(s.find((x) => x.id === "foundry")!.pipes.some((p) => p.id === "foundry:job-deploy-azure.yml" && p.state === "ok")).toBe(true);
    expect(roomState(s.find((x) => x.id === "boiler")!)).toBe("leak");
    expect(roomFaults(s)[0]).toMatchObject({ room: "boiler", kind: "leak" });
  });

  it("says what a broken or unconnected link needs, with its fix, last success and cap", () => {
    const s = build({ ...LIVE, gmail: "down", fantasypros: "off" });
    const gmail = s.find((x) => x.id === "relay")!.pipes.find((p) => p.id === "relay:gmail")!;
    expect(gmail.state).toBe("leak");
    expect(gmail.fix).toMatchObject({ kind: "gmail" });
    expect(gmail.needs).toBe("Reconnect Gmail.");
    expect(gmail.cap).toBe("Under its cap");
    expect(gmail.facts?.auth).toBeTruthy();
    const fp = s.find((x) => x.id === "green")!.pipes.find((p) => p.id === "green:fantasypros")!;
    expect(fp.state).toBe("dry");
    expect(fp.needs).toMatch(/FantasyPros key/);
    const ok = build({ ...LIVE }, [], true).find((x) => x.id === "relay")!.pipes.find((p) => p.id === "relay:gmail")!;
    expect(ok.lastOk).toBe(NOW - 120_000);
    expect(ok.cap).toBe("42% of its cap this month");
    expect(roomCounts(s).total).toBe(s.reduce((n, x) => n + x.pipes.length, 0));
  });

  it("lays each room out as its own manifold, branches in pairs, no two stations on one spot", () => {
    const s = build({ ...LIVE }, [job("checks.yml"), job("backup-azure.yml")]);
    const g = layout(s);
    expect(g.sections).toHaveLength(s.length);
    const tips = g.sections.flatMap((x) => x.pipes.map((p) => `${p.tip[0].toFixed(2)},${p.tip[1].toFixed(2)}`));
    expect(new Set(tips).size).toBe(tips.length);
    for (const sec of g.sections) {
      const xs = sec.pipes.map((p) => Math.abs(p.root[0]));
      const n = s.find((x) => x.id === sec.id)!.pipes.length;
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((Math.min(RUN, Math.ceil(n / 2)) - 1) * STEP);
    }
  });

  it("winds a long header back on itself, so a big room is a block, not one long line (#789)", () => {
    const s = build({ ...LIVE }, ["checks.yml", "e2e.yml", "codeql.yml", "scorecard.yml", "deploy-azure.yml", "desk-pings.yml", "live-watch.yml"].map((f) => job(f)));
    const g = layout(s);
    const big = s.reduce((a, b) => (b.pipes.length > a.pipes.length ? b : a));
    expect(runsOf(big.pipes.length)).toBeGreaterThan(1);
    const geo = g.sections.find((x) => x.id === big.id)!;
    // Its runs stack down the floor, each no longer than RUN steps.
    const zs = [...new Set(geo.pipes.map((p) => p.root[1].toFixed(2)))].map(Number).sort((a, b) => a - b);
    expect(zs).toHaveLength(runsOf(big.pipes.length));
    expect(zs[1]! - zs[0]!).toBeCloseTo(ROW);
    for (const sec of g.sections) {
      const xs = sec.pipes.map((p) => Math.abs(p.root[0]));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual((RUN - 1) * STEP + 1e-6);
      // The header turns only at right angles.
      for (let k = 1; k < sec.header.length; k++) {
        const [a, b] = [sec.header[k - 1]!, sec.header[k]!];
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      }
    }
    // No two rooms' boxes overlap on one side of the boiler.
    for (const a of g.sections)
      for (const b of g.sections)
        if (a !== b && Math.sign(a.box[0] + a.box[2]) === Math.sign(b.box[0] + b.box[2])) expect(a.box[3] <= b.box[1] + 1e-6 || b.box[3] <= a.box[1] + 1e-6, `${a.id}/${b.id}`).toBe(true);
  });

  it("gives the house devices to the Haven and puts the Boiler Room, only shared plumbing, last (#789)", () => {
    const s = build({ ...LIVE }, [job("backup-azure.yml")]);
    expect(s[s.length - 1]!.id).toBe("boiler");
    const haven = s.find((x) => x.id === "haven")!;
    for (const id of ["roborock", "petlibro", "whisker", "nest", "tasks", "kroger"]) expect(haven.pipes.some((p) => p.id === `haven:${id}`), id).toBe(true);
    const boiler = s.find((x) => x.id === "boiler")!;
    expect(boiler.pipes.some((p) => /roborock|petlibro|whisker|nest|tasks|kroger/.test(p.id))).toBe(false);
    expect(boiler.pipes.some((p) => p.id === "boiler:clock")).toBe(true);
  });
});
