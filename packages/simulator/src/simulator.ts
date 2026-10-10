import {
  LINEAGES,
  ROOMS,
  travelTime,
  type AgentEvent,
  type AgentEventBody,
  type Place,
  type Provider,
} from "@ceo/core";
import { SAMPLE_AGENTS, type SimAgent } from "./agents.ts";
import {
  APPROVAL_WAIT_QUIPS,
  APPROVED_QUIPS,
  BREAK_QUIPS,
  DENIED_QUIPS,
  FAILURE_QUIPS,
  LINEAGE_QUIPS,
  NOSTALGIA_QUIPS,
  ROOM_QUIPS,
} from "./quips.ts";
import { createRng } from "./rng.ts";
import { SCRIPTS, coffeeBreak, type Step } from "./scripts.ts";


interface Actor {
  spec: SimAgent;
  place: Place;
  queue: Step[];
  nextAt: number;
  taskId: string | null;
  pendingApprovalId: string | null;
}

export interface SimulatorOptions {
  seed?: number;
  agents?: SimAgent[];
  startTs?: number;
}

/**
 * A deterministic stand-in for the real world. It plays every sample agent's routine and emits the same
 * AgentEvents that real adapters will, in timestamp order. Same seed + same calls = same events.
 */
export class Simulator {
  private readonly rng;
  private readonly actors: Actor[];
  private counter = 0;
  private now: number;
  private readonly approvalOwners = new Map<string, Actor>();
  private outbox: AgentEvent[] = [];

  constructor(options: SimulatorOptions = {}) {
    const seed = options.seed ?? 1;
    this.rng = createRng(seed);
    this.now = options.startTs ?? 0;
    this.actors = (options.agents ?? SAMPLE_AGENTS).map((spec) => ({
      spec,
      place: spec.home,
      queue: [],
      nextAt: this.now + this.rng.int(200, 3000),
      taskId: null,
      pendingApprovalId: null,
    }));
    for (const actor of this.actors) {
      const { script: _s, breakChance: _b, ...agent } = actor.spec;
      this.emit(this.now, { type: "agent.spawned", agent });
    }
  }

  get time(): number {
    return this.now;
  }

  /** Run every agent forward to `ts` and return the events produced, oldest first. */
  advanceTo(ts: number): AgentEvent[] {
    for (;;) {
      let next: Actor | null = null;
      for (const a of this.actors) if (a.nextAt <= ts && (!next || a.nextAt < next.nextAt)) next = a;
      if (!next) break;
      this.run(next);
    }
    this.now = Math.max(this.now, ts);
    return this.flush();
  }

  /** The C.E.O. has spoken. Returns the resolution and the agent's reaction. */
  resolveApproval(approvalId: string, decision: "approved" | "denied", ts = this.now): AgentEvent[] {
    const actor = this.approvalOwners.get(approvalId);
    if (!actor) return [];
    this.approvalOwners.delete(approvalId);
    if (actor.pendingApprovalId === approvalId) actor.pendingApprovalId = null;
    this.emit(ts, { type: "approval.resolved", approvalId, decision, by: "user" });
    const approved = decision === "approved";
    this.emit(ts, {
      type: "agent.quip",
      agentId: actor.spec.id,
      text: this.rng.pick(approved ? APPROVED_QUIPS : DENIED_QUIPS),
    });
    actor.queue.unshift({ kind: "do", activity: approved ? "celebrating" : "slumped", ms: 1800 });
    return this.flush();
  }

  pendingApprovalIds(): string[] {
    return [...this.approvalOwners.keys()];
  }

