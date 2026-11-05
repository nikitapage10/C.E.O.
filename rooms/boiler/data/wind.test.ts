import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@ceo/desk/foundryGraph.ts";
import { pipeRows, systemsModel } from "./systemsGraph.ts";
import { readPipes } from "./pipes.ts";
import { roomSections } from "./rooms.ts";
import { bandWidth, CX, midOf, RZ, windRoom } from "./wind.ts";

const NOW = Date.UTC(2026, 10, 5, 4, 30);
const LIVE = { gmail: "ok", sleeper: "ok", polymarket: "ok", paypal: "ok", petlibro: "down", whisker: "ok", roborock: "ok", nest: "ok", tasks: "ok", kroger: "off", fantasypros: "ok" } as const;

/** The Foundry's real chain, so its run is long enough to wind. */
const CHAIN = ["nikita", "desk", "shaping", "issues", "queue", "builder", "rusty", "checks", "main", "deploy"];
const FOUNDRY = {
  nodes: CHAIN.map((id) => ({ id, label: id, sub: "", kind: id === "nikita" ? "person" : id === "rusty" ? "agent" : "service", state: "ok", status: "" })) as unknown as GraphNode[],
  edges: CHAIN.slice(1).map((to, i) => ({ from: CHAIN[i]!, to, label: "", what: "", state: "ok" })) as unknown as GraphEdge[],
};

function build() {
  const model = systemsModel({ links: LIVE, foundry: FOUNDRY, connected: true, building: null, clock: { state: "ok", headline: "On time" }, world: null, pings: true, vqa: "ok" });
  const rows = pipeRows(model.nodes, model.over, model.flows);
  const map = readPipes({ now: NOW, nodes: model.nodes, links: LIVE, jobs: [], vqa: null, security: null, clock: { state: "ok", at: NOW - 60_000 } });
  return { model, sections: roomSections({ now: NOW, rows, map, jobs: [], signedIn: false, lastSeen: {}, caps: {} }) };
}

describe("each room's own run in 3D (#789)", () => {
  it("draws every pipe the room has, as a station or a connection, no two stations on one spot", () => {
    const { model, sections } = build();
    for (const sec of sections) {
      const w = windRoom(sec, model);
      const shown = new Set([...w.nodes.map((n) => n.target), ...w.links.map((l) => l.target)]);
      for (const p of sec.pipes) expect(shown.has(p.id), `${sec.id} ${p.id}`).toBe(true);
      const spots = w.nodes.map((n) => `${n.at[0].toFixed(2)},${n.at[1].toFixed(2)}`);
      expect(new Set(spots).size, sec.id).toBe(spots.length);
      const keys = [...w.nodes, ...w.links].map((x) => x.key);
      expect(new Set(keys).size, sec.id).toBe(keys.length);
      // Every run turns at right angles and starts and ends on its parts.
      for (const l of w.links) {
        const a = w.nodes.find((n) => n.key === `n:${l.a}`)!;
        const b = w.nodes.find((n) => n.key === `n:${l.b}`)!;
        expect(l.path[0]).toEqual(a.at);
        expect(l.path[l.path.length - 1]).toEqual(b.at);
        for (let k = 1; k < l.path.length; k++) {
          const [p, q] = [l.path[k - 1]!, l.path[k]!];
          expect(Math.abs(p[0] - q[0]) < 1e-9 || Math.abs(p[1] - q[1]) < 1e-9, `${sec.id} ${l.key}`).toBe(true);
        }
      }
      // A card for everything that has no pipe of its own.
      const cards = new Set(w.cards.map((c) => c.id));
      for (const t of shown) if (!sec.pipes.some((p) => p.id === t)) expect(cards.has(t), `${sec.id} ${t}`).toBe(true);
    }
  });

  it("winds a long room into bands to fit the view, and keeps a short one in one", () => {
    const { model, sections } = build();
    const foundry = sections.find((s) => s.id === "foundry")!;
    const wide = windRoom(foundry, model, 1.6);
    expect(wide.bands).toBeGreaterThan(1);
    const xs = wide.nodes.map((n) => n.at[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual((wide.per - 1) * CX + 1e-6);
    // A taller view winds it more.
    expect(windRoom(foundry, model, 0.6).bands).toBeGreaterThanOrEqual(wide.bands);
    // The serpentine: a band's last part and the next band's first stand at the same end.
    const haven = windRoom(sections.find((s) => s.id === "haven")!, model, 1.6);
    expect(haven.bands).toBe(1);
    expect(bandWidth(10, 2, 1.6)).toBeLessThan(10);
    expect(bandWidth(3, 4, 1.6)).toBe(3);
  });

  it("carries each part's and link's state, a broken device cracked and an unconnected one dry", () => {
    const { model, sections } = build();
    const w = windRoom(sections.find((s) => s.id === "haven")!, model);
    expect(w.nodes.find((n) => n.key === "n:petlibro")!.state).toBe("leak");
    expect(w.links.find((l) => l.b === "petlibro")!.state).toBe("leak");
    expect(w.nodes.find((n) => n.key === "n:kroger")!.state).toBe("dry");
    expect(w.nodes.filter((n) => n.hub).map((n) => n.key)).toEqual(["n:haven"]);
  });

  it("finds the point halfway along a run", () => {
    expect(midOf([[0, 0], [2, 0], [2, 2]])).toEqual([2, 0]);
    expect(midOf([[0, 0], [0, RZ * 2]])).toEqual([0, RZ]);
  });
});
