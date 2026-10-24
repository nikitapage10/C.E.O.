import { describe, expect, it } from "vitest";
import { CONNECTIONS } from "../connections.ts";
import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";
import { connectionFor, pipeLayout, pipeState, pressureHeadline, pressureOf, rackPressure, roomConnections } from "./pressure.ts";

const fit = (id: string, state: GState, side: Fitting["side"] = "out"): Fitting => ({ id, l: id, s: "", k: "service", state, side });
const row = (id: string, ins: Fitting[], outs: Fitting[], stc: GState = "ok"): PipeRow => ({ id, flow: false, room: id, name: id, sub: "", stc, steps: ins.length + outs.length, ins, outs });

describe("the Boiler Room's pressure", () => {
  it("counts flowing, running, dry and burst fittings", () => {
    const p = pressureOf([fit("a", "ok"), fit("b", "run"), fit("c", "wait"), fit("d", "bad")]);
    expect(p).toEqual({ flowing: 2, run: 1, dry: 1, burst: 1, total: 4, share: 0.5 });
    expect(pressureOf([]).share).toBe(0);
  });

  it("reads the whole rack from every pipe's fittings", () => {
    const rows = [row("foundry", [fit("you", "ok", "in")], [fit("github", "run")]), row("relay", [], [fit("openai", "wait"), fit("lattice", "wait")])];
    const p = rackPressure(rows);
    expect(p.total).toBe(4);
    expect(p.flowing).toBe(2);
    expect(p.dry).toBe(2);
  });

  it("says burst first, then cold, then hot, then holding", () => {
    expect(pressureHeadline(pressureOf([fit("a", "bad"), fit("b", "ok")])).em).toBe("burst.");
    expect(pressureHeadline(pressureOf([fit("a", "bad"), fit("b", "bad")])).lead).toBe("2 pipes have");
    expect(pressureHeadline(pressureOf([fit("a", "wait")])).em).toBe("cold.");
    expect(pressureHeadline(pressureOf([fit("a", "run")])).tone).toBe("run");
    expect(pressureHeadline(pressureOf([fit("a", "ok")])).em).toBe("holding.");
  });

  it("gives a pipe the worst state on it", () => {
    expect(pipeState(row("x", [], [fit("a", "ok"), fit("b", "bad")]))).toBe("bad");
    expect(pipeState(row("x", [], [fit("a", "wait")], "wait"))).toBe("wait");
    expect(pipeState(row("x", [], [fit("a", "ok")], "run"))).toBe("run");
  });

  it("explains each valve with its real connection, by room where it matters", () => {
    expect(connectionFor("github", "boiler")?.id).toBe("world-trigger");
    expect(connectionFor("github", "foundry")?.id).toBe("github-api");
    expect(connectionFor("gemini", "archive")?.id).toBe("gemini-speech");
    expect(connectionFor("gemini", "foundry")?.id).toBe("gemini-visual-qa");
    expect(connectionFor("lattice", "boiler")).toBeUndefined();
    expect(connectionFor("desk", "foundry")).toBeUndefined();
    for (const id of ["claude", "claudecode", "blob", "vercel", "phone", "polymarket", "sleeper", "fantasypros", "gmail", "paypal", "bluebubbles", "openai"]) expect(connectionFor(id, "x"), id).toBeDefined();
  });

  it("lists a room's own connections, live before planned", () => {
    const relay = roomConnections("relay");
    expect(relay.length).toBe(CONNECTIONS.filter((c) => c.room === "relay").length);
    expect(relay[0]!.status).toBe("live");
    expect(roomConnections("exchange").map((c) => c.id)).toEqual(["polymarket", "polymarket-us"]);
  });

  it("lines the feeds up before the hub and spreads the rest after it", () => {
    const r = row("x", [fit("a", "ok", "in"), fit("b", "ok", "in")], [fit("c", "ok"), fit("d", "ok")]);
    const l = pipeLayout(r, 1000, 300, 90, 20);
    expect(l.ins).toEqual([120, 210]);
    expect(l.end).toBe(980);
    expect(l.outs[0]).toBeGreaterThan(300);
    expect(l.outs[1]).toBeLessThan(980);
  });
});
