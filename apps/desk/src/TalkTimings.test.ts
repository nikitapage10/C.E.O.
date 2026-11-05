import { describe, expect, it } from "vitest";
import { callSteps, isTalkCallsView, slowestStage } from "./TalkTimings.tsx";
import { serverStages } from "./skippy/talkBeacon.ts";

const call = (firstWord: number, token: number) => ({
  at: String(firstWord),
  ok: true,
  stages: {
    mic: 500,
    token: 500 + token,
    connected: firstWord - 200,
    firstWord,
  },
  server: { eleven: 400 },
});

describe("the Boiler Room's Talk timings (#512)", () => {
  it("splits a call into its steps", () => {
    expect(callSteps(call(3000, 1000))).toEqual([
      ["mic", 500],
      ["token", 1000],
      ["connected", 1300],
      ["firstWord", 200],
      ["eleven", 400],
    ]);
  });
  it("names the stage that is typically slowest", () => {
    expect(slowestStage([call(3000, 1000), call(3500, 1200)])).toEqual({
      stage: "connected",
      ms: 1450,
    });
    expect(slowestStage([])).toBeNull();
  });
  it("checks the answer's shape", () => {
    expect(isTalkCallsView({ ok: true, calls: [call(3000, 1000)] })).toBe(true);
    expect(isTalkCallsView({ ok: true, calls: [{ at: "x" }] })).toBe(false);
    expect(isTalkCallsView({ error: "not-set-up" })).toBe(false);
  });
  it("turns the Server-Timing string into numbers", () => {
    expect(serverStages("auth=4 eleven=700 junk")).toEqual({
      auth: 4,
      eleven: 700,
    });
    expect(serverStages(undefined)).toEqual({});
  });
});
