import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "../connections.ts";
import type { JobRow } from "../jobs.ts";
import { pipeRows, systemsModel } from "../systemsGraph.ts";
import { readPipes } from "./pipes.ts";
import { layout, roomCounts, roomFaults, roomSections, roomState, STEP } from "./rooms.ts";

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
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((Math.ceil(sec.pipes.length / 2) - 1) * STEP);
    }
  });
});