  private flush(): AgentEvent[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private emit(ts: number, body: AgentEventBody, source: Provider = "simulated") {
    this.outbox.push({ ...body, id: `sim-${++this.counter}`, ts, source } as AgentEvent);
  }

  private refill(actor: Actor) {
    const ctx = { rng: this.rng, agent: actor.spec };
    if (actor.spec.breakChance > 0 && this.rng.chance(actor.spec.breakChance)) {
      actor.queue.push(...coffeeBreak(ctx));
      if (this.rng.chance(0.5)) actor.queue.push({ kind: "quip", text: this.rng.pick(BREAK_QUIPS) });
    }
    actor.queue.push(...SCRIPTS[actor.spec.script](ctx));
  }

  private quipFor(actor: Actor): string {
    const r = this.rng.next();
    if (r < 0.12) return this.rng.pick(NOSTALGIA_QUIPS);
    if (r < 0.55) return this.rng.pick(LINEAGE_QUIPS[actor.spec.lineage] ?? LINEAGE_QUIPS.unforked);
    return this.rng.pick(ROOM_QUIPS[actor.place.room]);
  }

  /** Execute instant steps until one takes time, then schedule the actor's next turn. */
  private run(actor: Actor) {
    const id = actor.spec.id;
    for (let guard = 0; guard < 200; guard++) {
      if (actor.queue.length === 0) this.refill(actor);
      const step = actor.queue.shift()!;
      const t = actor.nextAt;
      switch (step.kind) {
        case "go": {
          const to: Place = { room: step.room ?? actor.spec.home.room, station: step.station };
          if (!ROOMS[to.room].stations.some((s) => s.id === to.station)) throw new Error(`Bad station ${to.room}/${to.station}`);
          if (to.room === actor.place.room && to.station === actor.place.station) continue;
          const duration = travelTime(actor.place, to, id);
          this.emit(t, { type: "agent.moved", agentId: id, to });
          actor.place = to;
          actor.nextAt = t + duration;
          return;
        }
        case "do":
          this.emit(t, { type: "agent.activity", agentId: id, activity: step.activity, ...(step.prop !== undefined ? { prop: step.prop } : {}) });
          actor.nextAt = t + step.ms;
          return;
        case "wait":
          actor.nextAt = t + step.ms;
          return;
        case "set":
          this.emit(t, { type: "agent.activity", agentId: id, activity: step.activity, ...(step.prop !== undefined ? { prop: step.prop } : {}) });
          continue;
        case "quip":
          if (step.chance === undefined || this.rng.chance(step.chance)) {
            this.emit(t, { type: "agent.quip", agentId: id, text: step.text ?? this.quipFor(actor) });
          }
          continue;
        case "task": {
          const taskId = `task-${++this.counter}`;
          actor.taskId = taskId;
          this.emit(t, { type: "task.started", taskId, agentId: id, title: step.title, room: actor.place.room }, actor.spec.provider);
          continue;
        }
        case "progress":
          if (actor.taskId) this.emit(t, { type: "task.progress", taskId: actor.taskId, progress: step.progress, ...(step.note ? { note: step.note } : {}) }, actor.spec.provider);
          continue;
        case "finish": {
          if (!actor.taskId) continue;
          const failed = this.rng.chance(step.failRate ?? 0);
          this.emit(t, { type: "task.completed", taskId: actor.taskId, outcome: failed ? "failure" : "success" }, actor.spec.provider);
          actor.taskId = null;
          if (failed) {
            this.emit(t, { type: "agent.quip", agentId: id, text: this.rng.pick(FAILURE_QUIPS) });
            // A failed task ends the routine: slump, drop whatever's being carried, start over.
            actor.queue = [{ kind: "do", activity: "slumped", ms: 2400, prop: null }];
          } else {
            this.emit(t, { type: "agent.activity", agentId: id, activity: "celebrating" });
            actor.nextAt = t + 1200;
            return;
          }
          continue;
        }
        case "approval": {
          if (actor.pendingApprovalId) {
            if (this.rng.chance(0.5)) this.emit(t, { type: "agent.quip", agentId: id, text: this.rng.pick(APPROVAL_WAIT_QUIPS) });
            continue;
          }
          const approvalId = `approval-${++this.counter}`;
          actor.pendingApprovalId = approvalId;
          this.approvalOwners.set(approvalId, actor);
          const { kind: _k, ...rest } = step;
          this.emit(
            t,
            { type: "approval.requested", approval: { id: approvalId, agentId: id, room: actor.place.room, ...rest } },
            actor.spec.provider,
          );
          this.emit(t, { type: "agent.activity", agentId: id, activity: "waiting" });
          actor.nextAt = t + 1500;
          return;
        }
      }
    }
    // Only reachable if a script never takes time; keep the world moving regardless.
    actor.nextAt += 1000;
  }
}

export function lineageOf(agent: SimAgent) {
  return LINEAGES[agent.lineage];
}
