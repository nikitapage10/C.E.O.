import { useMemo } from "react";
import { useChronicle, type RoomId } from "../../chronicle.ts";
import { useFoundry } from "../../foundry.ts";
import { routeOf, type Route } from "../../route.ts";
import { useSystems } from "../../systems.ts";
import { useDesk } from "../deskData.ts";
import { useEmail } from "../email/email.ts";
import { usePolymarket } from "../exchange/polymarket.ts";
import { useGreen } from "../green/league.ts";
import { useNow } from "../motion.tsx";
import { roomPulses, type RoomPulse } from "../roomPulse.ts";
import { useInvoices } from "../spire/invoices.ts";
import { legendOf, NEUTRAL, tempoOf, type Tempo } from "./tempo.ts";

/** The Desk page a route shows, as the room whose activity moves its lines; Today and the Lattice have none. */
export function roomOfRoute(route: Route): RoomId | null {
  return route === "today" || route === "lattice" ? null : route;
}

/**
 * A room's pulse (roomPulse.ts) from the stores the Desk already keeps (#262). It starts nothing and polls nothing of
 * its own: the Foundry and the links run for the whole Desk, and a room's own source (the odds, the league, the
 * invoices, the email counts) is started by that room's page. A source not read yet reads as not connected, and idles.
 */
export function useRoomPulse(room: RoomId | null): RoomPulse | null {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const links = useSystems((s) => s.links);
  const world = useChronicle((s) => s.feed);
  const owed = useDesk((s) => s.data.owed.length);
  const board = usePolymarket((s) => s.board);
  const greenStatus = useGreen((s) => s.status);
  const greenBoard = useGreen((s) => s.board);
  const invoices = useInvoices((s) => s.status);
  const email = useEmail((s) => s.status);
  // The Desk's clock already ticks every half minute; "today" only needs the minute.
  const minute = Math.floor(useNow(60_000) / 60_000);
  return useMemo(() => {
    if (!room) return null;
    const at = minute * 60_000;
    const dayStart = new Date(at).setHours(0, 0, 0, 0);
    const hub = links.find((l) => l.id === "hub")?.state ?? "off";
    const lead = board?.top[0];
    const odds = board ? { markets: board.top.length, lead: lead ? { question: lead.question, prob: lead.prob } : null } : null;
    const all = roomPulses({ now: at, dayStart, foundry: { connected, data, pending }, links, hub, owed, world, odds, green: { status: greenStatus, board: greenBoard }, invoices, email });
    return all.find((p) => p.id === room) ?? null;
  }, [room, minute, connected, data, pending, links, owed, world, board, greenStatus, greenBoard, invoices, email]);
}

/** The tempo and legend for the room a page shows (from its route unless named; `null` opts out). */
export function useTempo(room?: RoomId | null): { room: RoomId | null; tempo: Tempo; legend: string | null } {
  // Read at render: a room page mounts afresh on every move, and this keeps server rendering (tests) happy.
  const route = typeof window === "undefined" ? "today" : routeOf(window.location.pathname);
  const id = room === undefined ? roomOfRoute(route) : room;
  const p = useRoomPulse(id);
  return useMemo(() => (p ? { room: id, tempo: tempoOf(p), legend: legendOf(p) } : { room: id, tempo: NEUTRAL, legend: null }), [p, id]);
}
