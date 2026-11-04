import { describe, expect, it } from "vitest";
import { DEFAULT_GYM_PLAN } from "../../../../../api/_haven/gymShape.ts";
import { gymLine, nextSession, readGymView, scoreOf, setSeconds, weekOf, type GymLogEntry } from "./gym.ts";

/** The Gym's browser side (#660): the session laid out in time, the week, and the first line. Made-up logs only. */

const A = DEFAULT_GYM_PLAN.sessions[0]!;
const entry = (session: string): GymLogEntry => ({ id: `g-${session}-1`, session, at: "2026-11-03T01:00:00Z", via: "desk" });

describe("the Gym's score (#660)", () => {
  it("lays every set where it falls, with the middle of the rest range between sets and exercises", () => {
    const score = scoreOf(A, [45, 60]);
    expect(score.rest).toBe(53);
    expect(score.rows.map((r) => r.sets.length)).toEqual([3, 3, 3, 3]);
    // Dead bugs: 10 reps a side at 3 s, so 60 s a set.
    expect(setSeconds(A.exercises[0]!)).toBe(60);
    expect(score.rows[0]!.sets.map((s) => s.at)).toEqual([0, 113, 226]);
    expect(score.rows[1]!.from).toBe(score.rows[0]!.to + 53);
    // The side plank holds 30 s a side.
    expect(setSeconds(A.exercises[3]!)).toBe(60);
    // About twenty minutes, as the plan says.
    expect(Math.round(score.total / 60)).toBeGreaterThanOrEqual(18);
    expect(Math.round(score.total / 60)).toBeLessThanOrEqual(23);
  });

  it("puts the week Monday first with the sessions on their days", () => {
    expect(weekOf(DEFAULT_GYM_PLAN).map((d) => d.session?.id ?? "")).toEqual(["", "a", "", "", "b", "", ""]);
  });

  it("shows the next session not yet done, and says how the week stands", () => {
    expect(nextSession(DEFAULT_GYM_PLAN, [], 2).id).toBe("a");
    expect(nextSession(DEFAULT_GYM_PLAN, [], 3).id).toBe("b");
    expect(nextSession(DEFAULT_GYM_PLAN, [entry("a")], 2).id).toBe("b");
    expect(gymLine(DEFAULT_GYM_PLAN, [entry("a")], 3)).toBe("Core, twice a week. 1 of 2 done; Core day B is on Friday.");
    expect(gymLine(DEFAULT_GYM_PLAN, [], 2)).toBe("Core, twice a week. 0 of 2 done; Core day A is today.");
    expect(gymLine(DEFAULT_GYM_PLAN, [entry("a"), entry("b")], 6)).toBe("Core, twice a week. The week is done.");
  });

  it("reads a view only when its plan checks out", () => {
    expect(readGymView({ plan: DEFAULT_GYM_PLAN, isDefault: true, week: { start: "2026-11-02T07:00:00Z", done: [entry("a"), { bad: 1 }] }, weeks: [0, 1, "x"] })).toMatchObject({ isDefault: true, week: { done: [{ session: "a" }] }, weeks: [0, 1] });
    expect(readGymView({ plan: { v: 1 }, week: { start: "x", done: [] } })).toBeNull();
  });
});
