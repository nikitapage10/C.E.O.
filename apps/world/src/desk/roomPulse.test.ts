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

  it("marks the subminds of rooms with a real API active, from the one list in the simulator (docs/SKIPPY.md)", () => {
    const active = roomPulses(input()).filter((p) => p.submind.active).map((p) => p.submind.title).sort();
    expect(active).toEqual(["The Bookie", "The Builder", "The Commentator", "The Messenger", "The Pessimist"]);
    for (const m of SUBMINDS) expect(ROOM_META[m.room].submind.active, m.room).toBe(m.active);
  });

  it("runs Relay on the email line's public counts while the Mac's hub waits, and never shows more than counts (#322)", () => {
    const email = { v: 1 as const, at: NOW, gmail: "connected" as const, agent: "listening" as const, needsYou: 2, fyi: 3, noise: 9, newToday: 14, unsorted: 0, budgetPct: 4, lastCheck: NOW - 30_000 };
    const relay = roomPulses(input({ email })).find((p) => p.id === "relay")!;
    expect(relay).toMatchObject({ real: true, state: "busy", status: "2 emails need you", short: "2 emails" });
    expect(relay.report).toContain("14 new emails today, 2 need you, 3 FYI, 9 noise");
    expect(relay.report).toContain("Texts still wait on the Mac");
    expect(relay.events).toEqual([NOW - 30_000]);
    const quiet = roomPulses(input({ email: { ...email, needsYou: 0 } })).find((p) => p.id === "relay")!;
    expect(quiet).toMatchObject({ state: "steady", status: "Email is quiet" });
    const notYet = roomPulses(input({ email: { ...email, gmail: "not-connected" } })).find((p) => p.id === "relay")!;
    expect(notYet.status).toBe("Waiting on the Mac");
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

  it("makes the Spire real once PayPal answers, with counts and never an amount", () => {
    const at = NOW;
    const waiting = roomPulses(input({ invoices: { v: 1, at, paypal: "waiting", mode: "sandbox", drafts: 0, open: 0, overdue: 0, paid: 0 } })).find((p) => p.id === "spire")!;
    expect(waiting).toMatchObject({ real: false, state: "sim" });
    const live = roomPulses(input({ invoices: { v: 1, at, paypal: "live", mode: "sandbox", drafts: 1, open: 2, overdue: 1, paid: 3 } })).find((p) => p.id === "spire")!;
    expect(live).toMatchObject({ real: true, state: "busy", status: "1 overdue" });
    expect(live.report).toContain("2 open invoices, 1 overdue, 1 draft waiting on your Send, in the sandbox");
    expect(live.report).not.toMatch(/\$/);
    const down = roomPulses(input({ invoices: { v: 1, at, paypal: "error", mode: "live", drafts: 0, open: 0, overdue: 0, paid: 0 } })).find((p) => p.id === "spire")!;
    expect(down).toMatchObject({ real: true, state: "down" });
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
