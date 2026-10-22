import {
  AgentEventSchema,
  COMMAND_HEIGHT,
  OBSTACLES,
  POST_HALF,
  POST_HEIGHT,
  ROOMS,
  ROOM_HALF_D,
  ROOM_HALF_W,
  ROOM_IDS,
  applyEvents,
  blockedAt,
  emptyState,
  getStation,
  inAir,
  pendingApprovals,
  placeToWorld,
  routeBetween,
  sampleRoute,
} from "@ceo/core";
import { describe, expect, it } from "vitest";
import { SAMPLE_AGENTS, SUBMINDS, isSubmind, submindOf } from "./agents.ts";
import { isLiveRoom } from "./live.ts";
import { COMMAND_COOLDOWN, Simulator } from "./simulator.ts";

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

describe("live rooms (LIVE_ROOMS)", () => {
  it("the Exchange and the Green are live; rooms not yet connected keep their demo", () => {
    for (const room of ["exchange", "green", "relay", "foundry"] as const) expect(isLiveRoom(room), room).toBe(true);
    for (const room of ["spire", "archive", "workshop"] as const) expect(isLiveRoom(room), room).toBe(false);
  });

  it("every room whose submind is active (a real API integrated) is live, so it runs no demo", () => {
    for (const m of SUBMINDS) if (m.active) expect(isLiveRoom(m.room), m.room).toBe(true);
  });

  it("no agent of a live room starts a demo task, reports progress or asks for a demo approval; they still idle and banter", () => {
    const { events } = run(21, 3 * TEN_MINUTES);
    const home = new Map(SAMPLE_AGENTS.map((a) => [a.id, a.home.room]));
    const tasks = new Map<string, string>();
    for (const e of events) {
      if (e.type === "task.started") {
        expect(isLiveRoom(home.get(e.agentId)!), `${e.agentId}: ${e.title}`).toBe(false);
        tasks.set(e.taskId, e.agentId);
      }
      if (e.type === "task.progress" || e.type === "task.completed") expect(tasks.has(e.taskId)).toBe(true);
      if (e.type === "approval.requested") expect(isLiveRoom(e.approval.room), e.approval.summary).toBe(false);
    }
    // Demo rooms keep theirs.
    expect(events.some((e) => e.type === "task.started" && home.get(e.agentId) === "spire")).toBe(true);
    for (const id of ["odds", "hedge", "gridiron", "punt", "ticker", "turf"]) {
      expect(events.some((e) => e.type === "agent.quip" && e.agentId === id), id).toBe(true);
    }
  });

  it("skips demo work even when a live room's agent is handed a scripted task", () => {
    const sim = new Simulator({ seed: 4, agents: SAMPLE_AGENTS.filter((a) => a.id === "odds") });
    sim.assign("odds", [{ kind: "task", title: "Research a pretend market" }, { kind: "progress", progress: 0.5 }, { kind: "approval", action: "trade.place", summary: "Buy YES · $5", amountUsd: 5, risk: "medium" }, { kind: "finish" }], 0);
    const events = sim.advanceTo(TEN_MINUTES);
    expect(events.filter((e) => e.type.startsWith("task.") || e.type === "approval.requested")).toEqual([]);
    expect(sim.pendingApprovalIds()).toEqual([]);
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

  it("each post is a podium floating high in the back-right corner, over a floor left clear for everyone", () => {
    for (const room of ROOM_IDS) {
      const post = getStation(room, "post");
      expect(post.exact, room).toBe(true);
      // Mid-to-upper height: over every head and every piece of furniture, below the walls' tops.
      expect(post.y ?? 0, room).toBe(POST_HEIGHT);
      expect(POST_HEIGHT).toBeGreaterThanOrEqual(2.4);
      expect(POST_HEIGHT).toBeLessThanOrEqual(2.8);
      expect(inAir({ room, station: "post" }), room).toBe(true);
      // Back-right as the default camera sees it (+x, -z), inside the walls, well clear of the gate at (0, -6.9).
      expect(post.x, room).toBeGreaterThan(5.5);
      expect(post.z, room).toBeLessThan(-4);
      expect(post.x + POST_HALF, room).toBeLessThanOrEqual(ROOM_HALF_W);
      expect(post.z - POST_HALF, room).toBeGreaterThanOrEqual(-ROOM_HALF_D);
      // It floats, so it leaves no footprint: the corner under it is free to walk through.
      expect(OBSTACLES[room]?.some((b) => b.x === post.x && b.z === post.z) ?? false, room).toBe(false);
      expect(blockedAt(room, post.x, post.z), room).toBe(false);
      // Nobody but the submind stands up there.
      for (const st of ROOMS[room].stations) {
        if (st.id !== "post" && st.id !== "command") expect(inAir({ room, station: st.id }), `${room}/${st.id}`).toBe(false);
      }
    }
  });

  it("a submind glides straight between its podium and the command spot, through the air", () => {
    for (const room of ROOM_IDS) {
      const id = submindOf(room).id;
      const post = { room, station: "post" } as const;
      const command = { room, station: "command" } as const;
      for (const [a, b] of [[post, command], [command, post]] as const) {
        const r = routeBetween(a, b, id);
        // One straight leg, no detours round the furniture, ...
        expect(r.kinds, room).toEqual(["fly"]);
        expect(r.points[0]).toEqual(placeToWorld(a, id));
        expect(r.points[1]).toEqual(placeToWorld(b, id));
        // ...easing in and out (slow off the mark, quickest in the middle), bowed up a little, landing exactly.
        const at = (f: number) => sampleRoute(r, r.duration * f).position;
        const span = Math.hypot(r.points[1]![0] - r.points[0]![0], r.points[1]![2] - r.points[0]![2]);
        const moved = (f0: number, f1: number) => Math.hypot(at(f1)[0] - at(f0)[0], at(f1)[2] - at(f0)[2]);
        expect(moved(0, 0.1), room).toBeLessThan(moved(0.45, 0.55) * 0.5);
        expect(moved(0, 0.5), room).toBeCloseTo(span / 2, 5);
        expect(at(0.5)[1], room).toBeGreaterThan(Math.max(r.points[0]![1], r.points[1]![1]) + 0.2);
        expect(sampleRoute(r, r.duration + 1).position).toEqual(r.points[1]);
      }
    }
  });

  it("each command spot is high over the middle of its room, with nothing solid under it", () => {
    for (const room of ROOM_IDS) {
      const spot = getStation(room, "command");
      expect(spot.exact, room).toBe(true);
      expect(spot.y ?? 0, room).toBe(COMMAND_HEIGHT);
      expect(COMMAND_HEIGHT).toBeGreaterThanOrEqual(2.4);
      expect(Math.abs(spot.x), room).toBeLessThanOrEqual(2);
      expect(Math.abs(spot.z), room).toBeLessThanOrEqual(2);
      expect(OBSTACLES[room]?.some((b) => b.x === spot.x && b.z === spot.z), room).toBeFalsy();
    }
  });

  it("a submind comes out to give the order when work starts in its room, then goes back to its podium", () => {
    const { events } = run(5, 3 * TEN_MINUTES);
    const lead = submindOf("spire").id;
    const moves = events.filter((e) => e.type === "agent.moved" && e.agentId === lead);
    const out = moves.findIndex((e) => e.type === "agent.moved" && e.to.station === "command");
    expect(out).toBeGreaterThanOrEqual(0);
    expect(moves.slice(out + 1).some((e) => e.type === "agent.moved" && e.to.station === "post")).toBe(true);
    // Every sortie answers work starting in the room (once any flight it was on lands), and they are spaced out.
    const sorties = events.flatMap((e) => (e.type === "agent.moved" && isSubmind(e.agentId) && e.to.station === "command" ? [{ agentId: e.agentId, ts: e.ts }] : []));
    expect(sorties.length).toBeGreaterThan(SUBMINDS.length);
    for (const s of sorties) {
      const room = SUBMINDS.find((m) => m.id === s.agentId)!.room;
      expect(events.some((e) => e.type === "task.started" && e.room === room && e.ts <= s.ts && s.ts - e.ts < 15_000), s.agentId).toBe(true);
    }
    for (const m of SUBMINDS) {
      const ts = sorties.filter((e) => e.agentId === m.id).map((e) => e.ts);
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(COMMAND_COOLDOWN);
    }
  });

  it("command() only sends a submind out from its podium, and not again within the cooldown", () => {
    const lead = submindOf("relay").id;
    // The Messenger alone, so nothing else sends it out.
    const sim = new Simulator({ seed: 9, agents: SAMPLE_AGENTS.filter((a) => a.id === lead) });
    let t = 0;
    sim.advanceTo(t);
    while (sim.placeOf(lead)?.station !== "post" && t < 600_000) sim.advanceTo((t += 500));
    expect(sim.placeOf(lead)?.station).toBe("post");
    expect(sim.command("relay", "dialtone", t)).toBe(true);
    expect(sim.commandTarget(lead)).toBe("dialtone");
    const evs = sim.advanceTo(t + 1);
    expect(evs.some((e) => e.type === "agent.moved" && e.agentId === lead && e.to.station === "command")).toBe(true);
    // Out in the room: no second order until it's home and the cooldown has passed.
    expect(sim.command("relay", "postmaster", t + 2)).toBe(false);
    const back = sim.advanceTo(t + 30_000);
    expect(back.some((e) => e.type === "agent.moved" && e.agentId === lead && e.to.station === "post")).toBe(true);
    expect(sim.placeOf(lead)?.station).toBe("post");
    expect(sim.command("relay", "postmaster", t + 30_000)).toBe(false);
    while (sim.placeOf(lead)?.station !== "post" || t < COMMAND_COOLDOWN + 1000) sim.advanceTo((t += 500));
    expect(sim.command("relay", "postmaster", t + COMMAND_COOLDOWN)).toBe(true);
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
