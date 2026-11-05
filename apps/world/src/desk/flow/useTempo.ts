import { useMemo } from "react";
import type { RoomId } from "../../chronicle.ts";
import { routeOf, type Route } from "../../route.ts";
import { pulseReader } from "./pulse.ts";
import { legendOf, NEUTRAL, tempoOf, type Tempo } from "@ceo/engine/sigils/tempo.ts";

/** The Desk page a route shows, as the room whose activity moves its lines; Today, the Lattice and the Desk-only rooms (the Annex, #618; the Haven, #616) have none. */
export function roomOfRoute(route: Route): RoomId | null {
  return route === "today" || route === "lattice" || route === "annex" || route === "haven" ? null : route;
}

/** The tempo and legend for the room a page shows (from its route unless named; `null` opts out). Its pulse comes from the hook the Desk handed the kit (pulse.ts). */
export function useTempo(room?: RoomId | null): { room: RoomId | null; tempo: Tempo; legend: string | null } {
  // Read at render: a room page mounts afresh on every move, and this keeps server rendering (tests) happy.
  const route = typeof window === "undefined" ? "today" : routeOf(window.location.pathname);
  const id = room === undefined ? roomOfRoute(route) : room;
  const usePulse = pulseReader();
  const p = usePulse(id);
  return useMemo(() => (p ? { room: id, tempo: tempoOf(p), legend: legendOf(p) } : { room: id, tempo: NEUTRAL, legend: null }), [p, id]);
}
