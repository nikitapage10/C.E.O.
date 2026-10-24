import type { RoomId } from "@ceo/core";
import { createContext, useContext } from "react";
import { create } from "zustand";

/** Which parts of the world may load yet: scene/streaming.ts decides, the scene reads it here. */
interface StreamingStore {
  /**
   * The rooms let in so far, one at a time (scene/streaming.ts, loadRoom): the room the Lattice opened on first.
   * Empty when it opened on the overview.
   */
  rooms: readonly RoomId[];
  /** Every room's models, agents and pets may load: the overview, or the first room is in. */
  all: boolean;
  /**
   * One room on its own (#332, `/lattice?room=relay`): only it is built, with its crew and pets; the other rooms, the
   * Kernel and the streams are not mounted at all, and nothing for them is fetched. Null for the whole ring.
   */
  solo: RoomId | null;
}

export const useStreaming = create<StreamingStore>(() => ({ rooms: [], all: true, solo: null }));

/** Whether a room's models, agents and pets may load yet. */
export const roomIn = (s: StreamingStore, room: RoomId) => s.all || s.rooms.includes(room);

/** The room a part of the scene belongs to; null outside any room (the Kernel, the agents, the pets). */
export const RoomScope = createContext<RoomId | null>(null);

/** Whether the models in this part of the scene should load yet. */
export function useStreamedIn(): boolean {
  const room = useContext(RoomScope);
  return useStreaming((s) => room === null || roomIn(s, room));
}
