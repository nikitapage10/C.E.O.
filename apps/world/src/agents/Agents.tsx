import { useShallow } from "zustand/react/shallow";
import { useWorld } from "../store.ts";
import { Agent } from "./Agent.tsx";

export function Agents() {
  const ids = useWorld(useShallow((s) => Object.keys(s.lattice.agents)));
  return (
    <group>
      {ids.map((id) => (
        <Agent key={id} id={id} />
      ))}
    </group>
  );
}
