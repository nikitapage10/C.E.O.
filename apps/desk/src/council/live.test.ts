import { describe, expect, it } from "vitest";
import type { Change } from "../../../world/src/foundry.ts";
import type { RoomPulse } from "../roomPulse.ts";
import { councilLines, kernelLive, LIT_MS, memberLive } from "./live.ts";

const NOW = Date.UTC(2026, 10, 4, 18);
const pulse = (id: string, over: Partial<RoomPulse> = {}): RoomPulse =>
  ({ id, name: id, colour: "", submind: { id, title: id, active: true }, real: true, state: "steady", activity: 0.2, status: `${id} status`, short: "", drive: "", report: "", events: [], href: "/", ...over }) as RoomPulse;

describe("memberLive", () => {
  it("stays dark while nothing is happening", () => {
    expect(memberLive(pulse("boiler"), NOW)).toBe(0);
    expect(memberLive(pulse("archive", { events: [NOW - LIT_MS - 1] }), NOW)).toBe(0);
  });
  it("never lights a room that isn't connected", () => {
    expect(memberLive(pulse("studio", { real: false, state: "sim", events: [NOW] }), NOW)).toBe(0);
  });
  it("lights work under way and trouble", () => {
    expect(memberLive(pulse("foundry", { state: "busy" }), NOW)).toBe(1);
    expect(memberLive(pulse("boiler", { state: "down" }), NOW)).toBe(1);
  });
  it("lights a fresh real event, fading over the window", () => {
    const fresh = memberLive(pulse("archive", { events: [NOW - 60_000] }), NOW);
    const older = memberLive(pulse("archive", { events: [NOW - LIT_MS + 60_000] }), NOW);
    expect(fresh).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(0.5);
  });
  it("ignores routine checks and Ilyr scenes in other rooms", () => {
    expect(memberLive(pulse("relay", { events: [NOW - 1000] }), NOW)).toBe(0);
    expect(memberLive(pulse("exchange", { events: [NOW - 1000] }), NOW)).toBe(0);
  });
  it("lights Skippy with his Council", () => {
    expect(kernelLive([0, 0])).toBe(0);
    expect(kernelLive([0, 0.2])).toBe(0.5);
    expect(kernelLive([0.9, 0])).toBe(0.9);
  });
});

describe("councilLines", () => {
  const change = (n: number, at: number): Change => ({ key: `c${n}`, at, title: `Idea: thing ${n}`, kind: "build", issue: { number: n, url: "" }, landed: null, by: "tessellate", short: "" }) as Change;

  it("says only what lit members are doing, from the real feed", () => {
    const lines = councilLines({
      pulses: [pulse("foundry", { state: "busy", doing: "Rusty on #717, Tuning Today's Skippies" }), pulse("boiler"), pulse("relay", { state: "busy", status: "2 emails need you" })],
      changes: [change(700, NOW - 5 * 60_000), change(600, NOW - LIT_MS * 3)],
      ilyr: [],
      now: NOW,
    });
    expect(Object.keys(lines).sort()).toEqual(["foundry", "relay"]);
    expect(lines.foundry!.map((l) => l.text)).toEqual(["Rusty on #717, Tuning Today's Skippies", "Shipped #700 Thing 700 · Rusty"]);
    expect(lines.relay![0]!.text).toBe("2 emails need you");
  });

  it("gives the Archive its newest hour, clipped", () => {
    const summary = "The Foundry crew argued about lanterns for an hour while the Archive wrote every word of it down, twice, in ink.";
    const lines = councilLines({ pulses: [pulse("archive", { events: [NOW - 60_000] })], changes: [], ilyr: [{ step: 1, at: new Date(NOW - 60_000).toISOString(), summary } as never], now: NOW });
    const t = lines.archive![0]!.text;
    expect(t.startsWith("New hour of Ilyr: The Foundry crew")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(72);
    expect(t.endsWith("…")).toBe(true);
  });
});
