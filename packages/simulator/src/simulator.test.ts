import { AgentEventSchema, ROOM_IDS, applyEvents, emptyState, pendingApprovals } from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS } from "./agents.ts";
import { Simulator } from "./simulator.ts";

const TEN_MINUTES = 10 * 60 * 1000;

function run(seed: number, until = TEN_MINUTES) {
  const sim = new Simulator({ seed });
  const events = [];
  for (let t = 0; t <= until; t += 250) events.push(...sim.advanceTo(t));
  return { sim, events };
}

describe("simulator", () => {
  it("is deterministic for a seed, regardless of how time is chunked", () => {
    const a = run(42).events;
    const sim = new Simulator({ seed: 42 });
    const b = sim.advanceTo(TEN_MINUTES);
    expect(b).toEqual(a);
    expect(run(43).events).not.toEqual(a);
  });

  it("emits only valid events, in timestamp order", () => {
    const { events } = run(7);
    expect(events.length).toBeGreaterThan(300);
    let last = 0;
    for (const e of events) {
      expect(AgentEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
      expect(e.ts).toBeGreaterThanOrEqual(last);
      last = e.ts;
    }
  });

  it("covers every room, every lineage and the full event vocabulary", () => {
    const { events } = run(3);
    const state = applyEvents(emptyState(), events);
    expect(Object.keys(state.agents)).toHaveLength(SAMPLE_AGENTS.length);
    expect(new Set(SAMPLE_AGENTS.map((a) => a.home.room))).toEqual(new Set(ROOM_IDS));
    expect(new Set(SAMPLE_AGENTS.map((a) => a.lineage)).size).toBe(5);
    const types = new Set(events.map((e) => e.type));
    for (const t of ["agent.spawned", "agent.moved", "agent.activity", "agent.quip", "task.started", "task.progress", "task.completed", "approval.requested"]) {
      expect(types).toContain(t);
    }
    expect(state.stats.tasksDone).toBeGreaterThan(5);
  });

  it("waits on the user for approvals and reacts when resolved", () => {
    const { sim, events } = run(11);
    const state = applyEvents(emptyState(), events);
    const pending = pendingApprovals(state);
    expect(pending.length).toBeGreaterThan(0);
    // One pending approval per agent at most.
    const owners = pending.map((p) => p.request.agentId);
    expect(new Set(owners).size).toBe(owners.length);

    const target = pending[0]!.request;
    const reaction = sim.resolveApproval(target.id, "approved", TEN_MINUTES);
    expect(reaction[0]).toMatchObject({ type: "approval.resolved", approvalId: target.id, decision: "approved", by: "user" });
    expect(reaction.some((e) => e.type === "agent.quip" && e.agentId === target.agentId)).toBe(true);
    expect(sim.resolveApproval(target.id, "denied")).toEqual([]);
    const after = applyEvents(state, reaction);
    expect(after.approvals[target.id]?.status).toBe("approved");
  });
});

describe("assign", () => {
  it("sends an agent somewhere after its current walk, closing its task", () => {
    const sim = new Simulator({ seed: 5 });
    sim.advanceTo(60_000);
    const ok = sim.assign("kevin", [{ kind: "go", station: "seat-w", room: "archive" }, { kind: "do", activity: "idle", ms: 5000 }], 60_000);
    expect(ok).toBe(true);
    const events = sim.advanceTo(180_000);
    expect(events.some((e) => e.type === "agent.moved" && e.agentId === "kevin" && e.to.station === "seat-w")).toBe(true);
    expect(sim.assign("nobody", [])).toBe(false);
  });
});
