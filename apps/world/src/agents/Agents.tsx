import { useShallow } from "zustand/react/shallow";
import { roomIn, useStreaming } from "../scene/roomScope.ts";
import { useWorld } from "../store.ts";
import { Agent } from "./Agent.tsx";

export function Agents() {
  // Opened on a room, only the agents in the rooms let in so far join; the rest follow once it's in (scene/streaming.ts).
  const streaming = useStreaming();
  const ids = useWorld(
    useShallow((s) => {
      const agents = Object.keys(s.lattice.agents);
      return streaming.all ? agents : agents.filter((id) => roomIn(streaming, s.lattice.agents[id]!.place.room));
    }),
  );
  return (
    <group>
      {ids.map((id) => (
        <Agent key={id} id={id} />
      ))}
    </group>
  );
}
