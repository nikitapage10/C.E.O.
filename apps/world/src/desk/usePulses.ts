import { useMemo } from "react";
import { useWorldFeed } from "../chronicle.ts";
import { useFoundry } from "../foundry.ts";
import { useSystems } from "../systems.ts";
import { roomPulses, type RoomPulse } from "./roomPulse.ts";

/** How far back the day's strip on Today reaches, so the knots never empty out just after midnight. */
export const DAY_STRIP_MS = 14 * 3_600_000;

/** The nine rooms' pulses from the live stores (roomPulse.ts), recomputed when any of them changes. */
export function usePulses(owed: number, now: number): RoomPulse[] {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const links = useSystems((s) => s.links);
  const world = useWorldFeed().feed;
  const hub = links.find((l) => l.id === "hub")?.state ?? "off";
  const minute = Math.floor(now / 60_000);
  return useMemo(() => {
    const at = minute * 60_000;
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    return roomPulses({ now: at, dayStart: d.getTime(), since: Math.min(d.getTime(), at - DAY_STRIP_MS), foundry: { connected, data, pending }, links, hub, owed, world });
  }, [connected, data, pending, links, hub, owed, world, minute]);
}
