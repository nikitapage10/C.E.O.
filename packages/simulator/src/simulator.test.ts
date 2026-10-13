import {
  AgentEventSchema,
  OBSTACLES,
  POST_HEIGHT,
  ROOM_IDS,
  applyEvents,
  emptyState,
  getStation,
  pendingApprovals,
} from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS, SUBMINDS, isSubmind, submindOf } from "./agents.ts";
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

describe("the Relay's real line", () => {
  it("gives the Relay no demo tasks or approvals, and stamps all demo events as simulated", () => {
    const { events } = run(9, 3 * TEN_MINUTES);
    const relay = new Set(SAMPLE_AGENTS.filter((a) => a.home.room === "relay").map((a) => a.id));
    expect(relay.size).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.source).toBe("simulated");
      if (e.type === "task.started") expect(relay.has(e.agentId)).toBe(false);
      if (e.type === "approval.requested") expect(e.approval.room).not.toBe("relay");
    }
    // Still around, still chatting.
    expect(events.some((e) => e.type === "agent.quip" && relay.has(e.agentId))).toBe(true);
    const state = applyEvents(emptyState(), events);
    expect(state.liveFeed).toEqual([]);
    expect(pendingApprovals(state, true)).toEqual([]);
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

describe("the Skippy subminds", () => {
  it("every room has exactly one submind (a Room lead), homed at its conductor's post", () => {
    for (const room of ROOM_IDS) {
      const leads = SAMPLE_AGENTS.filter((a) => a.home.room === room && a.role === "Room lead");
      expect(leads, room).toHaveLength(1);
      expect(leads[0]!.home.station).toBe("post");
      expect(isSubmind(leads[0]!.id)).toBe(true);
      expect(submindOf(room).id).toBe(leads[0]!.id);
    }
    expect(SUBMINDS).toHaveLength(ROOM_IDS.length);
    expect(new Set(SUBMINDS.map((m) => m.colour)).size).toBe(SUBMINDS.length);
  });

  it("each post is a hover spot high over the middle of its room, inside the walls, clear of the gate", () => {
    for (const room of ROOM_IDS) {
      const post = getStation(room, "post");
      expect(post.exact, room).toBe(true);
      // High enough to clear every agent and every piece of furniture...
      expect(post.y ?? 0, room).toBeGreaterThanOrEqual(POST_HEIGHT);
      expect(post.y ?? 0, room).toBeGreaterThanOrEqual(2.5);
      // ...roughly over the room's centre, well inside the walls, and nowhere near the gate at (0, -6.9).
      expect(Math.abs(post.x), room).toBeLessThanOrEqual(2);
      expect(Math.abs(post.z), room).toBeLessThanOrEqual(2);
      // Nothing solid stands under it: it has no footprint.
      expect(OBSTACLES[room]?.some((b) => b.x === post.x && b.z === post.z), room).toBeFalsy();
    }
  });

  it("subminds conduct from the post, never nap, and now and then come down to check on someone", () => {
    const { events } = run(4, 6 * TEN_MINUTES);
    const ids = new Set(SUBMINDS.map((m) => m.id));
    expect(events.some((e) => e.type === "agent.activity" && ids.has(e.agentId) && e.activity === "napping")).toBe(false);
    expect(events.some((e) => e.type === "agent.activity" && ids.has(e.agentId) && e.activity === "waiting")).toBe(true);
    const swoops = events.filter((e) => e.type === "agent.moved" && ids.has(e.agentId) && e.to.station !== "post");
    expect(swoops.length).toBeGreaterThan(0);
  });
});
