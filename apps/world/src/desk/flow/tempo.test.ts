import { describe, expect, it } from "vitest";
import { EMPTY_FOUNDRY, type Crate } from "../../foundry.ts";
import type { Link } from "../../systems.ts";
import { roomPulses, type PulseInput } from "../roomPulse.ts";
import { driveOf, IDLE, legendOf, NEUTRAL, tempoLine, tempoOf } from "./tempo.ts";
import { roomOfRoute } from "./useTempo.ts";

const NOW = Date.parse("2026-10-22T19:00:00Z");
const DAY = new Date(NOW).setHours(0, 0, 0, 0);
const link = (id: string, state: Link["state"]): Link => ({ id, label: id, what: "", kind: "service", room: "foundry", state, load: 0, lastSeen: null });
const crate = (p: Partial<Crate>): Crate => ({ number: 1, title: "Show the Tide", kind: "build", state: "working", rung: 2, url: "u", updatedAt: NOW - 60_000, pitch: "", size: null, revising: false, ...p });
const input = (patch: Partial<PulseInput> = {}): PulseInput => ({
  now: NOW,
  dayStart: DAY,
  foundry: { connected: true, data: EMPTY_FOUNDRY, pending: [] },
  links: [link("hub", "off"), link("checks", "ok"), link("world", "ok")],
  hub: "off",
  owed: 0,
  world: null,
  ...patch,
});
const live = (activity: number) => ({ real: true, state: "steady" as const, activity });

describe("activity to motion (#262)", () => {
  it("speeds up, thickens and brightens with a room's real activity", () => {
    const quiet = tempoOf(live(0.1));
    const mid = tempoOf(live(0.35));
    const busy = tempoOf(live(1));
    for (const k of ["rate", "density", "bright", "spread"] as const) {
      expect(quiet[k], k).toBeLessThan(mid[k]);
      expect(mid[k], k).toBeLessThan(busy[k]);
    }
    // The middle of the range leaves a page's own look exactly as it was.
    expect(mid).toMatchObject({ rate: 1, density: 1, bright: 1, spread: 1, idle: false });
  });

  it("idles rooms with nothing connected or still waiting on their source, whatever their activity", () => {
    expect(tempoOf({ real: false, state: "sim", activity: 0.9 })).toBe(IDLE);
    expect(tempoOf({ real: true, state: "waiting", activity: 0.9 })).toBe(IDLE);
    expect(IDLE.rate).toBeLessThan(tempoOf(live(0)).rate);
  });

  it("holds a room that's down low, and keeps a page with no room as it is", () => {
    expect(tempoOf({ real: true, state: "down", activity: 1 }).level).toBeLessThanOrEqual(0.15);
    expect(tempoOf(null)).toBe(NEUTRAL);
    expect(tempoOf({ real: true, state: "busy", activity: Number.NaN }).level).toBe(0);
  });

  it("quantises the level so a small change never re-lays the field", () => {
    expect(tempoOf(live(0.52))).toEqual(tempoOf(live(0.48)));
  });

  it("scales a line's own numbers, never past full density or brightness, and leaves waiting lines alone", () => {
    const busy = tempoOf(live(1));
    const m = tempoLine(busy, { rate: 40, density: 0.9, bright: 0.95, spread: 2 });
    expect(m.rate).toBeGreaterThan(40);
    expect(m.density).toBe(1);
    expect(m.bright).toBe(1);
    expect(m.spread).toBeGreaterThan(2);
    expect(tempoLine(busy, { waiting: true, rate: 0, density: 0 })).toMatchObject({ rate: 0, density: 0 });
    expect(tempoLine(NEUTRAL, {})).toEqual({ rate: 40, density: 0.5, bright: 0.85, spread: 2 });
  });

  it("drives the Foundry hardest from crew runs and open pull requests, and says so in the legend", () => {
    const quiet = roomPulses(input()).find((p) => p.id === "foundry")!;
    const crates = [crate({ number: 1 }), crate({ number: 2, state: "ready" }), crate({ number: 3, updatedAt: DAY - 3_600_000 })];
    const changelog = [{ key: "a", at: NOW - 3_600_000, title: "Bell", kind: "build" as const, issue: { number: 2, url: "u" }, landed: null, by: null, short: "", approval: "auto" as const, origin: "builder" as const }];
    const prs = [1, 2].map((number) => ({ number, url: "u", at: NOW, draft: false, issue: null, checks: "running" as const }));
    const busy = roomPulses(input({ foundry: { connected: true, data: { ...EMPTY_FOUNDRY, crates, changelog, prs }, pending: [] } })).find((p) => p.id === "foundry")!;
    expect(busy.drive).toBe("2 runs today · 2 PRs open");
    expect(legendOf(busy)).toBe("Foundry · 2 runs today · 2 PRs open");
    expect(tempoOf(busy).rate).toBeGreaterThan(tempoOf(quiet).rate);
    expect(quiet.drive).toBe("0 runs today");
  });

  it("gives every room a legend from its own real reads, and idle ones say so", () => {
    const pulses = roomPulses(input());
    for (const p of pulses) expect(p.drive.length, p.id).toBeGreaterThan(0);
    const workshop = pulses.find((p) => p.id === "workshop")!;
    expect(legendOf(workshop)).toBe("Workshop · idle, nothing connected");
    expect(pulses.find((p) => p.id === "boiler")!.drive).toBe("2 of 3 links up");
    const { lead, idle } = driveOf(pulses);
    const levels = lead.map((p) => tempoOf(p).level);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(lead.length).toBeLessThanOrEqual(3);
    expect(lead.every((p) => !tempoOf(p).idle)).toBe(true);
    expect(idle).toBe(pulses.filter((p) => tempoOf(p).idle).length);
  });

  it("reads the room from the page's route; Today and the Lattice have none", () => {
    expect(roomOfRoute("foundry")).toBe("foundry");
    expect(roomOfRoute("green")).toBe("green");
    expect(roomOfRoute("today")).toBeNull();
    expect(roomOfRoute("lattice")).toBeNull();
  });
});
