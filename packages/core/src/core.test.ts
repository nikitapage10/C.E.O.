import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  DEFAULT_POLICY,
  ROOMS,
  ROOM_IDS,
  applyEvents,
  emptyState,
  evaluate,
  pendingApprovals,
  placeToWorld,
  roomToWorld,
  routeBetween,
  sampleRoute,
  type AgentEvent,
  type AgentEventBody,
  type ApprovalRequest,
  type AutonomyPolicy,
} from "./index.ts";

const agent = {
  id: "a1",
  name: "Tess",
  lineage: "claudari",
  provider: "simulated",
  role: "builder",
  home: { room: "foundry", station: "intake" },
} as const;

let n = 0;
const ev = (e: AgentEventBody & { ts: number }): AgentEvent => ({ id: `e${++n}`, source: "simulated", ...e }) as AgentEvent;

describe("layout", () => {
  it("every station sits on its platform", () => {
    for (const id of ROOM_IDS) {
      for (const st of ROOMS[id].stations) {
        expect(Math.abs(st.x)).toBeLessThanOrEqual(8);
        expect(Math.abs(st.z)).toBeLessThanOrEqual(6.5);
      }
    }
  });

  it("roomToWorld matches a three.js Y rotation (local -z points at the Kernel)", () => {
    for (const id of ROOM_IDS) {
      const center = roomToWorld(id, 0, 0, 0);
      const back = roomToWorld(id, 0, 0, -1);
      expect(Math.hypot(back[0], back[2])).toBeLessThan(Math.hypot(center[0], center[2]));
    }
  });

  it("routes start and end at the right places, and cross rooms by stream", () => {
    const from = { room: "foundry", station: "intake" } as const;
    const to = { room: "archive", station: "loom" } as const;
    const route = routeBetween(from, to, "a1");
    expect(route.points[0]).toEqual(placeToWorld(from, "a1"));
    expect(route.points.at(-1)).toEqual(placeToWorld(to, "a1"));
    expect(route.kinds).toContain("stream");
    expect(sampleRoute(route, 0).position).toEqual(route.points[0]);
    const end = sampleRoute(route, route.duration + 1);
    expect(end.done).toBe(true);
    expect(end.position).toEqual(route.points.at(-1));
    // Mid-route positions move continuously.
    const a = sampleRoute(route, route.duration * 0.5).position;
    const b = sampleRoute(route, route.duration * 0.5 + 16).position;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1);
  });

  it("same-room walks are a single walking segment", () => {
    const r = routeBetween({ room: "spire", station: "desk-1" }, { room: "spire", station: "coffee" }, "x");
    expect(r.kinds).toEqual(["walk"]);
    expect(r.duration).toBeGreaterThan(0);
  });
});

describe("reducer", () => {
  it("spawns, moves, works and completes", () => {
    const s = applyEvents(emptyState(), [
      ev({ type: "agent.spawned", ts: 0, agent }),
      ev({ type: "agent.moved", ts: 100, agentId: "a1", to: { room: "foundry", station: "furnace" } }),
      ev({ type: "task.started", ts: 200, taskId: "t1", agentId: "a1", title: "Ship it", room: "foundry" }),
      ev({ type: "task.progress", ts: 300, taskId: "t1", progress: 0.5 }),
      ev({ type: "task.completed", ts: 400, taskId: "t1", outcome: "success" }),
    ]);
    const rt = s.agents.a1!;
    expect(rt.place).toEqual({ room: "foundry", station: "furnace" });
    expect(rt.motion?.from).toEqual(agent.home);
    expect(rt.motion?.duration).toBeGreaterThan(0);
    expect(rt.taskId).toBeNull();
    expect(s.tasks.t1).toMatchObject({ status: "success", progress: 1 });
    expect(s.stats.tasksDone).toBe(1);
    expect(s.feed[0]?.type).toBe("task.completed");
    expect(s.now).toBe(400);
  });

  it("tracks approvals and ignores double resolution", () => {
    const approval: ApprovalRequest = {
      id: "ap1",
      agentId: "a1",
      action: "trade.place",
      summary: "Buy 10 YES",
      amountUsd: 4,
      risk: "medium",
      room: "exchange",
    };
    const s = applyEvents(emptyState(), [
      ev({ type: "agent.spawned", ts: 0, agent }),
      ev({ type: "approval.requested", ts: 1, approval }),
    ]);
    expect(pendingApprovals(s)).toHaveLength(1);
    const s2 = applyEvents(s, [
      ev({ type: "approval.resolved", ts: 2, approvalId: "ap1", decision: "approved", by: "user" }),
      ev({ type: "approval.resolved", ts: 3, approvalId: "ap1", decision: "denied", by: "user" }),
    ]);
    expect(pendingApprovals(s2)).toHaveLength(0);
    expect(s2.approvals.ap1?.status).toBe("approved");
    expect(s2.stats).toMatchObject({ approved: 1, denied: 0 });
  });

  it("ignores events for unknown agents and tasks", () => {
    const s = applyEvents(emptyState(), [
      ev({ type: "agent.quip", ts: 1, agentId: "ghost", text: "boo" }),
      ev({ type: "task.progress", ts: 1, taskId: "nope", progress: 0.2 }),
    ]);
    expect(s.agents).toEqual({});
    expect(s.feed).toHaveLength(2);
  });

  it("schema rejects malformed events", () => {
    expect(AgentEventSchema.safeParse({ id: "x", ts: 0, source: "simulated", type: "agent.moved" }).success).toBe(false);
  });
});

describe("autonomy policy", () => {
  const trade: ApprovalRequest = {
    id: "p",
    agentId: "quant",
    action: "trade.place",
    summary: "",
    amountUsd: 10,
    target: "RAIN-NYC",
    risk: "medium",
    room: "exchange",
  };

  it("defaults to asking for everything", () => {
    expect(evaluate(DEFAULT_POLICY, trade).decision).toBe("ask");
    expect(evaluate(DEFAULT_POLICY, { ...trade, action: "message.send" }).decision).toBe("ask");
  });

  it("applies the most specific rule and its limits", () => {
    const policy: AutonomyPolicy = {
      defaultMode: "approve",
      rules: [
        { action: "trade.place", mode: "read_only" },
        { agentId: "quant", action: "trade.place", mode: "auto", limits: { maxAmountUsd: 20, dailyCapUsd: 25 } },
      ],
    };
    expect(evaluate(policy, trade).decision).toBe("auto");
    expect(evaluate(policy, { ...trade, amountUsd: 50 }).decision).toBe("ask");
    expect(evaluate(policy, trade, { spentTodayUsd: 20 }).decision).toBe("ask");
    expect(evaluate(policy, { ...trade, agentId: "other" }).decision).toBe("block");
  });

  it("enforces allowlists", () => {
    const policy: AutonomyPolicy = {
      defaultMode: "approve",
      rules: [{ action: "message.send", mode: "auto", limits: { allowTargets: ["Mom"] } }],
    };
    const msg = { ...trade, action: "message.send" as const, amountUsd: undefined };
    expect(evaluate(policy, { ...msg, target: "Mom" }).decision).toBe("auto");
    expect(evaluate(policy, { ...msg, target: "Ex" }).decision).toBe("ask");
  });
});
