import { isLive, type Activity, type Agent, type AgentEvent, type ApprovalRequest, type Prop } from "./events.ts";
import { travelTime, type Place } from "./layout.ts";

export interface Motion {
  from: Place;
  to: Place;
  startTs: number;
  duration: number;
}

export interface AgentRuntime {
  agent: Agent;
  /** Where the agent is, or is heading if `motion` is set. */
  place: Place;
  motion: Motion | null;
  activity: Activity;
  prop: Prop | null;
  taskId: string | null;
  lastQuip: { text: string; ts: number } | null;
}

export interface TaskRecord {
  id: string;
  agentId: string;
  title: string;
  room: Place["room"];
  progress: number;
  status: "running" | "success" | "failure";
  note?: string;
  startedTs: number;
  endedTs?: number;
}

export interface ApprovalRecord {
  request: ApprovalRequest;
  status: "pending" | "approved" | "denied";
  requestedTs: number;
  resolvedTs?: number;
  by?: "user" | "policy";
  /** Raised by a real agent (through the hub), not the demo. */
  live: boolean;
}

export interface LatticeState {
  now: number;
  agents: Record<string, AgentRuntime>;
  tasks: Record<string, TaskRecord>;
  approvals: Record<string, ApprovalRecord>;
  /** Most recent events first. */
  feed: AgentEvent[];
  /** The same, real agents only, so the demo's chatter never pushes them out of the Lattice-wide view. */
  liveFeed: AgentEvent[];
  stats: { tasksDone: number; tasksFailed: number; approved: number; denied: number };
}

export const FEED_LIMIT = 80;
const FINISHED_TASK_LIMIT = 120;

export function emptyState(): LatticeState {
  return {
    now: 0,
    agents: {},
    tasks: {},
    approvals: {},
    feed: [],
    liveFeed: [],
    stats: { tasksDone: 0, tasksFailed: 0, approved: 0, denied: 0 },
  };
}

function patchAgent(state: LatticeState, id: string, patch: Partial<AgentRuntime>): LatticeState {
  const current = state.agents[id];
  if (!current) return state;
  return { ...state, agents: { ...state.agents, [id]: { ...current, ...patch } } };
}

function pruneTasks(tasks: Record<string, TaskRecord>): Record<string, TaskRecord> {
  const finished = Object.values(tasks).filter((t) => t.status !== "running");
  if (finished.length <= FINISHED_TASK_LIMIT) return tasks;
  const drop = new Set(
    finished
      .sort((a, b) => (a.endedTs ?? 0) - (b.endedTs ?? 0))
      .slice(0, finished.length - FINISHED_TASK_LIMIT)
      .map((t) => t.id),
  );
  return Object.fromEntries(Object.entries(tasks).filter(([id]) => !drop.has(id)));
}

/** Pure: apply one event. Unknown agents/tasks are ignored rather than thrown on, since sources are external. */
export function applyEvent(prev: LatticeState, event: AgentEvent): LatticeState {
  let state: LatticeState = {
    ...prev,
    now: Math.max(prev.now, event.ts),
    feed: [event, ...prev.feed].slice(0, FEED_LIMIT),
    liveFeed: isLive(event) ? [event, ...prev.liveFeed].slice(0, FEED_LIMIT) : prev.liveFeed,
  };

  switch (event.type) {
    case "agent.spawned": {
      const a = event.agent;
      state = {
        ...state,
        agents: {
          ...state.agents,
          [a.id]: { agent: a, place: a.home, motion: null, activity: "idle", prop: null, taskId: null, lastQuip: null },
        },
      };
      break;
    }
    case "agent.moved": {
      const current = state.agents[event.agentId];
      if (!current) break;
      const from = settledPlace(current, event.ts);
      const duration = travelTime(from, event.to, event.agentId);
      state = patchAgent(state, event.agentId, {
        place: event.to,
        motion: { from, to: event.to, startTs: event.ts, duration },
        activity: current.prop ? "carrying" : "walking",
      });
      break;
    }
    case "agent.activity": {
      const current = state.agents[event.agentId];
      if (!current) break;
      const prop = event.prop === undefined ? current.prop : event.prop;
      state = patchAgent(state, event.agentId, { activity: event.activity, prop });
      break;
    }
    case "agent.quip":
      state = patchAgent(state, event.agentId, { lastQuip: { text: event.text, ts: event.ts } });
      break;
    case "task.started":
      state = {
        ...patchAgent(state, event.agentId, { taskId: event.taskId }),
        tasks: {
          ...state.tasks,
          [event.taskId]: {
            id: event.taskId,
            agentId: event.agentId,
            title: event.title,
            room: event.room,
            progress: 0,
            status: "running",
            startedTs: event.ts,
          },
        },
      };
      break;
    case "task.progress": {
      const task = state.tasks[event.taskId];
      if (!task) break;
      state = {
        ...state,
        tasks: { ...state.tasks, [task.id]: { ...task, progress: event.progress, note: event.note ?? task.note } },
      };
      break;
    }
    case "task.completed": {
      const task = state.tasks[event.taskId];
      if (!task) break;
      const done = event.outcome === "success";
      state = {
        ...state,
        tasks: pruneTasks({
          ...state.tasks,
          [task.id]: {
            ...task,
            progress: done ? 1 : task.progress,
            status: event.outcome,
            note: event.note ?? task.note,
            endedTs: event.ts,
          },
        }),
        stats: {
          ...state.stats,
          tasksDone: state.stats.tasksDone + (done ? 1 : 0),
          tasksFailed: state.stats.tasksFailed + (done ? 0 : 1),
        },
      };
      if (state.agents[task.agentId]?.taskId === task.id) state = patchAgent(state, task.agentId, { taskId: null });
      break;
    }
    case "approval.requested":
      state = {
        ...state,
        approvals: {
          ...state.approvals,
          [event.approval.id]: { request: event.approval, status: "pending", requestedTs: event.ts, live: isLive(event) },
        },
      };
      break;
    case "approval.resolved": {
      const rec = state.approvals[event.approvalId];
      if (!rec || rec.status !== "pending") break;
      state = {
        ...state,
        approvals: {
          ...state.approvals,
          [rec.request.id]: { ...rec, status: event.decision, resolvedTs: event.ts, by: event.by },
        },
        stats: {
          ...state.stats,
          approved: state.stats.approved + (event.decision === "approved" ? 1 : 0),
          denied: state.stats.denied + (event.decision === "denied" ? 1 : 0),
        },
      };
      break;
    }
  }
  return state;
}

export function applyEvents(state: LatticeState, events: readonly AgentEvent[]): LatticeState {
  return events.reduce(applyEvent, state);
}

/**
 * Where a moving agent effectively is at `now`: its destination once the walk has finished,
 * otherwise its origin (a redirected walk restarts from there, which is close enough for a visual).
 */
export function settledPlace(rt: AgentRuntime, now: number): Place {
  if (!rt.motion) return rt.place;
  return now >= rt.motion.startTs + rt.motion.duration ? rt.motion.to : rt.motion.from;
}

/** What's waiting on the C.E.O.; `liveOnly` drops the demo's approvals (the Lattice-wide view). */
export function pendingApprovals(state: LatticeState, liveOnly = false): ApprovalRecord[] {
  return Object.values(state.approvals)
    .filter((a) => a.status === "pending" && (!liveOnly || a.live))
    .sort((a, b) => a.requestedTs - b.requestedTs);
}
