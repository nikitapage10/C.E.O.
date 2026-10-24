import { describe, expect, it } from "vitest";
import { viewKey, viewOf, viewPath } from "./view.ts";

describe("the Lattice's views (#332)", () => {
  it("opens on the map, a room alone, or the whole ring", () => {
    expect(viewOf("")).toEqual({ kind: "map" });
    expect(viewOf("?room=relay")).toEqual({ kind: "room", room: "relay" });
    expect(viewOf("?room=nowhere")).toEqual({ kind: "map" });
    expect(viewOf("?view=ring")).toEqual({ kind: "ring", room: null });
    expect(viewOf("?view=ring&room=green")).toEqual({ kind: "ring", room: "green" });
  });

  it("keeps the page's switches when it moves between views", () => {
    expect(viewPath({ kind: "room", room: "foundry" }, "?instant&seed=7&room=relay")).toBe("/lattice?instant&seed=7&room=foundry");
    expect(viewPath({ kind: "map" }, "?instant&room=relay&view=ring")).toBe("/lattice?instant");
    expect(viewPath({ kind: "ring", room: null }, "")).toBe("/lattice?view=ring");
  });

  it("keys each 3D view apart", () => {
    expect(viewKey({ kind: "room", room: "spire" })).not.toBe(viewKey({ kind: "room", room: "green" }));
    expect(viewKey({ kind: "ring", room: "spire" })).toBe(viewKey({ kind: "ring", room: null }));
  });
});
