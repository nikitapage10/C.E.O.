import type { RoomId } from "@ceo/core";

/** A Skippy submind: the lead of one room, in the admiral can, in its own colour. */
export interface Submind {
  id: string;
  name: string;
  room: RoomId;
  /** The colour it is known by: its hat and coat, and the glow under it. */
  colour: string;
  /** Its thread's name in Skippy's pattern, "Skippy, the <job>". */
  job: string;
  /**
   * Whether it is active: its room has a real API integrated, so it has its own "Skippy, the <job>" thread in the
   * project and leads real work (Nikita, 2026-10-22). The rest are played by the simulator until their room goes real.
   * This is the one list the Desk and the Lattice read (docs/SKIPPY.md, "The subminds").
   */
  active: boolean;
}

/**
 * The nine subminds, one per room. A leaf module with no runtime imports, so the Desk can read who is active without
 * pulling in the simulator.
 */
export const SUBMINDS: readonly Submind[] = [
  { id: "ember", name: "The Builder", room: "foundry", colour: "#ff7a3d", job: "Builder", active: true },
  { id: "gilt", name: "The Executive", room: "spire", colour: "#e8b84a", job: "Executive", active: false },
  { id: "ticker", name: "The Bookie", room: "exchange", colour: "#4fd18b", job: "Bookie", active: true },
  { id: "turf", name: "The Commentator", room: "green", colour: "#a3e04f", job: "Commentator", active: true },
  { id: "static", name: "The Messenger", room: "relay", colour: "#4fa8ff", job: "Messenger", active: false },
  { id: "vellum", name: "The Historian", room: "archive", colour: "#a07aff", job: "Historian", active: false },
  { id: "fizz", name: "The Life of the Party", room: "breakroom", colour: "#ff6fae", job: "Life of the Party", active: false },
  { id: "soot", name: "The Pessimist", room: "boiler", colour: "#c9d3d8", job: "Pessimist", active: true },
  { id: "putty", name: "The Artiste", room: "workshop", colour: "#3fd6c8", job: "Artiste", active: false },
];

export const SUBMIND_IDS: ReadonlySet<string> = new Set(SUBMINDS.map((m) => m.id));
export const isSubmind = (id: string) => SUBMIND_IDS.has(id);
export const submindOf = (room: RoomId): Submind => SUBMINDS.find((m) => m.room === room)!;
/** Whether a room's submind is active, with its own thread. */
export const submindActive = (room: RoomId): boolean => submindOf(room).active;
