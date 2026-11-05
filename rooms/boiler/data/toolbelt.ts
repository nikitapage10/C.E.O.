import { needsConfirm, spokenSafe, type RoomTool } from "@ceo/engine/tools";

/**
 * Skippy's tools, room by room (#847), for the "Skippy's tools" circuit on Controls: every tool his agent can call, read
 * from the same registry the server runs (`@ceo/engine/tools`, plugged in by the Desk), sorted into what it does. Titles
 * and kinds only: a tool's description is the model's prompt and stays off the page. Pure.
 */

/** What a tool does, in the words the panel uses: it only reads, changes C.E.O.'s own lists, or waits for the Yes tap. */
export type ToolKind = "reads" | "changes" | "asks";

export const KIND_WORD: Record<ToolKind, string> = { reads: "reads", changes: "changes", asks: "asks first" };
/** The tone each kind is drawn in (the Boiler Room's shared tone classes, pages.css). */
export const KIND_TONE: Record<ToolKind, string> = { reads: "ok", changes: "tracked", asks: "warn" };

export interface BeltTool {
  name: string;
  title: string;
  kind: ToolKind;
  /** Works on a call and the room mics, which can't show a Yes button (`spokenSafe`). */
  spoken: boolean;
}

export interface BeltRoom {
  room: string;
  name: string;
  tools: BeltTool[];
}

export interface Belt {
  rooms: BeltRoom[];
  total: number;
  reads: number;
  changes: number;
  asks: number;
  spoken: number;
}

const ROOM_NAME: Record<string, string> = { today: "Today", foundry: "Foundry", relay: "Relay", green: "Green", exchange: "Exchange", boiler: "Boiler Room", haven: "Haven" };
export const roomName = (id: string): string => ROOM_NAME[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

export const kindOf = (t: Pick<RoomTool, "effect" | "confirm">): ToolKind => (needsConfirm(t) ? "asks" : t.effect === "read" ? "reads" : "changes");

/** The tools grouped by room, in the registry's order, with the totals the panel's line reads. */
export function toolbelt(tools: readonly RoomTool[]): Belt {
  const rooms: BeltRoom[] = [];
  const by = new Map<string, BeltRoom>();
  const belt: Belt = { rooms, total: 0, reads: 0, changes: 0, asks: 0, spoken: 0 };
  for (const t of tools) {
    let r = by.get(t.room);
    if (!r) {
      r = { room: t.room, name: roomName(t.room), tools: [] };
      by.set(t.room, r);
      rooms.push(r);
    }
    const kind = kindOf(t);
    const spoken = spokenSafe(t);
    r.tools.push({ name: t.name, title: t.title, kind, spoken });
    belt.total++;
    belt[kind]++;
    if (spoken) belt.spoken++;
  }
  return belt;
}

/** The circuit's one line: "21 tools in 7 rooms · 4 ask first". */
export function beltLine(b: Belt): string {
  if (b.total === 0) return "none plugged in";
  const tools = `${b.total} ${b.total === 1 ? "tool" : "tools"} in ${b.rooms.length} ${b.rooms.length === 1 ? "room" : "rooms"}`;
  return b.asks ? `${tools} · ${b.asks} ${b.asks === 1 ? "asks" : "ask"} first` : tools;
}
