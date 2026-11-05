import { describe, expect, it } from "vitest";
import { pipeRows, systemsModel } from "../systemsGraph.ts";
import { readPipes } from "./pipes.ts";
import { roomSections } from "./rooms.ts";
import { cardOf, NODE_H, NODE_W, rank, schematic } from "./schematic.ts";

const NOW = Date.UTC(2026, 10, 5, 1, 0);
const LIVE = { gmail: "ok", sleeper: "ok", polymarket: "ok", paypal: "ok", petlibro: "ok", whisker: "ok", roborock: "ok", nest: "ok", tasks: "ok", kroger: "ok", fantasypros: "ok" } as const;

function build(links: Record<string, "ok" | "slow" | "off" | "down">) {
  const model = systemsModel({ links, foundry: { nodes: [], edges: [] }, connected: true, building: null, clock: { state: "ok", headline: "On time" }, world: null, pings: true, vqa: "ok" });
  const rows = pipeRows(model.nodes, model.over, model.flows);
  const map = readPipes({ now: NOW, nodes: model.nodes, links, jobs: [], vqa: null, security: null, clock: { state: "ok", at: NOW - 60_000 } });
  return { model, sections: roomSections({ now: NOW, rows, map, jobs: [], signedIn: false, lastSeen: {}, caps: {} }) };
}

describe("each room's own schematic (#751)", () => {
  it("draws every pipe the room has, as a part or a link, with no two plates on one spot", () => {
    const { model, sections } = build({ ...LIVE });
    for (const sec of sections) {
      for (const dir of ["lr", "tb"] as const) {
        const s = schematic(sec, model, dir);
        const shown = new Set([...s.nodes.map((n) => n.pipe), ...s.links.map((l) => l.pipe)]);
        for (const p of sec.pipes) expect(shown.has(p.id), `${sec.id} ${p.id}`).toBe(true);
        const ids = s.nodes.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const a of s.nodes)
          for (const b of s.nodes) if (a !== b) expect(Math.abs(a.x - b.x) >= NODE_W || Math.abs(a.y - b.y) >= NODE_H, `${sec.id} ${a.id}/${b.id}`).toBe(true);
        for (const l of s.links) expect(ids).toEqual(expect.arrayContaining([l.a, l.b]));
      }
    }
  });

  it("takes the Relay's parts and links from its real flow, and a broken Gmail breaks its link", () => {
    const { model, sections } = build({ ...LIVE, gmail: "down" });
    const relay = schematic(sections.find((s) => s.id === "relay")!, model);
    expect(relay.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["mac", "hub", "bluebubbles", "gmail", "dialtone", "blasto"]));
    const gmail = relay.links.find((l) => l.a === "gmail" && l.b === "dialtone")!;
    expect(gmail.state).toBe("leak");
    expect(gmail.how).toBeTruthy();
    // The hub isn't installed: its links lie dashed, not connected yet.
    expect(relay.links.find((l) => l.a === "mac" && l.b === "hub")!.state).toBe("dry");
    // Flow runs left to right: every forward link goes to a later column.
    for (const l of relay.links.filter((x) => !x.back)) expect(relay.nodes.find((n) => n.id === l.b)!.rank).toBeGreaterThan(relay.nodes.find((n) => n.id === l.a)!.rank);
  });

  it("gives a part or link with no pipe its own card from the model's words", () => {
    const { model, sections } = build({ ...LIVE });
    const sec = sections.find((s) => s.id === "boiler")!;
    const s = schematic(sec, model);
    const l = s.links.find((x) => x.a === "cron" && x.b === "step")!;
    const card = cardOf({ link: l }, sec, s.nodes);
    expect(card.id).toBe(`schem:boiler:cron>step`);
    expect(card.facts?.how).toMatch(/cron/i);
    expect(card.what).toContain("→");
  });

  it("ranks a loop without running forever", () => {
    const r = rank(["a", "b", "c"], [
      { a: "a", b: "b" },
      { a: "b", b: "c" },
      { a: "c", b: "a" },
    ]);
    expect([...r.values()].every((v) => v < 3)).toBe(true);
  });
});
