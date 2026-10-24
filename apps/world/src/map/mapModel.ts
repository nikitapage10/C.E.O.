import {
  LINEAGES,
  ROOMS,
  getStation,
  pendingApprovals,
  placeToWorld,
  routeBetween,
  sampleRoute,
  type AgentRuntime,
  type LatticeState,
  type Motion,
  type RoomId,
  type Route,
} from "@ceo/core";
import { isLiveRoom } from "@ceo/simulator";

/**
 * The map's reading of the world (#332): where each of the crew is on the ring's floor plan, and what each room is
 * up to, from the same Lattice state the 3D world draws. Pure, and free of three.js and the DOM.
 */

export interface CrewPoint {
  id: string;
  /** World x and z: the map is the ring seen from straight above, +z (the 3D overview's camera side) down. */
  x: number;
  z: number;
  /** Standing or walking in a room, or riding a light stream between rooms. */
  kind: "still" | "walk" | "stream";
  room: RoomId;
}

/** A route per walk, kept while the walk lasts: the same route the 3D agent follows (agents/Agent.tsx). */
const routes = new WeakMap<Motion, Route>();

export function crewPoint(rt: AgentRuntime, now: number): CrewPoint {
  const id = rt.agent.id;
  const m = rt.motion;
  if (m && now < m.startTs + m.duration) {
    let route = routes.get(m);
    if (!route) routes.set(m, (route = routeBetween(m.from, m.to, id)));
    const s = sampleRoute(route, now - m.startTs);
    if (!s.done) return { id, x: s.position[0], z: s.position[2], kind: s.kind === "stream" ? "stream" : "walk", room: rt.place.room };
  }
  const [x, , z] = placeToWorld(rt.place, id);
  return { id, x, z, kind: "still", room: rt.place.room };
}

export const isWalking = (rt: AgentRuntime, now: number) => !!rt.motion && now < rt.motion.startTs + rt.motion.duration;

const ACTIVITY_WORDS: Record<string, string> = {
  idle: "idle",
  walking: "on the move",
  working: "working",
  typing: "typing",
  carrying: "carrying something",
  celebrating: "celebrating",
  slumped: "slumped",
  napping: "napping",
  waiting: "waiting",
  staring: "staring into the middle distance",
};

/** What someone is doing, in a few plain words: their running task, or where they are and how. */
export function doing(rt: AgentRuntime, state: LatticeState, now: number): string {
  const task = rt.taskId ? state.tasks[rt.taskId] : undefined;
  if (task?.status === "running") return task.title;
  if (isWalking(rt, now)) {
    const to = rt.motion!.to;
    return to.room === rt.motion!.from.room ? `walking → ${lower(getStation(to.room, to.station).label)}` : `heading to ${ROOMS[to.room].name}`;
  }
  const station = getStation(rt.place.room, rt.place.station).label;
  return `${ACTIVITY_WORDS[rt.activity] ?? rt.activity} · ${lower(station)}`;
}

const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z]{2}/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

export interface CrewLine {
  id: string;
  name: string;
  /** "r,g,b": the agent's accent, for the dot. */
  rgb: string;
  what: string;
  busy: boolean;
}

export interface RoomSummary {
  room: RoomId;
  /** Played by real work (the simulator's LIVE_ROOMS), not by the demo. */
  live: boolean;
  here: number;
  running: number;
  shipped: number;
  /** Real asks waiting on the C.E.O. in this room. */
  waiting: number;
  crew: CrewLine[];
}

export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "236,238,243";
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export interface Names {
  name?: (id: string) => string | undefined;
  accent?: (id: string) => string | undefined;
}

export function accentOf(rt: AgentRuntime, names: Names): string {
  return names.accent?.(rt.agent.id) ?? LINEAGES[rt.agent.lineage]?.accent ?? "#eceef3";
}

/** Each room's state: who's in it and what they're doing, its running work and what waits on the C.E.O. there. */
export function roomSummary(state: LatticeState, room: RoomId, now: number, names: Names = {}): RoomSummary {
  const crew = Object.values(state.agents)
    .filter((a) => a.place.room === room)
    .map((a) => {
      const task = a.taskId ? state.tasks[a.taskId] : undefined;
      return {
        id: a.agent.id,
        name: names.name?.(a.agent.id) ?? a.agent.name,
        rgb: hexToRgb(accentOf(a, names)),
        what: doing(a, state, now),
        busy: task?.status === "running",
      };
    })
    // The ones on a job first, then by name, so the list doesn't shuffle as people idle.
    .sort((a, b) => Number(b.busy) - Number(a.busy) || a.name.localeCompare(b.name));
  const tasks = Object.values(state.tasks).filter((t) => t.room === room);
  return {
    room,
    live: isLiveRoom(room),
    here: crew.length,
    running: tasks.filter((t) => t.status === "running").length,
    shipped: tasks.filter((t) => t.status === "success").length,
    waiting: pendingApprovals(state, true).filter((a) => a.request.room === room).length,
    crew,
  };
}

/** One line for a room's state, plain: "5 here · 2 running · 1 waiting on you". */
export function stateLine(s: RoomSummary): string {
  const parts = [`${s.here} here`];
  if (s.running) parts.push(`${s.running} running`);
  if (s.waiting) parts.push(`${s.waiting} waiting on you`);
  if (!s.running && !s.waiting) parts.push("quiet");
  return parts.join(" · ");
}
