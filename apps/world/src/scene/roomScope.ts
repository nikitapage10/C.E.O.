import type { RoomId } from "@ceo/core";
import { createContext, useContext } from "react";
import { create } from "zustand";

/** Which parts of the world may load yet: scene/streaming.ts decides, the scene reads it here. */
interface StreamingStore {
  /** The room the Lattice opened on, loaded ahead of the rest; null when it opened on the overview. */
  first: RoomId | null;
  /** Every room's models, agents and pets may load: the overview, or the first room is in. */
  all: boolean;
}

export const useStreaming = create<StreamingStore>(() => ({ first: null, all: true }));

/** The room a part of the scene belongs to; null outside any room (the Kernel, the agents, the pets). */
export const RoomScope = createContext<RoomId | null>(null);

/** Whether the models in this part of the scene should load yet. */
export function useStreamedIn(): boolean {
  const room = useContext(RoomScope);
  return useStreaming((s) => s.all || room === null || s.first === room);
}
