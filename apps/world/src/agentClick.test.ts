import { beforeEach, describe, expect, it } from "vitest";
import { useWorld } from "./store";

describe("clicking a character", () => {
  beforeEach(() => {
    const lattice = useWorld.getState().lattice;
    const agent = (room: string) => ({ place: { room } }) as never;
    useWorld.setState({
      selectedAgent: null,
      hoveredAgent: null,
      focus: null,
      lattice: { ...lattice, agents: { ada: agent("lab"), bo: agent("breakroom") } },
    });
  });

  it("hovering does not open the info", () => {
    const id = Object.keys(useWorld.getState().lattice.agents)[0]!;
    useWorld.getState().hoverAgent(id);
    expect(useWorld.getState().hoveredAgent).toBe(id);
    expect(useWorld.getState().selectedAgent).toBeNull();
  });

  it("a click opens it, focuses their room, and a second click closes it", () => {
    const id = Object.keys(useWorld.getState().lattice.agents)[0]!;
    useWorld.getState().toggleAgent(id);
    expect(useWorld.getState().selectedAgent).toBe(id);
    expect(useWorld.getState().focus).toBe(useWorld.getState().lattice.agents[id]!.place.room);
    useWorld.getState().toggleAgent(id);
    expect(useWorld.getState().selectedAgent).toBeNull();
  });

  it("clicking another character switches to them", () => {
    const [a, b] = Object.keys(useWorld.getState().lattice.agents);
    useWorld.getState().toggleAgent(a!);
    useWorld.getState().toggleAgent(b!);
    expect(useWorld.getState().selectedAgent).toBe(b);
  });
});
