import { useEffect, useMemo } from "react";
import { DESK_SUBMINDS } from "../../../../../packages/simulator/src/subminds.ts";
import { RC } from "@ceo/engine/sigils/wvCanvas.ts";
import { homeLine, startHome, useHome, type DeviceKind, type HomeLoad, type HomePublic, VENDOR_NAME, VENDORS } from "../homeDevices.ts";
import { POPUPS, useAnnex, type PopupStatus } from "../../../../../rooms/annex/data/annex.ts";
import type { RoomSubmind } from "../roomPulse.ts";
import type { CouncilPulse } from "./live.ts";

/**
 * The Desk's own subminds on the Council (#717): the Steward (the Haven, `hearth`) and the Stagehand (the Annex,
 * `stagehand`), from DESK_SUBMINDS, seated with the ten rooms' subminds. Real data only: the Haven from the home
 * devices' public face (kinds, states and whether each is online; never a place, a reading or an alert), the Annex from
 * its pop-ups' status. Nothing here is simulated, and a room that can't be reached says so and stays dark.
 */

/** Every member's colour ("r,g,b"): the rooms' from the engine, the Desk's own from DESK_SUBMINDS. */
export const COUNCIL_RC: Record<string, string> = {
  ...RC,
  ...Object.fromEntries(DESK_SUBMINDS.map((m) => [m.room, rgbOf(m.colour)])),
};

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

const mindOf = (room: "haven" | "annex"): RoomSubmind => {
  const m = DESK_SUBMINDS.find((x) => x.room === room)!;
  return { id: m.id, title: m.name, active: m.active };
};

const KIND: Record<DeviceKind, string> = { vacuum: "The vacuum", "dry-feeder": "The feeder", "wet-feeder": "The wet feeder", fountain: "The fountain", litter: "The litter box", thermostat: "The thermostat" };
/** A device at work right now (the fountain always runs and the thermostat always holds, so neither counts). */
const AT_WORK = /clean|mop|return|cycl|feed|dispens|empty/i;

export function havenPulse(load: HomeLoad, pub: HomePublic | null): CouncilPulse {
  const base = { id: "haven", name: "Haven", colour: "var(--room-haven)", submind: mindOf("haven"), href: "/haven", real: true, events: [] as number[] };
  if (load === "idle" || (load === "live" && !pub)) return { ...base, state: "waiting", activity: 0.05, status: "Reaching the house", short: "reaching the house", drive: "reaching the house", report: "One moment. I'm knocking on the house's door, politely." };
  if (load === "off") return { ...base, state: "waiting", activity: 0.05, status: "The house isn't connected here", short: "not connected here", drive: "nothing connected", report: "The house isn't connected on this copy of the Desk. I keep the key all the same." };
  if (load === "failed" || !pub) return { ...base, state: "down", activity: 0.1, status: "Can't reach the house", short: "house unreachable", drive: "house unreachable", report: "The house isn't answering. I'll keep trying the door." };
  const down = VENDORS.filter((v) => pub.vendors[v] === "down");
  const working = pub.devices.filter((d) => d.online && d.kind !== "fountain" && d.kind !== "thermostat" && AT_WORK.test(d.state));
  const line = homeLine(pub);
  if (down.length) {
    const what = `${VENDOR_NAME[down[0]!]} isn't answering`;
    return { ...base, state: "down", activity: 0.2, status: what, short: "a device down", drive: line, report: `${what}. The rest of the house is fine. I checked every room.` };
  }
  if (working.length) {
    const w = working[0]!;
    const doing = `${KIND[w.kind]} is ${w.state}${working.length > 1 ? `, and ${working.length - 1} more at work` : ""}`;
    return { ...base, state: "busy", activity: 0.5, status: doing, doing, short: "at work", drive: line, report: `${doing}. All in hand.` };
  }
  return { ...base, state: "steady", activity: 0.15, status: line === "not connected yet" ? "The house isn't connected yet" : `${line[0]!.toUpperCase()}${line.slice(1)}, all quiet`, short: "quiet", drive: line, report: "The house is quiet. Everything in its place." };
}

/** End of the pop-up's last day, local time (its `until` is a date like "Nov 4, 2026"). */
const endOf = (until: string) => {
  const t = Date.parse(until);
  return Number.isFinite(t) ? t + 86_400_000 : Infinity;
};

export function annexPulse(load: "idle" | "ready" | "local", status: Record<string, PopupStatus>, now: number): CouncilPulse {
  const base = { id: "annex", name: "Annex", colour: "var(--room-annex)", submind: mindOf("annex"), href: "/annex", real: true, events: [] as number[] };
  if (load === "idle") return { ...base, state: "waiting", activity: 0.05, status: "Checking the pop-ups", short: "checking", drive: "checking the pop-ups", report: "Checking which sets are up. Places, everyone." };
  const live = POPUPS.filter((p) => status[p.id] === "live" && now < endOf(p.until));
  if (live.length) {
    const p = live[0]!;
    return { ...base, state: "busy", activity: 0.6, status: `${p.name} is live`, doing: `${p.name} is live: ${p.line}`, short: "pop-up live", drive: `${live.length} pop-up${live.length === 1 ? "" : "s"} live`, report: `${p.name} is up and running. I'll strike the set when it's done.` };
  }
  return { ...base, state: "steady", activity: 0.1, status: "No pop-up running", short: "between shows", drive: "no pop-up live", report: "Nothing on stage right now. The next set is in the wings." };
}

/** The Desk's own subminds' pulses, from the live stores. */
export function useDeskPulses(now: number): CouncilPulse[] {
  useEffect(() => startHome(), []);
  useEffect(() => void useAnnex.getState().refresh(), []);
  const homeLoad = useHome((s) => s.load);
  const pub = useHome((s) => s.pub);
  const annexLoad = useAnnex((s) => s.load);
  const annex = useAnnex((s) => s.status);
  const minute = Math.floor(now / 60_000);
  return useMemo(() => [havenPulse(homeLoad, pub), annexPulse(annexLoad, annex, minute * 60_000)], [homeLoad, pub, annexLoad, annex, minute]);
}
