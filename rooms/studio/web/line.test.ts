import { describe, expect, it } from "vitest";
import type { Episode } from "../data/desk.ts";
import { isQuestion, openOn, short, stageOn, stepsOf } from "../data/desk.ts";
import { stepTo } from "./line.ts";

describe("the Studio's timeline keys", () => {
  it("steps with the arrows and stops at the ends", () => {
    expect(stepTo("ArrowRight", 0, 4)).toBe(1);
    expect(stepTo("ArrowLeft", 0, 4)).toBe(0);
    expect(stepTo("ArrowRight", 3, 4)).toBe(3);
    expect(stepTo("ArrowDown", 1, 4)).toBe(2);
    expect(stepTo("ArrowUp", 2, 4)).toBe(1);
  });
  it("jumps to the ends with Home and End, and leaves other keys alone", () => {
    expect(stepTo("Home", 3, 4)).toBe(0);
    expect(stepTo("End", 1, 4)).toBe(3);
    expect(stepTo("w", 2, 4)).toBeNull();
    expect(stepTo(" ", 2, 4)).toBeNull();
  });
});

const ep = (n: number, stages: Episode["stages"]): Episode => ({ id: `ep${n}`, n, title: `Episode ${n}`, stages });

describe("the Studio desk on the page", () => {
  it("puts an episode on its first stage not approved", () => {
    expect(stageOn(ep(3, { pitch: { status: "approved" }, mix: { status: "ready" } }))).toBe(1);
    expect(stageOn(ep(3, {}))).toBe(0);
    expect(stageOn(ep(1, { pitch: { status: "done" }, mix: { status: "done" }, render: { status: "done" }, post: { status: "done" } }))).toBe(3);
  });
  it("opens on the newest episode still on the line", () => {
    const posted = ep(1, { post: { status: "done" } });
    expect(openOn([posted, ep(2, {}), ep(3, { post: { status: "approved" } })])).toBe(1);
    expect(openOn([posted])).toBe(0);
    expect(openOn([])).toBe(-1);
  });
  it("draws four stages with their state on the monitors", () => {
    expect(stepsOf(ep(3, { pitch: { status: "approved" }, mix: { status: "working" } })).map((s) => s.w)).toEqual(["Approved", "In the works", "Waiting", "Waiting"]);
    expect(stepsOf(undefined)).toHaveLength(4);
  });
  it("hands questions to the Director and keeps the rest as notes", () => {
    expect(isQuestion("Why is the poster small?")).toBe(true);
    expect(isQuestion("can you make it bigger")).toBe(true);
    expect(isQuestion("The poster's too small, make it bigger")).toBe(false);
    expect(isQuestion("cut the second joke")).toBe(false);
  });
  it("shortens big counts", () => {
    expect(short(812)).toBe("812");
    expect(short(8_122)).toBe("8.1K");
    expect(short(12_400)).toBe("12K");
    expect(short(1_500_000)).toBe("1.5M");
  });
});
