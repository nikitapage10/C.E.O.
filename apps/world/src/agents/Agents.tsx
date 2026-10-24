import { useShallow } from "zustand/react/shallow";
import { clock } from "../clock.ts";
import { roomIn, useStreaming } from "../scene/roomScope.ts";
import { useWorld } from "../store.ts";
import { Agent } from "./Agent.tsx";

export function Agents() {
  // Opened on a room, only the agents in the rooms let in so far join; the rest follow once it's in (scene/streaming.ts).
  // A room on its own (#332) keeps its crew: whoever is in it or on the way in, and whoever is still on the way out
  // to the pad; they beam in and out of it there.
  const streaming = useStreaming();
  const ids = useWorld(
    useShallow((s) => {
      const agents = Object.keys(s.lattice.agents);
      if (streaming.all) return agents;
      return agents.filter((id) => {
        const rt = s.lattice.agents[id]!;
        if (roomIn(streaming, rt.place.room)) return true;
        const m = rt.motion;
        return !!streaming.solo && !!m && m.from.room === streaming.solo && clock.sim < m.startTs + m.duration;
      });
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
