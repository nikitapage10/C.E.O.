import { applyEvents, emptyState, type Agent, type AgentEvent, type AgentEventBody } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { RC } from "../desk/wvCanvas.ts";
import { addPulse, MAX_PULSES, weaveBus } from "./bus.ts";
import { derive } from "./live.ts";

let n = 0;
const ev = (e: AgentEventBody & { ts: number }, source: AgentEvent["source"] = "simulated"): AgentEvent => ({ id: `e${++n}`, source, ...e }) as AgentEvent;
const agent = (id: string, room: "foundry" | "spire"): Agent => ({ id, name: id, lineage: "claudari", provider: "simulated", role: "builder", home: { room, station: "intake" } }) as Agent;

describe("the Weave in the Lattice (#374)", () => {
  it("draws real work only: the demo's tasks never light a room or an agent", () => {
    const s = applyEvents(emptyState(), [
      ev({ type: "agent.spawned", ts: 0, agent: agent("real", "foundry") }),
      ev({ type: "agent.spawned", ts: 0, agent: agent("demo", "spire") }),
      ev({ type: "task.started", ts: 1, taskId: "t1", agentId: "real", title: "Ship it", room: "foundry" }, "claude-code"),
      ev({ type: "task.started", ts: 1, taskId: "t2", agentId: "demo", title: "Pretend", room: "spire" }),
    ]);
    const d = derive(s);
    expect(d.rooms).toEqual([["foundry", 1]]);
    expect(d.workers.map((w) => w.id)).toEqual(["real"]);
    expect(d.workers[0]!.rgb).toBe(RC.foundry);
  });

  it("goes dark when the real work finishes", () => {
    const s = applyEvents(emptyState(), [
      ev({ type: "agent.spawned", ts: 0, agent: agent("real", "foundry") }),
      ev({ type: "task.started", ts: 1, taskId: "t1", agentId: "real", title: "Ship it", room: "foundry" }, "claude-code"),
      ev({ type: "task.completed", ts: 2, taskId: "t1", outcome: "success" }, "claude-code"),
    ]);
    expect(derive(s)).toEqual({ rooms: [], workers: [] });
  });

  it("flies each signal once, and a burst as a few threads", () => {
    weaveBus.pulses.length = 0;
    addPulse({ id: "a", room: "foundry", born: 0 });
    addPulse({ id: "a", room: "foundry", born: 1 });
    expect(weaveBus.pulses).toHaveLength(1);
    for (let i = 0; i < 10; i++) addPulse({ id: `b${i}`, room: "relay", born: i });
    expect(weaveBus.pulses).toHaveLength(MAX_PULSES);
    expect(weaveBus.pulses.at(-1)!.id).toBe("b9");
    weaveBus.pulses.length = 0;
  });
});
