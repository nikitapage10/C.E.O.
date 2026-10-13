import { useShallow } from "zustand/react/shallow";
import { useStreaming } from "../scene/roomScope.ts";
import { useWorld } from "../store.ts";
import { Agent } from "./Agent.tsx";

export function Agents() {
  // Opened on a room, only the agents in it join at first; the rest follow once it's in (scene/streaming.ts).
  const first = useStreaming((s) => (s.all ? null : s.first));
  const ids = useWorld(
    useShallow((s) => {
      const agents = Object.keys(s.lattice.agents);
      return first ? agents.filter((id) => s.lattice.agents[id]!.place.room === first) : agents;
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
