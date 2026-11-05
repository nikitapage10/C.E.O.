import { describe, expect, it } from "vitest";
import { pipeRows, type Flow, type FlowId, type GEdge, type GNode } from "./systemsGraph.ts";

const node = (id: string, l = id): GNode => ({ id, l, s: `${l} role`, k: "service", state: "ok" });
const NODES = Object.fromEntries(["you", "desk", "foundry", "github", "claude", "blob", "lattice", "boiler", "archive", "gemini", "speech", "mac", "relay", "openai", "polymarket"].map((id) => [id, node(id)]));
const flow = (id: FlowId, n: number, stc: Flow["stc"] = "ok"): Flow => ({ id, t: id, sub: `${id} sub`, room: id, p: "", st: "", stc, edges: Array.from({ length: n }, () => ({ a: "x", b: "y", room: id, state: "ok" })) });
const FLOWS: Record<FlowId, Flow> = { foundry: flow("foundry", 16, "run"), boiler: flow("boiler", 6), archive: flow("archive", 5, "wait"), relay: flow("relay", 9, "wait") };
const e = (a: string, b: string, room: string, state: GEdge["state"] = "ok"): GEdge => ({ a, b, room, state });

describe("the Boiler Room's pipe rack", () => {
  const over = [
    e("you", "desk", "foundry"),
    e("desk", "foundry", "foundry"),
    e("foundry", "github", "foundry", "run"),
    e("foundry", "claude", "foundry", "wait"),
    e("github", "boiler", "boiler"),
    e("boiler", "lattice", "boiler"),
    e("boiler", "claude", "boiler"),
    e("boiler", "desk", "boiler"),
    e("blob", "archive", "archive", "wait"),
    e("archive", "speech", "archive", "wait"),
    e("mac", "relay", "relay", "wait"),
    e("relay", "lattice", "relay", "wait"),
    e("relay", "openai", "relay", "wait"),
    e("desk", "exchange", "exchange"),
    e("exchange", "polymarket", "exchange"),
  ];
  const rows = pipeRows(NODES, over, FLOWS);
  const row = (id: string) => rows.find((r) => r.id === id)!;

  it("lays one pipe per room, with its flow's state and step count", () => {
    expect(rows.map((r) => r.id)).toEqual(["foundry", "boiler", "archive", "relay", "exchange"]);
    expect(row("foundry")).toMatchObject({ name: "Foundry", stc: "run", steps: 16, sub: "foundry sub" });
  });

  it("gives a room with connections but no flow its own pipe too, read from its node", () => {
    const NODES2 = { ...NODES, exchange: { id: "exchange", l: "Exchange", s: "Polymarket odds", k: "room" as const, room: "exchange", state: "ok" as const } };
    const x = pipeRows(NODES2, over, FLOWS).find((r) => r.id === "exchange")!;
    expect(x).toMatchObject({ flow: false, name: "Exchange", sub: "Polymarket odds", stc: "ok", steps: 2 });
    expect(x.ins.map((f) => f.id)).toEqual(["desk"]);
    expect(x.outs.map((f) => f.id)).toEqual(["polymarket"]);
    expect(row("foundry").flow).toBe(true);
  });

  it("puts what feeds a room before it, walking back along the chain, and what it feeds after", () => {
    expect(row("foundry").ins.map((f) => f.id)).toEqual(["you", "desk"]);
    expect(row("foundry").outs.map((f) => f.id)).toEqual(["github", "claude"]);
    expect(row("boiler").ins.map((f) => f.id)).toEqual(["github"]);
  });

  it("keeps each connection's own state on its fitting", () => {
    expect(row("foundry").outs.map((f) => f.state)).toEqual(["run", "wait"]);
    expect(row("archive").ins[0]).toMatchObject({ id: "blob", state: "wait", side: "in" });
  });

  it("always ends a pipe at the public Lattice when it reaches it", () => {
    expect(row("boiler").outs.map((f) => f.id)).toEqual(["claude", "desk", "lattice"]);
    expect(row("relay").outs.at(-1)?.id).toBe("lattice");
  });

  it("puts every overview connection on exactly one pipe, and a shared part on each pipe that uses it", () => {
    const fittings = rows.reduce((n, r) => n + r.ins.length + r.outs.length, 0);
    expect(fittings).toBe(over.length);
    expect(rows.filter((r) => [...r.ins, ...r.outs].some((f) => f.id === "claude")).map((r) => r.id)).toEqual(["foundry", "boiler"]);
  });
});
