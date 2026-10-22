import { describe, expect, it } from "vitest";
import { SUBMINDS } from "@ceo/simulator";
import type { WorldFeed } from "../chronicle.ts";
import { EMPTY_FOUNDRY, type Crate } from "../foundry.ts";
import type { Link } from "../systems.ts";
import { PORTRAITS } from "./portraits.ts";
import { ROOM_META, ROOM_ORDER, roomPhrase, roomPulses, skippyLine, type PulseInput } from "./roomPulse.ts";

const NOW = Date.parse("2026-10-22T19:00:00Z");
const DAY = new Date(NOW).setHours(0, 0, 0, 0);
const link = (id: string, state: Link["state"]): Link => ({ id, label: id, what: "", kind: "service", room: "foundry", state, load: 0, lastSeen: null });
const crate = (p: Partial<Crate>): Crate => ({ number: 1, title: "Show the Tide", kind: "build", state: "working", rung: 2, url: "u", updatedAt: NOW - 60_000, pitch: "", size: null, revising: false, ...p });

const input = (patch: Partial<PulseInput> = {}): PulseInput => ({
  now: NOW,
  dayStart: DAY,
  foundry: { connected: true, data: EMPTY_FOUNDRY, pending: [] },
  links: [link("hub", "off"), link("checks", "ok"), link("world", "ok"), link("mac", "off")],
  hub: "off",
  owed: 0,
  world: null,
  ...patch,
});

describe("room pulses", () => {
  it("covers all nine rooms, each with its submind from docs/SKIPPY.md and a portrait", () => {
    const pulses = roomPulses(input());
    expect(pulses.map((p) => p.id)).toEqual([...ROOM_ORDER]);
    for (const p of pulses) {
      const mind = SUBMINDS.find((m) => m.id === p.submind.id);
      expect(mind?.name, p.id).toBe(p.submind.title);
      expect(PORTRAITS[p.submind.id]?.room).toBe(p.id);
      expect(ROOM_META[p.id].colour).toMatch(/^var\(--room-/);
    }
  });

  it("speaks from real data where a room is real, and says plainly when it is only simulated", () => {
    const data = { ...EMPTY_FOUNDRY, crates: [crate({})], changelog: [{ key: "a", at: NOW - 3_600_000, title: "Bell", kind: "build" as const, issue: null, landed: null, by: null, short: "", approval: "auto" as const, origin: "builder" as const }] };
    const pulses = roomPulses(input({ foundry: { connected: true, data, pending: [] } }));
    const foundry = pulses.find((p) => p.id === "foundry")!;
    expect(foundry.state).toBe("busy");
    expect(foundry.report).toContain("1 job on the bench");
    expect(foundry.report).toContain("1 shipped today");
    expect(foundry.events.length).toBe(2);
    const relay = pulses.find((p) => p.id === "relay")!;
    expect(relay.state).toBe("waiting");
    expect(relay.status).toBe("Waiting on the Mac");
    const boiler = pulses.find((p) => p.id === "boiler")!;
    expect(boiler.report).toMatch(/^2 links up, 2 not connected yet/);
    const exchange = pulses.find((p) => p.id === "exchange")!;
    expect(exchange).toMatchObject({ real: false, state: "sim", short: "no odds yet" });
    for (const id of ["breakroom", "spire", "green", "workshop"]) {
      const p = pulses.find((x) => x.id === id)!;
      expect(p.real).toBe(false);
      expect(p.state).toBe("sim");
      expect(p.report.toLowerCase()).toContain("nothing real");
    }
  });

  it("says the Exchange's odds are live once Polymarket answers, and never a dollar figure", () => {
    const links = [...input().links, link("polymarket", "ok")];
    const live = roomPulses(input({ links, odds: { markets: 10, lead: { question: "Fed cut?", prob: 0.63 } } })).find((p) => p.id === "exchange")!;
    expect(live).toMatchObject({ real: true, state: "steady", short: "odds live", status: "Polymarket odds live" });
    expect(live.report).toContain("10 markets on the board, the busiest at 63%");
    expect(live.report).not.toMatch(/\$/);
    expect(roomPhrase(live)).toBe("the Exchange's odds are live");
    const slow = roomPulses(input({ links: [...input().links, link("polymarket", "slow")], odds: null })).find((p) => p.id === "exchange")!;
    expect(slow.short).toBe("odds stale");
    const down = roomPulses(input({ links: [...input().links, link("polymarket", "down")] })).find((p) => p.id === "exchange")!;
    expect(down).toMatchObject({ state: "down", short: "odds down" });
  });

  it("knots the simulated rooms only on the living Lattice's own scenes", () => {
    const world = { recent: [{ at: new Date(NOW - 7_200_000).toISOString(), scenes: [{ room: "green", title: "", lines: [] }], source: "claude", summary: "" }] } as unknown as WorldFeed;
    const pulses = roomPulses(input({ world }));
    expect(pulses.find((p) => p.id === "green")!.events).toHaveLength(1);
    expect(pulses.find((p) => p.id === "spire")!.events).toHaveLength(0);
    expect(pulses.find((p) => p.id === "archive")!.status).toBe("1 hour written today");
  });

  it("lets Skippy count what needs a human", () => {
    const pulses = roomPulses(input());
    expect(skippyLine(0, pulses)).toMatch(/^Nothing needs a human/);
    expect(skippyLine(1, pulses)).toMatch(/^One thing needs a human/);
    expect(skippyLine(3, pulses)).toMatch(/^Three things need a human/);
  });
});
