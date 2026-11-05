import type { RoomId } from "../../chronicle.ts";
import type { RoomPulse } from "../roomPulse.ts";

/**
 * Reads a room's pulse (roomPulse.ts) for the flow kit's tempo (useTempo.ts). The kit reads no room's data and
 * imports no room (#617): the Desk hands it this hook once, as it starts (desk/roomHooks.ts, `useRoomPulse`), before
 * any page renders. Until then (the flow harness, a test) every room reads as no pulse, so its lines keep the neutral
 * tempo. On its own, so handing it over doesn't pull the tempo into the Desk's first load.
 */
export type PulseReader = (room: RoomId | null) => RoomPulse | null;

const noPulse: PulseReader = () => null;
let reader: PulseReader = noPulse;

/** Hands the kit the Desk's pulse hook. Call once, before the Desk renders: a hook can't change between renders. */
export function setPulseReader(read: PulseReader): void {
  reader = read;
}

/** The pulse hook the Desk handed over (a no-pulse stand-in before). */
export const pulseReader = (): PulseReader => reader;
